// Outgoing stroke sender (collect points, resample, and flush as binary or JSON)
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  /**
   * @param {{
   *   wsClient: { isOpen: Function, sendRaw: Function, sendJson: Function },
   *   canDraw: Function,
   *   nowMs?: Function,
   *   maxPointStep?: number,
   *   sendIntervalMs?: number,
   *   maxPointsPerChunk?: number,
   * }} deps
   */
  function createStrokeSender({
    wsClient,
    canDraw,
    nowMs,
    maxPointStep = 0.002,
    sendIntervalMs = 16,
    maxPointsPerChunk = 160,
  } = {}) {
    if (!wsClient || typeof wsClient.sendRaw !== 'function' || typeof wsClient.sendJson !== 'function') {
      throw new Error('createStrokeSender: missing wsClient');
    }
    if (typeof canDraw !== 'function') throw new Error('createStrokeSender: missing canDraw');

    const getNowMs = (typeof nowMs === 'function') ? nowMs : () => performance.now();

    let pendingPoints = [];
    let lastSentPoint = null;

    let flushScheduled = false;
    let sendTimer = null;

    let drawSeq = 1;
    let strokeColor = '#000000';
    let strokeWidth = 3;

    function reset() {
      pendingPoints = [];
      lastSentPoint = null;
      flushScheduled = false;
      if (sendTimer !== null) {
        window.clearTimeout(sendTimer);
        sendTimer = null;
      }
    }

    function setStyle({ color, width } = {}) {
      if (typeof color === 'string' && color.trim() !== '') strokeColor = color;
      if (Number.isFinite(Number(width))) strokeWidth = Number(width);
    }

    function addPointWithResampling(prev, cur, maxStep) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= maxStep) {
        pendingPoints.push(cur);
        return;
      }

      const steps = Math.ceil(dist / maxStep);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        pendingPoints.push({
          x: prev.x + dx * t,
          y: prev.y + dy * t,
        });
      }
    }

    function flushChunk(forceSinglePoint = false) {
      if (!canDraw()) return;

      if (!pendingPoints || pendingPoints.length === 0) {
        pendingPoints = [];
        return;
      }

      let pointsToSend = pendingPoints;
      if (lastSentPoint && pointsToSend.length >= 1) {
        pointsToSend = [lastSentPoint, ...pointsToSend];
      }

      if (pointsToSend.length < 2 && !forceSinglePoint) return;
      if (pointsToSend.length < 2) pointsToSend = [pointsToSend[0], pointsToSend[0]];

      lastSentPoint = pointsToSend[pointsToSend.length - 1];

      const tsMs = Math.floor(getNowMs());

      let binarySent = false;
      if (wsClient.isOpen()) {
        try {
          const buf = Momal.binary.packBinaryStroke(drawSeq, tsMs, strokeColor, strokeWidth, pointsToSend);
          wsClient.sendRaw(buf);
          drawSeq += 1;
          binarySent = true;
        } catch (_) {
          binarySent = false;
        }
      }

      if (!binarySent) {
        const packed = pointsToSend.map((pt) => ({
          x: Math.round(pt.x * 10000) / 10000,
          y: Math.round(pt.y * 10000) / 10000,
        }));

        wsClient.sendJson({
          type: 'draw:stroke',
          payload: {
            t: 'stroke',
            p: packed,
            c: strokeColor,
            w: strokeWidth,
          },
        });
      }

      pendingPoints = [];
    }

    function scheduleFrameFlush() {
      if (flushScheduled) return;
      flushScheduled = true;
      window.requestAnimationFrame(() => {
        flushScheduled = false;
        flushChunk(false);
        if (pendingPoints.length > 0) scheduleFrameFlush();
      });
    }

    function scheduleFlush() {
      if (sendTimer !== null) return;

      sendTimer = window.setTimeout(() => {
        sendTimer = null;
        flushChunk(false);
      }, sendIntervalMs);

      scheduleFrameFlush();
    }

    function beginStroke(startPoint, { color, width } = {}) {
      if (!canDraw()) return;

      reset();
      setStyle({ color, width });

      pendingPoints = [startPoint];
      flushChunk(true);
    }

    function pushPoint(prevPoint, curPoint) {
      if (!canDraw()) return;

      addPointWithResampling(prevPoint, curPoint, maxPointStep);

      if (pendingPoints.length >= maxPointsPerChunk) {
        flushChunk(false);
      } else {
        scheduleFlush();
      }
    }

    function endStroke() {
      if (!canDraw()) {
        reset();
        return;
      }

      flushChunk(true);
      reset();
    }

    return {
      beginStroke,
      pushPoint,
      endStroke,
      reset,
    };
  }

  Momal.createStrokeSender = createStrokeSender;
})();

