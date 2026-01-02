(() => {
  const $ = (id) => document.getElementById(id);

  const statusEl = $('status');
  const nameEl = $('name');
  const roomEl = $('roomId');
  const btnJoin = $('btnJoin');
  const btnStart = $('btnStart');
  const playersEl = $('players');
  const chatEl = $('chat');
  const chatInput = $('chatInput');
  const btnSend = $('btnSend');
  const roundNumberEl = $('roundNumber');
  const timeLeftEl = $('timeLeft');
  const secretWordEl = $('secretWord');
  const btnClear = $('btnClear');
  const colorEl = $('color');
  const widthEl = $('width');
  const hintEl = $('hint');
  const highscoreEl = $('highscore');
  const toastEl = $('toast');

  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  let canvasTransformReady = false;

  let ws = null;
  let joined = false;
  let isHost = false;
  let myConnectionId = null;
  let drawerConnectionId = null;
  let state = 'lobby';

  // Drawing state
  let isDrawing = false;
  let last = null;

  // Outgoing draw event batching
  // We send stroke chunks (polyline points) instead of many single segments.
  const SEND_INTERVAL_MS = 16; // align with ~60fps to reduce jitter
  const MAX_POINTS_PER_CHUNK = 120;

  // Maximum allowed distance between consecutive points (normalized units).
  // If the pointer jumps farther (fast movement / low event rate), we insert intermediate points.
  const MAX_POINT_STEP = 0.006; // ~0.6% of canvas size

  let strokeColor = '#000000';
  let strokeWidth = 4;
  let pendingPoints = []; // [{x,y}, ...]
  let sendTimer = null;

  // Incoming draw rendering queue (smooth remote rendering)
  const renderQueue = [];
  let renderScheduled = false;

  // draw v2 sequencing (optional)
  let expectedDrawSeq = null; // number|null
  const pendingBatches = new Map(); // seq -> [events]
  let gapTimer = null;

  function scheduleGapCheck() {
    if (gapTimer !== null) return;
    gapTimer = window.setTimeout(() => {
      gapTimer = null;
      // If we still have a gap after a short wait, just render what we have.
      // This avoids long stalls on packet loss.
      drainPendingBatches(true);
    }, 120);
  }

  function drainPendingBatches(force = false) {
    if (expectedDrawSeq === null) return;

    while (pendingBatches.has(expectedDrawSeq)) {
      const batch = pendingBatches.get(expectedDrawSeq);
      pendingBatches.delete(expectedDrawSeq);
      if (Array.isArray(batch)) {
        batch.forEach((ev) => enqueueRender(ev));
      }
      expectedDrawSeq += 1;
      force = false;
    }

    if (force && pendingBatches.size > 0) {
      // render lowest seq we have to avoid visible freezing
      const keys = Array.from(pendingBatches.keys()).sort((a, b) => a - b);
      const k = keys[0];
      const batch = pendingBatches.get(k);
      pendingBatches.delete(k);
      if (typeof k === 'number') expectedDrawSeq = k + 1;
      if (Array.isArray(batch)) batch.forEach((ev) => enqueueRender(ev));
      // try draining following seqs
      drainPendingBatches(false);
    }
  }

  function pumpRenderQueue() {
    const started = performance.now();

    // Adaptive budget: if we have backlog, spend a bit more per frame to catch up.
    const budgetMs = renderQueue.length > 100 ? 12 : (renderQueue.length > 20 ? 9 : 6);

    while (renderQueue.length > 0 && (performance.now() - started) < budgetMs) {
      const ev = renderQueue.shift();
      drawEvent(ev);
    }

    if (renderQueue.length > 0) {
      window.requestAnimationFrame(pumpRenderQueue);
    } else {
      renderScheduled = false;
    }
  }

  function enqueueRender(payload) {
    // ignore null/undefined payloads
    if (!payload) return;

    renderQueue.push(payload);

    if (renderScheduled) return;
    renderScheduled = true;
    window.requestAnimationFrame(pumpRenderQueue);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function addChatLine(name, text, ts) {
    const line = document.createElement('div');
    line.className = 'chatLine';

    const time = ts ? new Date(ts * 1000).toLocaleTimeString() : '';
    line.innerHTML = `<span class="chatName">${escapeHtml(name)}</span> <span class="small muted">${escapeHtml(time)}</span><div>${escapeHtml(text)}</div>`;
    chatEl.appendChild(line);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.hostname}:8080`;

    ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus('online');
    };

    ws.onclose = () => {
      setStatus('offline');
      joined = false;
      isHost = false;
      drawerConnectionId = null;
      state = 'lobby';
      btnStart.disabled = true;
      btnClear.disabled = true;
      secretWordEl.textContent = '—';
      hintEl.textContent = 'Verbindung getrennt. Seite neu laden.';
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'hello':
          myConnectionId = msg.connectionId;
          break;
        case 'error':
          showToast(msg.message || 'Fehler');
          addChatLine('System', msg.message || 'Fehler', Math.floor(Date.now()/1000));
          break;
        case 'joined':
          joined = true;
          isHost = !!msg.isHost;
          btnStart.disabled = !isHost;
          break;
        case 'chat:new':
          addChatLine(msg.name, msg.text, msg.ts);
          break;
        case 'room:snapshot':
          renderSnapshot(msg);
          break;
        case 'round:started':
          drawerConnectionId = msg.drawerConnectionId;
          secretWordEl.textContent = '—';
          clearCanvasLocal();
          hintEl.textContent = (drawerConnectionId === myConnectionId)
            ? 'Du bist Zeichner. Zeichne das Wort (oben erscheint es gleich).'
            : 'Rate im Chat!';
          break;
        case 'round:word':
          secretWordEl.textContent = msg.word;
          break;
        case 'draw:batch': {
          const seq = Number(msg.seq);
          const events = Array.isArray(msg.events) ? msg.events : [];

          if (!Number.isFinite(seq) || events.length === 0) {
            break;
          }

          if (expectedDrawSeq === null) {
            expectedDrawSeq = seq;
          }

          // If we're behind, buffer and try to drain in-order.
          pendingBatches.set(seq, events);

          if (seq !== expectedDrawSeq) {
            scheduleGapCheck();
          }

          drainPendingBatches(false);
          break;
        }
        case 'draw:event':
        case 'draw:stroke':
          // Legacy: queue for smooth render
          if (msg.payload) {
            enqueueRender(msg.payload);
          }
          break;
        case 'round:clear':
          clearCanvasLocal();
          // reset draw v2 state so next batch can restart cleanly
          expectedDrawSeq = null;
          pendingBatches.clear();
          break;
        case 'round:ended':
          addChatLine('System', `${msg.reason} Wort war: ${msg.word}`, Math.floor(Date.now()/1000));
          drawerConnectionId = null;
          secretWordEl.textContent = '—';
          btnClear.disabled = true;
          expectedDrawSeq = null;
          pendingBatches.clear();
          break;
      }
    };
  }

  function renderSnapshot(snap) {
    state = snap.state;
    drawerConnectionId = snap.round?.drawerConnectionId ?? drawerConnectionId;

    playersEl.innerHTML = '';
    (snap.players || []).sort((a,b) => b.score - a.score).forEach(p => {
      const li = document.createElement('li');
      const tags = [
        p.isHost ? 'Host' : null,
        p.isDrawer ? 'Zeichner' : null,
        p.connectionId === myConnectionId ? 'Du' : null
      ].filter(Boolean).join(', ');
      li.textContent = `${p.name} — ${p.score} ${tags ? '('+tags+')' : ''}`;
      playersEl.appendChild(li);

      if (p.connectionId === myConnectionId) {
        isHost = !!p.isHost;
      }
    });

    btnStart.disabled = !(joined && isHost && state === 'lobby');
    btnClear.disabled = !(joined && drawerConnectionId === myConnectionId && state === 'in_round');

    roundNumberEl.textContent = snap.round?.roundNumber ?? '-';
    timeLeftEl.textContent = snap.round?.timeLeft ?? '-';

    if (state === 'lobby') {
      hintEl.textContent = isHost ? 'Du bist Host. Starte eine Runde, sobald mindestens 2 Spieler da sind.' : 'Warte, bis der Host startet.';
    }
  }

  function send(type, payload = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, ...payload }));
  }

  function showToast(message, timeoutMs = 4000) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;

    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => {
      toastEl.hidden = true;
    }, timeoutMs);
  }

  function setupCanvasResolution() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    const displayW = Math.max(1, Math.round(rect.width));
    const displayH = Math.max(1, Math.round(rect.height));

    const targetW = Math.round(displayW * dpr);
    const targetH = Math.round(displayH * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    // Work in pixel-space. Incoming/outgoing points are normalized (0..1) and
    // are converted at draw time. This keeps line widths consistent across clients.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    canvasTransformReady = true;
  }

  function toPxX(x) {
    return (Number(x) || 0) * canvas.width;
  }

  function toPxY(y) {
    return (Number(y) || 0) * canvas.height;
  }

  function ensureCanvasReady() {
    if (!canvasTransformReady) {
      setupCanvasResolution();
    }
  }

  function clearCanvasLocal() {
    setupCanvasResolution();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function canDraw() {
    return joined && state === 'in_round' && drawerConnectionId === myConnectionId;
  }

  function drawEvent(ev) {
    if (!ev) return;

    ensureCanvasReady();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ev.c || '#000';
    ctx.lineWidth = Math.max(1, Number(ev.w) || 3);

    // stroke events (polyline)
    if (ev.t === 'stroke' && Array.isArray(ev.p) && ev.p.length >= 2) {
      // Interpolate between points to avoid visible gaps when points are sparse.
      // max step ~1.5% of canvas size
      const maxStep = 0.015;

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

    // legacy single line segment
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

  function canvasPos(e) {
    return normalizeCanvasPoint(e);
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

    // If we only have a single point (e.g. just started the stroke), send it as a tiny dot-stroke
    // so remote clients don't miss the beginning.
    if (pendingPoints.length < 2 && !forceSinglePoint) {
      return;
    }

    const pointsToSend = pendingPoints.length >= 2
      ? pendingPoints
      : [pendingPoints[0], pendingPoints[0]];

    send('draw:stroke', {
      payload: {
        t: 'stroke',
        p: pointsToSend,
        c: strokeColor,
        w: strokeWidth
      }
    });

    pendingPoints = [];
  }

  // Ensure we flush at most once per animation frame while drawing.
  let flushScheduled = false;
  function scheduleFrameFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    window.requestAnimationFrame(() => {
      flushScheduled = false;
      // Send any accumulated points for low latency and consistent pacing.
      flushStrokeChunk(false);

      // If we're still drawing and points keep coming in, schedule next frame flush.
      if (isDrawing && pendingPoints.length > 0) {
        scheduleFrameFlush();
      }
    });
  }

  function scheduleStrokeFlush() {
    if (sendTimer !== null) return;

    // Flush soon (timeout) and also by frame pacing.
    sendTimer = window.setTimeout(() => {
      sendTimer = null;
      flushStrokeChunk(false);
    }, SEND_INTERVAL_MS);

    scheduleFrameFlush();
  }

  function onPointerDown(e) {
    if (!canDraw()) return;
    isDrawing = true;

    strokeColor = colorEl.value;
    strokeWidth = Number(widthEl.value);

    const p = canvasPos(e);
    last = p;
    pendingPoints = [p];

    // Send the first point immediately so other clients see stroke start right away.
    flushStrokeChunk(true);

    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!isDrawing || !last || !canDraw()) return;

    // Chrome/Edge: coalesced events give us higher frequency samples.
    const events = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : null;

    if (Array.isArray(events) && events.length > 0) {
      for (const ce of events) {
        const cur = canvasPos(ce);

        // local draw segment for immediate feedback
        drawEvent({
          t: 'line',
          x0: last.x, y0: last.y,
          x1: cur.x, y1: cur.y,
          c: strokeColor,
          w: strokeWidth
        });

        addPointWithResampling(last, cur);
        last = cur;

        if (pendingPoints.length >= MAX_POINTS_PER_CHUNK) {
          flushStrokeChunk(false);
        }
      }

      scheduleStrokeFlush();
      e.preventDefault();
      return;
    }

    // Fallback: single event
    const cur = canvasPos(e);

    drawEvent({
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
    if (!canDraw()) return;
    isDrawing = false;
    last = null;

    // Send whatever remains.
    flushStrokeChunk(true);
    e.preventDefault();
  }

  function refreshHighscore() {
    fetch('/api/highscore.php?limit=20')
      .then(r => r.json())
      .then(data => {
        highscoreEl.innerHTML = '';
        (data.top || []).forEach(el => {
          const li = document.createElement('li');
          const d = new Date((el.updatedAt || 0) * 1000).toLocaleDateString();
          li.textContent = `${el.name} — ${el.points} (${d})`;
          highscoreEl.appendChild(li);
        });
      })
      .catch(() => {});
  }

  // UI
  btnJoin.onclick = () => {
    const name = nameEl.value.trim() || 'Spieler';
    const roomId = roomEl.value.trim().toUpperCase();
    send('join', { name, roomId });
    refreshHighscore();
  };

  btnStart.onclick = () => {
    send('round:start');
  };

  btnClear.onclick = () => {
    send('round:clear');
  };

  btnSend.onclick = () => {
    const text = chatInput.value.trim();
    if (!text) return;
    // treat as guess (server echoes into chat)
    send('guess', { text });
    chatInput.value = '';
  };

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSend.click();
  });

  // Prefer PointerEvents when available for higher frequency and consistent behavior.
  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  } else {
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    canvas.addEventListener('touchstart', onPointerDown, { passive: false });
    canvas.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp, { passive: false });
  }

  window.addEventListener('resize', () => {
    canvasTransformReady = false;
    setupCanvasResolution();
  });

  // periodic ui refresh for timer (snapshot also updates)
  setInterval(() => {
    refreshHighscore();
  }, 10000);

  // initial resolution setup
  setupCanvasResolution();

  connect();
})();
