// Canvas rendering + stroke processing
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  function createDraw(canvas, ctx) {
    let canvasTransformReady = false;

    function setupCanvasResolution() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();

      const displayW = Math.max(1, Math.round(rect.width));
      const displayH = Math.max(1, Math.round(rect.height));

      const targetW = Math.round(displayW * dpr);
      const targetH = Math.round(displayH * dpr);

      // IMPORTANT: changing canvas width/height clears the bitmap.
      // Preserve current drawing across resizes by snapshotting and restoring.
      if (canvas.width !== targetW || canvas.height !== targetH) {
        let snapshot = null;
        const prevW = canvas.width;
        const prevH = canvas.height;

        if (prevW > 0 && prevH > 0) {
          try {
            snapshot = document.createElement('canvas');
            snapshot.width = prevW;
            snapshot.height = prevH;
            const sctx = snapshot.getContext('2d');
            if (sctx) sctx.drawImage(canvas, 0, 0);
          } catch (_) {
            snapshot = null;
          }
        }

        canvas.width = targetW;
        canvas.height = targetH;

        // reset transform before restoring
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        if (snapshot) {
          try {
            ctx.imageSmoothingEnabled = true;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(snapshot, 0, 0, prevW, prevH, 0, 0, canvas.width, canvas.height);
          } catch (_) {
            // ignore
          }
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      canvasTransformReady = true;
    }

    function ensureCanvasReady() {
      if (!canvasTransformReady) setupCanvasResolution();
    }

    function toPxX(x) {
      return (Number(x) || 0) * canvas.width;
    }

    function toPxY(y) {
      return (Number(y) || 0) * canvas.height;
    }

    function clearCanvasLocal() {
      setupCanvasResolution();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function drawEvent(ev) {
      if (!ev) return;

      ensureCanvasReady();

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ev.c || '#000';
      ctx.lineWidth = Math.max(1, Number(ev.w) || 3);

      if (ev.t === 'stroke' && Array.isArray(ev.p) && ev.p.length >= 2) {
        // Interpolate between points to avoid visible gaps when points are sparse.
        const maxStep = 0.008;

        ctx.beginPath();
        let prev = ev.p[0];
        ctx.moveTo(toPxX(prev.x), toPxY(prev.y));

        for (let i = 1; i < ev.p.length; i++) {
          const cur = ev.p[i];
          const dx = (cur.x - prev.x);
          const dy = (cur.y - prev.y);
          const dist = Math.hypot(dx, dy);

          if (dist > maxStep) {
            const steps = Math.ceil(dist / maxStep);
            for (let s = 1; s <= steps; s++) {
              const t = s / steps;
              ctx.lineTo(toPxX(prev.x + dx * t), toPxY(prev.y + dy * t));
            }
          } else {
            ctx.lineTo(toPxX(cur.x), toPxY(cur.y));
          }

          prev = cur;
        }

        ctx.stroke();
        return;
      }

      if (ev.t === 'line') {
        ctx.beginPath();
        ctx.moveTo(toPxX(ev.x0), toPxY(ev.y0));
        ctx.lineTo(toPxX(ev.x1), toPxY(ev.y1));
        ctx.stroke();
      }
    }

    function normalizeCanvasPoint(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;

      return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    }

    // Incoming stroke stitching (receiver-side).
    const incomingStrokeAnchor = new Map();

    function strokeKey(ev) {
      const c = (ev && typeof ev.c === 'string') ? ev.c : '';
      const w = (ev && (typeof ev.w === 'number' || typeof ev.w === 'string')) ? String(ev.w) : '';
      return `${c}|${w}`;
    }

    function pointsClose(a, b) {
      if (!a || !b) return false;
      const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
      const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
      return (dx * dx + dy * dy) <= 0.0000005;
    }

    function stitchIncomingStroke(ev) {
      if (!ev || ev.t !== 'stroke' || !Array.isArray(ev.p) || ev.p.length < 2) {
        return ev;
      }

      const key = strokeKey(ev);
      const anchor = incomingStrokeAnchor.get(key) || null;
      const pts = ev.p;

      if (anchor && pointsClose(anchor, pts[0])) {
        const rest = pts.slice(1);
        if (rest.length >= 1) {
          ev = { ...ev, p: [anchor, ...rest] };
        }
      }

      const outPts = ev.p;
      incomingStrokeAnchor.set(key, outPts[outPts.length - 1]);

      return ev;
    }

    function resetIncomingStrokeAnchors() {
      incomingStrokeAnchor.clear();
    }

    // Render queue / jitter buffer
    const renderQueue = [];
    let renderScheduled = false;

    const JITTER_BUFFER_MIN_MS = 20;
    const JITTER_BUFFER_MAX_MS = 80;
    let jitterBufferMs = 35;

    const MAX_QUEUE_DELAY_MS = 220;
    let lastDueMs = 0;
    let timeOffsetMs = null;

    const SPREAD_WITHIN_BATCH_MS = 0;

    function updateTimeOffset(serverTsMs) {
      if (!Number.isFinite(serverTsMs)) return;
      const localNow = performance.now();
      const candidate = serverTsMs - localNow;
      if (timeOffsetMs === null) {
        timeOffsetMs = candidate;
        return;
      }
      timeOffsetMs = (timeOffsetMs * 0.9) + (candidate * 0.1);
    }

    function localNowAsServerMs() {
      if (timeOffsetMs === null) return performance.now();
      return performance.now() + timeOffsetMs;
    }

    function tuneJitterBufferOnBatch(batchSize) {
      if (!Number.isFinite(batchSize)) return;
      if (batchSize >= 8) {
        jitterBufferMs = Momal.clamp(jitterBufferMs + 6, JITTER_BUFFER_MIN_MS, JITTER_BUFFER_MAX_MS);
      } else if (batchSize <= 2) {
        jitterBufferMs = Momal.clamp(jitterBufferMs - 1, JITTER_BUFFER_MIN_MS, JITTER_BUFFER_MAX_MS);
      }
    }

    function pumpRenderQueue() {
      const started = performance.now();
      const budgetMs = renderQueue.length > 400 ? 12 : (renderQueue.length > 120 ? 9 : 6);

      const nowServerMs = localNowAsServerMs();

      while (renderQueue.length > 0 && (performance.now() - started) < budgetMs) {
        const item = renderQueue[0];
        if (!item) {
          renderQueue.shift();
          continue;
        }
        if (item.dueMs > nowServerMs) break;
        renderQueue.shift();
        drawEvent(item.ev);
      }

      if (renderQueue.length > 0) {
        window.requestAnimationFrame(pumpRenderQueue);
      } else {
        renderScheduled = false;
        lastDueMs = 0;
      }
    }

    function enqueueRender(payload, meta = null) {
      if (!payload) return;

      const tsMs = meta && Number.isFinite(meta.tsMs) ? Number(meta.tsMs) : null;
      if (tsMs !== null) updateTimeOffset(tsMs);

      const nowServerMs = localNowAsServerMs();
      const targetDue = nowServerMs + jitterBufferMs;

      if (lastDueMs > targetDue + MAX_QUEUE_DELAY_MS) {
        lastDueMs = targetDue;
      }

      const dueMs = Math.max(targetDue, lastDueMs);
      renderQueue.push({ ev: payload, dueMs });
      lastDueMs = dueMs;

      if (renderScheduled) return;
      renderScheduled = true;
      window.requestAnimationFrame(pumpRenderQueue);
    }

    function enqueueRenderBatch(events, tsMs) {
      if (!Array.isArray(events) || events.length === 0) return;

      const stitchedEvents = events.map((e) => stitchIncomingStroke(e));

      if (Number.isFinite(tsMs)) updateTimeOffset(Number(tsMs));

      tuneJitterBufferOnBatch(stitchedEvents.length);

      const nowServerMs = localNowAsServerMs();
      const targetDue = nowServerMs + jitterBufferMs;

      if (lastDueMs > targetDue + MAX_QUEUE_DELAY_MS) {
        lastDueMs = targetDue;
      }

      const baseDue = Math.max(targetDue, lastDueMs);

      if (SPREAD_WITHIN_BATCH_MS > 0 && stitchedEvents.length > 1) {
        for (let i = 0; i < stitchedEvents.length; i++) {
          renderQueue.push({ ev: stitchedEvents[i], dueMs: baseDue + (i * (SPREAD_WITHIN_BATCH_MS / stitchedEvents.length)) });
        }
      } else {
        for (let i = 0; i < stitchedEvents.length; i++) {
          renderQueue.push({ ev: stitchedEvents[i], dueMs: baseDue });
        }
      }

      lastDueMs = baseDue;

      if (!renderScheduled) {
        renderScheduled = true;
        window.requestAnimationFrame(pumpRenderQueue);
      }
    }

    return {
      // canvas
      setupCanvasResolution,
      clearCanvasLocal,
      drawEvent,
      normalizeCanvasPoint,

      // rendering queue
      enqueueRender,
      enqueueRenderBatch,

      // stroke stitching
      stitchIncomingStroke,
      resetIncomingStrokeAnchors,
      updateTimeOffset,
    };
  }

  Momal.createDraw = createDraw;
})();

