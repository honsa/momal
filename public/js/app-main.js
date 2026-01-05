// Main app wiring (kept small)
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  if (!Momal.createWsClient) throw new Error('Momal WS client missing');
  if (!Momal.createGameState) throw new Error('Momal game state missing');
  if (!Momal.createDrawSync) throw new Error('Momal draw sync missing');
  if (!Momal.createStrokeSender) throw new Error('Momal stroke sender missing');

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

  const game = Momal.createGameState({ els, ui, draw });
  const drawSync = Momal.createDrawSync({ draw });
  const wsClient = Momal.createWsClient({
    onOpen: () => {
      ui.setStatus('online');
      ui.showToast('WS verbunden', 2500, 'success');
    },
    onClose: (e) => {
      ui.setStatus('offline');
      ui.showToast(`WS getrennt (${(e && e.code) || 0})`);
      game.state.joined = false;
      game.state.isHost = false;
      game.state.drawerConnectionId = null;
      game.state.phase = 'lobby';
      els.btnStart.disabled = true;
      els.btnClear.disabled = true;
      els.secretWordEl.textContent = '—';
      ui.setHint('Verbindung getrennt. Seite neu laden.');
      drawSync.reset();
    },
    onError: () => {
      ui.showToast('WS Fehler (siehe console)');
    },
    onBinary: (decoded) => {
      if (Number.isFinite(decoded.tsMs)) draw.updateTimeOffset(Number(decoded.tsMs));
      const stitched = draw.stitchIncomingStroke(decoded.payload);
      draw.enqueueRender(stitched, { tsMs: decoded.tsMs });
      draw.drawEvent(stitched);
    },
    onJsonMessage: (msg) => {
      game.applyWsMessage(msg, {
        onDrawBatch: (batchMsg) => {
          drawSync.onBatch({ seq: batchMsg.seq, events: batchMsg.events, tsMs: batchMsg.tsMs });
        }
      });

      if (msg && (msg.type === 'round:clear' || msg.type === 'round:ended')) {
        drawSync.reset();
      }
    }
  });

  const strokeSender = Momal.createStrokeSender({
    wsClient,
    canDraw: () => game.canDraw(),
    nowMs: () => performance.now(),
    maxPointStep: 0.002,
    sendIntervalMs: 16,
    maxPointsPerChunk: 160,
  });

  function canDraw() {
    return game.canDraw();
  }

  // Outgoing draw state
  let isDrawing = false;
  let last = null;
  let strokeColor = '#000000';
  let strokeWidth = 3;

  const MAX_POINT_STEP = 0.002;

  // draw v2 sequencing handled by draw-sync module

  // localNowAsServerMs now lives inside strokeSender

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
    wsClient.sendJson({ type, ...payload });
  }

  // renderSnapshot handled by game-state module

  function connect() {
    ws = wsClient.connect();
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

    strokeColor = els.colorEl.value;
    strokeWidth = Number(els.widthEl.value);

    const p = canvasPos(e);
    last = p;
    strokeSender.beginStroke(p, { color: strokeColor, width: strokeWidth });
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!isDrawing || !last || !canDraw()) {
      if (!canDraw()) {
        isDrawing = false;
        last = null;
        setDrawingCursor(false);
        strokeSender.reset();
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

        strokeSender.pushPoint(last, cur);
        last = cur;
      }

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

    if (Math.hypot(cur.x - last.x, cur.y - last.y) >= MAX_POINT_STEP) {
      strokeSender.pushPoint(last, cur);
    }

    last = cur;
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!canDraw()) {
      setDrawingCursor(false);
      strokeSender.reset();
      return;
    }

    isDrawing = false;
    last = null;
    setDrawingCursor(false);

    strokeSender.endStroke();

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
    if (!game.state.lastSnapshot) {
      renderHighscoreFromApi(normalizeRoomForJoin(els.roomEl.value));
    } else {
      ui.renderScoreboard(game.state.lastSnapshot.players || [], game.state.myConnectionId);
    }
  }, 10000);

  // Debug hook: show draw-sync health without affecting gameplay.
  if (typeof Momal.isDebugEnabled === 'function' && Momal.isDebugEnabled()) {
    setInterval(() => {
      try {
        // eslint-disable-next-line no-console
        console.log('[momal] drawSync', drawSync.getDebugInfo());
      } catch (_) {
        // ignore
      }
    }, 5000);
  }

  // initial setup
  draw.setupCanvasResolution();
  connect();
})();

