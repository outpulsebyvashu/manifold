/* worker-embed.js — runs the heavy embeddings off the main thread (UI stays responsive). */
importScripts('manifold-core.js');
onmessage = function (e) {
  var m = e.data;
  try {
    if (m.cmd !== 'run') return;
    var Y, extra = {};
    var cb = function (it, Yc) { postMessage({ type: 'progress', id: m.id, iter: it, total: m.opts.iters, Y: Yc }); };
    if (m.tech === 'tsne') Y = MCore.tsne(m.data, Object.assign({}, m.opts, { onProgress: m.progress ? cb : null, every: m.every || 10 }));
    else if (m.tech === 'umap') Y = MCore.umap(m.data, Object.assign({}, m.opts, { onProgress: m.progress ? cb : null, every: m.every || 5 }));
    else if (m.tech === 'iso') { var r = MCore.isomap(m.data, m.opts.k); Y = r.Y; extra = { kUsed: r.kUsed, disconnected: r.disconnected }; }
    else throw new Error('unknown technique ' + m.tech);
    postMessage({ type: 'done', id: m.id, Y: Y, extra: extra });
  } catch (err) { postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) }); }
};
