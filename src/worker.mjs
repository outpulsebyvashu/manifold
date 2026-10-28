/**
 * Manifold — Cloudflare Worker (static assets + server-side auth)
 *
 *  POST /api/login   { credential }  -> verifies the Google ID token (signature, iss, aud, exp, email_verified)
 *                                        and sets a signed, HttpOnly, Secure session cookie
 *  GET  /api/me                      -> the signed-in user (from the cookie) or 401
 *  POST /api/logout                  -> clears the cookie
 *  everything else                   -> static files from ./public. With GATE_MODE="server" it is DENY-BY-DEFAULT:
 *                                        only login.html and the shared JS are public; every other page needs a valid
 *                                        session cookie. With GATE_MODE="open" (default) pages are served as static files.
 *
 * Secrets / vars (see wrangler.jsonc, README):
 *   SESSION_SECRET   (secret)  long random string used to HMAC-sign session cookies
 *   GOOGLE_CLIENT_ID (var)     OAuth client id the ID token must have been issued for
 *   ADMIN_EMAILS     (var)     comma-separated; get role "admin" (display only)
 *   GATE_MODE        (var)     "server" | "open" (default)
 */

const COOKIE = '__Host-manifold';
const SESSION_TTL = 8 * 60 * 60; // seconds
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const PUBLIC_PATHS = new Set(['/login.html', '/manifold-core.js', '/guard.js', '/favicon.ico', '/robots.txt']);

const te = new TextEncoder();
const td = new TextDecoder();

/* ───────── base64url ───────── */
export function b64uToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ───────── Google ID-token verification ───────── */
let jwksCache = { keys: null, exp: 0 };
export function __resetJwksCache() { jwksCache = { keys: null, exp: 0 }; }

async function getJwks(force = false) {
  const now = Date.now();
  if (!force && jwksCache.keys && jwksCache.exp > now) return jwksCache.keys;
  const r = await fetch(GOOGLE_JWKS, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error('jwks_unavailable');
  const j = await r.json();
  jwksCache = { keys: j.keys || [], exp: now + 3600 * 1000 };
  return jwksCache.keys;
}

/** Returns the verified claims, or throws Error(reason). */
export async function verifyGoogleIdToken(token, clientId, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 8192) throw new Error('bad_token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('bad_token');
  let header, payload;
  try {
    header = JSON.parse(td.decode(b64uToBytes(parts[0])));
    payload = JSON.parse(td.decode(b64uToBytes(parts[1])));
  } catch { throw new Error('bad_token'); }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad_alg');

  let keys = await getJwks();
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await getJwks(true); jwk = keys.find(k => k.kid === header.kid); } // key rotation
  if (!jwk) throw new Error('unknown_key');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uToBytes(parts[2]), te.encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('bad_signature');

  const sec = Math.floor(now / 1000);
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') throw new Error('bad_iss');
  if (!clientId || payload.aud !== clientId) throw new Error('bad_aud');
  if (!(payload.exp > sec - 60)) throw new Error('expired');
  if (payload.iat && payload.iat > sec + 120) throw new Error('bad_iat');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw new Error('email_unverified');
  if (!payload.email || !payload.sub) throw new Error('no_email');
  return payload;
}

/* ───────── signed session cookie (HMAC-SHA256) ───────── */
const hmacKey = secret => crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function makeSession(user, secret, now = Date.now()) {
  const body = bytesToB64u(te.encode(JSON.stringify({ ...user, exp: Math.floor(now / 1000) + SESSION_TTL })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), te.encode(body)));
  return body + '.' + bytesToB64u(sig);
}

export async function readSession(token, secret, now = Date.now()) {
  try {
    if (!token || !secret) return null;
    const [body, sig, extra] = token.split('.');
    if (!body || !sig || extra !== undefined) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64uToBytes(sig), te.encode(body));
    if (!ok) return null;
    const p = JSON.parse(td.decode(b64uToBytes(body)));
    return p.exp > now / 1000 ? p : null;
  } catch { return null; }
}

