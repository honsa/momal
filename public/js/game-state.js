// Game / round state machine (UI-oriented)
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  /**
   * @param {{
   *   els: any,
   *   ui: any,
   *   draw: any,
   * }} deps
   */
  function createGameState({ els, ui, draw } = {}) {
    if (!els || !ui || !draw) throw new Error('createGameState: missing deps');

    // Public-ish state
    const state = {
      joined: false,
      isHost: false,
      myConnectionId: null,
      drawerConnectionId: null,
      phase: 'lobby',
      lastSnapshot: null,
      lastRoundAccent: null,
    };

    // --- helpers ---

    function setAccentColor(color) {
      if (!color || typeof color !== 'string') return;
      document.body.style.setProperty('--accent', color);
      state.lastRoundAccent = color;
    }

    /** Whether the local player is allowed to draw right now. */
    function canDraw() {
      return state.joined && state.phase === 'in_round' && state.drawerConnectionId === state.myConnectionId;
    }

    function maybeSetDrawerDefaultColor() {
      if (!canDraw()) return;
      const cur = (els.colorEl && typeof els.colorEl.value === 'string') ? els.colorEl.value : '';
      const norm = String(cur || '').toLowerCase();
      if (norm === '' || norm === '#000000' || norm === '#000') {
        if (state.lastRoundAccent) {
          els.colorEl.value = state.lastRoundAccent;
        }
      }
    }

    function applySnapshot(snap) {
      state.lastSnapshot = snap;

      state.phase = snap.state;
      state.drawerConnectionId = snap.round?.drawerConnectionId ?? state.drawerConnectionId;

      ui.renderPlayersList(snap.players || [], state.myConnectionId);

      for (const p of (snap.players || [])) {
        if (p.connectionId === state.myConnectionId) {
          state.isHost = !!p.isHost;
        }
      }

      els.btnStart.disabled = !(state.joined && state.isHost && state.phase === 'lobby');
      els.btnClear.disabled = !(state.joined && state.drawerConnectionId === state.myConnectionId && state.phase === 'in_round');

      els.roundNumberEl.textContent = snap.round?.roundNumber ?? '-';
      els.timeLeftEl.textContent = snap.round?.timeLeft ?? '-';

      if (state.phase === 'lobby') {
        ui.setHint(state.isHost
          ? 'Du bist Host. Starte eine Runde, sobald mindestens 2 Spieler da sind.'
          : 'Warte, bis der Host startet.');
      }

      ui.renderScoreboard(snap.players || [], state.myConnectionId);
    }

    /**
     * Applies one incoming WS JSON message to state + UI.
     *
     * @param {{type:string, [key:string]:any}} msg
     * @param {{
     *   expectedDrawSeqRef?: { value: number|null },
     *   pendingBatches?: Map<number, any>,
     *   scheduleGapCheck?: Function,
     *   drainPendingBatchesWithinWindow?: Function,
     *   drainPendingBatches?: Function,
     * }} helpers
     */
    function applyWsMessage(msg, helpers) {
      const {
        expectedDrawSeqRef,
        pendingBatches,
        scheduleGapCheck,
        drainPendingBatchesWithinWindow,
        drainPendingBatches,
      } = helpers || {};

      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'hello':
          state.myConnectionId = msg.connectionId;
          break;

        case 'error':
          ui.showToast(msg.message || 'Fehler');
          ui.addChatLine('System', msg.message || 'Fehler', Math.floor(Date.now() / 1000));
          if ((msg.message || '').toLowerCase().includes('name')) {
            try { els.nameEl.focus(); } catch (_) { /* ignore */ }
          }
          break;

        case 'joined':
          state.joined = true;
          state.isHost = !!msg.isHost;
          els.btnStart.disabled = !state.isHost;
          break;

        case 'chat:new':
          ui.addChatLine(msg.name, msg.text, msg.ts);
          break;

        case 'room:snapshot':
          applySnapshot(msg);
          break;

        case 'round:started':
          state.drawerConnectionId = msg.drawerConnectionId;
          els.secretWordEl.textContent = '—';
          draw.clearCanvasLocal();

          if (msg.accentColor) setAccentColor(msg.accentColor);

          window.requestAnimationFrame(() => {
            draw.setupCanvasResolution();
          });

          ui.setHint((state.drawerConnectionId === state.myConnectionId)
            ? 'Du bist Zeichner. Zeichne das Wort (oben erscheint es gleich).'
            : 'Rate im Chat!');

          if (state.drawerConnectionId === state.myConnectionId) maybeSetDrawerDefaultColor();
          break;

        case 'round:word':
          els.secretWordEl.textContent = msg.word;
          break;

        case 'draw:batch': {
          if (!expectedDrawSeqRef || !pendingBatches || typeof drainPendingBatches !== 'function') return;

          const seq = Number(msg.seq);
          const events = Array.isArray(msg.events) ? msg.events : [];
          if (!Number.isFinite(seq) || events.length === 0) break;

          if (Number.isFinite(msg.tsMs)) draw.updateTimeOffset(Number(msg.tsMs));

          if (expectedDrawSeqRef.value === null) expectedDrawSeqRef.value = seq;

          pendingBatches.set(seq, { events, tsMs: Number.isFinite(msg.tsMs) ? Number(msg.tsMs) : null });

          if (seq !== expectedDrawSeqRef.value) {
            if (typeof scheduleGapCheck === 'function') scheduleGapCheck();
            if (typeof drainPendingBatchesWithinWindow === 'function') drainPendingBatchesWithinWindow();
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
          if (expectedDrawSeqRef) expectedDrawSeqRef.value = null;
          if (pendingBatches) pendingBatches.clear();
          draw.resetIncomingStrokeAnchors();
          break;

        case 'round:ended':
          ui.addChatLine('System', `${msg.reason} Wort war: ${msg.word}`, Math.floor(Date.now() / 1000));
          state.drawerConnectionId = null;
          els.secretWordEl.textContent = '—';
          els.btnClear.disabled = true;
          if (expectedDrawSeqRef) expectedDrawSeqRef.value = null;
          if (pendingBatches) pendingBatches.clear();
          draw.resetIncomingStrokeAnchors();
          break;

        default:
          break;
      }
    }

    return {
      state,
      canDraw,
      applyWsMessage,
    };
  }

  Momal.createGameState = createGameState;
})();
