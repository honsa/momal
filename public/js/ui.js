// UI helpers (toast, chat, players list, scoreboard)
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  function createUi(els) {
    const {
      statusEl,
      toastEl,
      playersEl,
      chatEl,
      hintEl,
      highscoreTopEl,
      highscoreEl,
    } = els;

    function setStatus(text) {
      if (statusEl) statusEl.textContent = text;
    }

    function showToast(message, timeoutMs = 4000, kind = 'error') {
      if (!toastEl) return;

      const normalizedKind = (kind === 'success') ? 'success' : 'error';

      toastEl.textContent = message;
      toastEl.hidden = false;
      toastEl.removeAttribute('hidden');

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

    function addChatLine(name, text, ts) {
      if (!chatEl) return;
      const line = document.createElement('div');
      line.className = 'chatLine';

      const time = ts ? new Date(ts * 1000).toLocaleTimeString() : '';
      line.innerHTML = `<span class="chatName">${Momal.escapeHtml(name)}</span> <span class="small muted">${Momal.escapeHtml(time)}</span><div>${Momal.escapeHtml(text)}</div>`;
      chatEl.appendChild(line);
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    function setHint(text) {
      if (hintEl) hintEl.textContent = text;
    }

    function renderPlayersList(players, myConnectionId) {
      if (!playersEl) return;

      playersEl.innerHTML = '';
      (players || []).slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).forEach((p) => {
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
        if (badges.childNodes.length > 0) left.appendChild(badges);

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'playerScore';
        scoreSpan.textContent = String(Number(p.score) || 0);

        li.appendChild(left);
        li.appendChild(scoreSpan);

        const roleParts = [];
        if (p.connectionId === myConnectionId) roleParts.push('du');
        if (p.isHost) roleParts.push('Host');
        if (p.isDrawer) roleParts.push('Zeichner');
        li.setAttribute('aria-label', `${p.name}, ${scoreSpan.textContent} Punkte${roleParts.length ? ', ' + roleParts.join(', ') : ''}`);

        playersEl.appendChild(li);
      });
    }

    function renderScoreboard(players, myConnectionId) {
      if (!highscoreEl) return;

      const list = Array.isArray(players) ? players.slice() : [];
      list.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

      highscoreEl.innerHTML = '';

      if (list.length === 0) {
        if (highscoreTopEl) highscoreTopEl.textContent = '—';
        return;
      }

      const leaderScore = Number(list[0].score) || 0;

      if (highscoreTopEl) {
        const leader = list[0];
        const crown = leaderScore > 0 ? '👑 ' : '';
        highscoreTopEl.textContent = `${crown}${leader.name} — ${leaderScore}`;
        highscoreTopEl.setAttribute('aria-label', `Führend: ${leader.name}, ${leaderScore} Punkte`);
      }

      for (const p of list) {
        const score = Number(p.score) || 0;
        const isLeader = (score === leaderScore) && list.length > 0;
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
        crownEl.setAttribute('aria-hidden', 'true');

        const nameEl2 = document.createElement('span');
        nameEl2.className = 'name';
        nameEl2.textContent = String(p.name ?? '');

        li.appendChild(crownEl);
        li.appendChild(nameEl2);

        if (tags.length) {
          const metaEl = document.createElement('span');
          metaEl.className = 'meta';
          metaEl.textContent = `(${tags.join(', ')})`;
          li.appendChild(metaEl);
        }

        const pointsEl = document.createElement('span');
        pointsEl.className = 'points';
        pointsEl.textContent = String(score);
        li.appendChild(pointsEl);

        const parts = [];
        if (isLeader && leaderScore > 0) parts.push('Führend');
        parts.push(`${String(p.name ?? '')}, ${score} Punkte`);
        if (tags.length) parts.push(tags.join(', '));
        li.setAttribute('aria-label', parts.join('. '));

        highscoreEl.appendChild(li);
      }
    }

    return {
      setStatus,
      showToast,
      addChatLine,
      setHint,
      renderPlayersList,
      renderScoreboard,
    };
  }

  Momal.createUi = createUi;
})();

