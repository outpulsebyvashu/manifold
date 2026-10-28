// Run: node tests/core.test.js   (compares manifold-core.js against NumPy/SciPy/sklearn fixtures)
const M = require('../public/manifold-core.js'), fx = require('./fixtures.json');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name, extra !== undefined ? extra : ''); } };
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

console.log('jacobiEigen');
let eg = M.jacobiEigen(fx.sym);
ok('eigenvalues match numpy', eg.values.every((v, i) => close(v, fx.sym_vals[i], 1e-9)), eg.values);
ok('A v = λ v', eg.vectors.every((v, k) => { const Av = fx.sym.map(r => r.reduce((s, x, j) => s + x * v[j], 0)); return Av.every((x, i) => close(x, eg.values[k] * v[i], 1e-8)); }));

console.log('topEigenSym (indefinite matrix, largest algebraic)');
let te = M.topEigenSym(fx.sym, 2);
ok('top-2 match numpy', close(te.values[0], fx.sym_vals[0], 1e-6) && close(te.values[1], fx.sym_vals[1], 1e-6), te.values);
const neg = fx.sym.map((r, i) => r.map((x, j) => x - (i === j ? 10 : 0)));   // all eigenvalues negative, |λ_min| largest
te = M.topEigenSym(neg, 1);
ok('picks largest algebraic, not largest |λ|', close(te.values[0], fx.sym_vals[0] - 10, 1e-6), te.values);

