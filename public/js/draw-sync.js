// Draw sequencing / gap handling for draw:batch events
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  /**
   * Manages draw batch sequencing with a small re-order window.
   *
   * Contract:
   * - Call onBatch(seq, events, tsMs) for incoming draw:batch.
   * - It will call draw.enqueueRenderBatch(events, tsMs) in-order where possible,
   *   and can optionally render slightly out-of-order within a small window.
   */
  function createDrawSync({ draw } = {}) {
    if (!draw) throw new Error('createDrawSync: missing draw');

    let expectedDrawSeq = null; // number|null
    const pendingBatches = new Map(); // seq -> {events, tsMs}
    let gapTimer = null;

    const DRAW_REORDER_WINDOW = 6;

    function reset() {
      expectedDrawSeq = null;
      pendingBatches.clear();
      if (gapTimer !== null) {
        window.clearTimeout(gapTimer);
        gapTimer = null;
      }
    }

    function scheduleGapCheck() {
      if (gapTimer !== null) return;
      gapTimer = window.setTimeout(() => {
        gapTimer = null;
        drain(true);
      }, 90);
    }

    function drainWithinWindow() {
      if (expectedDrawSeq === null) return;

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

      if (nSeq !== expectedDrawSeq) {
        scheduleGapCheck();
        drainWithinWindow();
      }

      drain(false);
    }

    return {
      reset,
      onBatch,
      // exposed for debugging
      getExpectedSeq: () => expectedDrawSeq,
      getPendingCount: () => pendingBatches.size,
    };
  }

  Momal.createDrawSync = createDrawSync;
})();

