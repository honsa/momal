// Main app wiring (kept small)
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  const $ = Momal.$;

  const els = {
    statusEl: $('status'),
    nameEl: $('name'),
    roomEl: $('roomId'),
    btnJoin: $('btnJoin'),
    btnStart: $('btnStart'),
    playersEl: $('players'),
    chatEl: $('chat'),
    chatInput: $('chatInput'),
    btnSend: $('btnSend'),
    roundNumberEl: $('roundNumber'),
    timeLeftEl: $('timeLeft'),
    secretWordEl: $('secretWord'),
    btnClear: $('btnClear'),
    colorEl: $('color'),
    widthEl: $('width'),
    hintEl: $('hint'),
    highscoreEl: $('highscore'),
    highscoreTopEl: $('highscoreTop'),
    toastEl: $('toast'),
    joinForm: $('joinForm'),
    canvas: $('canvas'),
  };

  const ctx = els.canvas.getContext('2d');
  const draw = Momal.createDraw(els.canvas, ctx);
  const ui = Momal.createUi(els);

  // State
  let ws = null;
  let joined = false;
  let isHost = false;
  let myConnectionId = null;
  let drawerConnectionId = null;
  let state = 'lobby';
  let lastSnapshot = null;

  // Per-round UI accent color (server decides)
  let lastRoundAccent = null;
  function setAccentColor(color) {
    if (!color || typeof color !== 'string') return;
    document.body.style.setProperty('--accent', color);
    lastRoundAccent = color;
  }

  function canDraw() {
    return joined && state === 'in_round' && drawerConnectionId === myConnectionId;
  }

  function maybeSetDrawerDefaultColor() {
    if (!canDraw()) return;
    const cur = (els.colorEl && typeof els.colorEl.value === 'string') ? els.colorEl.value : '';
    const norm = String(cur || '').toLowerCase();
    if (norm === '' || norm === '#000000' || norm === '#000') {
      if (lastRoundAccent) {
        els.colorEl.value = lastRoundAccent;
      }
    }
  }

  // Outgoing draw state
  let isDrawing = false;
  let last = null;
  let pendingPoints = [];
  let strokeColor = '#000000';
  let strokeWidth = 3;
  let lastSentPoint = null;

  const SEND_INTERVAL_MS = 16;
  const MAX_POINTS_PER_CHUNK = 160;
  const MAX_POINT_STEP = 0.002;

  let sendTimer = null;
  let flushScheduled = false;
  let drawSeq = 1;

  // draw v2 sequencing (optional)
  let expectedDrawSeq = null; // number|null
  const pendingBatches = new Map(); // seq -> {events:[], tsMs:number|null}
  let gapTimer = null;

  const DRAW_REORDER_WINDOW = 6;

  function localNowAsServerMs() {
    // draw.updateTimeOffset uses the same smoothing, so we re-map through it by calling updateTimeOffset when we get server timestamps.
    // Here we just use performance.now() as the local baseline.
    return performance.now();
  }

  function normalizeNameForJoin(raw) {
    let name = String(raw || '');
    name = name.trim().replace(/\s+/g, ' ');
    name = name.slice(0, 20);
    return name;
  }

  function normalizeRoomForJoin(raw) {
    let roomId = String(raw || '');
    roomId = roomId.toUpperCase().replace(/[^A-Z0-9]/g, '');
    roomId = roomId.slice(0, 6);
    return roomId;
  }

  function send(type, payload = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, ...payload }));
  }

  function renderSnapshot(snap) {
    lastSnapshot = snap;

    state = snap.state;
    drawerConnectionId = snap.round?.drawerConnectionId ?? drawerConnectionId;

    ui.renderPlayersList(snap.players || [], myConnectionId);

    // set isHost based on my player
    for (const p of (snap.players || [])) {
      if (p.connectionId === myConnectionId) {
        isHost = !!p.isHost;
      }
    }

    els.btnStart.disabled = !(joined && isHost && state === 'lobby');
    els.btnClear.disabled = !(joined && drawerConnectionId === myConnectionId && state === 'in_round');

    els.roundNumberEl.textContent = snap.round?.roundNumber ?? '-';
    els.timeLeftEl.textContent = snap.round?.timeLeft ?? '-';

    if (state === 'lobby') {
      ui.setHint(isHost
        ? 'Du bist Host. Starte eine Runde, sobald mindestens 2 Spieler da sind.'
        : 'Warte, bis der Host startet.');
    }

    ui.renderScoreboard(snap.players || [], myConnectionId);
  }

  function scheduleGapCheck() {
    if (gapTimer !== null) return;
    gapTimer = window.setTimeout(() => {
      gapTimer = null;
      drainPendingBatches(true);
    }, 90);
  }

  function drainPendingBatchesWithinWindow() {
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

  function drainPendingBatches(force = false) {
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
      const keys = Array.from(pendingBatches.keys()).filter((k) => Number.isFinite(k)).sort((a, b) => a - b);
      const k = keys[0];
      if (!Number.isFinite(k)) return;

      const batchObj = pendingBatches.get(k);
      pendingBatches.delete(k);
      expectedDrawSeq = k + 1;

      const events = batchObj && Array.isArray(batchObj.events) ? batchObj.events : [];
      const tsMs = batchObj && Number.isFinite(batchObj.tsMs) ? Number(batchObj.tsMs) : null;
      draw.enqueueRenderBatch(events, tsMs);

      drainPendingBatches(false);
    }
  }

  function connect() {
    const isHttps = location.protocol === 'https:';
    const proto = isHttps ? 'wss:' : 'ws:';

    let host = location.hostname;
    if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') {
      host = '127.0.0.1';
    }

    const isLocalHost = host === '127.0.0.1' || host === 'localhost';
    const useDirectPort = (!isHttps) && isLocalHost;

    const url = useDirectPort
      ? `${proto}//${host}:8080`
      : `${proto}//${host}/ws`;

    if (Momal.isDebugEnabled()) {
      console.log('[momal] connecting', url);
    }

    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      ui.setStatus('online');
      ui.showToast('WS verbunden', 2500, 'success');
    };

    ws.onclose = (e) => {
      ui.setStatus('offline');
      ui.showToast(`WS getrennt (${e.code || 0})`);
      joined = false;
      isHost = false;
      drawerConnectionId = null;
      state = 'lobby';
      els.btnStart.disabled = true;
      els.btnClear.disabled = true;
      els.secretWordEl.textContent = '—';
      ui.setHint('Verbindung getrennt. Seite neu laden.');
    };

    ws.onerror = () => {
      ui.showToast('WS Fehler (siehe console)');
    };

    ws.onmessage = (ev) => {
      const decoded = Momal.binary.tryDecodeBinaryFrame(ev.data);
      if (decoded) {
        if (Number.isFinite(decoded.tsMs)) draw.updateTimeOffset(Number(decoded.tsMs));

        const stitched = draw.stitchIncomingStroke(decoded.payload);
        draw.enqueueRender(stitched, { tsMs: decoded.tsMs });
        draw.drawEvent(stitched);
        return;
      }

      try {
        const msg = JSON.parse(ev.data);
        if (!msg || !msg.type) return;

        switch (msg.type) {
          case 'hello':
            myConnectionId = msg.connectionId;
            break;
          case 'error':
            ui.showToast(msg.message || 'Fehler');
            ui.addChatLine('System', msg.message || 'Fehler', Math.floor(Date.now() / 1000));
            if ((msg.message || '').toLowerCase().includes('name')) {
              try { els.nameEl.focus(); } catch (_) { /* ignore */ }
            }
            break;
          case 'joined':
            joined = true;
            isHost = !!msg.isHost;
            els.btnStart.disabled = !isHost;
            break;
          case 'chat:new':
            ui.addChatLine(msg.name, msg.text, msg.ts);
            break;
          case 'room:snapshot':
            renderSnapshot(msg);
            break;
          case 'round:started':
            drawerConnectionId = msg.drawerConnectionId;
            els.secretWordEl.textContent = '—';
            draw.clearCanvasLocal();

            if (msg.accentColor) setAccentColor(msg.accentColor);

            window.requestAnimationFrame(() => {
              draw.setupCanvasResolution();
            });

            ui.setHint((drawerConnectionId === myConnectionId)
              ? 'Du bist Zeichner. Zeichne das Wort (oben erscheint es gleich).'
              : 'Rate im Chat!');

            if (drawerConnectionId === myConnectionId) maybeSetDrawerDefaultColor();
            break;
          case 'round:word':
            els.secretWordEl.textContent = msg.word;
            break;
          case 'draw:batch': {
            const seq = Number(msg.seq);
            const events = Array.isArray(msg.events) ? msg.events : [];
            if (!Number.isFinite(seq) || events.length === 0) break;

            if (Number.isFinite(msg.tsMs)) draw.updateTimeOffset(Number(msg.tsMs));

            if (expectedDrawSeq === null) expectedDrawSeq = seq;

            pendingBatches.set(seq, { events, tsMs: Number.isFinite(msg.tsMs) ? Number(msg.tsMs) : null });

            if (seq !== expectedDrawSeq) {
              scheduleGapCheck();
              drainPendingBatchesWithinWindow();
            }

            drainPendingBatches(false);
            break;
          }
          case 'draw:event':
          case 'draw:stroke':
            if (msg.payload) {
              draw.enqueueRender(draw.stitchIncomingStroke(msg.payload));
            }
            break;
          case 'round:clear':
            draw.clearCanvasLocal();
            expectedDrawSeq = null;
            pendingBatches.clear();
            draw.resetIncomingStrokeAnchors();
            break;
          case 'round:ended':
            ui.addChatLine('System', `${msg.reason} Wort war: ${msg.word}`, Math.floor(Date.now() / 1000));
            drawerConnectionId = null;
            els.secretWordEl.textContent = '—';
            els.btnClear.disabled = true;
            expectedDrawSeq = null;
            pendingBatches.clear();
            draw.resetIncomingStrokeAnchors();
            break;
          default:
            break;
        }
      } catch (_) {
        // ignore non-JSON frames
      }
    };
  }

  function renderHighscoreFromApi(roomId) {
    if (!roomId) {
      els.highscoreEl.innerHTML = '';
      if (els.highscoreTopEl) els.highscoreTopEl.textContent = '—';
      return;
    }

    fetch(`/api/highscore.php?limit=20&roomId=${encodeURIComponent(roomId)}`)
      .then((r) => r.json())
      .then((data) => {
        els.highscoreEl.innerHTML = '';

        const top = Array.isArray(data.top) ? data.top : [];

        if (els.highscoreTopEl) {
          if (top.length > 0) {
            const first = top[0];
            const time = first.updatedAt ? new Date(first.updatedAt * 1000).toLocaleString() : '';
            els.highscoreTopEl.textContent = `${first.name} — ${first.points}${time ? ' · ' + time : ''}`;
          } else {
            els.highscoreTopEl.textContent = '—';
          }
        }

        top.forEach((el) => {
          const li = document.createElement('li');
          const d = new Date((el.updatedAt || 0) * 1000).toLocaleString();
          li.textContent = `${el.name} — ${el.points} (${d})`;
          els.highscoreEl.appendChild(li);
        });
      })
      .catch(() => {
        if (els.highscoreTopEl) els.highscoreTopEl.textContent = '—';
      });
  }

  function canvasPos(e) {
    return draw.normalizeCanvasPoint(e);
  }

  function addPointWithResampling(prev, cur) {
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= MAX_POINT_STEP) {
      pendingPoints.push(cur);
      return;
    }

    const steps = Math.ceil(dist / MAX_POINT_STEP);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      pendingPoints.push({
        x: prev.x + dx * t,
        y: prev.y + dy * t,
      });
    }
  }

  function flushStrokeChunk(forceSinglePoint = false) {
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

    if (pointsToSend.length < 2) {
      pointsToSend = [pointsToSend[0], pointsToSend[0]];
    }

    lastSentPoint = pointsToSend[pointsToSend.length - 1];

    const tsMs = Math.floor(localNowAsServerMs());

    let binarySent = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const buf = Momal.binary.packBinaryStroke(drawSeq, tsMs, strokeColor, strokeWidth, pointsToSend);
        ws.send(buf);
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

      send('draw:stroke', {
        payload: {
          t: 'stroke',
          p: packed,
          c: strokeColor,
          w: strokeWidth
        }
      });
    }

    pendingPoints = [];
  }

  function scheduleFrameFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    window.requestAnimationFrame(() => {
      flushScheduled = false;
      flushStrokeChunk(false);
      if (isDrawing && pendingPoints.length > 0) scheduleFrameFlush();
    });
  }

  function scheduleStrokeFlush() {
    if (sendTimer !== null) return;

    sendTimer = window.setTimeout(() => {
      sendTimer = null;
      flushStrokeChunk(false);
    }, SEND_INTERVAL_MS);

    scheduleFrameFlush();
  }

  function setDrawingCursor(active) {
    if (active) {
      document.body.classList.add('is-drawing');
    } else {
      document.body.classList.remove('is-drawing');
      els.canvas.style.cursor = '';
    }
  }

  function onPointerDown(e) {
    if (!canDraw()) return;

    isDrawing = true;
    setDrawingCursor(true);

    lastSentPoint = null;

    strokeColor = els.colorEl.value;
    strokeWidth = Number(els.widthEl.value);

    const p = canvasPos(e);
    last = p;
    pendingPoints = [p];

    flushStrokeChunk(true);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!isDrawing || !last || !canDraw()) {
      if (!canDraw()) {
        isDrawing = false;
        last = null;
        setDrawingCursor(false);
      }
      return;
    }

    const events = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : null;

    if (Array.isArray(events) && events.length > 0) {
      for (const ce of events) {
        const cur = canvasPos(ce);

        draw.drawEvent({
          t: 'line',
          x0: last.x, y0: last.y,
          x1: cur.x, y1: cur.y,
          c: strokeColor,
          w: strokeWidth
        });

        addPointWithResampling(last, cur);
        last = cur;

        if (pendingPoints.length >= MAX_POINTS_PER_CHUNK) flushStrokeChunk(false);
      }

      scheduleStrokeFlush();
      e.preventDefault();
      return;
    }

    const cur = canvasPos(e);

    draw.drawEvent({
      t: 'line',
      x0: last.x, y0: last.y,
      x1: cur.x, y1: cur.y,
      c: strokeColor,
      w: strokeWidth
    });

    addPointWithResampling(last, cur);

    if (pendingPoints.length >= MAX_POINTS_PER_CHUNK) {
      flushStrokeChunk(false);
    } else {
      scheduleStrokeFlush();
    }

    last = cur;
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!canDraw()) {
      setDrawingCursor(false);
      return;
    }

    isDrawing = false;
    last = null;
    setDrawingCursor(false);

    flushStrokeChunk(true);
    lastSentPoint = null;

    e.preventDefault();
  }

  function submitJoin() {
    const name = normalizeNameForJoin(els.nameEl.value);
    const roomId = normalizeRoomForJoin(els.roomEl.value);

    els.nameEl.value = name;
    els.roomEl.value = roomId;

    if (els.joinForm && typeof els.joinForm.reportValidity === 'function') {
      const ok = els.joinForm.reportValidity();
      if (!ok) return;
    }

    if (!name) {
      ui.showToast('Bitte gib einen Namen ein.');
      els.nameEl.focus();
      return;
    }

    if (!roomId) {
      ui.showToast('Bitte gib einen Room-Code ein.');
      els.roomEl.focus();
      return;
    }

    send('join', { name, roomId });
    renderHighscoreFromApi(roomId);
  }

  // UI wiring
  if (els.joinForm) {
    els.joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitJoin();
    });
  }

  els.btnJoin.onclick = (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    submitJoin();
  };

  els.btnStart.onclick = () => send('round:start');
  els.btnClear.onclick = () => send('round:clear');

  els.btnSend.onclick = () => {
    const text = els.chatInput.value.trim();
    if (!text) return;
    send('guess', { text });
    els.chatInput.value = '';
  };

  els.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.btnSend.click();
  });

  if (window.PointerEvent) {
    els.canvas.addEventListener('pointerdown', onPointerDown);
    els.canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', () => {
      isDrawing = false;
      last = null;
      setDrawingCursor(false);
      onPointerUp(new Event('pointercancel'));
    });
  } else {
    els.canvas.addEventListener('mousedown', onPointerDown);
    els.canvas.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    els.canvas.addEventListener('touchstart', onPointerDown, { passive: false });
    els.canvas.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp, { passive: false });
  }

  window.addEventListener('resize', () => {
    draw.setupCanvasResolution();
  });

  // periodic ui refresh for highscore (API fallback)
  setInterval(() => {
    if (!lastSnapshot) {
      renderHighscoreFromApi(normalizeRoomForJoin(els.roomEl.value));
    } else {
      ui.renderScoreboard(lastSnapshot.players || [], myConnectionId);
    }
  }, 10000);

  // initial setup
  draw.setupCanvasResolution();
  connect();
})();

