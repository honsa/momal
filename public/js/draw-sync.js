// Draw sequencing / gap handling for draw:batch events
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  /**
   * Manages draw batch sequencing with a small re-order window.
   *
   * Contract:
   * - Call onBatch({seq, events, tsMs}) for incoming draw:batch.
   * - It will call draw.enqueueRenderBatch(events, tsMs) in-order where possible.
   * - If a gap occurs, it renders slightly out-of-order within a small window and
   *   eventually force-drains to keep the remote canvas moving.
   */
  function createDrawSync({ draw, reorderWindow = 6, gapTimeoutMs = 90, maxPending = 400 } = {}) {
    if (!draw) throw new Error('createDrawSync: missing draw');

    let expectedDrawSeq = null; // number|null
    const pendingBatches = new Map(); // seq -> {events, tsMs}
    let gapTimer = null;

    const DRAW_REORDER_WINDOW = Math.max(0, Math.min(50, Number(reorderWindow) || 6));
    const GAP_TIMEOUT_MS = Math.max(10, Math.min(2000, Number(gapTimeoutMs) || 90));
    const MAX_PENDING = Math.max(20, Math.min(5000, Number(maxPending) || 400));

    function clearGapTimer() {
      if (gapTimer !== null) {
        window.clearTimeout(gapTimer);
        gapTimer = null;
      }
    }

    function reset() {
      expectedDrawSeq = null;
      pendingBatches.clear();
      clearGapTimer();
    }

    function scheduleGapCheck() {
      if (gapTimer !== null) return;
      gapTimer = window.setTimeout(() => {
        gapTimer = null;
        drain(true);
      }, GAP_TIMEOUT_MS);
    }

    function drainWithinWindow() {
      if (expectedDrawSeq === null) return;
      if (DRAW_REORDER_WINDOW <= 0) return;

      for (let i = 0; i < DRAW_REORDER_WINDOW; i++) {
        const k = expectedDrawSeq + i;
        if (!pendingBatches.has(k)) continue;
        if (i === 0) return;

        const batchObj = pendingBatches.get(k);
        pendingBatches.delete(k);

        const events = batchObj && Array.isArray(batchObj.events) ? batchObj.events : [];
        const tsMs = batchObj && Number.isFinite(batchObj.tsMs) ? Number(batchObj.tsMs) : null;
        draw.enqueueRenderBatch(events, tsMs);
        break;
      }
    }

    function forceDropOldestUntilUnderLimit() {
      if (pendingBatches.size <= MAX_PENDING) return;

      // Drop oldest keys to prevent memory buildup.
      // This trades perfect fidelity for liveness under extreme lag.
      const keys = Array.from(pendingBatches.keys())
        .filter((k) => Number.isFinite(k))
        .sort((a, b) => a - b);

      while (pendingBatches.size > MAX_PENDING && keys.length > 0) {
        const k = keys.shift();
        pendingBatches.delete(k);
      }

      // If we just dropped the expected seq (or we're far off), resync to the smallest available.
      if (expectedDrawSeq !== null && !pendingBatches.has(expectedDrawSeq) && pendingBatches.size > 0) {
        const smallest = Array.from(pendingBatches.keys()).filter(Number.isFinite).sort((a, b) => a - b)[0];
        if (Number.isFinite(smallest)) expectedDrawSeq = smallest;
      }
    }

    function drain(force = false) {
      if (expectedDrawSeq === null) return;

      while (pendingBatches.has(expectedDrawSeq)) {
        const batchObj = pendingBatches.get(expectedDrawSeq);
        pendingBatches.delete(expectedDrawSeq);

        const events = batchObj && Array.isArray(batchObj.events) ? batchObj.events : [];
        const tsMs = batchObj && Number.isFinite(batchObj.tsMs) ? Number(batchObj.tsMs) : null;
        draw.enqueueRenderBatch(events, tsMs);

        expectedDrawSeq += 1;
        force = false;
      }

      // Keep timer in sync: if queue is empty or we are in-order, no need to keep waiting.
      if (!force && pendingBatches.size === 0) {
        clearGapTimer();
      }

      if (force && pendingBatches.size > 0) {
        const keys = Array.from(pendingBatches.keys())
          .filter((k) => Number.isFinite(k))
          .sort((a, b) => a - b);
        const k = keys[0];
        if (!Number.isFinite(k)) return;

        const batchObj = pendingBatches.get(k);
        pendingBatches.delete(k);
        expectedDrawSeq = k + 1;

        const events = batchObj && Array.isArray(batchObj.events) ? batchObj.events : [];
        const tsMs = batchObj && Number.isFinite(batchObj.tsMs) ? Number(batchObj.tsMs) : null;
        draw.enqueueRenderBatch(events, tsMs);

        drain(false);
      }
    }

    function onBatch({ seq, events, tsMs } = {}) {
      const nSeq = Number(seq);
      const evs = Array.isArray(events) ? events : [];

      if (!Number.isFinite(nSeq) || evs.length === 0) return;

      if (expectedDrawSeq === null) expectedDrawSeq = nSeq;

      pendingBatches.set(nSeq, { events: evs, tsMs: Number.isFinite(tsMs) ? Number(tsMs) : null });
      forceDropOldestUntilUnderLimit();

      if (nSeq !== expectedDrawSeq) {
        scheduleGapCheck();
        drainWithinWindow();
      }

      drain(false);
    }

    function getDebugInfo() {
      return {
        expectedDrawSeq,
        pendingCount: pendingBatches.size,
        reorderWindow: DRAW_REORDER_WINDOW,
        gapTimeoutMs: GAP_TIMEOUT_MS,
        maxPending: MAX_PENDING,
      };
    }

    return {
      reset,
      onBatch,
      getDebugInfo,
    };
  }

  Momal.createDrawSync = createDrawSync;
})();
