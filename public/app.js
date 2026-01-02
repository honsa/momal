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
  const SEND_INTERVAL_MS = 12; // ~80fps (lower latency)
  const MAX_POINTS_PER_CHUNK = 60;

  let strokeColor = '#000000';
  let strokeWidth = 4;
  let pendingPoints = []; // [{x,y}, ...]
  let sendTimer = null;

  // Incoming draw rendering queue (smooth remote rendering)
  const renderQueue = [];
  let renderScheduled = false;

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
        case 'draw:event':
        case 'draw:stroke':
          // Queue for smooth render
          if (msg.payload) {
            enqueueRender(msg.payload);
          }
          break;
        case 'round:clear':
          clearCanvasLocal();
          break;
        case 'round:ended':
          addChatLine('System', `${msg.reason} Wort war: ${msg.word}`, Math.floor(Date.now()/1000));
          drawerConnectionId = null;
          secretWordEl.textContent = '—';
          btnClear.disabled = true;
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

    // normalized coordinate space (0..1)
    ctx.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);
  }

  function normalizeCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;

    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  function clearCanvasLocal() {
    setupCanvasResolution();
    ctx.clearRect(0, 0, 1, 1);
  }

  function canDraw() {
    return joined && state === 'in_round' && drawerConnectionId === myConnectionId;
  }

  function drawEvent(ev) {
    if (!ev) return;

    setupCanvasResolution();

    // stroke events (polyline)
    if (ev.t === 'stroke' && Array.isArray(ev.p) && ev.p.length >= 2) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ev.c || '#000';
      ctx.lineWidth = (Number(ev.w) || 3) / canvas.width;

      ctx.beginPath();
      ctx.moveTo(ev.p[0].x, ev.p[0].y);
      for (let i = 1; i < ev.p.length; i++) {
        const pt = ev.p[i];
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      return;
    }

    // legacy single line segment
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ev.c || '#000';
    ctx.lineWidth = (Number(ev.w) || 3) / canvas.width;

    if (ev.t === 'line') {
      ctx.beginPath();
      ctx.moveTo(ev.x0, ev.y0);
      ctx.lineTo(ev.x1, ev.y1);
      ctx.stroke();
    }
  }

  function canvasPos(e) {
    return normalizeCanvasPoint(e);
  }

  function flushStrokeChunk() {
    if (!canDraw()) return;
    if (!pendingPoints || pendingPoints.length < 2) {
      pendingPoints = [];
      return;
    }

    // send only normalized points, color, width
    send('draw:stroke', {
      payload: {
        t: 'stroke',
        p: pendingPoints,
        c: strokeColor,
        w: strokeWidth
      }
    });

    pendingPoints = [];
  }

  function scheduleStrokeFlush() {
    if (sendTimer !== null) return;

    // Use rAF for low latency when active, plus a small timeout as fallback.
    sendTimer = window.setTimeout(() => {
      sendTimer = null;
      flushStrokeChunk();
    }, SEND_INTERVAL_MS);

    window.requestAnimationFrame(() => {
      if (sendTimer === null) return;
      window.clearTimeout(sendTimer);
      sendTimer = null;
      flushStrokeChunk();
    });
  }

  function onPointerDown(e) {
    if (!canDraw()) return;
    isDrawing = true;

    strokeColor = colorEl.value;
    strokeWidth = Number(widthEl.value);

    const p = canvasPos(e);
    last = p;
    pendingPoints = [p];

    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!isDrawing || !last || !canDraw()) return;
    const cur = canvasPos(e);

    // local draw segment for immediate feedback
    drawEvent({
      t: 'line',
      x0: last.x, y0: last.y,
      x1: cur.x, y1: cur.y,
      c: strokeColor,
      w: strokeWidth
    });

    pendingPoints.push(cur);

    if (pendingPoints.length >= MAX_POINTS_PER_CHUNK) {
      flushStrokeChunk();
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

    flushStrokeChunk();
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

  canvas.addEventListener('mousedown', onPointerDown);
  canvas.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);

  canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  canvas.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp, { passive: false });

  window.addEventListener('resize', () => {
    // Keep canvas crisp and consistent on resize.
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
