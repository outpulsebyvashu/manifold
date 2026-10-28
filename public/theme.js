/* theme.js — shared light/dark toggle for every page (same storage key as the dashboard: manifold_theme = "light" | "dark").
   Light is the default. Older pages carry their own emoji toggle; we swap their button for a clean one wired to this code. */
(function () {
  var KEY = 'manifold_theme';
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function toggle() { var dark = saved() !== 'dark'; try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch (e) { } apply(); }
  function ensureButton() {
    var b = document.getElementById('theme-btn'); if (!b) return null;
    if (b.getAttribute('data-themed') !== '1') {
      var nb = document.createElement('button'); nb.id = 'theme-btn'; nb.className = b.className; nb.type = 'button'; nb.setAttribute('data-themed', '1');
      nb.addEventListener('click', toggle);
      b.parentNode.replaceChild(nb, b); b = nb;
    }
    return b;
  }
  function apply() {
    var dark = saved() === 'dark';
    document.body.classList.toggle('light', !dark);
    var b = ensureButton(); if (b) { b.innerHTML = dark ? SUN : MOON; b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); }
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#0a0d0a' : '#e9e9e9';
    if (typeof window.__themeChanged === 'function') window.__themeChanged(dark);
  }
  window.toggleTheme = toggle;
  document.addEventListener('DOMContentLoaded', function () {
    apply();                                   // right away (no flash)…
    setTimeout(function () { window.toggleTheme = toggle; apply(); }, 60);   // …and again after the page's own older theme code ran
  });
  window.addEventListener('load', function () { window.toggleTheme = toggle; apply(); });
})();