console.log('PCA (real Iris)');
const pc = M.pca(M.IRIS.data, 4);
ok('EVR matches sklearn', pc.evr.every((v, i) => close(v, fx.pca_evr[i], 1e-6)), pc.evr);
const pc2 = M.pca(M.IRIS.data.map(r => r.concat([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 2);
ok('EVR uses trace (not just top-k) when d>8', close(pc2.evr[0], fx.pca_evr[0], 1e-6) && close(pc2.evr[0] + pc2.evr[1], fx.pca_evr[0] + fx.pca_evr[1], 1e-6), pc2.evr);

console.log('LDA');
const lda = M.ldaDirections(fx.SW, fx.SB, 2, 1e-9);
ok('discriminant eigenvalues match scipy eigh(SB,SW)', lda.values.every((v, i) => close(v, fx.lda_vals[i], 1e-4)), [lda.values, fx.lda_vals]);
const v1 = lda.vectors[0], v2 = lda.vectors[1];
const SWv = fx.SW.map(r => r.reduce((s, x, j) => s + x * v2[j], 0));
ok('directions are S_W-orthogonal (the old deflation broke this)', Math.abs(v1.reduce((s, x, i) => s + x * SWv[i], 0)) < 1e-6 * Math.max(...SWv.map(Math.abs)), v1.reduce((s, x, i) => s + x * SWv[i], 0));

console.log('UMAP');
const dists = Array.from({ length: 15 }, (_, i) => 0.5 + i * 0.2), sg = M.umapSigma(dists, 0.5, 15);
ok('sigma solves Σexp(-(d-ρ)/σ)=log2 k', close(dists.reduce((s, d) => s + Math.exp(-Math.max(0, d - 0.5) / sg), 0), Math.log2(15), 1e-5) && sg < 5, sg);
ok('a,b constants match scipy fit', Object.keys(fx.ab).every(k => M.UMAP_AB[k][0] && close(M.UMAP_AB[k][0], fx.ab[k][0], 5e-3) && close(M.UMAP_AB[k][1], fx.ab[k][1], 5e-3)), [M.UMAP_AB, fx.ab]);

ok('fitAB reproduces scipy fit for several min_dist', Object.keys(fx.ab).every(k => { const r = M.fitAB(+k); return close(r[0], fx.ab[k][0], 2e-2) && close(r[1], fx.ab[k][1], 2e-2); }), Object.keys(fx.ab).map(k => [k, M.fitAB(+k), fx.ab[k]]));

const g = M.umapGraph([[0, 0], [1, 0], [0, 1], [5, 5], [6, 5]], 2);
ok('umapGraph: weights in (0,1], symmetric union, nearest neighbour edge has w=1', g.edges.length > 0 && g.edges.every(e => e.w > 0 && e.w <= 1 + 1e-12) && g.W.every((r, i) => Object.keys(r).every(j => Math.abs(r[j] - g.W[j][i]) < 1e-12)) && g.edges.some(e => Math.abs(e.w - 1) < 1e-9));
console.log('Isomap');
const adj = M.symKNN(fx.swiss, 6);
ok('kNN graph is symmetric', adj.every((nb, i) => nb.every(e => adj[e.j].some(f => f.j === i))));
const D = M.dijkstraAll(adj);
ok('geodesic matrix is symmetric', D.every((r, i) => r.every((v, j) => Math.abs(v - D[j][i]) < 1e-9)));
const iso = M.isomap(fx.swiss, 6), math = require('util');
const B = iso.B || M.classicalMDS(iso.D, 2).B;
ok('connected after auto-k', M.isConnected(M.dijkstraAll(iso.knn)) && iso.kUsed >= 6);
const iso2 = M.isomap(fx.swiss, 1, { autoK: false });
ok('autoK:false keeps k and reports disconnection when k is too small', iso2.kUsed === 1 && iso2.disconnected === true && iso2.Y.every(r => r.every(isFinite)));
ok('Y has 2 columns, finite', iso.Y.every(r => r.length === 2 && r.every(isFinite)));

console.log('Metrics');
const pcs = M.pca(fx.swiss, 2).projected;
ok('trustworthiness matches sklearn (k=5,10)', [5, 10].every(k => close(M.trustworthiness(fx.swiss, pcs, k), fx.trust[k], 1e-9)), [M.trustworthiness(fx.swiss, pcs, 5), fx.trust]);
ok('knnOverlap is 1 for identity, <1 for a squash', M.knnOverlap(fx.swiss, fx.swiss, 5) === 1 && M.knnOverlap(fx.swiss, pcs, 5) < 1);

console.log('CSV');
const csv = M.parseCSV('a,b,c\r\n1,"x, y",3\n2,"he said ""hi""",4\n3,"multi\nline",5\n4,5\n');
ok('quotes, commas, escaped quotes, newlines in quotes', csv.rows.length === 3 && csv.rows[0][1] === 'x, y' && csv.rows[1][1] === 'he said "hi"' && csv.rows[2][1] === 'multi\nline', csv.rows);
ok('short row dropped and counted', csv.dropped === 1);
ok('isNumeric strict', M.isNumeric('3.5') && M.isNumeric('-1e3') && !M.isNumeric('12abc') && !M.isNumeric('2024-01-01') && !M.isNumeric(''));

console.log('escape');
ok('esc neutralises HTML', M.esc('<img src=x onerror="a()">') === '&lt;img src=x onerror=&quot;a()&quot;&gt;');

console.log('spectralInit');
const rng = M.seededRNG(1), W = Array.from({ length: 30 }, () => ({}));
for (let i = 0; i < 30; i++) { const j = (i + 1) % 30; W[i][j] = 1; W[j][i] = 1; }   // ring graph
const Y0 = M.spectralInit(W, 30, rng, 2);
ok('ring graph gives a finite 2-D layout spanning ±10', Y0.length === 30 && Y0.every(r => r.every(isFinite)) && Math.max(...Y0.map(r => Math.abs(r[0]))) > 5);

console.log('t-SNE / kNN accuracy (real Iris)');
const I = M.irisSample(30), Yt = M.tsne(I.data, { perplexity: 15, iters: 300 });
ok('t-SNE embedding is finite, 2-D', Yt.every(r => r.length === 2 && r.every(isFinite)));
ok('t-SNE keeps species separable (5-NN acc >= 0.9)', M.knnAccuracy(Yt, I.labels, 5) >= 0.9, M.knnAccuracy(Yt, I.labels, 5));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
