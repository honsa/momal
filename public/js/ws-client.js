// WebSocket client (connect + dispatch). Keeps app-main smaller.
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  function buildWsUrl() {
    const isHttps = location.protocol === 'https:';
    const proto = isHttps ? 'wss:' : 'ws:';

    let host = location.hostname;
    if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') {
      host = '127.0.0.1';
    }

    const isLocalHost = host === '127.0.0.1' || host === 'localhost';
    const useDirectPort = (!isHttps) && isLocalHost;

    return useDirectPort
      ? `${proto}//${host}:8080`
      : `${proto}//${host}/ws`;
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