function getCookie(request, name) {
  const h = request.headers.get('Cookie') || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
const setCookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/* ───────── helpers ───────── */
const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

function withSecurityHeaders(res, extra = {}) {
  const r = new Response(res.body, res);
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('X-Frame-Options', 'DENY');
  r.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  r.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  r.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups'); // Google sign-in popup needs this
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}

// Login page needs Google Identity Services, EmailJS and Google Forms. Report-only so a mistake can never lock people out.
const LOGIN_CSP_REPORT_ONLY =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com https://cdn.jsdelivr.net; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src https://fonts.gstatic.com; " +
  "img-src 'self' data: https:; connect-src 'self' https://accounts.google.com https://api.emailjs.com https://docs.google.com; " +
  "frame-src https://accounts.google.com; object-src 'none'; base-uri 'self'";

/* admins (display role only): comma-separated ADMIN_EMAILS (falls back to the legacy OWNER_EMAIL) */
function adminList(env) { return String(env.ADMIN_EMAILS || env.OWNER_EMAIL || '').toLowerCase().split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

/* ───────── API ───────── */
async function api(request, env, url) {
  const path = url.pathname;

  if (path === '/api/me' && request.method === 'GET') {
    const s = await readSession(getCookie(request, COOKIE), env.SESSION_SECRET);
    return s ? json({ user: { name: s.name, email: s.email, picture: s.picture, role: s.role } }) : json({ error: 'unauthenticated' }, 401);
  }

  if (path === '/api/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': setCookie('', 0) });
  }

  if (path === '/api/login' && request.method === 'POST') {
    if (!env.SESSION_SECRET || !env.GOOGLE_CLIENT_ID) return json({ error: 'server_not_configured' }, 500);
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'bad_origin' }, 403);   // CSRF
    if (!(request.headers.get('Content-Type') || '').includes('application/json')) return json({ error: 'bad_content_type' }, 415);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
    let claims;
    try { claims = await verifyGoogleIdToken(body && body.credential, env.GOOGLE_CLIENT_ID); }
    catch (e) { return json({ error: 'invalid_token', reason: String(e.message || e) }, 401); }

    const email = String(claims.email).toLowerCase();
    const user = {
      sub: claims.sub, email,
      name: String(claims.name || email.split('@')[0]).slice(0, 120),
      picture: typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture : '',
      role: adminList(env).indexOf(email) >= 0 ? 'admin' : 'student',
    };
    const token = await makeSession(user, env.SESSION_SECRET);
    return json({ user: { name: user.name, email: user.email, picture: user.picture, role: user.role } }, 200, { 'Set-Cookie': setCookie(token, SESSION_TTL) });
  }

  return json({ error: 'not_found' }, 404);
}

/* ───────── static site (deny by default) ───────── */
async function site(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const path = url.pathname;

  if (PUBLIC_PATHS.has(path)) {
    const res = await env.ASSETS.fetch(request);
    return path === '/login.html' ? withSecurityHeaders(res, { 'Content-Security-Policy-Report-Only': LOGIN_CSP_REPORT_ONLY, 'Cache-Control': 'no-cache' }) : res;
  }
  // GATE_MODE "server": every non-public page needs a valid signed session cookie (Google sign-in via /api/login).
  // Anything else ("open", the default): pages are served as static files and the browser-side login is a convenience
  // lock only (needed for username/password accounts, which cannot create a server session).
  if (env.GATE_MODE === 'server') {
    const session = await readSession(getCookie(request, COOKIE), env.SESSION_SECRET);
    if (!session) return Response.redirect(new URL('/login.html', url).toString(), 302);
  } else if (path === '/' || path === '/index.html') {
    return withSecurityHeaders(await env.ASSETS.fetch(new Request(new URL('/index.html', url), request)), { 'Cache-Control': 'no-cache' });
  }

  if (path === '/' || path === '/index.html') return Response.redirect(new URL('/dashboard.html', url).toString(), 302);
  const res = await env.ASSETS.fetch(request);
  return withSecurityHeaders(res, { 'Cache-Control': 'private, no-store' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const res = url.pathname.startsWith('/api/') ? await api(request, env, url) : await site(request, env, url);
      return withSecurityHeaders(res);
    } catch (e) {
      return withSecurityHeaders(json({ error: 'server_error' }, 500));
    }
  },
};
