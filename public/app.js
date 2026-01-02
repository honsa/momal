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
  const SEND_INTERVAL_MS = 16; // ~60fps
  const MAX_POINTS_PER_CHUNK = 40;

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
    sendTimer = window.setTimeout(() => {
      sendTimer = null;
      flushStrokeChunk();
    }, SEND_INTERVAL_MS);
  }

  function enqueueRender(payload) {
    renderQueue.push(payload);
    if (renderScheduled) return;
    renderScheduled = true;

    window.requestAnimationFrame(() => {
      renderScheduled = false;

      // render a bounded amount per frame to keep UI responsive
      const maxPerFrame = 12;
      for (let i = 0; i < maxPerFrame && renderQueue.length > 0; i++) {
        const ev = renderQueue.shift();
        drawEvent(ev);
      }

      if (renderQueue.length > 0) {
        enqueueRender(null); // re-schedule
      }
    });
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
