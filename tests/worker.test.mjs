// Run: node tests/worker.test.mjs   — exercises src/worker.js with a locally generated "Google" RSA key (no network).
import worker, { verifyGoogleIdToken, makeSession, readSession, bytesToB64u, __resetJwksCache } from '../src/worker.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name, extra ?? ''); } };

const CLIENT = 'test-client.apps.googleusercontent.com', SECRET = 'unit-test-secret-unit-test-secret';
const te = new TextEncoder();
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pubJwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

let jwksFetches = 0;
globalThis.fetch = async (url) => {
  if (String(url).includes('googleapis.com/oauth2/v3/certs')) { jwksFetches++; return new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200 }); }
  throw new Error('unexpected fetch ' + url);
};

async function idToken(over = {}, key = kp.privateKey, kid = 'k1') {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '123', email: 'Ada@Example.com', email_verified: true, name: 'Ada', picture: 'https://lh3.example/p.png', iat: now, exp: now + 3600, ...over };
  const h = bytesToB64u(te.encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }))), p = bytesToB64u(te.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, te.encode(h + '.' + p)));
  return h + '.' + p + '.' + bytesToB64u(sig);
}
const rejects = async (p, reason) => { try { await p; return false; } catch (e) { return reason ? e.message === reason : true; } };

console.log('verifyGoogleIdToken');
ok('accepts a valid token', (await verifyGoogleIdToken(await idToken(), CLIENT)).email === 'Ada@Example.com');
ok('JWKS is cached (1 fetch so far)', jwksFetches === 1, jwksFetches);
ok('rejects wrong audience', await rejects(verifyGoogleIdToken(await idToken({ aud: 'evil' }), CLIENT), 'bad_aud'));
ok('rejects wrong issuer', await rejects(verifyGoogleIdToken(await idToken({ iss: 'https://evil.example' }), CLIENT), 'bad_iss'));
ok('rejects expired token', await rejects(verifyGoogleIdToken(await idToken({ exp: Math.floor(Date.now() / 1000) - 3600 }), CLIENT), 'expired'));
ok('rejects unverified email', await rejects(verifyGoogleIdToken(await idToken({ email_verified: false }), CLIENT), 'email_unverified'));
ok('rejects a token signed by a different key', await rejects(verifyGoogleIdToken(await idToken({}, other.privateKey), CLIENT), 'bad_signature'));
ok('rejects unknown kid', await rejects(verifyGoogleIdToken(await idToken({}, kp.privateKey, 'nope'), CLIENT), 'unknown_key'));
const t = await idToken(); const [h, p, s] = t.split('.');
const forged = h + '.' + bytesToB64u(te.encode(JSON.stringify({ ...JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))), email: 'admin@x.com' }))) + '.' + s;
ok('rejects a payload edited after signing', await rejects(verifyGoogleIdToken(forged, CLIENT), 'bad_signature'));
ok('rejects alg=none style tokens', await rejects(verifyGoogleIdToken(bytesToB64u(te.encode('{"alg":"none"}')) + '.' + p + '.', CLIENT)));
ok('rejects garbage', await rejects(verifyGoogleIdToken('abc', CLIENT), 'bad_token'));

console.log('session cookie');
const tok = await makeSession({ email: 'a@b.c', name: 'A' }, SECRET);
ok('round-trips', (await readSession(tok, SECRET)).email === 'a@b.c');
ok('rejected with a different secret', (await readSession(tok, 'another-secret-another-secret')) === null);
ok('rejected when tampered', (await readSession(tok.replace(/^./, c => (c === 'A' ? 'B' : 'A')), SECRET)) === null);
ok('rejected when expired', (await readSession(tok, SECRET, Date.now() + 9 * 3600 * 1000)) === null);
ok('rejected when empty / malformed', (await readSession('', SECRET)) === null && (await readSession('a.b.c', SECRET)) === null);

console.log('HTTP behaviour');
const env = { SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: CLIENT, ADMIN_EMAILS: 'someone@x.com, ada@example.com', GATE_MODE: 'server', ASSETS: { fetch: async (req) => new Response('asset:' + new URL(req.url).pathname, { status: 200 }) } };
const call = (path, init = {}) => worker.fetch(new Request('https://manifold.example' + path, init), env);
const login = async (credential, extra = {}) => call('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://manifold.example', ...extra }, body: JSON.stringify({ credential }) });

