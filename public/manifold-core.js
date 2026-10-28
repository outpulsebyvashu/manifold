/* manifold-core.js — shared, tested maths + helpers for Manifold.
   Plain ES5 (works in every page); also loadable from Node for tests. */
(function (root) {
  'use strict';
  var M = {};

  /* ── RNG ── */
  M.seededRNG = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  M.randn = function (rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /* ── Escaping (use for ANY user-supplied text put into innerHTML) ── */
  M.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ── Vector helpers ── */
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function matVec(A, v) {
    var n = A.length, out = new Array(n);
    for (var i = 0; i < n; i++) { var s = 0, r = A[i]; for (var j = 0; j < n; j++) s += r[j] * v[j]; out[i] = s; }
    return out;
  }
  M.dot = dot;

  /* ── Exact symmetric eigen-solver (cyclic Jacobi). For small/medium d (≤ ~100). ──
     Returns eigenvalues sorted DESCENDING and matching unit eigenvectors. */
  M.jacobiEigen = function (A0) {
    var n = A0.length, a = [], v = [], i, j, k;
    for (i = 0; i < n; i++) { a.push(A0[i].slice()); var row = new Array(n).fill(0); row[i] = 1; v.push(row); }
    for (var sweep = 0; sweep < 60; sweep++) {
      var off = 0, diag = 0;
      for (i = 0; i < n; i++) { diag += a[i][i] * a[i][i]; for (j = i + 1; j < n; j++) off += a[i][j] * a[i][j]; }
      if (off <= 1e-24 * (diag + 1e-300) || off === 0) break;
      for (var p = 0; p < n - 1; p++) for (var q = p + 1; q < n; q++) {
        var apq = a[p][q];
        if (Math.abs(apq) < 1e-300) continue;
        var theta = (a[q][q] - a[p][p]) / (2 * apq);
        var t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        var c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (k = 0; k < n; k++) { var akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (k = 0; k < n; k++) { var apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (k = 0; k < n; k++) { var vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
      }
    }
    var idx = []; for (i = 0; i < n; i++) idx.push(i);
    idx.sort(function (x, y) { return a[y][y] - a[x][x]; });
    var values = [], vectors = [];
    for (i = 0; i < n; i++) {
      var col = idx[i], vec = new Array(n);
      for (k = 0; k < n; k++) vec[k] = v[k][col];
      values.push(a[col][col]); vectors.push(vec);
    }
    return { values: values, vectors: vectors };
  };

  /* ── Top-k LARGEST (algebraic) eigenpairs of a big symmetric matrix.
     Shifted power iteration + Gram-Schmidt, with a convergence test. Safe for
     indefinite matrices (e.g. Isomap's B) because the shift makes it PSD. ── */
  M.topEigenSym = function (A, k, opts) {
    opts = opts || {};
    var n = A.length, maxIter = opts.maxIter || 3000, tol = opts.tol || 1e-11;
    var rng = M.seededRNG(opts.seed || 7), shift = 0, i, j;
    for (i = 0; i < n; i++) { var rs = 0; for (j = 0; j < n; j++) rs += Math.abs(A[i][j]); if (rs > shift) shift = rs; }
    var vecs = [], vals = [];
    for (var e = 0; e < Math.min(k, n); e++) {
      var v = []; for (i = 0; i < n; i++) v.push(M.randn(rng));
      for (var it = 0; it < maxIter; it++) {
        for (var q = 0; q < vecs.length; q++) { var pr = dot(v, vecs[q]); for (i = 0; i < n; i++) v[i] -= pr * vecs[q][i]; }
        var nm = Math.sqrt(dot(v, v)); if (nm < 1e-300) break;
        for (i = 0; i < n; i++) v[i] /= nm;
        var w = matVec(A, v);
        for (i = 0; i < n; i++) w[i] += shift * v[i];
        for (q = 0; q < vecs.length; q++) { var pr2 = dot(w, vecs[q]); for (i = 0; i < n; i++) w[i] -= pr2 * vecs[q][i]; }
        var wn = Math.sqrt(dot(w, w)); if (wn < 1e-300) break;
        for (i = 0; i < n; i++) w[i] /= wn;
        var done = Math.abs(dot(w, v)) > 1 - tol;
        v = w; if (done) break;
      }
      vecs.push(v); vals.push(dot(v, matVec(A, v)));
    }
    return { values: vals, vectors: vecs };
  };

  /* ── Cholesky (returns null if not positive-definite) + triangular solves ── */
  M.cholesky = function (A) {
    var n = A.length, L = [], i, j, k;
    for (i = 0; i < n; i++) L.push(new Array(n).fill(0));
    for (i = 0; i < n; i++) for (j = 0; j <= i; j++) {
      var s = A[i][j];
      for (k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (!(s > 0)) return null; L[i][j] = Math.sqrt(s); }
      else L[i][j] = s / L[j][j];
    }
    return L;
  };
  M.solveLower = function (L, b) {
    var n = b.length, x = new Array(n);
    for (var i = 0; i < n; i++) { var s = b[i]; for (var j = 0; j < i; j++) s -= L[i][j] * x[j]; x[i] = s / L[i][i]; }
    return x;
  };
  M.solveUpperT = function (L, b) { // solves Lᵀ x = b
    var n = b.length, x = new Array(n);
    for (var i = n - 1; i >= 0; i--) { var s = b[i]; for (var j = i + 1; j < n; j++) s -= L[j][i] * x[j]; x[i] = s / L[i][i]; }
    return x;
  };

  /* ── Standardise columns (z-score). Zero-variance columns are left at 0. ── */
  M.standardize = function (data) {
    var n = data.length, d = data[0].length, mean = new Array(d).fill(0), sd = new Array(d).fill(0), i, j;
    for (i = 0; i < n; i++) for (j = 0; j < d; j++) mean[j] += data[i][j] / n;
    for (i = 0; i < n; i++) for (j = 0; j < d; j++) { var z = data[i][j] - mean[j]; sd[j] += z * z / n; }
    for (j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    return { data: data.map(function (r) { return r.map(function (v, j2) { return (v - mean[j2]) / sd[j2]; }); }, 0), mean: mean, sd: sd };
  };

  /* ── PCA. Exact Jacobi for small problems, shifted power iteration for big ones.
     WIDE data (more features than samples, e.g. 17 x 2500) uses the n x n Gram matrix, so cost depends on n, not d.
     Explained-variance ratio always uses the TRACE (all variance). ── */
  function symEigs(A, kk) {
    return A.length <= 120 ? M.jacobiEigen(A) : M.topEigenSym(A, kk, { maxIter: 500, tol: 1e-9 });
  }
  M.pca = function (data, k) {
    var n = data.length, d = data[0].length, i, j, r, t;
    var mean = new Array(d).fill(0);
    for (r = 0; r < n; r++) for (j = 0; j < d; j++) mean[j] += data[r][j] / n;
    var c = data.map(function (p) { return p.map(function (v, j2) { return v - mean[j2]; }); });
    var kk = Math.max(1, Math.min(k || 2, d, n));
    var values, vectors, trace = 0, cov = null, dual = d > n, allVals = null;
    if (!dual) {
      cov = []; for (i = 0; i < d; i++) cov.push(new Array(d).fill(0));
      for (r = 0; r < n; r++) for (i = 0; i < d; i++) for (j = i; j < d; j++) cov[i][j] += c[r][i] * c[r][j] / n;
      for (i = 0; i < d; i++) for (j = 0; j < i; j++) cov[i][j] = cov[j][i];
      for (i = 0; i < d; i++) trace += cov[i][i];
      var eg = symEigs(cov, kk); if (eg.values.length === d) allVals = eg.values;
      values = eg.values.slice(0, kk).map(function (v) { return Math.max(0, v); });
      vectors = eg.vectors.slice(0, kk);
    } else {
      // Gram trick: G = C C^T / n  (n x n).  If G u = lam u  then  v = C^T u / sqrt(n lam)  is a unit eigenvector of cov.
      var G = []; for (i = 0; i < n; i++) G.push(new Array(n).fill(0));
      for (i = 0; i < n; i++) for (j = i; j < n; j++) { var s2 = 0; for (t = 0; t < d; t++) s2 += c[i][t] * c[j][t]; G[i][j] = G[j][i] = s2 / n; }
      for (i = 0; i < n; i++) trace += G[i][i];
      var ge = symEigs(G, kk); if (ge.values.length === n) allVals = ge.values;
      values = []; vectors = [];
      for (var q = 0; q < kk; q++) {
        var lam = Math.max(0, ge.values[q]), u = ge.vectors[q], v = new Array(d).fill(0);
        if (lam > 1e-12 * Math.max(1e-300, ge.values[0])) {
          var sc = 1 / Math.sqrt(n * lam);
          for (i = 0; i < n; i++) { var ui = u[i] * sc; if (ui !== 0) for (t = 0; t < d; t++) v[t] += c[i][t] * ui; }
        }
        values.push(lam); vectors.push(v);
      }
    }
    // deterministic sign: largest-magnitude component positive
    vectors = vectors.map(function (v) {
      var m = 0, mi = 0; for (var t2 = 0; t2 < v.length; t2++) if (Math.abs(v[t2]) > m) { m = Math.abs(v[t2]); mi = t2; }
      return v[mi] < 0 ? v.map(function (x) { return -x; }) : v;
    });
    var evr = values.map(function (v) { return trace > 0 ? v / trace : 0; });
    var projected = c.map(function (p) { return vectors.map(function (v) { return dot(p, v); }); });
    // exact numerical rank when all eigenvalues were computed, otherwise the upper bound min(n-1, d)
    var rank = allVals ? allVals.filter(function (v) { return v > 1e-10 * (allVals[0] || 1); }).length : Math.min(n - 1, d);
    return { mean: mean, centered: c, cov: cov, trace: trace, values: values, vectors: vectors, evr: evr, projected: projected, dual: dual, rank: rank };
  };

  /* ── LDA: solves S_B v = λ S_W v as a SYMMETRIC problem (Cholesky whitening). ── */
  M.ldaDirections = function (SW, SB, nDirs, shrink) {
    var d = SW.length, i, j, tr = 0;
    for (i = 0; i < d; i++) tr += SW[i][i];
    var ridge = (shrink == null ? 1e-4 : shrink) * (tr / d || 1);
    var A = SW.map(function (r, ii) { var c = r.slice(); c[ii] += ridge; return c; });
    var L = M.cholesky(A);
    if (!L) return null;
    // Linv * SB * Linv^T  (symmetric)
    var X = []; // X = Linv * SB  (solve column by column)
    for (j = 0; j < d; j++) { var col = []; for (i = 0; i < d; i++) col.push(SB[i][j]); X.push(M.solveLower(L, col)); } // X[j] = column j
    var S = []; for (i = 0; i < d; i++) S.push(new Array(d).fill(0));
    // S = X * Linv^T = (Linv * X^T)^T ; compute S[:,j] = Linv * (row j of X as column)
    for (j = 0; j < d; j++) { var rowj = []; for (i = 0; i < d; i++) rowj.push(X[i][j]); var sc = M.solveLower(L, rowj); for (i = 0; i < d; i++) S[i][j] = sc[i]; }
    for (i = 0; i < d; i++) for (j = 0; j < i; j++) { var m = 0.5 * (S[i][j] + S[j][i]); S[i][j] = m; S[j][i] = m; }
    var eg = M.jacobiEigen(S), values = [], vectors = [];
    for (var k = 0; k < Math.min(nDirs, d); k++) {
      var u = eg.vectors[k], v = M.solveUpperT(L, u), nm = Math.sqrt(dot(v, v)) || 1;
      v = v.map(function (x) { return x / nm; });
      var mi = 0; for (i = 0; i < d; i++) if (Math.abs(v[i]) > Math.abs(v[mi])) mi = i;
      if (v[mi] < 0) v = v.map(function (x) { return -x; });
      values.push(Math.max(0, eg.values[k])); vectors.push(v);
    }
    return { values: values, vectors: vectors };
  };

  /* ── UMAP helpers ── */
  // a,b fitted (least squares) to 1/(1+a x^{2b}) for spread=1.
  M.UMAP_AB = { 0.001: [1.929, 0.792], 0.1: [1.577, 0.895], 0.5: [0.583, 1.334] };
  // Fit a,b of 1/(1+a x^{2b}) to the target curve (1 if x<min_dist else exp(-(x-min_dist)/spread)) by pattern search.
  M.fitAB = function (minDist, spread) {
    spread = spread || 1; var xs = [], ys = [], i;
    for (i = 0; i < 300; i++) { var x = i * 3 * spread / 299; xs.push(x); ys.push(x < minDist ? 1 : Math.exp(-(x - minDist) / spread)); }
    function sse(a, b) { if (a <= 0 || b <= 0) return Infinity; var s = 0; for (var k = 0; k < xs.length; k++) { var d = 1 / (1 + a * Math.pow(xs[k], 2 * b)) - ys[k]; s += d * d; } return s; }
    var a = 1, b = 1, step = 0.5, best = sse(a, b);
    while (step > 1e-6) {
      var moved = false, cand = [[a + step, b], [a - step, b], [a, b + step], [a, b - step]];
      for (var c = 0; c < 4; c++) { var e = sse(cand[c][0], cand[c][1]); if (e < best) { best = e; a = cand[c][0]; b = cand[c][1]; moved = true; } }
      if (!moved) step /= 2;
    }
    return [a, b];
  };
  // Binary-search sigma so that Σ_j exp(-(d_j-rho)/sigma) = log2(k).  (sum INCREASES with sigma)
  M.umapSigma = function (dists, rho, k) {
    var target = Math.log2(k), lo = 1e-10, hi = 1e6, sigma = 1, it;
    function sum(s) { var t = 0; for (var i = 0; i < dists.length; i++) t += Math.exp(-Math.max(0, dists[i] - rho) / s); return t; }
    for (it = 0; it < 80; it++) {
      var sm = sum(sigma);
      if (Math.abs(sm - target) < 1e-6) break;
      if (sm > target) hi = sigma; else lo = sigma;   // too big -> shrink sigma
      sigma = (lo + hi) / 2;
    }
    return sigma;
  };

  // Fuzzy simplicial set: directed weights w(i->j)=exp(-(d-rho)/sigma) for each point's k nearest neighbours,
  // symmetrised with the fuzzy union  w = a + b - a*b  using the DIRECTED weights. Returns edges [{i,j,w}], i<j.
  M.umapGraph = function (data, k, minW) {
    var n = data.length, kk = Math.max(2, Math.min(k, n - 1)), i, j, W = [], dir = [];
    for (i = 0; i < n; i++) {
      var ds = []; for (j = 0; j < n; j++) if (j !== i) ds.push({ j: j, d: M.euclid(data[i], data[j]) });
      ds.sort(function (a, b) { return a.d - b.d; }); ds = ds.slice(0, kk);
      var rho = ds[0].d, sg = M.umapSigma(ds.map(function (x) { return x.d; }), rho, kk), row = {};
      for (var t = 0; t < ds.length; t++) row[ds[t].j] = Math.exp(-Math.max(0, ds[t].d - rho) / sg);
      dir.push(row); W.push({});
    }
    for (i = 0; i < n; i++) for (var key in dir[i]) {
      j = +key; var a = dir[i][j], b = dir[j][i] || 0, u = a + b - a * b;
      W[i][j] = u; W[j][i] = u;
    }
    var edges = [], thr = minW == null ? 0.005 : minW;
    for (i = 0; i < n; i++) for (var k2 in W[i]) { j = +k2; if (j > i && W[i][j] > thr) edges.push({ i: i, j: j, w: W[i][j] }); }
    return { edges: edges, W: W };
  };
  // Spectral initialisation: eigenvectors of D^-1/2 W D^-1/2 (skip trivial), scaled to ~[-10,10].
  // W: array of {j: weight} objects. Falls back to random if the graph is degenerate.
  M.spectralInit = function (W, n, rng, dims) {
    dims = dims || 2;
    var deg = new Array(n).fill(0), i, j, key;
    for (i = 0; i < n; i++) for (key in W[i]) deg[i] += W[i][key];
    var ok = deg.every(function (x) { return x > 1e-9; });
    function randomInit() { var Y = []; for (var t = 0; t < n; t++) Y.push([(rng() - 0.5) * 20, (rng() - 0.5) * 20]); return Y; }
    if (!ok || n < dims + 3 || n > 700) return randomInit();
    var A = []; for (i = 0; i < n; i++) A.push(new Array(n).fill(0));
    for (i = 0; i < n; i++) for (key in W[i]) { j = +key; A[i][j] = W[i][key] / Math.sqrt(deg[i] * deg[j]); }
    var eg = M.topEigenSym(A, dims + 1, { maxIter: 800, tol: 1e-9, seed: 5 });
    var Y = []; for (i = 0; i < n; i++) Y.push([]);
    var finite = true, ext = 0;
    for (var d2 = 1; d2 <= dims; d2++) {
      var v = eg.vectors[d2];
      for (i = 0; i < n; i++) { var val = v[i] / Math.sqrt(deg[i]); Y[i].push(val); if (!isFinite(val)) finite = false; if (Math.abs(val) > ext) ext = Math.abs(val); }
    }
    if (!finite || ext < 1e-12) return randomInit();
    var sc = 10 / ext, noise = 1e-3;
    return Y.map(function (r) { return r.map(function (x) { return x * sc + noise * M.randn(rng); }); });
  };

  /* ── Isomap ── */
  M.euclid = function (a, b) { var s = 0; for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };
  // Undirected kNN graph: edge i-j exists if j in kNN(i) OR i in kNN(j). adj[i] = [{j,d}]
  M.symKNN = function (data, k) {
    var n = data.length, adj = [], i, j, seen = [];
    for (i = 0; i < n; i++) { adj.push([]); seen.push({}); }
    for (i = 0; i < n; i++) {
      var ds = [];
      for (j = 0; j < n; j++) if (j !== i) ds.push({ j: j, d: M.euclid(data[i], data[j]) });
      ds.sort(function (a, b) { return a.d - b.d; });
      for (var t = 0; t < Math.min(k, ds.length); t++) {
        var nb = ds[t];
        if (!seen[i][nb.j]) { seen[i][nb.j] = 1; adj[i].push({ j: nb.j, d: nb.d }); }
        if (!seen[nb.j][i]) { seen[nb.j][i] = 1; adj[nb.j].push({ j: i, d: nb.d }); }
      }
    }
    return adj;
  };
  M.dijkstraAll = function (adj) {
    var n = adj.length, INF = Infinity, D = [];
    for (var s = 0; s < n; s++) {
      var dist = new Float64Array(n).fill(INF), vis = new Uint8Array(n);
      dist[s] = 0;
      for (var it = 0; it < n; it++) {
        var u = -1, best = INF;
        for (var v = 0; v < n; v++) if (!vis[v] && dist[v] < best) { best = dist[v]; u = v; }
        if (u < 0) break;
        vis[u] = 1;
        var nb = adj[u];
        for (var e = 0; e < nb.length; e++) { var w = dist[u] + nb[e].d; if (w < dist[nb[e].j]) dist[nb[e].j] = w; }
      }
      D.push(dist);
    }
    return D;
  };
  M.isConnected = function (D) { for (var j = 0; j < D.length; j++) if (!isFinite(D[0][j])) return false; return true; };
  // Classical MDS on a (symmetric) distance matrix; returns top `dims` coordinates.
  M.classicalMDS = function (D, dims) {
    var n = D.length, i, j, rm = new Array(n).fill(0), cm = new Array(n).fill(0), gm = 0;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) { var q = D[i][j] * D[i][j]; rm[i] += q / n; cm[j] += q / n; gm += q / (n * n); }
    var B = []; for (i = 0; i < n; i++) { B.push(new Array(n)); for (j = 0; j < n; j++) B[i][j] = -0.5 * (D[i][j] * D[i][j] - rm[i] - cm[j] + gm); }
    var eg = M.topEigenSym(B, dims, { maxIter: 3000, tol: 1e-12, seed: 42 });
    var lam = eg.values.map(function (x) { return Math.max(0, x); });
    var Y = []; for (i = 0; i < n; i++) Y.push(eg.vectors.map(function (v, k) { return v[i] * Math.sqrt(lam[k]); }));
    return { Y: Y, lambdas: lam, B: B };
  };
  // Full Isomap. opts.autoK (default true) raises k until the neighbourhood graph is connected;
  // pass {autoK:false} to keep k fixed (then `disconnected` reports whether some points are unreachable).
  M.isomap = function (data, k, opts) {
    var autoK = !(opts && opts.autoK === false);
    var n = data.length, kk = Math.max(1, Math.min(k, n - 1)), adj, D;
    for (;;) {
      adj = M.symKNN(data, kk); D = M.dijkstraAll(adj);
      if (!autoK || M.isConnected(D) || kk >= n - 1) break;
      kk++;
    }
    var disconnected = !M.isConnected(D), maxD = 0, i, j;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (isFinite(D[i][j]) && D[i][j] > maxD) maxD = D[i][j];
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (!isFinite(D[i][j])) D[i][j] = maxD * 2; // artificial; flagged via `disconnected`
    var res = M.classicalMDS(D, 2);
    return { knn: adj, D: D, Y: res.Y, lambdas: res.lambdas, maxD: maxD, kUsed: kk, disconnected: disconnected };
  };

  /* ── t-SNE (batch; for static comparison layouts). Exact gradient, scale-aware perplexity search. ── */
  M.tsneP = function (data, perp) {
    var n = data.length, P = [], i, j, it;
    for (i = 0; i < n; i++) P.push(new Float64Array(n));
    var D = []; for (i = 0; i < n; i++) { D.push(new Float64Array(n)); for (j = 0; j < n; j++) { var s = 0; for (var k = 0; k < data[0].length; k++) { var z = data[i][k] - data[j][k]; s += z * z; } D[i][j] = s; } }
    var target = Math.log(perp);                         // entropy in nats
    for (i = 0; i < n; i++) {
      var msd = 0; for (j = 0; j < n; j++) if (j !== i) msd += D[i][j]; msd /= (n - 1);
      var beta = msd > 0 ? 1 / msd : 1, lo = 0, hi = Infinity, row = new Float64Array(n);
      for (it = 0; it < 100; it++) {
        var sum = 0, H = 0;
        for (j = 0; j < n; j++) { row[j] = j === i ? 0 : Math.exp(-D[i][j] * beta); sum += row[j]; }
        if (sum < 1e-300) sum = 1e-300;
        for (j = 0; j < n; j++) { row[j] /= sum; if (row[j] > 1e-300) H -= row[j] * Math.log(row[j]); }
        if (Math.abs(H - target) < 1e-6) break;
        if (H > target) { lo = beta; beta = hi === Infinity ? beta * 2 : (beta + hi) / 2; }   // too flat -> sharpen
        else { hi = beta; beta = (beta + lo) / 2; }
      }
      for (j = 0; j < n; j++) P[i][j] = row[j];
    }
    var Ps = []; for (i = 0; i < n; i++) { Ps.push(new Float64Array(n)); for (j = 0; j < n; j++) Ps[i][j] = Math.max((P[i][j] + P[j][i]) / (2 * n), 1e-12); }
    return Ps;
  };
  M.tsne = function (data, opts) {
    opts = opts || {};
    var n = data.length, perp = Math.min(opts.perplexity || 30, (n - 1) / 3), iters = opts.iters || 300, lr = opts.lr || 100;
    var P = M.tsneP(data, perp), rng = M.seededRNG(opts.seed || 42), i, j, d, t;
    var Y = [], vy = [], gains = []; for (i = 0; i < n; i++) { Y.push([M.randn(rng) * 1e-2, M.randn(rng) * 1e-2]); vy.push([0, 0]); gains.push([1, 1]); }
    for (t = 0; t < iters; t++) {
      var ex = t < 100 ? 4 : 1, mom = t < 20 ? 0.5 : 0.8, num = [], sumQ = 0;
      for (i = 0; i < n; i++) num.push(new Float64Array(n));
      for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) { var dx = Y[i][0] - Y[j][0], dy = Y[i][1] - Y[j][1], q = 1 / (1 + dx * dx + dy * dy); num[i][j] = q; num[j][i] = q; sumQ += 2 * q; }
      sumQ = Math.max(sumQ, 1e-12);
      for (i = 0; i < n; i++) {
        var gx = 0, gy = 0;
        for (j = 0; j < n; j++) { if (i === j) continue; var f = 4 * (ex * P[i][j] - num[i][j] / sumQ) * num[i][j]; gx += f * (Y[i][0] - Y[j][0]); gy += f * (Y[i][1] - Y[j][1]); }
        var g = [gx, gy];
        for (d = 0; d < 2; d++) {
          gains[i][d] = Math.max((Math.sign(g[d]) !== Math.sign(vy[i][d])) ? gains[i][d] + 0.2 : gains[i][d] * 0.8, 0.01);
          vy[i][d] = mom * vy[i][d] - lr * gains[i][d] * g[d];
        }
      }
      for (i = 0; i < n; i++) for (d = 0; d < 2; d++) Y[i][d] += vy[i][d];
      for (d = 0; d < 2; d++) { var m = 0; for (i = 0; i < n; i++) m += Y[i][d]; m /= n; for (i = 0; i < n; i++) Y[i][d] -= m; }
      if (opts.onProgress && ((t + 1) % (opts.every || 10) === 0 || t === iters - 1)) opts.onProgress(t + 1, Y.map(function (r) { return r.slice(); }));
    }
    return Y;
  };
  // leave-one-out k-NN classification accuracy in an embedding (quick sanity metric)
  M.knnAccuracy = function (Y, labels, k) {
    var n = Y.length, ok = 0;
    for (var i = 0; i < n; i++) {
      var ds = []; for (var j = 0; j < n; j++) if (j !== i) ds.push([M.euclid(Y[i], Y[j]), labels[j]]);
      ds.sort(function (a, b) { return a[0] - b[0]; });
      var votes = {}, best = -1, bl = null;
      for (var t = 0; t < k; t++) { var l = ds[t][1]; votes[l] = (votes[l] || 0) + 1; if (votes[l] > best) { best = votes[l]; bl = l; } }
      if (bl === labels[i]) ok++;
    }
    return ok / n;
  };

  /* ── UMAP (batch). fuzzy graph -> spectral init -> SGD with negative sampling. opts: k, iters, minDist, seed, onProgress, every ── */
  M.umap = function (data, opts) {
    opts = opts || {};
    var n = data.length, k = Math.min(opts.k || 15, n - 1), iters = opts.iters || 300, seed = opts.seed == null ? 42 : opts.seed;
    var g = M.umapGraph(data, k), ab = M.fitAB(opts.minDist == null ? 0.1 : opts.minDist), a = ab[0], b = ab[1];
    var Y = M.spectralInit(g.W, n, M.seededRNG(seed + n), 2), rng = M.seededRNG(77 + seed + n), edges = g.edges, el = edges.length, gc = 4;
    function clampv(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    for (var e = 0; e < iters; e++) {
      var lr = Math.max(0.05, 1 - e / iters);
      for (var si = el - 1; si > 0; si--) { var ri = Math.floor(rng() * (si + 1)), tmp = edges[si]; edges[si] = edges[ri]; edges[ri] = tmp; }
      for (var ei = 0; ei < el; ei++) {
        var ed = edges[ei], ii = ed.i, jj = ed.j, w = ed.w;
        var dx = Y[ii][0] - Y[jj][0], dy = Y[ii][1] - Y[jj][1], d2 = dx * dx + dy * dy + 1e-6;
        var dp = Math.pow(d2, b), gA = clampv(w * 2 * a * b * Math.pow(d2, b - 1) / (1 + a * dp + 1e-7), 0, gc);
        Y[ii][0] -= lr * gA * dx; Y[ii][1] -= lr * gA * dy; Y[jj][0] += lr * gA * dx; Y[jj][1] += lr * gA * dy;
        for (var ns = 0; ns < 5; ns++) {
          var kk = Math.floor(rng() * n); if (kk === ii || kk === jj) continue;
          var dxk = Y[ii][0] - Y[kk][0], dyk = Y[ii][1] - Y[kk][1], d2k = dxk * dxk + dyk * dyk + 1e-6, dpk = Math.pow(d2k, b);
          var gR = clampv(2 * b / (d2k * (1 + a * dpk) + 1e-7), 0, gc);
          Y[ii][0] += lr * gR * dxk; Y[ii][1] += lr * gR * dyk;
        }
      }
      if (opts.onProgress && ((e + 1) % (opts.every || 5) === 0 || e === iters - 1)) opts.onProgress(e + 1, Y.map(function (r) { return r.slice(); }));
    }
    return Y;
  };

  // pairwise-distance vector of an embedding (upper triangle)
  M.distVec = function (Y) { var out = []; for (var i = 0; i < Y.length; i++) for (var j = i + 1; j < Y.length; j++) out.push(M.euclid(Y[i], Y[j])); return out; };
  // How reproducible is a layout across seeds / settings? Mean pairwise Spearman correlation of distance vectors (1 = same geometry).
  M.consistency = function (Ys) {
    if (Ys.length < 2) return null;
    var vs = Ys.map(M.distVec), tot = 0, c = 0;
    for (var i = 0; i < vs.length; i++) for (var j = i + 1; j < vs.length; j++) { tot += M.spearman(vs[i], vs[j]); c++; }
    return tot / c;
  };

  /* ── Embedding quality metrics ── */
  function rankOrder(X, i) { // indices sorted by distance from i (excluding i)
    var n = X.length, a = [];
    for (var j = 0; j < n; j++) if (j !== i) a.push([M.euclid(X[i], X[j]), j]);
    a.sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
    return a.map(function (e) { return e[1]; });
  }
  // Trustworthiness (Venna & Kaski): penalises low-D neighbours that were NOT high-D neighbours. 1 = perfect.
  M.trustworthiness = function (X, Y, k) {
    var n = X.length, pen = 0;
    for (var i = 0; i < n; i++) {
      var ordH = rankOrder(X, i), rankH = {}, t;
      for (t = 0; t < ordH.length; t++) rankH[ordH[t]] = t + 1;
      var lowK = rankOrder(Y, i).slice(0, k);
      for (t = 0; t < lowK.length; t++) { var r = rankH[lowK[t]]; if (r > k) pen += r - k; }
    }
    return 1 - 2 / (n * k * (2 * n - 3 * k - 1)) * pen;
  };
  // Fraction of each point's k high-D neighbours that are still among its k low-D neighbours.
  M.knnOverlap = function (X, Y, k) {
    var n = X.length, keep = 0;
    for (var i = 0; i < n; i++) {
      var h = rankOrder(X, i).slice(0, k), l = {}, lk = rankOrder(Y, i).slice(0, k), t;
      for (t = 0; t < lk.length; t++) l[lk[t]] = 1;
      for (t = 0; t < h.length; t++) if (l[h[t]]) keep++;
    }
    return keep / (n * k);
  };


  /* ── Continuous colormap (matplotlib "plasma", 9 stops) ── */
  var PLASMA = ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'];
  M.plasma = function (t) {
    t = Math.max(0, Math.min(1, t)); var x = t * (PLASMA.length - 1), i = Math.min(PLASMA.length - 2, Math.floor(x)), f = x - i;
    function h(s) { return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]; }
    var a = h(PLASMA[i]), b = h(PLASMA[i + 1]);
    return '#' + a.map(function (v, k) { return ('0' + Math.round(v + (b[k] - v) * f).toString(16)).slice(-2); }).join('');
  };
  M.PLASMA_STOPS = PLASMA;

  /* ── Scaling: ONE global min-max over the whole matrix (preserves relative magnitudes between features) ── */
  M.minmaxGlobal = function (data) {
    var mn = Infinity, mx = -Infinity, i, j;
    for (i = 0; i < data.length; i++) for (j = 0; j < data[i].length; j++) { var v = data[i][j]; if (v < mn) mn = v; if (v > mx) mx = v; }
    var rg = mx - mn || 1;
    return { data: data.map(function (r) { return r.map(function (v) { return (v - mn) / rg; }); }), min: mn, max: mx };
  };

  /* ── Quality of an embedding ── */
  M.continuity = function (X, Y, k) { return M.trustworthiness(Y, X, k); };   // roles swapped: are high-D neighbours kept?
  // Trustworthiness / continuity / k-NN overlap, plus a RANDOM-embedding baseline (mean over shuffles of Y).
  M.embeddingQuality = function (X, Y, k, shuffles) {
    var n = X.length; shuffles = shuffles || 8;
    if (n < 8 || k < 2 || 2 * n - 3 * k - 1 <= 0) return null;
    var rng = M.seededRNG(2024), base = 0, t;
    for (t = 0; t < shuffles; t++) {
      var idx = []; for (var i = 0; i < n; i++) idx.push(i);
      for (var a = n - 1; a > 0; a--) { var b = Math.floor(rng() * (a + 1)), tmp = idx[a]; idx[a] = idx[b]; idx[b] = tmp; }
      base += M.trustworthiness(X, idx.map(function (q) { return Y[q]; }), k) / shuffles;
    }
    return { k: k, trust: M.trustworthiness(X, Y, k), cont: M.continuity(X, Y, k), knn: M.knnOverlap(X, Y, k), baseline: base };
  };

  /* ── Ordered-data analysis: how far does the system "move" between consecutive states? ── */
  M.stepSizes = function (P, order) {
    var out = [];
    for (var t = 1; t < order.length; t++) out.push(M.euclid(P[order[t - 1]], P[order[t]]));
    return out;
  };
  function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }), m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : 0; }
  M.median = median;
  M.normByMedian = function (a) { var m = median(a) || 1; return a.map(function (v) { return v / m; }); };
  M.spearman = function (a, b) {
    function ranks(x) { var idx = x.map(function (v, i) { return [v, i]; }).sort(function (p, q) { return p[0] - q[0]; }), r = new Array(x.length), i = 0;
      while (i < idx.length) { var j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; var avg = (i + j) / 2 + 1; for (var t = i; t <= j; t++) r[idx[t][1]] = avg; i = j + 1; } return r; }
    var ra = ranks(a), rb = ranks(b), n = a.length, ma = 0, mb = 0, i2;
    for (i2 = 0; i2 < n; i2++) { ma += ra[i2] / n; mb += rb[i2] / n; }
    var sab = 0, sa = 0, sb = 0; for (i2 = 0; i2 < n; i2++) { sab += (ra[i2] - ma) * (rb[i2] - mb); sa += (ra[i2] - ma) * (ra[i2] - ma); sb += (rb[i2] - mb) * (rb[i2] - mb); }
    return sa && sb ? sab / Math.sqrt(sa * sb) : 0;
  };
  // Candidate transitions = steps clearly larger than the typical step (robust: median / MAD). Returns indices into steps.
  M.flagJumps = function (steps, factor) {
    var m = median(steps), mad = median(steps.map(function (v) { return Math.abs(v - m); })) || m * 0.1 || 1e-12;
    var thr = Math.max(m + 3 * 1.4826 * mad, m * (factor || 2));
    var flagged = []; steps.forEach(function (v, i) { if (v > thr) flagged.push(i); });
    return { median: m, threshold: thr, flagged: flagged, max: steps.length ? steps.indexOf(Math.max.apply(null, steps)) : -1 };
  };

  /* ── CSV ── RFC-4180-ish: quoted fields, "" escapes, commas/newlines inside quotes. */
  M.parseCSV = function (text) {
    text = String(text).replace(/^﻿/, '');
    var rows = [], row = [], cur = '', inQ = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur.trim()); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur.trim()); cur = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur.trim()); if (row.length > 1 || row[0] !== '') rows.push(row);
    if (rows.length < 2) return null;
    var headers = rows[0], out = [], dropped = 0;
    for (i = 1; i < rows.length; i++) { if (rows[i].length === headers.length) out.push(rows[i]); else dropped++; }
    return { headers: headers, rows: out, dropped: dropped };
  };
  M.isNumeric = function (s) { return s !== '' && s != null && isFinite(Number(s)); };

  /* ── Real Iris (Fisher 1936; 150 × 4, 1 d.p.) ── */
  M.IRIS = {"data":[[5.1,3.5,1.4,0.2],[4.9,3.0,1.4,0.2],[4.7,3.2,1.3,0.2],[4.6,3.1,1.5,0.2],[5.0,3.6,1.4,0.2],[5.4,3.9,1.7,0.4],[4.6,3.4,1.4,0.3],[5.0,3.4,1.5,0.2],[4.4,2.9,1.4,0.2],[4.9,3.1,1.5,0.1],[5.4,3.7,1.5,0.2],[4.8,3.4,1.6,0.2],[4.8,3.0,1.4,0.1],[4.3,3.0,1.1,0.1],[5.8,4.0,1.2,0.2],[5.7,4.4,1.5,0.4],[5.4,3.9,1.3,0.4],[5.1,3.5,1.4,0.3],[5.7,3.8,1.7,0.3],[5.1,3.8,1.5,0.3],[5.4,3.4,1.7,0.2],[5.1,3.7,1.5,0.4],[4.6,3.6,1.0,0.2],[5.1,3.3,1.7,0.5],[4.8,3.4,1.9,0.2],[5.0,3.0,1.6,0.2],[5.0,3.4,1.6,0.4],[5.2,3.5,1.5,0.2],[5.2,3.4,1.4,0.2],[4.7,3.2,1.6,0.2],[4.8,3.1,1.6,0.2],[5.4,3.4,1.5,0.4],[5.2,4.1,1.5,0.1],[5.5,4.2,1.4,0.2],[4.9,3.1,1.5,0.2],[5.0,3.2,1.2,0.2],[5.5,3.5,1.3,0.2],[4.9,3.6,1.4,0.1],[4.4,3.0,1.3,0.2],[5.1,3.4,1.5,0.2],[5.0,3.5,1.3,0.3],[4.5,2.3,1.3,0.3],[4.4,3.2,1.3,0.2],[5.0,3.5,1.6,0.6],[5.1,3.8,1.9,0.4],[4.8,3.0,1.4,0.3],[5.1,3.8,1.6,0.2],[4.6,3.2,1.4,0.2],[5.3,3.7,1.5,0.2],[5.0,3.3,1.4,0.2],[7.0,3.2,4.7,1.4],[6.4,3.2,4.5,1.5],[6.9,3.1,4.9,1.5],[5.5,2.3,4.0,1.3],[6.5,2.8,4.6,1.5],[5.7,2.8,4.5,1.3],[6.3,3.3,4.7,1.6],[4.9,2.4,3.3,1.0],[6.6,2.9,4.6,1.3],[5.2,2.7,3.9,1.4],[5.0,2.0,3.5,1.0],[5.9,3.0,4.2,1.5],[6.0,2.2,4.0,1.0],[6.1,2.9,4.7,1.4],[5.6,2.9,3.6,1.3],[6.7,3.1,4.4,1.4],[5.6,3.0,4.5,1.5],[5.8,2.7,4.1,1.0],[6.2,2.2,4.5,1.5],[5.6,2.5,3.9,1.1],[5.9,3.2,4.8,1.8],[6.1,2.8,4.0,1.3],[6.3,2.5,4.9,1.5],[6.1,2.8,4.7,1.2],[6.4,2.9,4.3,1.3],[6.6,3.0,4.4,1.4],[6.8,2.8,4.8,1.4],[6.7,3.0,5.0,1.7],[6.0,2.9,4.5,1.5],[5.7,2.6,3.5,1.0],[5.5,2.4,3.8,1.1],[5.5,2.4,3.7,1.0],[5.8,2.7,3.9,1.2],[6.0,2.7,5.1,1.6],[5.4,3.0,4.5,1.5],[6.0,3.4,4.5,1.6],[6.7,3.1,4.7,1.5],[6.3,2.3,4.4,1.3],[5.6,3.0,4.1,1.3],[5.5,2.5,4.0,1.3],[5.5,2.6,4.4,1.2],[6.1,3.0,4.6,1.4],[5.8,2.6,4.0,1.2],[5.0,2.3,3.3,1.0],[5.6,2.7,4.2,1.3],[5.7,3.0,4.2,1.2],[5.7,2.9,4.2,1.3],[6.2,2.9,4.3,1.3],[5.1,2.5,3.0,1.1],[5.7,2.8,4.1,1.3],[6.3,3.3,6.0,2.5],[5.8,2.7,5.1,1.9],[7.1,3.0,5.9,2.1],[6.3,2.9,5.6,1.8],[6.5,3.0,5.8,2.2],[7.6,3.0,6.6,2.1],[4.9,2.5,4.5,1.7],[7.3,2.9,6.3,1.8],[6.7,2.5,5.8,1.8],[7.2,3.6,6.1,2.5],[6.5,3.2,5.1,2.0],[6.4,2.7,5.3,1.9],[6.8,3.0,5.5,2.1],[5.7,2.5,5.0,2.0],[5.8,2.8,5.1,2.4],[6.4,3.2,5.3,2.3],[6.5,3.0,5.5,1.8],[7.7,3.8,6.7,2.2],[7.7,2.6,6.9,2.3],[6.0,2.2,5.0,1.5],[6.9,3.2,5.7,2.3],[5.6,2.8,4.9,2.0],[7.7,2.8,6.7,2.0],[6.3,2.7,4.9,1.8],[6.7,3.3,5.7,2.1],[7.2,3.2,6.0,1.8],[6.2,2.8,4.8,1.8],[6.1,3.0,4.9,1.8],[6.4,2.8,5.6,2.1],[7.2,3.0,5.8,1.6],[7.4,2.8,6.1,1.9],[7.9,3.8,6.4,2.0],[6.4,2.8,5.6,2.2],[6.3,2.8,5.1,1.5],[6.1,2.6,5.6,1.4],[7.7,3.0,6.1,2.3],[6.3,3.4,5.6,2.4],[6.4,3.1,5.5,1.8],[6.0,3.0,4.8,1.8],[6.9,3.1,5.4,2.1],[6.7,3.1,5.6,2.4],[6.9,3.1,5.1,2.3],[5.8,2.7,5.1,1.9],[6.8,3.2,5.9,2.3],[6.7,3.3,5.7,2.5],[6.7,3.0,5.2,2.3],[6.3,2.5,5.0,1.9],[6.5,3.0,5.2,2.0],[6.2,3.4,5.4,2.3],[5.9,3.0,5.1,1.8]],"labels":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]};

  // Evenly-spaced stratified subsample of real Iris (perClass rows from each species).
  M.irisSample = function (perClass) {
    var out = { data: [], labels: [] };
    for (var c = 0; c < 3; c++) for (var t = 0; t < perClass; t++) {
      out.data.push(M.IRIS.data[c * 50 + Math.floor(t * 50 / perClass)].slice()); out.labels.push(c);
    }
    return out;
  };

  /* ── Page helpers (browser only) ── */
  if (typeof document !== 'undefined') {
    // Give canvases an accessible name so screen readers don't skip them.
    document.addEventListener('DOMContentLoaded', function () {
      var cs = document.querySelectorAll('canvas:not([aria-label]):not([role])');
      for (var i = 0; i < cs.length; i++) { cs[i].setAttribute('role', 'img'); cs[i].setAttribute('aria-label', 'Interactive visualisation'); }
      // respect "reduce motion": hide the decorative particle background canvas
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        var bg = document.getElementById('bg'); if (bg) bg.style.display = 'none';
      }
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = M; else root.MCore = M;
})(typeof window !== 'undefined' ? window : this);
