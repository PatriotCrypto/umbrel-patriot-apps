'use strict';
// Network guard. Umbrel's login lives in the app proxy in front of this app, but every
// other container on the Docker network could also call this app directly and skip it.
// Because Liberty AI can see logs and files, it only answers the proxy (and its own
// health check on localhost). Anyone else on the Docker network gets 403.
const dns = require('dns');

function norm(addr) {
  return String(addr || '').replace(/^::ffff:/, '');
}

function makeGuard({ proxyHost, disabled = false, lookup } = {}) {
  const look = lookup || ((h) => dns.promises.lookup(h, { all: true }));
  let cache = { at: 0, ips: new Set(), state: disabled ? 'off' : 'starting' };

  async function refresh() {
    if (disabled) { cache = { at: Date.now(), ips: new Set(), state: 'off' }; return cache; }
    if (!proxyHost) { cache = { at: Date.now(), ips: new Set(), state: 'unconfigured' }; return cache; }
    if (Date.now() - cache.at < 5000 && cache.state === 'active') return cache;
    try {
      const r = await look(proxyHost);
      cache = { at: Date.now(), ips: new Set(r.map((x) => norm(x.address))), state: 'active' };
    } catch (e) {
      // The proxy name did not resolve at all. Failing closed would lock the owner out of a
      // misnamed install, so stay open but report it loudly in Settings.
      cache = { at: Date.now(), ips: new Set(), state: 'unresolved' };
    }
    return cache;
  }

  return {
    async check(req) {
      const c = await refresh();
      if (c.state === 'off' || c.state === 'unresolved') return true;
      const ip = norm(req.socket && req.socket.remoteAddress);
      if (ip === '127.0.0.1' || ip === '::1') return true;
      if (c.state === 'unconfigured') return false;
      return c.ips.has(ip);
    },
    async status() { const c = await refresh(); return c.state; },
  };
}

module.exports = { makeGuard };
