'use strict';
// Constellation: a read-only network observatory for your home LAN.
// Zero runtime dependencies: Node's built-in http, dgram, net, dns and crypto.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('./lib/store');
const { Auth } = require('./lib/auth');
const { Engine, validateSettings } = require('./lib/engine');
const { detectNetwork, scanOnce } = require('./lib/scanner');
const { resolveName } = require('./lib/names');
const { probeAll } = require('./lib/probe');
const { probePort } = require('./lib/btcprobe');
const { runSpeedTest } = require('./lib/speedtest');
const U = require('./lib/util');
const demoLib = require('./lib/demo');
const { TYPES } = require('./lib/classify');
const VERSION = require('./package.json').version;

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createApp(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || '/data';
  const demo = opts.demo !== undefined ? opts.demo : process.env.CONSTELLATION_DEMO === '1';
  const noAuth = opts.noAuth !== undefined ? opts.noAuth : process.env.CONSTELLATION_NO_AUTH === '1';
  fs.mkdirSync(dataDir, { recursive: true });

  const startedAt = Date.now();
  const store = demo ? null : new Store(dataDir);
  const auth = new Auth(dataDir, { disabled: noAuth });
  const engine = new Engine(store ? store.load() : null, startedAt);
  let demoCtl = null;
  if (demo) demoCtl = demoLib.seed(engine, startedAt);
  else engine.repair(startedAt);
  if (store) store.attach(() => engine.s);

  let net = demo ? demoLib.DEMO_NET : null;
  const status = { lastScanAt: null, lastScanMs: null, lastError: null, scanning: false };
  const timers = { scan: null, probe: null, hourly: null, speed: null };
  const speed = { running: false, phase: '', mbps: null, startedAt: null };
  const sse = new Set();
  let stopped = false;

  // ---------- helpers ----------
  const publicNet = (n) => (n ? {
    ok: n.ok, error: n.error || null, iface: n.iface || null, ip: n.ip || null, gateway: n.gateway || null,
    cidrs: n.cidrs || [], source: n.source || null,
  } : null);

  function broadcast() {
    const msg = 'event: tick\ndata: ' + JSON.stringify({ v: engine.version, at: Date.now() }) + '\n\n';
    for (const res of sse) { try { res.write(msg); } catch (e) { sse.delete(res); } }
  }

  function internetState() {
    const pr = engine.s.probes;
    const last = pr[pr.length - 1] || null;
    if (!last) return { state: 'unknown', wan: null, lan: null, at: null, avg1h: null };
    const recent = pr.slice(-10);
    const lossRecent = recent.filter((p) => p.wan === null).length / recent.length;
    const hour = pr.filter((p) => p.t >= last.t - 3600e3 && p.wan !== null).map((p) => p.wan);
    const avg1h = hour.length ? Math.round((hour.reduce((a, b) => a + b, 0) / hour.length) * 10) / 10 : null;
    let state = 'ok';
    if (pr.slice(-3).every((p) => p.wan === null)) state = 'down';
    else if ((last.wan !== null && last.wan > 120) || lossRecent > 0.3) state = 'degraded';
    return { state, wan: last.wan, lan: last.lan, at: last.t, avg1h };
  }

  function stateView() {
    const now = Date.now();
    return {
      version: VERSION, demo, now, types: TYPES,
      summary: engine.summary(now),
      network: publicNet(net),
      scanner: Object.assign({ intervalSec: engine.settings.scanIntervalSec }, status),
      internet: internetState(),
      settings: engine.settings,
      order: engine.s.order,
      speed: Object.assign({}, speed, { results: engine.s.speed.slice(-60) }),
      devices: engine.list(now),
    };
  }

  // ---------- scanning ----------
  async function doScan() {
    if (status.scanning || stopped) return false;
    status.scanning = true;
    broadcast();
    try {
      net = demo ? demoLib.DEMO_NET : opts.netFn ? opts.netFn() : detectNetwork({ override: engine.settings.subnets });
      if (!net.ok) { status.lastError = net.error; return true; }
      const res = demo
        ? { hosts: demoCtl.scan(Date.now()), durationMs: 4 }
        : opts.scanFn ? await opts.scanFn(net) : await scanOnce(net);
      status.lastScanMs = res.durationMs;
      if (res.error) { status.lastError = res.error; return true; }
      status.lastError = null;
      const now = Date.now();
      engine.applyScan(res.hosts, now, { gatewayIp: net.gateway, selfMac: net.mac });
      if (!demo && net.mac && engine.s.devices[net.mac] && !engine.s.devices[net.mac].hostname) {
        engine.setHostname(net.mac, U.cleanText(os.hostname(), 63) || null, now);
      }
      flushNotifications();
      if (store) store.scheduleSave();
      resolveNames().catch(() => {});
      detectBitcoin().catch(() => {});
    } catch (e) {
      status.lastError = String((e && e.message) || e);
    } finally {
      status.scanning = false;
      status.lastScanAt = Date.now();
      broadcast();
    }
    return true;
  }

  function loopScan(delayMs) {
    clearTimeout(timers.scan);
    if (stopped) return;
    timers.scan = setTimeout(async () => {
      await doScan();
      loopScan(engine.settings.scanIntervalSec * 1000);
    }, delayMs);
    if (timers.scan.unref && opts.unref) timers.scan.unref();
  }

  let probing = false;
  async function doProbe() {
    if (probing || stopped || speed.running) return;
    probing = true;
    try {
      const p = demo ? demoLib.probeAt(Date.now())
        : await (opts.probeFn || probeAll)({ gateway: net && net.gateway });
      engine.addProbe(Date.now(), p);
      if (store) store.scheduleSave();
      broadcast();
    } catch (e) { /* a failed probe is simply skipped */ } finally { probing = false; }
  }

  function loopProbe(delayMs) {
    clearTimeout(timers.probe);
    if (stopped) return;
    timers.probe = setTimeout(async () => { await doProbe(); loopProbe(60e3); }, delayMs);
  }

  let nameBusy = false;
  async function resolveNames() {
    if (nameBusy || demo || !engine.settings.resolveNames || !net || !net.ok) return;
    nameBusy = true;
    try {
      const list = engine.needsName(Date.now());
      for (let i = 0; i < list.length; i += 6) {
        await Promise.all(list.slice(i, i + 6).map(async (d) => {
          const fn = opts.nameFn || resolveName;
          const n = await fn(d.ip, { gateway: net.gateway }).catch(() => null);
          engine.setHostname(d.mac, n, Date.now());
        }));
      }
    } finally {
      nameBusy = false;
      if (store) store.scheduleSave();
      broadcast();
    }
  }

  // Quietly notice Bitcoin nodes: anything on the LAN answering on port 8333.
  let btcBusy = false;
  async function detectBitcoin() {
    if (btcBusy || demo || !net || !net.ok) return;
    btcBusy = true;
    try {
      const list = engine.needsBtc(Date.now());
      for (let i = 0; i < list.length; i += 8) {
        await Promise.all(list.slice(i, i + 8).map(async (d) => {
          const ok = await (opts.btcFn || probePort)(d.ip, 8333).catch(() => false);
          engine.setBtc(d.mac, ok, Date.now());
        }));
      }
    } finally {
      btcBusy = false;
      if (store) store.scheduleSave();
      broadcast();
    }
  }

  // ---------- notifications (optional, off by default) ----------
  function sendNtfy(title, body) {
    const n = engine.settings.ntfy;
    if (!n.enabled || !n.topic) return Promise.resolve(false);
    const send = opts.fetchFn || fetch;
    return send(n.server + '/' + encodeURIComponent(n.topic), {
      method: 'POST', body, headers: { Title: title, Tags: 'satellite', Priority: '3' },
      signal: AbortSignal.timeout(8000),
    }).then((r) => r.ok).catch(() => false);
  }

  function flushNotifications() {
    const items = engine.pending.splice(0);
    for (const it of items) {
      const d = engine.s.devices[it.mac];
      const label = d ? engine.view(d, Date.now()).label : it.mac;
      sendNtfy('New device on your network', label + '\n' + it.ip + ' / ' + (it.vendor || 'unknown vendor') + '\n' + it.mac);
    }
  }

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler, o = {}) => routes.push({ method, parts: pattern.split('/').filter(Boolean), handler, open: !!o.open, limit: o.limit });

  function clientIp(req) { return (req.socket && req.socket.remoteAddress) || 'unknown'; }

  route('GET', '/api/auth/status', (req) => ({ configured: auth.configured || noAuth, authed: auth.isAuthed(req), noAuth }), { open: true });

  route('POST', '/api/auth/setup', (req, res, c) => {
    const code = auth.setup(c.body.password);
    res.setHeader('Set-Cookie', auth.cookieHeader(auth.issue()));
    return { ok: true, recoveryCode: code };
  }, { open: true });

  route('POST', '/api/auth/login', (req, res, c) => {
    const ip = clientIp(req);
    const wait = auth.blockedFor(ip);
    if (wait) throw new HttpError(429, 'Too many attempts. Try again in ' + wait + ' seconds.');
    if (!auth.verify(c.body.password)) { auth.recordFail(ip); throw new HttpError(401, 'Wrong password'); }
    auth.recordOk(ip);
    res.setHeader('Set-Cookie', auth.cookieHeader(auth.issue()));
    return { ok: true };
  }, { open: true });

  route('POST', '/api/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', auth.cookieHeader('', true));
    return { ok: true };
  }, { open: true });

  route('POST', '/api/auth/reset', (req, res, c) => {
    const ip = clientIp(req);
    const wait = auth.blockedFor(ip);
    if (wait) throw new HttpError(429, 'Too many attempts. Try again in ' + wait + ' seconds.');
    if (!auth.verifyRecovery(c.body.recoveryCode)) { auth.recordFail(ip); throw new HttpError(401, 'That recovery code is not right'); }
    auth.recordOk(ip);
    const code = auth.change(c.body.newPassword);
    res.setHeader('Set-Cookie', auth.cookieHeader(auth.issue()));
    return { ok: true, recoveryCode: code };
  }, { open: true });

  route('POST', '/api/auth/password', (req, res, c) => {
    if (!auth.verify(c.body.current)) throw new HttpError(401, 'Current password is wrong');
    const code = auth.change(c.body.password);
    res.setHeader('Set-Cookie', auth.cookieHeader(auth.issue()));
    return { ok: true, recoveryCode: code };
  });

  route('GET', '/api/state', () => stateView());

  route('GET', '/api/history', (req, res, c) => engine.history(c.query.get('range') || '24h', Date.now()));

  route('GET', '/api/devices/:mac', (req, res, c) => {
    const mac = U.normMac(decodeURIComponent(c.params.mac));
    const d = mac && engine.s.devices[mac];
    if (!d) throw new HttpError(404, 'Unknown device');
    const now = Date.now();
    return {
      device: engine.view(d, now),
      sessions: d.sessions.slice(-60).reverse().map((s) => ({ start: s[0], end: s[1] })),
      events: engine.s.events.filter((e) => e.mac === mac).slice(-40).reverse(),
    };
  });

  route('PATCH', '/api/devices/:mac', (req, res, c) => {
    const mac = U.normMac(decodeURIComponent(c.params.mac));
    if (!mac || !engine.s.devices[mac]) throw new HttpError(404, 'Unknown device');
    const patch = {};
    for (const k of ['name', 'type', 'notes', 'known', 'hidden', 'group']) if (c.body[k] !== undefined) patch[k] = c.body[k];
    engine.updateDevice(mac, patch, Date.now());
    if (store) store.scheduleSave(3000);
    broadcast();
    return { ok: true, device: engine.view(engine.s.devices[mac], Date.now()) };
  });

  route('DELETE', '/api/devices/:mac', (req, res, c) => {
    const mac = U.normMac(decodeURIComponent(c.params.mac));
    if (!mac || !engine.forget(mac)) throw new HttpError(404, 'Unknown device');
    if (store) store.scheduleSave(3000);
    broadcast();
    return { ok: true };
  });

  route('POST', '/api/ack-all', () => {
    const n = engine.acknowledgeAll();
    if (store) store.scheduleSave(3000);
    broadcast();
    return { ok: true, acknowledged: n };
  });

  route('POST', '/api/scan', () => {
    if (status.scanning) return { started: false };
    doScan();
    return { started: true };
  });

  route('PUT', '/api/order', (req, res, c) => {
    const order = engine.setOrder(c.body && c.body.order, c.body && c.body.tags);
    if (store) store.scheduleSave(1000);
    broadcast();
    return { ok: true, order };
  });

  async function doSpeed() {
    if (speed.running || stopped) return false;
    speed.running = true; speed.phase = 'ping'; speed.mbps = null; speed.startedAt = Date.now();
    broadcast();
    let lastPush = 0;
    try {
      let r;
      if (demo) r = await demoLib.fakeSpeed(speed, broadcast);
      else r = await runSpeedTest({
        fetchFn: opts.fetchFn,
        onProgress: (p) => { speed.phase = p.phase; speed.mbps = p.mbps; if (Date.now() - lastPush > 400) { lastPush = Date.now(); broadcast(); } },
      });
      engine.addSpeed(r);
      if (store) store.scheduleSave(1000);
    } catch (e) {
      engine.addSpeed({ t: Date.now(), down: null, up: null, ping: null, jitter: null, server: '', error: String((e && e.message) || e) });
    } finally { speed.running = false; speed.phase = ''; speed.mbps = null; broadcast(); }
    return true;
  }

  route('POST', '/api/speedtest', () => {
    if (speed.running) return { started: false };
    doSpeed();
    return { started: true };
  });

  route('GET', '/api/settings', () => engine.settings);

  route('PUT', '/api/settings', (req, res, c) => {
    const r = validateSettings(c.body, engine.settings);
    if (!r.ok) throw new HttpError(400, r.error);
    const subnetsChanged = JSON.stringify(r.settings.subnets) !== JSON.stringify(engine.settings.subnets);
    engine.s.settings = r.settings;
    engine.touch();
    if (store) store.scheduleSave(1000);
    if (subnetsChanged) loopScan(500); else loopScan(engine.settings.scanIntervalSec * 1000);
    broadcast();
    return { ok: true, settings: engine.settings };
  });

  route('POST', '/api/notify-test', async () => {
    const n = engine.settings.ntfy;
    if (!n.enabled || !n.topic) throw new HttpError(400, 'Turn on notifications and save a topic first');
    const ok = await sendNtfy('Constellation test', 'Notifications are working.');
    if (!ok) throw new HttpError(502, 'Could not reach the notification server');
    return { ok: true };
  });

  route('GET', '/api/export', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="constellation-backup-' + new Date().toISOString().slice(0, 10) + '.json"');
    return engine.s;
  });

  route('POST', '/api/import', (req, res, c) => {
    const st = Engine.sanitizeImport(c.body, Date.now());
    engine.s = st;
    engine.repair(Date.now());
    engine.touch();
    if (store) store.scheduleSave(500);
    broadcast();
    return { ok: true, devices: Object.keys(st.devices).length };
  }, { limit: 12 * 1024 * 1024 });

  route('POST', '/api/clear-history', () => {
    engine.clearHistory(Date.now());
    if (store) store.scheduleSave(500);
    broadcast();
    return { ok: true };
  });

  route('GET', '/api/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 4000\n\n');
    sse.add(res);
    req.on('close', () => sse.delete(res));
    return null; // keep open
  });

  // ---------- http plumbing ----------
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const len = Number(req.headers['content-length'] || 0);
      if (len > limit) return reject(new HttpError(413, 'Request too large'));
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!size) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new HttpError(400, 'Invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  function send(res, status, body, headers = {}) {
    if (res.headersSent) return;
    const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
    res.end(buf);
  }

  function serveStatic(req, res, pathname) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    let file;
    try { file = path.normalize(path.join(PUBLIC, decodeURIComponent(rel))); } catch (e) { return send(res, 400, { error: 'Bad path' }); }
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        // Single-page app: unknown non-asset paths fall back to the shell.
        if (!path.extname(rel)) return serveStatic(req, res, '/');
        return send(res, 404, { error: 'Not found' });
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, { error: 'Bad request' }); }

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      return serveStatic(req, res, url.pathname);
    }

    try {
      const parts = url.pathname.split('/').filter(Boolean);
      let match = null;
      let params = {};
      let pathExists = false;
      for (const r of routes) {
        if (r.parts.length !== parts.length) continue;
        const p = {};
        let ok = true;
        for (let i = 0; i < parts.length; i++) {
          if (r.parts[i].startsWith(':')) p[r.parts[i].slice(1)] = parts[i];
          else if (r.parts[i] !== parts[i]) { ok = false; break; }
        }
        if (!ok) continue;
        pathExists = true;
        if (r.method === req.method) { match = r; params = p; break; }
      }
      if (!match) throw new HttpError(pathExists ? 405 : 404, pathExists ? 'Method not allowed' : 'Not found');

      if (!match.open && !auth.isAuthed(req)) throw new HttpError(401, 'Sign in required');

      let body = {};
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.headers['x-cs-request'] !== '1') throw new HttpError(403, 'Missing request header');
        const origin = req.headers.origin;
        if (origin) {
          let oh = null;
          try { oh = new URL(origin).host; } catch (e) { /* bad origin */ }
          if (oh !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked');
        }
        body = await readBody(req, match.limit || 64 * 1024);
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object');
      }

      const out = await match.handler(req, res, { params, body, query: url.searchParams });
      if (out === null) return; // streaming handler took over
      send(res, 200, out);
    } catch (e) {
      const st = e.status || 500;
      if (st >= 500 && st !== 502) console.error(e);
      send(res, st, { error: st >= 500 && st !== 502 ? 'Server error' : e.message });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;

  // ---------- lifecycle ----------
  function dropPrivileges() {
    if (typeof process.getuid !== 'function' || process.getuid() !== 0 || opts.noDrop) return;
    try {
      for (const f of fs.readdirSync(dataDir)) fs.chownSync(path.join(dataDir, f), 1000, 1000);
      fs.chownSync(path.join(dataDir, 'backups'), 1000, 1000);
      fs.chownSync(dataDir, 1000, 1000);
      process.setgid(1000);
      process.setuid(1000);
    } catch (e) { console.error('Could not drop privileges:', e.message); }
  }

  function start(port) {
    return new Promise((resolve) => {
      server.listen(port === undefined ? Number(process.env.PORT || 3971) : port, opts.host || '0.0.0.0', () => {
        dropPrivileges();
        if (store) store.backupDaily();
        loopScan(opts.firstScanMs !== undefined ? opts.firstScanMs : 1500);
        loopProbe(opts.firstProbeMs !== undefined ? opts.firstProbeMs : 3000);
        timers.speed = setInterval(() => {
          const h = engine.settings.speedEveryHours;
          if (!h || speed.running || demo) return;
          const last = engine.s.speed[engine.s.speed.length - 1];
          if (!last || Date.now() - last.t >= h * 3600e3) doSpeed();
        }, 5 * 60 * 1000);
        if (timers.speed.unref) timers.speed.unref();
        timers.hourly = setInterval(() => {
          engine.prune(Date.now());
          if (store) { store.backupDaily(); store.scheduleSave(1000); }
          for (const res of sse) { try { res.write(': ping\n\n'); } catch (e) { sse.delete(res); } }
        }, 60 * 1000);
        if (timers.hourly.unref) timers.hourly.unref();
        resolve(server.address().port);
      });
    });
  }

  function stop() {
    stopped = true;
    clearTimeout(timers.scan);
    clearTimeout(timers.probe);
    clearInterval(timers.hourly);
    clearInterval(timers.speed);
    for (const res of sse) { try { res.end(); } catch (e) { /* ignore */ } }
    sse.clear();
    try { if (store) store.saveNow(); } catch (e) { console.error('final save failed:', e.message); }
    return new Promise((r) => server.close(() => r()));
  }

  return { server, engine, auth, store, start, stop, doScan, doProbe, doSpeed, status, stateView };
}

if (require.main === module) {
  const app = createApp();
  app.start().then((p) => console.log('Constellation ' + VERSION + ' listening on :' + p + (process.env.CONSTELLATION_DEMO === '1' ? ' (demo mode)' : '')));
  const bye = () => { app.stop().then(() => process.exit(0)); };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
  process.on('uncaughtException', (e) => console.error('uncaught:', e));
  process.on('unhandledRejection', (e) => console.error('unhandled:', e));
}

module.exports = { createApp };
