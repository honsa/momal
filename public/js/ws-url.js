// WS URL builder (shared between app + smoke tools)
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  function readNonEmptyString(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  }

  function getOverride(key) {
    try {
      const v = readNonEmptyString(new URLSearchParams(location.search).get(key));
      if (v) return v;

      const lsKey = `momal_${key}`;
      return readNonEmptyString(localStorage.getItem(lsKey));
    } catch (_) {
      // ignore
    }
    return null;
  }

  function normalizeHost(raw) {
    const host = readNonEmptyString(raw);
    if (!host) return '127.0.0.1';
    if (host === '0.0.0.0' || host === '::' || host === '[::]') return '127.0.0.1';
    return host;
  }

  function parsePort(raw, fallback) {
    const s = readNonEmptyString(raw);
    if (!s) return fallback;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  // Matches ws-client.js behavior.
  function buildWsUrl() {
    const isHttps = location.protocol === 'https:';
    const proto = isHttps ? 'wss:' : 'ws:';

    const host = normalizeHost(getOverride('wsHost') || location.hostname);

    const isLocalHost = host === '127.0.0.1' || host === 'localhost';
    const useDirectPortDefault = (!isHttps) && isLocalHost;

    const wsPortOverride = getOverride('wsPort');
    const wsPathOverride = getOverride('wsPath');

    const wsPort = parsePort(wsPortOverride, 8080);
    const wsPath = readNonEmptyString(wsPathOverride) || '/ws';

    const useDirectPort = wsPortOverride ? true : useDirectPortDefault;

    if (useDirectPort) {
      return `${proto}//${host}:${wsPort}`;
    }

    const normalizedPath = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
    return `${proto}//${host}${normalizedPath}`;
  }

  Momal.wsUrl = {
    buildWsUrl,
  };

  if (typeof Momal.isDebugEnabled === 'function' && Momal.isDebugEnabled()) {
    Momal.wsUrl.getOverride = getOverride;
  }
})();
