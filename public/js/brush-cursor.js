// Brush cursor UX (dynamic cursor that reflects size/color)
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  function clampInt(n, a, b) {
    n = Number.isFinite(n) ? Math.round(n) : a;
    return Math.max(a, Math.min(b, n));
  }

  function escapeAttr(s) {
    return String(s).replace(/[^a-zA-Z0-9#(),.%\s-]/g, '');
  }

  function buildBrushCursorSvg(sizePx, colorHex) {
    // Keep this small: browsers impose cursor-size limits.
    const w = 64;
    const h = 64;

    const r = clampInt(sizePx / 2, 2, 20);
    const cx = 18;
    const cy = 44;

    const color = escapeAttr(colorHex || '#000000');

    // A11y: high-contrast outline so size is visible for all colors.
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <!-- stroke preview dot -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.45"/>
  <circle cx="${cx}" cy="${cy}" r="${Math.max(1, r - 1)}" fill="none" stroke="#000" stroke-width="2"/>
  <circle cx="${cx}" cy="${cy}" r="${Math.max(1, r - 2)}" fill="none" stroke="#fff" stroke-width="1" opacity="0.9"/>

  <!-- flat brush icon (neutral colors, visible on light/dark) -->
  <path d="M40 10l12 12-12 12-12-12z" fill="#f5f5f5" stroke="#111" stroke-width="2" />
  <path d="M22 34l18-18 6 6-18 18z" fill="#d0a264" stroke="#111" stroke-width="2" />
  <path d="M12 58c0-5 3-9 8-9 4 0 6 3 6 6 0 8-6 13-14 13-1 0-2-1-2-10z" fill="#f5f5f5" stroke="#111" stroke-width="2" />
</svg>`;
  }

  function svgToCursor(svg, hotX, hotY) {
    const encoded = encodeURIComponent(svg).replace(/%0A/g, '').replace(/%20/g, ' ');
    return `url("data:image/svg+xml,${encoded}") ${hotX} ${hotY}`;
  }

  /**
   * @param {{
   *   canvas: HTMLCanvasElement,
   *   widthEl: HTMLInputElement,
   *   colorEl: HTMLInputElement,
   *   isDrawing?: () => boolean
   * }} deps
   */
  function createBrushCursor({ canvas, widthEl, colorEl, isDrawing } = {}) {
    if (!canvas || !widthEl || !colorEl) throw new Error('createBrushCursor: missing deps');

    const isActive = (typeof isDrawing === 'function') ? isDrawing : () => document.body.classList.contains('is-drawing');

    // Default hover cursor (non-drawing state)
    canvas.style.cursor = 'pointer';

    function apply() {
      if (!isActive()) return;

      const w = clampInt(Number(widthEl.value), 1, 40);
      const c = colorEl.value || '#000000';

      try {
        const svg = buildBrushCursorSvg(w, c);
        canvas.style.cursor = `${svgToCursor(svg, 18, 44)}, crosshair`;
      } catch (_) {
        canvas.style.cursor = 'crosshair';
      }
    }

    function clear() {
      // Revert to hover cursor when not drawing.
      canvas.style.cursor = 'pointer';
    }

    function setActive(active) {
      if (active) {
        document.body.classList.add('is-drawing');
        apply();
      } else {
        document.body.classList.remove('is-drawing');
        clear();
      }
    }

    // Live update while drawing
    function handleInput() {
      if (!isActive()) return;
      apply();
    }

    widthEl.addEventListener('input', handleInput);
    colorEl.addEventListener('input', handleInput);

    return {
      apply,
      clear,
      setActive,
    };
  }

  Momal.createBrushCursor = createBrushCursor;
})();
