/* guard.js — loaded first on every protected page.
   1) redirects to login.html when there is no session
   2) records that this section was opened (per signed-in user, on this device) so the dashboard progress is accurate
   NOTE: this is a courtesy lock only. Anything running in the browser can be bypassed; real access control
   needs a server that verifies the Google ID token (see AUDIT.md). */
(function () {
  var MAP = { 'section-01.html': 'curse', 'section-02.html': 'dr', 'section-pca.html': 'pca', 'section-tsne.html': 'tsne',
    'section-umap.html': 'umap', 'section-lda.html': 'lda', 'section-isomap.html': 'iso', 'section-compare.html': 'compare',
    'section05-playground.html': 'playground', 'section-gpr.html': 'gpr' };
  try {
    var user = sessionStorage.getItem('manifold_user');
    if (!user) { location.replace('login.html'); return; }
    var id = MAP[location.pathname.split('/').pop()];
    if (id) {
      var key = 'manifold_visited:' + (sessionStorage.getItem('manifold_email') || 'guest').toLowerCase();
      var v = JSON.parse(localStorage.getItem(key) || '{}') || {};
      v[id] = Date.now();
      localStorage.setItem(key, JSON.stringify(v));
    }
  } catch (e) { location.replace('login.html'); }
})();
