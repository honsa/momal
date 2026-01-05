// WS URL builder (shared between app + smoke tools)
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

  // Matches ws-client.js behavior.
  function buildWsUrl() {
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

    const useDirectPort = wsPortOverride ? true : useDirectPortDefault;

    return useDirectPort
      ? `${proto}//${host}:${Number.isFinite(wsPort) ? wsPort : 8080}`
      : `${proto}//${host}${wsPath.startsWith('/') ? wsPath : '/' + wsPath}`;
  }

  Momal.wsUrl = {
    buildWsUrl,
    getOverride,
  };
})();

