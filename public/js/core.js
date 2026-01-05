// Core namespace + tiny helpers (no build, no dependencies)
// Exposes a single global: window.Momal
(() => {
  'use strict';

  const Momal = (window.Momal || {});

  Momal.$ = Momal.$ || ((id) => document.getElementById(id));

  Momal.clamp = Momal.clamp || ((n, a, b) => Math.max(a, Math.min(b, n)));

  Momal.clampInt = Momal.clampInt || ((n, a, b) => {
    n = Number.isFinite(n) ? Math.round(n) : a;
    return Math.max(a, Math.min(b, n));
  });

  Momal.escapeHtml = Momal.escapeHtml || ((s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c])));

  Momal.escapeAttr = Momal.escapeAttr || ((s) => String(s).replace(/[^a-zA-Z0-9#(),.%\s-]/g, ''));

  Momal.isDebugEnabled = Momal.isDebugEnabled || (() => {
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get('debug') === '1') return true;
      return (localStorage.getItem('momalDebug') === '1');
    } catch (_) {
      return false;
    }
  });

  window.Momal = Momal;
})();