let r = await login(await idToken());
const setCookieHdr = r.headers.get('Set-Cookie') || '';
const j = await r.json();
ok('login 200 with user JSON', r.status === 200 && j.user.email === 'ada@example.com' && j.user.role === 'admin', j);
ok('cookie is HttpOnly; Secure; SameSite; __Host-', /^__Host-manifold=/.test(setCookieHdr) && /HttpOnly/.test(setCookieHdr) && /Secure/.test(setCookieHdr) && /SameSite=Lax/.test(setCookieHdr) && /Path=\//.test(setCookieHdr), setCookieHdr);
const cookie = setCookieHdr.split(';')[0];
r = await login(await idToken({ aud: 'evil' }));        ok('login 401 for a bad token', r.status === 401);
r = await login(await idToken(), { Origin: 'https://evil.example' }); ok('login 403 for a foreign Origin (CSRF)', r.status === 403);
r = await call('/api/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' }); ok('login 415 for non-JSON', r.status === 415);
r = await call('/api/login', { method: 'GET' }); ok('login via GET is not allowed', r.status === 404);
r = await worker.fetch(new Request('https://manifold.example/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), { ...env, SESSION_SECRET: '' });
ok('500 (not open access) when SESSION_SECRET is missing', r.status === 500);

r = await call('/api/me');                                  ok('/api/me 401 without cookie', r.status === 401);
r = await call('/api/me', { headers: { Cookie: cookie } }); ok('/api/me returns the user with the cookie', r.status === 200 && (await r.json()).user.name === 'Ada');
r = await call('/dashboard.html');                          ok('dashboard without cookie -> 302 /login.html', r.status === 302 && new URL(r.headers.get('Location')).pathname === '/login.html');
for (const pth of ['/section-pca.html', '/section05-playground.html', '/anything-else.html', '/api-secret.txt'])
  { r = await call(pth); ok(`deny-by-default: ${pth} -> 302`, r.status === 302); }
r = await call('/dashboard.html', { headers: { Cookie: cookie } }); ok('dashboard with cookie -> 200 + no-store', r.status === 200 && /no-store/.test(r.headers.get('Cache-Control')) && (await r.text()) === 'asset:/dashboard.html');
r = await call('/dashboard.html', { headers: { Cookie: cookie.slice(0, -3) + 'xyz' } }); ok('forged cookie -> 302', r.status === 302);
r = await call('/', { headers: { Cookie: cookie } });      ok('/ with cookie -> /dashboard.html', r.status === 302 && new URL(r.headers.get('Location')).pathname === '/dashboard.html');
r = await call('/login.html');                              ok('login.html public + CSP report-only + nosniff', r.status === 200 && !!r.headers.get('Content-Security-Policy-Report-Only') && r.headers.get('X-Content-Type-Options') === 'nosniff');
r = await call('/manifold-core.js');                        ok('manifold-core.js public', r.status === 200);
r = await call('/dashboard.html', { method: 'POST', headers: { Cookie: cookie } }); ok('POST to a page -> 405', r.status === 405);
r = await call('/api/logout', { method: 'POST' });          ok('logout clears the cookie', r.status === 200 && /Max-Age=0/.test(r.headers.get('Set-Cookie')));
ok('all responses carry X-Frame-Options DENY', (await call('/api/me')).headers.get('X-Frame-Options') === 'DENY');

console.log('GATE_MODE open (default)');
const openEnv = { ...env, GATE_MODE: undefined };
let ro = await worker.fetch(new Request('https://manifold.example/section-pca.html'), openEnv);
ok('open mode serves pages without a cookie (client-side login only)', ro.status === 200 && (await ro.text()) === 'asset:/section-pca.html');
ro = await worker.fetch(new Request('https://manifold.example/'), openEnv);
ok('open mode serves index.html at /', ro.status === 200 && (await ro.text()) === 'asset:/index.html');
ro = await worker.fetch(new Request('https://manifold.example/section-pca.html'), { ...env, GATE_MODE: 'server' });
ok('server mode still redirects without a cookie', ro.status === 302);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
