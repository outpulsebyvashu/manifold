/* playground-ext.js — extensions for the Dataset Playground (loaded after the inline script).
   - off-main-thread t-SNE / UMAP / Isomap (Web Worker, with a main-thread fallback)
   - missing-value policies, log scaling, preprocessing summary
   - paste box, template CSV, built-in examples (real breast data + two clearly-labelled synthetic AMBE demos)
   - several files: joint embedding or separate embeddings overlaid (marker shape per file)
   - stability panel (settings x seeds), CSV / SVG export, auto-generated Methods text */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross'], SHAPE_GLYPH = ['●', '■', '▲', '◆', '✖'];
  var CAP = { pca: 5000, lda: 5000, tsne: 500, umap: 800, iso: 350 };
  var tname = function (t) { return { pca: 'PCA', tsne: 't-SNE', umap: 'UMAP', lda: 'LDA', iso: 'Isomap' }[t] || t; };

  var style = document.createElement('style');
  style.textContent = '.ana.multi-only>:not(#ana-warn):not(#prep-info):not(#multi-wrap):not(details):not(#methods-wrap):not(#sweep-wrap){display:none !important}';
  document.head.appendChild(style);

  /* ───────────── markers (one shape per file) ───────────── */
  window.drawMarker = function (ctx, x, y, shape, col) {
    var r = 5, s = SHAPES[shape % SHAPES.length];
    ctx.beginPath();
    if (s === 'square') ctx.rect(x - r, y - r, 2 * r, 2 * r);
    else if (s === 'triangle') { ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r + 1, y + r); ctx.lineTo(x - r - 1, y + r); ctx.closePath(); }
    else if (s === 'diamond') { ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r + 1, y); ctx.lineTo(x, y + r + 1); ctx.lineTo(x - r - 1, y); ctx.closePath(); }
    else if (s === 'cross') { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); return; }
    else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = col + 'cc'; ctx.fill(); ctx.strokeStyle = col + '55'; ctx.lineWidth = 0.8; ctx.stroke();
  };

  /* ───────────── job runner (Web Worker, with fallback) ───────────── */
  var jobId = 0;
  function cancelRun() {
    if (APP.worker) { try { APP.worker.terminate(); } catch (e) { } APP.worker = null; }
    if (APP.rafId) cancelAnimationFrame(APP.rafId);
    APP.job = null; APP.running = false;
  }
  window.cancelRun = cancelRun;
  function runJob(tech, data, opts, progress) {
    return new Promise(function (resolve, reject) {
      var id = ++jobId; APP.job = id;
      function fallback() {
        setTimeout(function () {
          try {
            var Y, extra = {}, cb = progress ? function (it, Yc) { progress(it, opts.iters, Yc); } : null;
            if (tech === 'tsne') Y = MCore.tsne(data, Object.assign({}, opts, { onProgress: cb }));
            else if (tech === 'umap') Y = MCore.umap(data, Object.assign({}, opts, { onProgress: cb }));
            else { var r = MCore.isomap(data, opts.k); Y = r.Y; extra = { kUsed: r.kUsed, disconnected: r.disconnected }; }
            resolve({ Y: Y, extra: extra });
          } catch (e) { reject(e); }
        }, 20);
      }
      if (typeof Worker === 'undefined') { fallback(); return; }
      var w;
      try { w = new Worker('worker-embed.js'); } catch (e) { fallback(); return; }
      APP.worker = w;
      w.onmessage = function (e) {
        var m = e.data; if (m.id !== id) return;
        if (m.type === 'progress') { if (progress) progress(m.iter, m.total, m.Y); }
        else if (m.type === 'done') { try { w.terminate(); } catch (x) { } if (APP.worker === w) APP.worker = null; resolve({ Y: m.Y, extra: m.extra }); }
        else if (m.type === 'error') { try { w.terminate(); } catch (x) { } reject(new Error(m.message)); }
      };
      w.onerror = function () { try { w.terminate(); } catch (x) { } if (APP.worker === w) APP.worker = null; fallback(); };
      w.postMessage({ cmd: 'run', id: id, tech: tech, data: data, opts: opts, progress: !!progress, every: opts.every });
    });
  }

  /* ───────────── preprocessing ───────────── */
  function spreadRatio(data) {
    var sd = MCore.standardize(data).sd.filter(function (v) { return v > 1e-12; });
    return sd.length ? Math.max.apply(null, sd) / Math.min.apply(null, sd) : 1;
  }
  var SCALE_LABEL = { z: 'z-score per feature', minmax: 'one global min–max range', logz: 'log10 followed by z-score', none: 'no scaling' };

  // T = {headers, rows}; fc = feature column indices; returns {data, keep, fcUse, notes, prepInfo} or {error}
  function prepareTable(T, fc, labelIdx, contOn, tech, cap, scaleNow) {
    var rows = T.rows, miss = $('miss-sel').value, scale = $('scale-sel').value, notes = [];
    var ok = function (r, ci) { return MCore.isNumeric(r[ci]); };
    var idx = []; rows.forEach(function (r, i) { if (!contOn || ok(r, labelIdx)) idx.push(i); });
    var fcUse = fc.slice(), fill = null;
    if (miss === 'drop') idx = idx.filter(function (i) { return fc.every(function (ci) { return ok(rows[i], ci); }); });
    else {
      fill = {}; fcUse = [];
      fc.forEach(function (ci) {
        var v = []; idx.forEach(function (i) { if (ok(rows[i], ci)) v.push(Number(rows[i][ci])); });
        if (!v.length) { notes.push('column "' + T.headers[ci] + '" has no numeric values and was ignored'); return; }
        fcUse.push(ci);
        fill[ci] = miss === 'mean' ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : MCore.median(v);
      });
    }
    if (idx.length < rows.length) notes.push('dropped ' + (rows.length - idx.length) + ' row(s) with missing/non-numeric values');
    if (fcUse.length < 2) return { error: 'Select at least 2 usable feature columns.' };
    if (idx.length < 5) return { error: 'Fewer than 5 usable rows after removing missing values.' };
    var total = idx.length;
    if (idx.length > cap) { var st = idx.length / cap, k2 = []; for (var q = 0; q < cap; q++) k2.push(idx[Math.floor(q * st)]); idx = k2; notes.push('sampled ' + cap + ' of ' + total + ' rows for ' + tname(tech)); }
    var imputed = 0;
    var data = idx.map(function (i) { return fcUse.map(function (ci) { if (ok(rows[i], ci)) return Number(rows[i][ci]); imputed++; return fill[ci]; }); });
    if (imputed) notes.push('filled ' + imputed + ' missing value(s) with the column ' + miss);
    var before = spreadRatio(data);
    if (scaleNow) {
      if (scale === 'logz') {
        for (var a = 0; a < data.length; a++) for (var b = 0; b < data[a].length; b++) if (!(data[a][b] > 0)) return { error: 'log10 needs strictly positive values (found a value ≤ 0). Choose another scaling.' };
        data = MCore.standardize(data.map(function (r) { return r.map(function (v) { return Math.log10(v); }); })).data;
      } else if (scale === 'z') data = MCore.standardize(data).data;
      else if (scale === 'minmax') data = MCore.minmaxGlobal(data).data;
    }
    var prepInfo = 'Scaling: ' + SCALE_LABEL[scale] + '. Feature spread (largest ÷ smallest std): ' + before.toFixed(1) + '×' + (scaleNow ? ' → ' + spreadRatio(data).toFixed(1) + '×' : '') + '.';
    if (scale === 'none') notes.push('features NOT scaled'); else if (scale === 'minmax') notes.push('global min-max scaling'); else if (scale === 'logz') notes.push('log10 + z-score');
    return { data: data, keep: idx, fcUse: fcUse, notes: notes, prepInfo: prepInfo, imputed: imputed, dropped: rows.length - total };
  }

  function colourFor(rowsSel, labelIdx, contOn, labelsSeen, rangeOverride) {
    // returns {labels, contVals} for the selected rows
    var res = { labels: null, contVals: null };
    if (contOn) res.contVals = rowsSel.map(function (r) { return Number(r[labelIdx]); });
    else if (labelIdx >= 0) res.labels = rowsSel.map(function (r) { var l = r[labelIdx] === '' ? '(blank)' : r[labelIdx]; if (!Object.prototype.hasOwnProperty.call(labelsSeen, l)) labelsSeen[l] = Object.keys(labelsSeen).length; return labelsSeen[l]; });
    return res;
  }

  /* single-file extraction (replaces the version in the main script) */
  window.extractData = function (tech) {
    var T = APP.parsed, labelIdx = APP.labelCol !== '' ? parseInt(APP.labelCol) : -1;
    var contOn = !!($('cont-chk').checked && labelIdx >= 0 && APP.colTypes[labelIdx] && APP.colTypes[labelIdx].numeric);
    var fc = APP.selectedFeatures.filter(function (ci) { return !(contOn && ci === labelIdx); });
    var P = prepareTable(T, fc, labelIdx, contOn, tech, CAP[tech] || 500, true);
    if (P.error) { showError(P.error); return null; }
    var rows = P.keep.map(function (i) { return T.rows[i]; }), notes = P.notes.slice();
    if (APP.parsedDropped) notes.push(APP.parsedDropped + ' malformed CSV row(s) skipped');
    APP.featNames = P.fcUse.map(function (ci) { return T.headers[ci]; });
    APP.pointColors = null; APP.contOn = contOn; APP.order = null; APP.orders = null; APP.dataset = null;
    var labels, labelNames, colors, seen = {};
    if (contOn) {
      var cv = colourFor(rows, labelIdx, true, seen).contVals, mn = Math.min.apply(null, cv), mx = Math.max.apply(null, cv), rg = (mx - mn) || 1;
      APP.contVals = cv; APP.contMin = mn; APP.contMax = mx; APP.contName = T.headers[labelIdx];
      APP.pointColors = cv.map(function (v) { return MCore.plasma((v - mn) / rg); });
      labels = P.data.map(function () { return 0; }); labelNames = ['(continuous)']; colors = ['#aaa'];
    } else if (labelIdx >= 0) {
      labels = colourFor(rows, labelIdx, false, seen).labels; labelNames = Object.keys(seen);
      colors = labelNames.map(function (nm, i) { return APP.userColors[i] || FULL_PALETTE[i % FULL_PALETTE.length]; });
    } else { labels = P.data.map(function () { return 0; }); labelNames = ['All points']; colors = [APP.userColors[0] || FULL_PALETTE[0]]; }
    APP.traj = !!$('traj-chk').checked;
    if (contOn || APP.traj) {
      var ord = P.data.map(function (_, i) { return i; });
      if (contOn) ord.sort(function (a, b) { return APP.contVals[a] - APP.contVals[b] || a - b; });
      APP.order = ord;
    }
    APP.notes = notes; APP.prepInfo = P.prepInfo; APP.prepMeta = { imputed: P.imputed, dropped: P.dropped, n: P.data.length };
    return { data: P.data, labels: labels, labelNames: labelNames, colors: colors };
  };

  /* ───────────── run ───────────── */
  function readParams(tech, n) {
    return {
      tech: tech, seed: 42, lr: 150,
      perplexity: Math.max(2, Math.min(parseInt($('sl-perp').value), Math.floor(n / 3))),
      iters: parseInt($('sl-iter').value), k: parseInt($('sl-k').value), minDist: parseInt($('sl-md').value) / 100,
      pre: parseInt($('pre-pca').value) || 0, scale: $('scale-sel').value, miss: $('miss-sel').value
    };
  }
  function resetPanels() {
    ['sweep-wrap', 'methods-wrap', 'multi-wrap'].forEach(function (id) { var e = $(id); if (e) e.style.display = 'none'; });
    $('ana').classList.remove('multi-only'); $('ana').style.display = 'none';
    $('sweep-grid').innerHTML = ''; $('sweep-note').textContent = '';
  }
  function fail(err) { cancelRun(); showError('Run failed: ' + (err && err.message || err)); $('run-btn').disabled = false; $('output-title').textContent = 'Run failed'; }
  function progressUI(tech) {
    return function (it, total, Y) {
      APP.Y = Y; drawResult(Y);
      $('prog-fill').style.width = (it / total * 100) + '%';
      $('prog-label').textContent = 'Iter ' + it + ' / ' + total;
      $('prog-phase').textContent = tech === 'tsne' ? (it < 100 ? 'Early exaggeration' : it < 250 ? 'Optimising' : 'Fine-tuning') : (it < total * 0.2 ? 'Graph phase' : 'SGD phase');
    };
  }

  window.runEmbedding = function () {
    if (!APP.parsed || APP.selectedFeatures.length < 2) return;
    cancelRun(); hideError(); APP.running = true; APP.pcaInfo = null; APP.multi = null; APP.orders = null; APP.dataset = null; resetPanels();
    var tech = document.querySelector('input[name="tech"]:checked').value;
    if (APP.files && APP.files.length > 1) { runMulti(tech); return; }
    var ex = extractData(tech);
    if (!ex) { APP.running = false; return; }
    APP.data = ex.data; APP.labels = ex.labels; APP.colors = ex.colors; APP.labelNames = ex.labelNames;
    APP.startTs = performance.now(); APP.technique = tech;
    var P = readParams(tech, APP.data.length); APP.runParams = P; APP.embedData = APP.data;
    if (P.pre > 0 && (tech === 'tsne' || tech === 'umap' || tech === 'iso') && P.pre < APP.data[0].length) {
      var kp = Math.max(2, Math.min(P.pre, APP.data.length - 1));
      APP.embedData = MCore.pca(APP.data, kp).projected; APP.notes.push('pre-reduced to ' + kp + ' PCA dims'); P.preUsed = kp;
    }
    var n = APP.data.length, d = APP.data[0].length;
    $('progress-wrap').style.display = 'none'; $('stats-row').style.display = 'none';
    $('output-title').textContent = tname(tech) + ' running...'; $('output-sub').textContent = n + ' points · ' + d + ' features';
    $('run-btn').disabled = true; updateLegendArea();
    if (tech === 'pca') finish(algoPCA(APP.data));
    else if (tech === 'lda') finish(algoLDA(APP.data, APP.labels));
    else if (tech === 'iso') finish(algoIsomap(APP.embedData, P.k));
    else {
      $('progress-wrap').style.display = 'block'; $('prog-fill').style.width = '0%';
      var opts = tech === 'tsne' ? { perplexity: P.perplexity, iters: P.iters, lr: P.lr, seed: P.seed, every: 10 } : { k: P.k, iters: P.iters, minDist: P.minDist, seed: P.seed, every: 5 };
      runJob(tech, APP.embedData, opts, progressUI(tech)).then(function (r) { if (APP.job !== jobId) return; finish(r.Y); }).catch(fail);
    }
  };

  // analysis additions (preprocessing summary, LDA warning)
  var _analyse = window.analyse;
  window.analyse = function (Y) {
    _analyse(Y);
    $('prep-info').textContent = APP.prepInfo || '';
    if (!APP.order) $('step-note').textContent = '';
    if (APP.technique === 'lda' && APP.data.length < APP.data[0].length) {
      var d = document.createElement('div'); d.className = 'ana-warn';
      d.textContent = '⚠ LDA with fewer samples than features can separate almost any labelling (over-fitting). Validate on held-out data before trusting the separation.';
      $('ana-warn').appendChild(d);
    }
  };

  var _ula = window.updateLegendArea;
  window.updateLegendArea = function () {
    _ula();
    if (APP.multi && APP.dataset && APP.files && APP.files.length > 1) {
      var la = $('legend-area'); la.style.display = 'flex';
      la.innerHTML += APP.multi.files.map(function (nm, i) { return '<div class="legend-item">' + SHAPE_GLYPH[i % SHAPE_GLYPH.length] + ' ' + MCore.esc(nm) + '</div>'; }).join('');
    }
  };

  /* ───────────── several files ───────────── */
  function numericNames(T) { var types = detectColumnTypes(T.headers, T.rows); return types.filter(function (c) { return c.numeric; }).map(function (c) { return c.name; }); }

  function handleFiles(files) {
    hideError();
    var reads = files.map(function (f) {
      return new Promise(function (res) {
        if (f.size > 5 * 1024 * 1024) { res({ error: f.name + ' is larger than 5 MB' }); return; }
        var rd = new FileReader(); rd.onload = function (ev) { var p = MCore.parseCSV(ev.target.result); res(p ? { name: f.name, headers: p.headers, rows: p.rows, dropped: p.dropped || 0 } : { error: 'Could not parse ' + f.name }); };
        rd.onerror = function () { res({ error: 'Could not read ' + f.name }); }; rd.readAsText(f);
      });
    });
    Promise.all(reads).then(function (list) {
      var bad = list.filter(function (x) { return x.error; });
      if (bad.length) { showError(bad[0].error); return; }
      if (list.length === 1) { APP.files = null; APP.parsedDropped = list[0].dropped; setUploadZoneLoaded(list[0].name); window.__single = true; processCSV(list[0].headers, list[0].rows, list[0].name); return; }
      window.__keepFiles = true; APP.parsedDropped = list[0].dropped;
      setUploadZoneLoaded(list.length + ' files');
      processCSV(list[0].headers, list[0].rows, list[0].name);
      window.__keepFiles = false;
      APP.files = list.map(function (l) { return { name: l.name, headers: l.headers, rows: l.rows, colTypes: detectColumnTypes(l.headers, l.rows) }; });
      var sets = APP.files.map(function (f) { return numericNames(f).filter(function (nm) { return true; }).sort().join('|'); });
      var same = sets.every(function (s) { return s === sets[0]; });
      $('multi-opt').style.display = 'flex'; $('multi-mode').value = same ? 'joint' : 'overlay';
      $('multi-list').textContent = list.length + ' files: ' + list.map(function (l) { return l.name + ' (' + l.rows.length + '×' + l.headers.length + ')'; }).join(', ') + (same ? '. Same columns → joint embedding is possible.' : '. Different columns → each file is embedded separately and the paths are overlaid.');
    });
  }

  function norm2D(Y) {  // centre and scale to unit RMS radius so separately fitted embeddings share a scale
    var n = Y.length, cx = 0, cy = 0; Y.forEach(function (p) { cx += p[0] / n; cy += p[1] / n; });
    var rms = Math.sqrt(Y.reduce(function (s, p) { return s + (p[0] - cx) * (p[0] - cx) + (p[1] - cy) * (p[1] - cy); }, 0) / n) || 1;
    return Y.map(function (p) { return [(p[0] - cx) / rms, (p[1] - cy) / rms]; });
  }

  function embedOne(tech, data, labels, P, tag) {
    // resolves {Y, extra}
    if (tech === 'pca') return Promise.resolve({ Y: algoPCA(data) });
    if (tech === 'lda') return Promise.resolve({ Y: algoLDA(data, labels) });
    var X = data;
    if (P.pre > 0 && P.pre < data[0].length) X = MCore.pca(data, Math.max(2, Math.min(P.pre, data.length - 1))).projected;
    var n = X.length;
    var opts = tech === 'tsne' ? { perplexity: Math.max(2, Math.min(P.perplexity, Math.floor(n / 3))), iters: P.iters, lr: P.lr, seed: P.seed } : tech === 'umap' ? { k: Math.min(P.k, n - 1), iters: P.iters, minDist: P.minDist, seed: P.seed } : { k: P.k };
    $('output-sub').textContent = (tag || '') + ' computing…';
    return runJob(tech, X, opts, null);
  }

  function runMulti(tech) {
    var files = APP.files, mode = $('multi-mode').value, labelIdx0 = APP.labelCol !== '' ? parseInt(APP.labelCol) : -1;
    var labelName = labelIdx0 >= 0 ? APP.parsed.headers[labelIdx0] : null;
    var contOn = !!($('cont-chk').checked && labelName);
    var P = readParams(tech, 200); APP.runParams = P; APP.technique = tech;
    var cap = Math.max(20, Math.floor((CAP[tech] || 500) / files.length));
    var scale = $('scale-sel').value, perFile = [], notes = [], seen = {};
    var common = null;
    if (mode === 'joint') {
      var sels = APP.selectedFeatures.map(function (ci) { return APP.parsed.headers[ci]; }).filter(function (nm) { return nm !== labelName || !contOn; });
      common = sels.filter(function (nm) { return files.every(function (f) { return f.headers.indexOf(nm) >= 0; }); });
      if (common.length < 2) { showError('Joint embedding needs at least 2 selected columns that exist in every file.'); APP.running = false; return; }
    }
    for (var fi = 0; fi < files.length; fi++) {
      var F = files[fi], names = mode === 'joint' ? common : numericNames(F).filter(function (nm) { return !(contOn && nm === labelName); }).slice(0, 5000);
      var fc = names.map(function (nm) { return F.headers.indexOf(nm); }), li = labelName ? F.headers.indexOf(labelName) : -1;
      if (contOn && li < 0) { showError('The colour column "' + labelName + '" is missing from ' + F.name); APP.running = false; return; }
      var pr = prepareTable(F, fc, li, contOn, tech, cap, mode === 'overlay');
      if (pr.error) { showError(F.name + ': ' + pr.error); APP.running = false; return; }
      perFile.push({ F: F, li: li, pr: pr, rows: pr.keep.map(function (i) { return F.rows[i]; }) });
      pr.notes.forEach(function (t) { notes.push(F.name + ': ' + t); });
    }
    if (mode === 'joint') {   // scale the stacked matrix once
      var all = []; perFile.forEach(function (p) { p.pr.data.forEach(function (r) { all.push(r); }); });
      var sc = scale === 'minmax' ? MCore.minmaxGlobal(all).data : scale === 'z' ? MCore.standardize(all).data : scale === 'logz' ? MCore.standardize(all.map(function (r) { return r.map(function (v) { return Math.log10(Math.max(v, 1e-300)); }); })).data : all;
      var o = 0; perFile.forEach(function (p) { p.pr.data = p.pr.data.map(function () { return sc[o++]; }); });
    }
    // colours (shared range / shared label set)
    var datasetIdx = [], labels = [], pointColors = null, contVals = [];
    perFile.forEach(function (p, i) { p.rows.forEach(function () { datasetIdx.push(i); }); });
    var labelNames, colors;
    if (contOn) {
      perFile.forEach(function (p) { p.rows.forEach(function (r) { contVals.push(Number(r[p.li])); }); });
      var mn = Math.min.apply(null, contVals), mx = Math.max.apply(null, contVals), rg = (mx - mn) || 1;
      pointColors = contVals.map(function (v) { return MCore.plasma((v - mn) / rg); });
      APP.contVals = contVals; APP.contMin = mn; APP.contMax = mx; APP.contName = labelName; labels = contVals.map(function () { return 0; }); labelNames = ['(continuous)']; colors = ['#aaa'];
    } else if (labelName) {
      perFile.forEach(function (p) { colourFor(p.rows, p.li, false, seen).labels.forEach(function (l) { labels.push(l); }); });
      labelNames = Object.keys(seen); colors = labelNames.map(function (nm, i) { return APP.userColors[i] || FULL_PALETTE[i % FULL_PALETTE.length]; });
    } else { labels = datasetIdx.map(function () { return 0; }); labelNames = ['All points']; colors = [FULL_PALETTE[0]]; }
    APP.pointColors = pointColors; APP.contOn = contOn; APP.labels = labels; APP.labelNames = labelNames; APP.colors = colors; APP.dataset = datasetIdx;
    APP.traj = !!$('traj-chk').checked; APP.order = null;
    var starts = [], acc = 0; perFile.forEach(function (p) { starts.push(acc); acc += p.rows.length; });
    APP.orders = perFile.map(function (p, i) {
      var ord = p.rows.map(function (_, j) { return j; });
      if (contOn) ord.sort(function (a, b) { return contVals[starts[i] + a] - contVals[starts[i] + b] || a - b; });
      return ord.map(function (j) { return starts[i] + j; });
    });
    APP.notes = notes; APP.prepInfo = perFile[0].pr.prepInfo + (mode === 'overlay' ? ' (applied to each file separately)' : ' (applied to all files together)');
    APP.startTs = performance.now(); APP.multi = { mode: mode, files: perFile.map(function (p) { return p.F.name; }), perFile: perFile, starts: starts };
    $('progress-wrap').style.display = 'none'; $('stats-row').style.display = 'none'; $('run-btn').disabled = true;
    $('output-title').textContent = tname(tech) + ' running...'; updateLegendArea();
    var myJob;
    if (mode === 'joint') {
      var data = []; perFile.forEach(function (p) { p.pr.data.forEach(function (r) { data.push(r); }); });
      APP.data = data; APP.embedData = data;
      embedOne(tech, data, labels, P, 'joint').then(function (r) { myJob = jobId; if (APP.job !== myJob && tech !== 'pca' && tech !== 'lda') return; finishMulti(r.Y, perFile, mode); }).catch(fail);
    } else {
      var Ys = [], chain = Promise.resolve();
      perFile.forEach(function (p, i) {
        chain = chain.then(function () { return embedOne(tech, p.pr.data, labels.slice(starts[i], starts[i] + p.rows.length), P, 'file ' + (i + 1) + '/' + perFile.length + ' (' + p.F.name + ')').then(function (r) { Ys.push(norm2D(r.Y)); }); });
      });
      chain.then(function () { var Y = []; Ys.forEach(function (y) { y.forEach(function (pt) { Y.push(pt); }); }); APP.data = perFile[0].pr.data; finishMulti(Y, perFile, mode, Ys); }).catch(fail);
    }
  }

  function finishMulti(Y, perFile, mode, Ys) {
    APP.running = false; APP.result = Y;
    var elapsed = performance.now() - APP.startTs, total = Y.length;
    $('run-btn').disabled = false;
    $('output-title').textContent = tname(APP.technique) + ' — ' + perFile.length + ' files (' + (mode === 'joint' ? 'joint embedding' : 'separate embeddings, overlaid') + ')';
    $('output-sub').textContent = total + ' pts · ' + elapsed.toFixed(0) + 'ms' + (APP.notes.length ? ' · ' + APP.notes.slice(0, 4).join(' · ') + (APP.notes.length > 4 ? ' · …' : '') : '');
    $('stats-row').style.display = 'grid'; $('stat-n').textContent = total; $('stat-d').textContent = mode === 'joint' ? perFile[0].pr.data[0].length : perFile.map(function (p) { return p.pr.data[0].length; }).join(' / '); $('stat-time').textContent = elapsed.toFixed(0) + 'ms';
    drawResult(Y); updateLegendArea();
    // per-file table
    var rowsHtml = perFile.map(function (p, i) {
      var Xf = p.pr.data, Yf = mode === 'joint' ? Y.slice(APP.multi.starts[i], APP.multi.starts[i] + Xf.length) : Ys[i], n = Xf.length, k = Math.max(2, Math.min(10, Math.floor(n / 4)));
      var q = MCore.embeddingQuality(Xf, Yf, k, 6), tr = '—';
      if (contOn()) {
        var ord = APP.orders[i].map(function (g) { return g - APP.multi.starts[i]; }), hd = MCore.stepSizes(Xf, ord), fj = MCore.flagJumps(hd), vals = APP.contVals;
        if (fj.flagged.length) tr = fj.flagged.slice(0, 2).map(function (s) { return +vals[APP.orders[i][s]].toPrecision(5) + '→' + +vals[APP.orders[i][s + 1]].toPrecision(5); }).join(', '); else tr = 'none clear';
      }
      return '<tr><td>' + SHAPE_GLYPH[i % SHAPE_GLYPH.length] + ' ' + MCore.esc(p.F.name) + '</td><td>' + n + '×' + Xf[0].length + '</td><td>' + (q ? q.trust.toFixed(3) : '—') + '</td><td>' + (q ? q.cont.toFixed(3) : '—') + '</td><td>' + (q ? q.baseline.toFixed(2) : '—') + '</td><td>' + MCore.esc(tr) + '</td></tr>';
    }).join('');
    $('multi-table').innerHTML = '<table class="fm-table"><tr><th>File</th><th>n×d</th><th>Trust.</th><th>Contin.</th><th>Random</th><th>Candidate transition (high-D)</th></tr>' + rowsHtml + '</table>' +
      '<div class="ana-note">' + (mode === 'overlay' ? 'Each file was embedded on its own and scaled to unit RMS radius before overlaying. <b>The axes of separately fitted embeddings are not comparable</b> — compare the <i>shape</i> of each path, not coordinates.' : 'All files were embedded together on the same axes, so distances between files are meaningful (same columns, same scaling).') + '</div>';
    $('multi-wrap').style.display = 'block'; $('ana').style.display = 'block'; $('ana').classList.add('multi-only');
    $('prep-info').textContent = APP.prepInfo || '';
    $('ana-warn').innerHTML = '';
  }
  function contOn() { return !!APP.contOn; }

  /* ───────────── stability: settings x seeds ───────────── */
  function drawMini(cv, Y, cols) {
    var W = cv.width = 220, H = cv.height = 160, ctx = cv.getContext('2d'); ctx.fillStyle = '#070d1e'; ctx.fillRect(0, 0, W, H);
    var xs = Y.map(function (p) { return p[0]; }), ys = Y.map(function (p) { return p[1]; }), mnx = Math.min.apply(null, xs), mxx = Math.max.apply(null, xs), mny = Math.min.apply(null, ys), mxy = Math.max.apply(null, ys);
    var sx = function (v) { return 10 + (v - mnx) / ((mxx - mnx) || 1) * (W - 20); }, sy = function (v) { return H - 10 - (v - mny) / ((mxy - mny) || 1) * (H - 20); };
    Y.forEach(function (p, i) { ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 2.6, 0, Math.PI * 2); ctx.fillStyle = cols(i) + 'dd'; ctx.fill(); });
  }
  function runSweep() {
    var tech = APP.technique, wrap = $('sweep-wrap'), note = $('sweep-note'), grid = $('sweep-grid');
    wrap.style.display = 'block'; $('ana').style.display = 'block';
    if (!APP.result) { note.textContent = 'Run an embedding first.'; return; }
    if (APP.multi && APP.files && APP.files.length > 1) { grid.innerHTML = ''; note.textContent = 'The stability sweep works on a single file.'; return; }
    if (tech !== 'tsne' && tech !== 'umap' && tech !== 'iso') { grid.innerHTML = ''; note.textContent = 'PCA and LDA are deterministic, so there is nothing to sweep. Choose t-SNE, UMAP or Isomap.'; return; }
    var X = APP.embedData || APP.data, Xq = APP.data, n = X.length, P = APP.runParams || readParams(tech, n), iters = Math.min(P.iters || 300, 300);
    var settings = (tech === 'tsne' ? [5, 10, 20, 30].filter(function (v) { return v <= Math.floor(n / 3); }) : [4, 8, 12, 20].filter(function (v) { return v <= n - 1; }));
    var cur = tech === 'tsne' ? P.perplexity : P.k; if (settings.indexOf(cur) < 0) settings.push(cur); settings.sort(function (a, b) { return a - b; });
    var seeds = tech === 'iso' ? [] : [1, 2, 3, 4];
    var jobs = settings.map(function (v) { return { kind: 'setting', v: v, seed: 42 }; }).concat(seeds.map(function (sd) { return { kind: 'seed', v: cur, seed: sd }; }));
    var btn = $('sweep-btn'); btn.disabled = true; grid.innerHTML = ''; var out = [], done = 0;
    function optsFor(j) { return tech === 'tsne' ? { perplexity: j.v, iters: iters, lr: P.lr || 150, seed: j.seed } : tech === 'umap' ? { k: j.v, iters: iters, minDist: P.minDist || 0.1, seed: j.seed } : { k: j.v }; }
    var chain = Promise.resolve();
    jobs.forEach(function (j) {
      chain = chain.then(function () { note.textContent = 'Running ' + (done + 1) + ' / ' + jobs.length + '…'; return runJob(tech, X, optsFor(j), null); }).then(function (r) { out.push({ j: j, Y: r.Y }); done++; });
    });
    chain.then(function () {
      var k = Math.max(2, Math.min(10, Math.floor(n / 4))), col = function (i) { return APP.pointColors ? APP.pointColors[i] : (APP.colors[APP.labels[i]] || '#aaa'); }, qs = [];
      out.filter(function (o) { return o.j.kind === 'setting'; }).forEach(function (o) {
        var q = MCore.embeddingQuality(Xq, o.Y, k, 4); qs.push(q ? q.trust : null);
        var fig = document.createElement('figure'), cv = document.createElement('canvas'), cap = document.createElement('figcaption'); drawMini(cv, o.Y, col);
        cap.textContent = (tech === 'tsne' ? 'perplexity ' : 'k = ') + o.j.v + (q ? ' · T = ' + q.trust.toFixed(3) : ''); fig.appendChild(cv); fig.appendChild(cap); grid.appendChild(fig);
      });
      var setYs = out.filter(function (o) { return o.j.kind === 'setting'; }).map(function (o) { return o.Y; }), seedYs = out.filter(function (o) { return o.j.kind === 'seed'; }).map(function (o) { return o.Y; });
      var cs = MCore.consistency(setYs), cd = MCore.consistency(seedYs), tq = qs.filter(function (v) { return v != null; });
      var txt = 'Across settings, trustworthiness ranges from ' + Math.min.apply(null, tq).toFixed(3) + ' to ' + Math.max.apply(null, tq).toFixed(3) + '. ';
      txt += 'Geometry agreement between settings: Spearman ρ = ' + (cs == null ? 'n/a' : cs.toFixed(2)) + '. ';
      if (cd != null) txt += 'Between ' + seedYs.length + ' random seeds (same setting): ρ = ' + cd.toFixed(2) + '. ';
      var weak = (cs != null && cs < 0.6) || (cd != null && cd < 0.6);
      txt += weak ? 'Agreement is low — the layout depends on the settings/seed, so do not over-interpret it.' : 'Agreement is high — the overall geometry is robust to these choices.';
      note.textContent = txt; btn.disabled = false; APP.sweep = { settings: settings, cs: cs, cd: cd };
    }).catch(function (e) { note.textContent = 'Sweep failed: ' + (e && e.message || e); btn.disabled = false; });
  }

  /* ───────────── export ───────────── */
  function download(name, text, mime) { var b = new Blob([text], { type: mime }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); }
  var csvq = function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function exportCSV() {
    if (!APP.result) return;
    var head = ['index', 'x', 'y'], cn = APP.contOn ? (APP.contName || 'value') : 'label';
    head.push(cn); if (APP.dataset) head.push('file');
    var rank = {}; (APP.orders || (APP.order ? [APP.order] : [])).forEach(function (o) { o.forEach(function (g, t) { rank[g] = t; }); });
    var hasRank = Object.keys(rank).length > 0; if (hasRank) head.push('order_in_trajectory');
    var lines = [head.join(',')];
    APP.result.forEach(function (p, i) {
      var row = [i, p[0], p[1], APP.contOn ? APP.contVals[i] : (APP.labelNames[APP.labels[i]] || '')];
      if (APP.dataset) row.push((APP.multi && APP.multi.files[APP.dataset[i]]) || APP.dataset[i]); if (hasRank) row.push(rank[i] == null ? '' : rank[i]);
      lines.push(row.map(csvq).join(','));
    });
    download('manifold_' + APP.technique + '_embedding.csv', lines.join('\n') + '\n', 'text/csv');
  }
  function exportSVG() {
    if (!APP.result) return;
    var pts = APP.result, W = 800, H = 600, pl = 60, pr = APP.pointColors ? 110 : 40, pt = 30, pb = 50;
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; }), mnx = Math.min.apply(null, xs), mxx = Math.max.apply(null, xs), mny = Math.min.apply(null, ys), mxy = Math.max.apply(null, ys);
    var rx = (mxx - mnx) * 0.06 || 0.5, ry = (mxy - mny) * 0.06 || 0.5; mnx -= rx; mxx += rx; mny -= ry; mxy += ry;
    var sx = function (v) { return pl + (v - mnx) / (mxx - mnx) * (W - pl - pr); }, sy = function (v) { return H - pb - (v - mny) / (mxy - mny) * (H - pt - pb); };
    var f = function (v) { return v.toFixed(1); }, o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="sans-serif" font-size="11">');
    o.push('<rect width="100%" height="100%" fill="#ffffff"/><rect x="' + pl + '" y="' + pt + '" width="' + (W - pl - pr) + '" height="' + (H - pt - pb) + '" fill="none" stroke="#999"/>');
    (APP.orders || (APP.order ? [APP.order] : [])).forEach(function (ord) { if (APP.traj) o.push('<polyline fill="none" stroke="#888" stroke-width="1" points="' + ord.map(function (g) { return f(sx(pts[g][0])) + ',' + f(sy(pts[g][1])); }).join(' ') + '"/>'); });
    pts.forEach(function (p, i) {
      var col = APP.pointColors ? APP.pointColors[i] : (APP.colors[APP.labels[i]] || '#555'), x = sx(p[0]), y = sy(p[1]), sh = APP.dataset ? SHAPES[APP.dataset[i] % SHAPES.length] : 'circle';
      if (sh === 'square') o.push('<rect x="' + f(x - 4.5) + '" y="' + f(y - 4.5) + '" width="9" height="9" fill="' + col + '" stroke="#333" stroke-width="0.5"/>');
      else if (sh === 'triangle') o.push('<polygon points="' + f(x) + ',' + f(y - 5.5) + ' ' + f(x + 5.5) + ',' + f(y + 4.5) + ' ' + f(x - 5.5) + ',' + f(y + 4.5) + '" fill="' + col + '" stroke="#333" stroke-width="0.5"/>');
      else if (sh === 'diamond') o.push('<polygon points="' + f(x) + ',' + f(y - 6) + ' ' + f(x + 6) + ',' + f(y) + ' ' + f(x) + ',' + f(y + 6) + ' ' + f(x - 6) + ',' + f(y) + '" fill="' + col + '" stroke="#333" stroke-width="0.5"/>');
      else if (sh === 'cross') o.push('<path d="M' + f(x - 4.5) + ' ' + f(y - 4.5) + 'L' + f(x + 4.5) + ' ' + f(y + 4.5) + 'M' + f(x + 4.5) + ' ' + f(y - 4.5) + 'L' + f(x - 4.5) + ' ' + f(y + 4.5) + '" stroke="' + col + '" stroke-width="2"/>');
      else o.push('<circle cx="' + f(x) + '" cy="' + f(y) + '" r="4.5" fill="' + col + '" stroke="#333" stroke-width="0.5"/>');
    });
    o.push('<text x="' + (pl + (W - pl - pr) / 2) + '" y="' + (H - 12) + '" text-anchor="middle" fill="#444">' + MCore.esc(tname(APP.technique) + ' dimension 1') + '</text>');
    o.push('<text transform="translate(16,' + (pt + (H - pt - pb) / 2) + ') rotate(-90)" text-anchor="middle" fill="#444">' + MCore.esc(tname(APP.technique) + ' dimension 2') + '</text>');
    if (APP.pointColors) {
      for (var g = 0; g < 100; g++) o.push('<rect x="' + (W - pr + 28) + '" y="' + (pt + 20 + g * 2) + '" width="14" height="2" fill="' + MCore.plasma(1 - g / 100) + '"/>');
      o.push('<text x="' + (W - pr + 46) + '" y="' + (pt + 28) + '" fill="#444">' + MCore.esc(String(+APP.contMax.toPrecision(5))) + '</text><text x="' + (W - pr + 46) + '" y="' + (pt + 218) + '" fill="#444">' + MCore.esc(String(+APP.contMin.toPrecision(5))) + '</text><text x="' + (W - pr + 28) + '" y="' + (pt + 10) + '" fill="#444">' + MCore.esc(String(APP.contName || '')) + '</text>');
    } else {
      var seen = {}, ly = pt + 14; APP.labels.forEach(function (l) { if (!seen[l]) { seen[l] = 1; o.push('<circle cx="' + (W - pr + 12) + '" cy="' + ly + '" r="4" fill="' + APP.colors[l] + '"/><text x="' + (W - pr + 22) + '" y="' + (ly + 4) + '" fill="#444">' + MCore.esc(String(APP.labelNames[l] || '')) + '</text>'); ly += 16; } });
    }
    o.push('</svg>');
    download('manifold_' + APP.technique + '_figure.svg', o.join('\n'), 'image/svg+xml');
  }

  function methodsText() {
    var P = APP.runParams || {}, n = APP.data ? APP.data.length : 0, d = APP.data ? APP.data[0].length : 0, t = APP.technique, s = [];
    var multi = APP.multi && APP.files && APP.files.length > 1;
    s.push('Dimensionality reduction was performed with Manifold, an in-browser implementation of PCA, t-SNE, UMAP, LDA and Isomap (https://github.com/outpulsebyvashu/manifold).');
    if (multi) s.push('Input: ' + APP.files.length + ' tables (' + APP.multi.files.join(', ') + '), ' + (APP.multi.mode === 'joint' ? 'embedded jointly on shared columns' : 'each embedded separately and overlaid after scaling every embedding to unit RMS radius (axes of separate embeddings are not comparable)') + '.');
    else s.push('The input matrix had n = ' + n + ' samples × d = ' + d + ' features' + ((APP.prepMeta && APP.prepMeta.dropped) ? ' after removing ' + APP.prepMeta.dropped + ' row(s) with missing values' : '') + ((APP.prepMeta && APP.prepMeta.imputed) ? '; ' + APP.prepMeta.imputed + ' missing value(s) were imputed (' + P.miss + ')' : '') + '.');
    s.push('Features were scaled by ' + (SCALE_LABEL[P.scale] || 'the selected scheme') + '.');
    if (t === 'pca') { var inf = APP.pcaInfo; s.push('PCA used an exact eigendecomposition' + ((inf && inf.dual) ? ' (via the n×n Gram matrix because d > n)' : '') + (inf ? '; PC1 and PC2 explain ' + (inf.evr[0] * 100).toFixed(1) + '% and ' + ((inf.evr[1] || 0) * 100).toFixed(1) + '% of the total variance.' : '.')); }
    else if (t === 'tsne') s.push('t-SNE used perplexity = ' + P.perplexity + ', ' + P.iters + ' iterations, learning rate ' + P.lr + ', early exaggeration 4 for the first 100 iterations, random initialisation and random seed ' + P.seed + (P.preUsed ? ', after PCA pre-reduction to ' + P.preUsed + ' components' : '') + '.');
    else if (t === 'umap') s.push('UMAP used n_neighbors = ' + P.k + ', min_dist = ' + P.minDist + ', ' + P.iters + ' optimisation epochs, spectral initialisation and random seed ' + P.seed + (P.preUsed ? ', after PCA pre-reduction to ' + P.preUsed + ' components' : '') + '.');
    else if (t === 'lda') s.push('LDA solved the generalised eigenproblem S_B v = λ S_W v by Cholesky whitening with light shrinkage' + (n < d ? '; because n < d the data were first reduced with PCA' : '') + '.');
    else if (t === 'iso') s.push('Isomap used k = ' + P.k + (APP.kUsed > P.k ? ' (raised to ' + APP.kUsed + ' to connect the neighbourhood graph)' : '') + ', an undirected k-nearest-neighbour graph, Dijkstra geodesic distances and classical MDS.');
    if (!multi && APP.result && APP.data && n >= 8) {
      var k = Math.max(2, Math.min(10, Math.floor(n / 4))), q = MCore.embeddingQuality(APP.data, APP.result, k, 6);
      if (q) s.push('Embedding quality (k = ' + q.k + ' neighbours): trustworthiness = ' + q.trust.toFixed(3) + ', continuity = ' + q.cont.toFixed(3) + ', ' + q.k + '-NN overlap = ' + (q.knn * 100).toFixed(0) + '%, against a random-layout baseline trustworthiness of ' + q.baseline.toFixed(2) + '.' + (n < 30 ? ' With so few samples these scores are coarse.' : ''));
      if (APP.order && n >= 6) { var hd = MCore.stepSizes(APP.data, APP.order), fj = MCore.flagJumps(hd); if (fj.flagged.length && APP.contOn) s.push('In the high-dimensional data the largest change between consecutive states occurred between ' + fj.flagged.slice(0, 2).map(function (i) { return +APP.contVals[APP.order[i]].toPrecision(5) + ' and ' + +APP.contVals[APP.order[i + 1]].toPrecision(5); }).join(' and ') + ' (' + APP.contName + '), which we treat as a candidate transition to be confirmed with an independent observable.'); }
    }
    if (APP.sweep) s.push('Stability was checked across ' + APP.sweep.settings.length + ' parameter settings' + (APP.sweep.cd != null ? ' and 4 random seeds' : '') + ' (geometry agreement ρ = ' + (APP.sweep.cs == null ? 'n/a' : APP.sweep.cs.toFixed(2)) + (APP.sweep.cd != null ? ' between settings, ' + APP.sweep.cd.toFixed(2) + ' between seeds' : '') + ').');
    return s.join(' ');
  }

  /* ───────────── data helpers: paste, template, examples ───────────── */
  function loadPasted() {
    var t = $('paste-ta').value; if (!t.trim()) { showError('Paste some CSV text first.'); return; }
    var p = MCore.parseCSV(t); if (!p) { showError('Could not parse the pasted text (need a header row and at least one data row).'); return; }
    cancelRun(); APP.files = null; APP.parsedDropped = p.dropped || 0; setUploadZoneLoaded('pasted data'); processCSV(p.headers, p.rows, 'pasted data');
  }
  function template() {
    var rng = MCore.seededRNG(1), lines = ['temperature,cell0,cell1,cell2,cell3,cell4,cell5'];
    for (var i = 0; i < 12; i++) { var T = 300 + 10 * i, row = [T]; for (var j = 0; j < 6; j++) row.push((0.5 + 0.001 * (T - 300) * (j + 1) / 6 + (T >= 350 ? 0.05 * (j % 2 ? 1 : -1) : 0) + 0.004 * MCore.randn(rng)).toFixed(4)); lines.push(row.join(',')); }
    download('manifold_template.csv', lines.join('\n') + '\n', 'text/csv');
  }
  function genMelt() {
    var rng = MCore.seededRNG(2026), d = 200, base = [], dA = [], dB = [], j, i;
    for (j = 0; j < d; j++) { base.push(0.6 + 0.3 * rng()); dA.push(MCore.randn(rng)); dB.push(MCore.randn(rng)); }
    var headers = ['temperature'], rows = [];
    for (j = 0; j < d; j++) headers.push('cell' + j);
    for (i = 0; i < 17; i++) {
      var T = 300 + 10 * i, sh = 1 / (1 + Math.exp(-(T - 390) / 4)), r = [String(T)];
      for (j = 0; j < d; j++) r.push((base[j] + 0.0007 * (T - 300) * (1 + 0.3 * dA[j]) + 0.07 * sh * dB[j] + 0.004 * MCore.randn(rng)).toFixed(5));
      rows.push(r);
    }
    return { headers: headers, rows: rows, name: 'Polymer melt (SYNTHETIC demo)', preferLabel: 'temperature' };
  }
  function genTensile() {
    var rng = MCore.seededRNG(77), cls = [['as-cast', 60, 0, 28, 2.66], ['annealed', 90, 0, 38, 2.70], ['cold-worked', 15, 80, 9, 2.70]], rows = [];
    cls.forEach(function (c) {
      for (var i = 0; i < 30; i++) {
        var g = c[1] * Math.exp(0.18 * MCore.randn(rng)), y = 70 + 600 / Math.sqrt(g) + c[2] + 6 * MCore.randn(rng), uts = y * (c[0] === 'cold-worked' ? 1.1 : 1.25) + 8 * MCore.randn(rng);
        rows.push([g.toFixed(1), y.toFixed(1), uts.toFixed(1), (c[3] + 2.5 * MCore.randn(rng)).toFixed(1), (69 + 1.2 * MCore.randn(rng)).toFixed(1), (0.3 * uts + 4 * MCore.randn(rng)).toFixed(1), (c[4] + 0.012 * MCore.randn(rng)).toFixed(3), c[0]]);
      }
    });
    return { headers: ['grain_size_um', 'yield_MPa', 'UTS_MPa', 'elongation_pct', 'modulus_GPa', 'hardness_HV', 'density_g_cc', 'condition'], rows: rows, name: 'Tensile tests, Al-alloy-like (SYNTHETIC demo)' };
  }

  /* ───────────── wiring (after the main script's own load handlers) ───────────── */
  window.addEventListener('load', function () {
    BUILTINS.melt = genMelt(); BUILTINS.tensile = genTensile();
    if (window.DATASETS_EXT && DATASETS_EXT.breast) BUILTINS.breast = DATASETS_EXT.breast;
    var _lb = window.loadBuiltin;
    window.loadBuiltin = function (key) {
      cancelRun(); APP.files = null; $('multi-opt').style.display = 'none'; $('multi-list').textContent = '';
      _lb(key); var c = BUILTINS[key];
      if (c && c.preferLabel) { APP.labelCol = String(c.headers.indexOf(c.preferLabel)); autoContinuous(); renderColSelector(); previewLabels(); }
    };
    var _pc = window.processCSV;
    window.processCSV = function (h, r, nm) {
      if (!window.__keepFiles) { APP.files = null; $('multi-opt').style.display = 'none'; $('multi-list').textContent = ''; }
      window.__single = false; _pc(h, r, nm);
    };
    // replace the file input so ONE handler (ours) manages 1..n files
    var fi = $('file-input'), nf = fi.cloneNode(true); fi.parentNode.replaceChild(nf, fi);
    nf.addEventListener('change', function (e) { var fl = Array.prototype.slice.call(e.target.files || []); if (fl.length) { cancelRun(); handleFiles(fl); } });
    $('paste-load').addEventListener('click', loadPasted);
    $('tpl-btn').addEventListener('click', template);
    $('sweep-btn').addEventListener('click', runSweep);
    $('csv-btn').addEventListener('click', exportCSV);
    $('svg-btn').addEventListener('click', exportSVG);
    $('methods-btn').addEventListener('click', function () {
      if (!APP.result) { showError('Run an embedding first.'); return; }
      $('methods-ta').value = methodsText(); $('methods-wrap').style.display = 'block'; $('ana').style.display = 'block'; $('methods-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('methods-copy').addEventListener('click', function () { var t = $('methods-ta'); t.select(); try { navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand('copy'); } this.textContent = 'Copied ✓'; var b = this; setTimeout(function () { b.textContent = 'Copy to clipboard'; }, 1500); });
    // multi-file: label column change should also refresh mode hint; nothing else needed
  });
})();
