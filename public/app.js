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
  const highscoreTopEl = $('highscoreTop');
  const toastEl = $('toast');
  const joinForm = $('joinForm');

  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  let canvasTransformReady = false;

  let ws = null;
  let joined = false;
  let isHost = false;
  let myConnectionId = null;
  let drawerConnectionId = null;
  let state = 'lobby';

  // Per-round UI accent color (server decides)
  let lastRoundAccent = null;

  function setAccentColor(color) {
    if (!color || typeof color !== 'string') return;
    document.body.style.setProperty('--accent', color);
    lastRoundAccent = color;
  }

  function maybeSetDrawerDefaultColor() {
    if (!canDraw()) return;
    const cur = (colorEl && typeof colorEl.value === 'string') ? colorEl.value : '';
    const norm = String(cur || '').toLowerCase();
    if (norm === '' || norm === '#000000' || norm === '#000') {
      if (lastRoundAccent) {
        colorEl.value = lastRoundAccent;
      }
    }
  }

  // Drawing state + sending (must be declared before use)
  let isDrawing = false;
  let last = null;
  let pendingPoints = [];
  let strokeColor = '#000000';
  let strokeWidth = 3;

  // NEW: stroke stitching so remote clients can draw continuously across chunks
  let strokeId = 0;
  let lastSentPoint = null;

  // Outgoing draw pacing
  const SEND_INTERVAL_MS = 16;
  const MAX_POINTS_PER_CHUNK = 160;
  // Smaller step => denser sampling => fewer gaps on fast strokes
  const MAX_POINT_STEP = 0.002;
  let sendTimer = null;

  // Incoming draw rendering queue (smooth remote rendering)
  // We use a tiny jitter buffer so rendering is stable even if network delivery is bursty.
  const renderQueue = []; // items: {ev: object, dueMs: number}
  let renderScheduled = false;

  // Perfect smoothness mode: render a constant small delay behind the server clock.
  // This removes micro-stutters at the cost of a tiny fixed latency.
  // We keep this dynamic: when bursts happen, buffer increases slightly; when stable, it shrinks.
  const JITTER_BUFFER_MIN_MS = 20;
  const JITTER_BUFFER_MAX_MS = 80;
  let jitterBufferMs = 35;

  const MAX_QUEUE_DELAY_MS = 220; // if we're too far behind, catch up
  let lastDueMs = 0;
  let timeOffsetMs = null; // serverTsMs - performance.now()

  // Optionally spread events within a batch (0 = draw as one continuous stroke sequence)
  const SPREAD_WITHIN_BATCH_MS = 0;

  // If we tolerate minor out-of-order delivery, we can keep drawing instead of stalling.
  // With a good jitter buffer, this stays visually smooth.
  const DRAW_REORDER_WINDOW = 6;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function clampInt(n, a, b) {
    n = Number.isFinite(n) ? Math.round(n) : a;
    return Math.max(a, Math.min(b, n));
  }

  function escapeAttr(s) {
    return String(s).replace(/[^a-zA-Z0-9#(),.%\s-]/g, '');
  }

  // Incoming stroke stitching (receiver-side).
  // When the drawer sends strokes in chunks (for perf), we need to join them into a continuous line.
  // We keep the last point of the previous stroke-chunk (per style) and re-attach it to the next.
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
    // epsilon in normalized space (0..1)
    return (dx * dx + dy * dy) <= 0.0000005;
  }

  function stitchIncomingStroke(ev) {
    if (!ev || ev.t !== 'stroke' || !Array.isArray(ev.p) || ev.p.length < 2) {
      return ev;
    }

    const key = strokeKey(ev);
    const anchor = incomingStrokeAnchor.get(key) || null;
    const pts = ev.p;

    // Most common case: chunks are sent with the previous last point prepended.
    // => drop the duplicate and ensure continuity.
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

  function isDebugEnabled() {
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get('debug') === '1') return true;
      return (localStorage.getItem('momalDebug') === '1');
    } catch (_) {
      return false;
    }
  }

  function updateTimeOffset(serverTsMs) {
    if (!Number.isFinite(serverTsMs)) return;
    const localNow = performance.now();
    const candidate = serverTsMs - localNow;
    if (timeOffsetMs === null) {
      timeOffsetMs = candidate;
      return;
    }
    // Smooth the offset to avoid jumps if clocks drift.
    timeOffsetMs = (timeOffsetMs * 0.9) + (candidate * 0.1);
  }

  function localNowAsServerMs() {
    if (timeOffsetMs === null) return performance.now();
    return performance.now() + timeOffsetMs;
  }

  function tuneJitterBufferOnBatch(batchSize) {
    // Simple heuristic: if batches are large (network burst / backlog), increase buffer a bit;
    // if small, slowly decrease.
    if (!Number.isFinite(batchSize)) return;
    if (batchSize >= 8) {
      jitterBufferMs = clamp(jitterBufferMs + 6, JITTER_BUFFER_MIN_MS, JITTER_BUFFER_MAX_MS);
    } else if (batchSize <= 2) {
      jitterBufferMs = clamp(jitterBufferMs - 1, JITTER_BUFFER_MIN_MS, JITTER_BUFFER_MAX_MS);
    }
  }

  function pumpRenderQueue() {
    const started = performance.now();

    // Budget small per frame; pacing handles bursts.
    const budgetMs = renderQueue.length > 400 ? 12 : (renderQueue.length > 120 ? 9 : 6);

    const nowServerMs = localNowAsServerMs();

    while (renderQueue.length > 0 && (performance.now() - started) < budgetMs) {
      const item = renderQueue[0];
      if (!item) {
        renderQueue.shift();
        continue;
      }
      if (item.dueMs > nowServerMs) {
        break; // not yet due
      }
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
    // ignore null/undefined payloads
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

  // Helper: enqueue an array of events but keep them within the same batch timeline.
  function enqueueRenderBatch(events, tsMs) {
    if (!Array.isArray(events) || events.length === 0) return;

    // Ensure each stroke in a batch is stitched before enqueueing.
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
        const ev = stitchedEvents[i];
        renderQueue.push({ ev, dueMs: baseDue + (i * (SPREAD_WITHIN_BATCH_MS / stitchedEvents.length)) });
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

  // Binary draw protocol (max performance)
  const BIN_MAGIC = 'MOML';
  const BIN_VERSION = 1;
  const BIN_TYPE_STROKE = 1;

  function hexToRgb(hex) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return { r: 0, g: 0, b: 0 };
    const v = parseInt(m[1], 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }

  function rgbToHex(r, g, b) {
    const to2 = (n) => n.toString(16).padStart(2, '0');
    return `#${to2(r & 255)}${to2(g & 255)}${to2(b & 255)}`;
  }

  function packBinaryStroke(seq, tsMs, colorHex, widthPx, points) {
    const { r, g, b } = hexToRgb(colorHex);
    const count = points.length;

    // header size = 22 bytes
    const buf = new ArrayBuffer(22 + count * 8);
    const dv = new DataView(buf);

    // magic
    dv.setUint8(0, BIN_MAGIC.charCodeAt(0));
    dv.setUint8(1, BIN_MAGIC.charCodeAt(1));
    dv.setUint8(2, BIN_MAGIC.charCodeAt(2));
    dv.setUint8(3, BIN_MAGIC.charCodeAt(3));

    dv.setUint8(4, BIN_VERSION);
    dv.setUint8(5, BIN_TYPE_STROKE);

    dv.setUint32(6, seq >>> 0, true);
    dv.setUint32(10, tsMs >>> 0, true);

    dv.setUint8(14, r);
    dv.setUint8(15, g);
    dv.setUint8(16, b);
    dv.setUint8(17, 0);

    const w10 = Math.max(1, Math.min(500, Math.round((Number(widthPx) || 3) * 10)));
    dv.setUint16(18, w10, true);
    dv.setUint16(20, count, true);

    let off = 22;
    for (let i = 0; i < count; i++) {
      const p = points[i];
      dv.setFloat32(off, p.x, true);
      dv.setFloat32(off + 4, p.y, true);
      off += 8;
    }

    return buf;
  }

  function tryDecodeBinaryFrame(data) {
    if (!(data instanceof ArrayBuffer)) return null;
    if (data.byteLength < 22) return null;

    const dv = new DataView(data);
    const magic = String.fromCharCode(
      dv.getUint8(0),
      dv.getUint8(1),
      dv.getUint8(2),
      dv.getUint8(3)
    );
    if (magic !== BIN_MAGIC) return null;

    const version = dv.getUint8(4);
    if (version !== BIN_VERSION) return null;

    const type = dv.getUint8(5);
    if (type !== BIN_TYPE_STROKE) return null;

    const seq = dv.getUint32(6, true);
    const tsMs = dv.getUint32(10, true);

    const r = dv.getUint8(14);
    const g = dv.getUint8(15);
    const b = dv.getUint8(16);

    const width = dv.getUint16(18, true) / 10;
    const count = dv.getUint16(20, true);

    const expectedLen = 22 + count * 8;
    if (count < 2 || expectedLen > data.byteLength) return null;

    const pts = new Array(count);
    let off = 22;
    for (let i = 0; i < count; i++) {
      const x = dv.getFloat32(off, true);
      const y = dv.getFloat32(off + 4, true);
      off += 8;
      pts[i] = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    }

    return {
      seq,
      tsMs,
      payload: {
        t: 'stroke',
        p: pts,
        c: rgbToHex(r, g, b),
        w: width
      }
    };
  }

  function connect() {
    const isHttps = location.protocol === 'https:';
    const proto = isHttps ? 'wss:' : 'ws:';

    let host = location.hostname;
    if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') {
      host = '127.0.0.1';
    }

    const isLocalHost = host === '127.0.0.1' || host === 'localhost';

    // IMPORTANT:
    // - When the site is served via HTTPS, we must NOT connect to :8080 (would require TLS on 8080).
    //   Instead, use Apache reverse proxy on the same origin: wss://<host>/ws
    // - Only for local development over HTTP, connect directly to ws://<host>:8080
    const useDirectPort = (!isHttps) && isLocalHost;

    const url = useDirectPort
      ? `${proto}//${host}:8080`
      : `${proto}//${host}/ws`;

    if (isDebugEnabled()) {
      console.log('[momal] connecting', url);
    }

    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setStatus('online');
      showToast('WS verbunden', 2500, 'success');
    };

    ws.onclose = (e) => {
      setStatus('offline');
      showToast(`WS getrennt (${e.code || 0})`);
      joined = false;
      isHost = false;
      drawerConnectionId = null;
      state = 'lobby';
      btnStart.disabled = true;
      btnClear.disabled = true;
      secretWordEl.textContent = '—';
      hintEl.textContent = 'Verbindung getrennt. Seite neu laden.';
    };

    ws.onerror = () => {
      showToast('WS Fehler (siehe console)');
    };

    ws.onmessage = (ev) => {
      const decoded = tryDecodeBinaryFrame(ev.data);
      if (decoded) {
        if (Number.isFinite(decoded.tsMs)) updateTimeOffset(Number(decoded.tsMs));

        const stitched = stitchIncomingStroke(decoded.payload);

        // Primary path: smooth render queue
        enqueueRender(stitched, { tsMs: decoded.tsMs });

        // Safety net: draw immediately as well so remote canvases never stay blank.
        drawEvent(stitched);

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
            showToast(msg.message || 'Fehler');
            addChatLine('System', msg.message || 'Fehler', Math.floor(Date.now()/1000));

            if ((msg.message || '').toLowerCase().includes('name')) {
              try {
                nameEl.focus();
              } catch (_) {
                // ignore
              }
            }
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

            if (msg.accentColor) {
              setAccentColor(msg.accentColor);
            }

            // Ensure canvas is ready on receivers too (layout can lag on newly opened tabs)
            window.requestAnimationFrame(() => {
              canvasTransformReady = false;
              setupCanvasResolution();
            });

            hintEl.textContent = (drawerConnectionId === myConnectionId)
              ? 'Du bist Zeichner. Zeichne das Wort (oben erscheint es gleich).'
              : 'Rate im Chat!';

            // If I'm the drawer this round, optionally preselect the accent color.
            if (drawerConnectionId === myConnectionId) {
              maybeSetDrawerDefaultColor();
            }
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

            if (Number.isFinite(msg.tsMs)) {
              updateTimeOffset(Number(msg.tsMs));
            }

            if (expectedDrawSeq === null) {
              expectedDrawSeq = seq;
            }

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
              enqueueRender(stitchIncomingStroke(msg.payload));
            }
            break;
          case 'round:clear':
            clearCanvasLocal();
            expectedDrawSeq = null;
            pendingBatches.clear();
            resetIncomingStrokeAnchors();
            break;
          case 'round:ended':
            addChatLine('System', `${msg.reason} Wort war: ${msg.word}` , Math.floor(Date.now()/1000));
            drawerConnectionId = null;
            secretWordEl.textContent = '—';
            btnClear.disabled = true;
            expectedDrawSeq = null;
            pendingBatches.clear();
            resetIncomingStrokeAnchors();
            break;
          default:
            break;
        }
      } catch (_) {
        // ignore non-JSON frames
      }
    };
  }

  let lastSnapshot = null;

  function renderCurrentScores(snap) {
    if (!highscoreEl) return;

    const players = Array.isArray(snap?.players) ? snap.players.slice() : [];
    players.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

    highscoreEl.innerHTML = '';

    if (players.length === 0) {
      if (highscoreTopEl) highscoreTopEl.textContent = '—';
      return;
    }

    const leaderScore = Number(players[0].score) || 0;

    // Top line
    if (highscoreTopEl) {
      const leader = players[0];
      const crown = leaderScore > 0 ? '👑 ' : '';
      highscoreTopEl.textContent = `${crown}${leader.name} — ${leaderScore}`;
    }

    for (const p of players) {
      const score = Number(p.score) || 0;
      const isLeader = (score === leaderScore) && players.length > 0;
      const crown = (isLeader && leaderScore > 0) ? '👑' : '';

      const tags = [
        p.connectionId === myConnectionId ? 'Du' : null,
        p.isHost ? 'Host' : null,
        p.isDrawer ? 'Zeichner' : null,
      ].filter(Boolean);

      const li = document.createElement('li');
      if (isLeader && leaderScore > 0) li.classList.add('is-leader');

      const crownEl = document.createElement('span');
      crownEl.className = 'crown';
      crownEl.textContent = crown;
      crownEl.setAttribute('aria-hidden', crown ? 'false' : 'true');

      const nameEl2 = document.createElement('span');
      nameEl2.className = 'name';
      nameEl2.textContent = String(p.name ?? '');

      const pointsEl = document.createElement('span');
      pointsEl.className = 'points';
      pointsEl.textContent = String(score);

      li.appendChild(crownEl);
      li.appendChild(nameEl2);

      if (tags.length) {
        const metaEl = document.createElement('span');
        metaEl.className = 'meta';
        metaEl.textContent = `(${tags.join(', ')})`;
        li.appendChild(metaEl);
      }

      li.appendChild(pointsEl);
      highscoreEl.appendChild(li);
    }
  }

  function renderSnapshot(snap) {
    lastSnapshot = snap;

    state = snap.state;
    drawerConnectionId = snap.round?.drawerConnectionId ?? drawerConnectionId;

    playersEl.innerHTML = '';
    (snap.players || []).sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).forEach(p => {
      const li = document.createElement('li');
      li.className = 'playerRow';

      const left = document.createElement('div');
      left.className = 'playerLeft';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'playerName';
      nameSpan.textContent = String(p.name ?? '');

      const badges = document.createElement('span');
      badges.className = 'badges';

      const addBadge = (text, kind) => {
        const bEl = document.createElement('span');
        bEl.className = `badge badge--${kind}`;
        bEl.textContent = text;
        badges.appendChild(bEl);
      };

      if (p.connectionId === myConnectionId) addBadge('Du', 'me');
      if (p.isHost) addBadge('Host', 'host');
      if (p.isDrawer) addBadge('Zeichner', 'drawer');

      left.appendChild(nameSpan);
      if (badges.childNodes.length > 0) {
        left.appendChild(badges);
      }

      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'playerScore';
      scoreSpan.textContent = String(Number(p.score) || 0);

      li.appendChild(left);
      li.appendChild(scoreSpan);

      // Helpful for screen readers
      const roleParts = [];
      if (p.connectionId === myConnectionId) roleParts.push('du');
      if (p.isHost) roleParts.push('Host');
      if (p.isDrawer) roleParts.push('Zeichner');
      li.setAttribute('aria-label', `${p.name}, ${scoreSpan.textContent} Punkte${roleParts.length ? ', ' + roleParts.join(', ') : ''}`);

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

    // NEW: show current round scores in the highscore box
    renderCurrentScores(snap);
  }

  function send(type, payload = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, ...payload }));
  }

  function showToast(message, timeoutMs = 4000, kind = 'error') {
    if (!toastEl) return;

    const normalizedKind = (kind === 'success') ? 'success' : 'error';

    // content
    toastEl.textContent = message;

    // visibility
    toastEl.hidden = false;
    toastEl.removeAttribute('hidden');

    // style
    toastEl.dataset.kind = normalizedKind;
    toastEl.classList.remove('toast--success', 'toast--error');
    toastEl.classList.add(normalizedKind === 'success' ? 'toast--success' : 'toast--error');

    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => {
      toastEl.hidden = true;
      toastEl.setAttribute('hidden', '');
      toastEl.dataset.kind = '';
      toastEl.classList.remove('toast--success', 'toast--error');
    }, timeoutMs);
  }

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
      let prevW = canvas.width;
      let prevH = canvas.height;

      if (prevW > 0 && prevH > 0) {
        try {
          snapshot = document.createElement('canvas');
          snapshot.width = prevW;
          snapshot.height = prevH;
          const sctx = snapshot.getContext('2d');
          if (sctx) {
            sctx.drawImage(canvas, 0, 0);
          }
        } catch (_) {
          snapshot = null;
        }
      }

      canvas.width = targetW;
      canvas.height = targetH;

      // Reset transform before restoring.
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      if (snapshot) {
        try {
          // Scale old bitmap into the new resolution.
          ctx.imageSmoothingEnabled = true;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(snapshot, 0, 0, prevW, prevH, 0, 0, canvas.width, canvas.height);
        } catch (_) {
          // ignore
        }
      }
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
      // Smaller step improves continuity when the sender is forced to chunk aggressively.
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

  // Outgoing binary stroke sending
  let drawSeq = 1;

  function flushStrokeChunk(forceSinglePoint = false) {
    if (!canDraw()) return;

    if (!pendingPoints || pendingPoints.length === 0) {
      pendingPoints = [];
      return;
    }

    // Stitch across chunks: if we already sent part of the stroke, prepend the last sent point.
    // This avoids visible gaps between chunks under fast drawing.
    let pointsToSend = pendingPoints;
    if (lastSentPoint && pointsToSend.length >= 1) {
      pointsToSend = [lastSentPoint, ...pointsToSend];
    }

    if (pointsToSend.length < 2 && !forceSinglePoint) {
      return;
    }

    if (pointsToSend.length < 2) {
      pointsToSend = [pointsToSend[0], pointsToSend[0]];
    }

    // Keep for next stitch.
    lastSentPoint = pointsToSend[pointsToSend.length - 1];

    const tsMs = Math.floor(localNowAsServerMs());

    // Prefer binary transport; server will broadcast binary too.
    let binarySent = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const buf = packBinaryStroke(drawSeq, tsMs, strokeColor, strokeWidth, pointsToSend);
        ws.send(buf);
        drawSeq += 1;
        binarySent = true;
      } catch (_) {
        binarySent = false;
      }
    }

    // Fallback JSON (compat) only if binary send failed.
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

  function buildBrushCursorSvg(sizePx, colorHex) {
    // Cursor images have browser-specific limits; keep this small.
    const w = 64;
    const h = 64;

    const r = clampInt(sizePx / 2, 2, 20);
    const cx = 18;
    const cy = 44;

    const color = escapeAttr(colorHex || '#000000');

    // High-contrast outline circle + filled center approximating brush size.
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.45"/>
  <circle cx="${cx}" cy="${cy}" r="${Math.max(1, r - 1)}" fill="none" stroke="#000" stroke-width="2"/>
  <circle cx="${cx}" cy="${cy}" r="${Math.max(1, r - 2)}" fill="none" stroke="#fff" stroke-width="1" opacity="0.9"/>

  <!-- small brush icon (white fill + black stroke) -->
  <path d="M28 10l22 22-6 6L22 16z" fill="#ffffff" stroke="#000000" stroke-width="2" />
  <path d="M14 56c0-6 4-10 9-10 4 0 6 3 6 6 0 7-5 12-12 12-2 0-3-1-3-8z" fill="#ffffff" stroke="#000000" stroke-width="2" />
</svg>`;
  }

  function applyDynamicBrushCursor() {
    // Only set dynamic cursor while we're actively drawing.
    if (!document.body.classList.contains('is-drawing')) return;

    const w = clampInt(Number(widthEl.value), 1, 40);
    const c = colorEl.value || '#000000';

    try {
      const svg = buildBrushCursorSvg(w, c);
      const encoded = encodeURIComponent(svg)
        .replace(/%0A/g, '')
        .replace(/%20/g, ' ');

      // Hotspot at circle center.
      canvas.style.cursor = `url("data:image/svg+xml,${encoded}") 18 44, crosshair`;
    } catch (_) {
      // Fallback to CSS.
      canvas.style.cursor = '';
    }
  }

  function clearDynamicBrushCursor() {
    canvas.style.cursor = '';
  }

  function setDrawingCursor(active) {
    if (active) {
      document.body.classList.add('is-drawing');
      applyDynamicBrushCursor();
    } else {
      document.body.classList.remove('is-drawing');
      clearDynamicBrushCursor();
    }
  }

  function onPointerDown(e) {
    if (!canDraw()) return;
    isDrawing = true;
    setDrawingCursor(true);

    strokeId += 1;
    lastSentPoint = null;

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
    if (!isDrawing || !last || !canDraw()) {
      // If permissions changed mid-stroke, ensure cursor resets.
      if (!canDraw()) {
        isDrawing = false;
        last = null;
        setDrawingCursor(false);
      }
      return;
    }

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
    if (!canDraw()) {
      setDrawingCursor(false);
      return;
    }
    isDrawing = false;
    last = null;
    setDrawingCursor(false);

    // Send whatever remains.
    flushStrokeChunk(true);

    // reset stitch anchor for next stroke
    lastSentPoint = null;

    e.preventDefault();
  }

  function refreshHighscore() {
    // If we already have a snapshot, the UI-highscore is driven by live scores.
    if (lastSnapshot) {
      renderCurrentScores(lastSnapshot);
      return;
    }

    const roomId = (roomEl && roomEl.value ? roomEl.value.trim().toUpperCase() : '');

    if (!roomId) {
      highscoreEl.innerHTML = '';
      if (highscoreTopEl) highscoreTopEl.textContent = '—';
      return;
    }

    fetch(`/api/highscore.php?limit=20&roomId=${encodeURIComponent(roomId)}`)
      .then(r => r.json())
      .then((data) => {
        highscoreEl.innerHTML = '';

        const top = Array.isArray(data.top) ? data.top : [];

        if (highscoreTopEl) {
          if (top.length > 0) {
            const first = top[0];
            const time = first.updatedAt ? new Date(first.updatedAt * 1000).toLocaleString() : '';
            highscoreTopEl.textContent = `${first.name} — ${first.points}${time ? ' · ' + time : ''}`;
          } else {
            highscoreTopEl.textContent = '—';
          }
        }

        top.forEach(el => {
          const li = document.createElement('li');
          const d = new Date((el.updatedAt || 0) * 1000).toLocaleString();
          li.textContent = `${el.name} — ${el.points} (${d})`;
          highscoreEl.appendChild(li);
        });
      })
      .catch(() => {
        if (highscoreTopEl) highscoreTopEl.textContent = '—';
      });
  }

  // draw v2 sequencing (optional)
  let expectedDrawSeq = null; // number|null
  const pendingBatches = new Map(); // seq -> {events:[], tsMs:number|null}
  let gapTimer = null;

  function scheduleGapCheck() {
    if (gapTimer !== null) return;
    gapTimer = window.setTimeout(() => {
      gapTimer = null;
      // If we still have a gap after a short wait, just render what we have.
      drainPendingBatches(true);
    }, 90);
  }

  function drainPendingBatchesWithinWindow() {
    if (expectedDrawSeq === null) return;

    // If we have the next batches but one is missing, render what we can within a small window.
    // This avoids visible “stops” while drawing fast.
    for (let i = 0; i < DRAW_REORDER_WINDOW; i++) {
      const k = expectedDrawSeq + i;
      if (!pendingBatches.has(k)) continue;

      // Only draw out-of-order if we're missing earlier seq(s)
      if (i === 0) return;

      const batchObj = pendingBatches.get(k);
      pendingBatches.delete(k);

      const events = batchObj && Array.isArray(batchObj.events) ? batchObj.events : [];
      const tsMs = batchObj && Number.isFinite(batchObj.tsMs) ? Number(batchObj.tsMs) : null;
      enqueueRenderBatch(events, tsMs);

      // Do NOT advance expectedDrawSeq here; we’re only keeping continuity.
      // Once the missing seq arrives (or we force-drain), order will resync.
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

      enqueueRenderBatch(events, tsMs);

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

      enqueueRenderBatch(events, tsMs);

      drainPendingBatches(false);
    }
  }

  // UI
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

  function submitJoin() {
    const name = normalizeNameForJoin(nameEl.value);
    const roomId = normalizeRoomForJoin(roomEl.value);

    nameEl.value = name;
    roomEl.value = roomId;

    // Let native validation run first (required/pattern/minlength)
    if (joinForm && typeof joinForm.reportValidity === 'function') {
      const ok = joinForm.reportValidity();
      if (!ok) return;
    }

    if (!name) {
      showToast('Bitte gib einen Namen ein.');
      nameEl.focus();
      return;
    }

    if (!roomId) {
      showToast('Bitte gib einen Room-Code ein.');
      roomEl.focus();
      return;
    }

    send('join', { name, roomId });
    refreshHighscore();
  }

  if (joinForm) {
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitJoin();
    });
  }

  btnJoin.onclick = (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    submitJoin();
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
    window.addEventListener('pointercancel', () => {
      isDrawing = false;
      last = null;
      setDrawingCursor(false);
      onPointerUp(new Event('pointercancel'));
    });
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
