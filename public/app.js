// Legacy stub.
// The frontend has been split into multiple vanilla JS modules under /public/js.
// Keep this file to avoid 404s if a stale deployment still references /app.js.
(() => {
  'use strict';
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[momal] public/app.js is deprecated. Use /js/app-main.js and friends.');
  }
})();
