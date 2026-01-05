// WebSocket client (connect + dispatch). Keeps app-main smaller.
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  function getOverride(key) {
    try {
      const qs = new URLSearchParams(location.search);
      const v = qs.get(key);
      if (v !== null && String(v).trim() !== '') return String(v).trim();

      const lsKey = `momal_${key}`;
      const ls = localStorage.getItem(lsKey);
      if (ls !== null && String(ls).trim() !== '') return String(ls).trim();
    } catch (_) {
      // ignore
    }
    return null;
  }

  function normalizeHost(raw) {
    const host = String(raw || '').trim();
    if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') return '127.0.0.1';
    return host;
  }

  function buildWsUrl() {
    // Prefer shared builder (used by smoke tools too).
    if (Momal.wsUrl && typeof Momal.wsUrl.buildWsUrl === 'function') {
      try {
        return Momal.wsUrl.buildWsUrl();
      } catch (_) {
        // fallback to local implementation
      }
    }

    const isHttps = location.protocol === 'https:';
    const proto = isHttps ? 'wss:' : 'ws:';

    const hostOverride = getOverride('wsHost');
    const host = normalizeHost(hostOverride || location.hostname);

    const isLocalHost = host === '127.0.0.1' || host === 'localhost';
    const useDirectPortDefault = (!isHttps) && isLocalHost;

    const wsPortOverride = getOverride('wsPort');
    const wsPathOverride = getOverride('wsPath');

    const wsPort = wsPortOverride ? parseInt(wsPortOverride, 10) : 8080;
    const wsPath = wsPathOverride || '/ws';

    // If user explicitly set a port, always use it.
    const useDirectPort = wsPortOverride ? true : useDirectPortDefault;

    return useDirectPort
      ? `${proto}//${host}:${Number.isFinite(wsPort) ? wsPort : 8080}`
      : `${proto}//${host}${wsPath.startsWith('/') ? wsPath : '/' + wsPath}`;
  }

  /**
   * Creates a WS client.
   *
   * Contract:
   * - Calls onJsonMessage(msg) for JSON messages
   * - Calls onBinary(decoded) for binary frames decoded via Momal.binary.tryDecodeBinaryFrame
   */
  function createWsClient({
    onOpen,
    onClose,
    onError,
    onJsonMessage,
    onBinary,
  } = {}) {
    let ws = null;

    function connect() {
      const url = buildWsUrl();

      if (Momal.isDebugEnabled()) {
        console.log('[momal] connecting', url);
      }

      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        if (typeof onOpen === 'function') onOpen();
      };

      ws.onclose = (e) => {
        if (typeof onClose === 'function') onClose(e);
      };

      ws.onerror = (e) => {
        if (typeof onError === 'function') onError(e);
      };

      ws.onmessage = (ev) => {
        const decoded = Momal.binary.tryDecodeBinaryFrame(ev.data);
        if (decoded) {
          if (typeof onBinary === 'function') onBinary(decoded);
          return;
        }

        try {
          const msg = JSON.parse(ev.data);
          if (!msg || !msg.type) return;
          if (typeof onJsonMessage === 'function') onJsonMessage(msg);
        } catch (_) {
          // ignore non-JSON text frames
        }
      };

      return ws;
    }

    function sendJson(obj) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(obj));
    }

    function sendRaw(data) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(data);
    }

    function isOpen() {
      return !!ws && ws.readyState === WebSocket.OPEN;
    }

    return {
      connect,
      sendJson,
      sendRaw,
      isOpen,
    };
  }

  Momal.createWsClient = createWsClient;
})();
