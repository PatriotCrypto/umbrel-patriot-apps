'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const { Mesh } = require('./lib/mesh');
const radio = require('./lib/radio');

const PORT = parseInt(process.env.PORT || '3959', 10);
const DATA_DIR = process.env.DATA_DIR || '/data';
const UID = 1000;
const VERSION = require('./package.json').version; // read before dropping privileges

// Start as root only to make sure the data folder is writable, then drop to uid 1000.
function dropPrivileges() {
  if (!process.getuid || process.getuid() !== 0) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const p of [DATA_DIR, path.join(DATA_DIR, 'skynet.json')]) { try { fs.chownSync(p, UID, UID); } catch (_) {} }
  process.setgid(UID); process.setuid(UID);
}

function createApp(store, mesh) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'"
    });
    next();
  });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }); // always fresh: a cached message list looks like "nothing arrived"
  app.use(express.json({ limit: '2mb' }));

  const D = store.data;
  const find = (arr, id) => arr.find((x) => x.id === id);
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

  // ---- live updates (server-sent events) ----
  const clients = new Set();
  let pending = new Set(), timer = null;
  mesh.on('change', (what) => {
    pending.add(what);
    if (timer) return;
    timer = setTimeout(() => {
      const msg = `event: change\ndata: ${JSON.stringify([...pending])}\n\n`;
      pending = new Set(); timer = null;
      for (const c of clients) c.write(msg);
    }, 400);
    if (timer.unref) timer.unref();
  });
  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    clients.add(res);
    const hb = setInterval(() => res.write(': hb\n\n'), 25000);
    req.on('close', () => { clearInterval(hb); clients.delete(res); });
  });

  // ---- state / settings ----
  app.get('/api/state', (req, res) => res.json({ ...mesh.snapshot(), settings: D.settings, version: VERSION }));

  app.put('/api/settings', (req, res) => {
    const b = req.body || {}, s = D.settings;
    const prevKey = [s.mode, s.host, s.port].join('|');
    if (b.callsign !== undefined) s.callsign = String(b.callsign).replace(/[^A-Za-z0-9/\-]/g, '').toUpperCase().slice(0, 12);
    if (b.mode !== undefined) { if (!['demo', 'live'].includes(b.mode)) return bad(res, 'mode must be demo or live'); s.mode = b.mode; }
    if (b.host !== undefined) {
      const h = String(b.host).trim();
      if (h && !/^[A-Za-z0-9.\-:]{1,253}$/.test(h)) return bad(res, 'That does not look like a hostname or IP address');
      s.host = h;
    }
    if (b.port !== undefined) { const p = parseInt(b.port, 10); if (!(p > 0 && p < 65536)) return bad(res, 'port must be 1-65535'); s.port = p; }
    if (b.staleMinutes !== undefined) { const v = parseInt(b.staleMinutes, 10); if (!(v >= 5 && v <= 1440)) return bad(res, 'silent-node limit must be 5-1440 minutes'); s.staleMinutes = v; }
    if (b.archiveDays !== undefined) { const v = parseInt(b.archiveDays, 10); if (!(v >= 0 && v <= 365)) return bad(res, 'auto-archive must be 0 (off) to 365 days'); s.archiveDays = v; }
    if (b.lowBattery !== undefined) { const v = parseInt(b.lowBattery, 10); if (!(v >= 1 && v <= 90)) return bad(res, 'low battery must be 1-90'); s.lowBattery = v; }
    if (b.tiles !== undefined) s.tiles = !!b.tiles;
    if (b.home !== undefined) {
      const la = b.home && b.home.lat === '' ? null : parseFloat(b.home && b.home.lat), lo = b.home && b.home.lon === '' ? null : parseFloat(b.home && b.home.lon);
      s.home = (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) ? { lat: la, lon: lo } : { lat: null, lon: null };
    }
    store.save();
    if ([s.mode, s.host, s.port].join('|') !== prevKey) mesh.start(); else mesh.sweepArchive();
    res.json(s);
  });

  // ---- mesh ----
  app.get('/api/trails', (req, res) => res.json(mesh.trails));
  app.get('/api/coverage', (req, res) => res.json(mesh.coverage()));
  app.get('/api/messages', (req, res) => {
    const arch = req.query.archived === '1';
    res.set('X-Msg-Rev', String(mesh.msgRev));
    res.json(mesh.messages.filter((m) => !!m.archived === arch).slice(-300));
  });
  app.post('/api/messages', (req, res) => {
    const to = req.body && req.body.to ? String(req.body.to) : '^all';
    if (to !== '^all' && !/^![0-9a-f]{8}$/.test(to)) return bad(res, 'bad destination');
    const r = mesh.send(req.body && req.body.text, to);
    if (!r.ok) return bad(res, r.error, 409);
    res.json({ ok: true });
  });
  // Archive hides messages from the chat (they can be brought back); delete removes them for good.
  const scopeOf = (v) => (v === undefined || v === 'all' || v === 'everyone' || v === 'private' || /^![0-9a-f]{8}$/.test(String(v)) ? (v || 'all') : null);
  const filterOf = (src) => {
    const sc = scopeOf(src.scope); if (sc === null) return null;
    const f = { scope: sc };
    if (Array.isArray(src.ids)) f.ids = src.ids.map(String).slice(0, 5000);
    if (src.olderThanDays !== undefined) { const d = Number(src.olderThanDays); if (!(d >= 0 && d <= 3650)) return null; f.before = Date.now() - d * 86400000; }
    return f;
  };
  app.post('/api/messages/archive', (req, res) => {
    const f = filterOf(req.body || {}); if (!f) return bad(res, 'bad filter');
    res.json({ ok: true, n: mesh.archive(f, req.body.archived !== false) });
  });
  app.delete('/api/messages', (req, res) => { // ?archived=1 empties the archive; ?scope= limits to one conversation
    const f = filterOf(req.query); if (!f) return bad(res, 'bad filter');
    if (req.query.archived === '1') f.archived = true;
    res.json({ ok: true, n: mesh.remove(f) });
  });
  app.delete('/api/messages/:id', (req, res) => { const n = mesh.remove({ ids: [req.params.id] }); if (!n) return bad(res, 'not found', 404); res.json({ ok: true }); });

  // ---- alerts and nodes ----
  app.post('/api/alerts/dismiss', (req, res) => {
    const k = req.body && req.body.key;
    if (!(k === 'all' || /^(silent|lowbat):![0-9a-f]{8}$/.test(String(k)))) return bad(res, 'bad alert');
    mesh.dismiss(k); res.json({ ok: true });
  });
  app.delete('/api/nodes/:id', (req, res) => { if (!mesh.forget(req.params.id)) return bad(res, 'not found (or that is your own node)', 404); res.json({ ok: true }); });

  // ---- generic CRUD for the three user collections ----
  function crud(name, key, sanitize, validate) {
    app.get(`/api/${name}`, (req, res) => res.json(D[key]));
    app.post(`/api/${name}`, (req, res) => {
      const r = sanitize(req.body || {});
      if (r.error) return bad(res, r.error);
      const err = validate && validate(r.value); if (err) return bad(res, err);
      if (D[key].length >= 5000) return bad(res, 'limit reached', 409);
      const item = { id: store.id(), created: Date.now(), ...r.value };
      D[key].push(item); store.save(); res.status(201).json(item);
    });
    app.put(`/api/${name}/:id`, (req, res) => {
      const old = find(D[key], req.params.id); if (!old) return bad(res, 'not found', 404);
      const r = sanitize(req.body || {}, old);
      if (r.error) return bad(res, r.error);
      const err = validate && validate(r.value); if (err) return bad(res, err);
      Object.assign(old, r.value); store.save(); res.json(old);
    });
    app.delete(`/api/${name}/:id`, (req, res) => {
      const i = D[key].findIndex((x) => x.id === req.params.id); if (i < 0) return bad(res, 'not found', 404);
      D[key].splice(i, 1); store.save(); res.json({ ok: true });
    });
  }
  crud('contacts', 'contacts', radio.sanitizeContact, (v) => (v.name || v.callsign ? null : 'give the contact a name or a callsign'));
  crud('freqs', 'freqs', radio.sanitizeFreq);
  crud('log', 'log', radio.sanitizeQso, (v) => (v.call ? null : 'a callsign is required'));

  // ---- frequency tools ----
  app.get('/api/freqs.chirp.csv', (req, res) => {
    const nameLen = Math.min(12, Math.max(4, parseInt(req.query.name, 10) || 7));
    const r = radio.toChirp(D.freqs, { nameLen });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="skynet-channels.csv"', 'X-Skynet-Count': String(r.count), 'X-Skynet-Warnings': encodeURIComponent(JSON.stringify(r.warnings.slice(0, 20))) });
    res.send(r.csv);
  });
  app.get('/api/freqs/preview', (req, res) => {
    const nameLen = Math.min(12, Math.max(4, parseInt(req.query.name, 10) || 7));
    const r = radio.toChirp(D.freqs, { nameLen });
    res.json({ count: r.count, warnings: r.warnings });
  });
  app.post('/api/freqs/import', (req, res) => {
    const r = radio.fromChirp((req.body && req.body.csv) || '');
    if (r.error) return bad(res, r.error);
    let added = 0;
    for (const v of r.items) {
      if (D.freqs.length >= 5000) break;
      if (D.freqs.some((f) => f.freq === v.freq && f.name === v.name)) continue;
      D.freqs.push({ id: store.id(), created: Date.now(), ...v }); added++;
    }
    store.save(); res.json({ added, skipped: r.skipped });
  });
  app.post('/api/freqs/presets', (req, res) => {
    let added = 0;
    for (const p of radio.presets()) {
      if (D.freqs.some((f) => f.service === p.service && f.name === p.name)) continue;
      const v = radio.sanitizeFreq(p); if (v.error) continue;
      D.freqs.push({ id: store.id(), created: Date.now(), ...v.value }); added++;
    }
    store.save(); res.json({ added });
  });
  app.get('/api/log.adi', (req, res) => {
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="skynet-log.adi"' });
    res.send(radio.toAdif(D.log.filter((q) => !q.sample), D.settings.callsign));
  });

  // ---- sample data (clearly tagged, removable) ----
  app.post('/api/sample', (req, res) => {
    if (D.contacts.some((c) => c.sample)) return res.json({ ok: true, already: true });
    const mk = (o) => ({ id: store.id(), created: Date.now(), sample: true, freqIds: [], ...o });
    D.contacts.push(
      mk({ name: 'Ridge Cabin', callsign: 'N0CALL', nodeId: '!d3a00003', relation: 'Family', notes: 'Sample contact. Portable node, usually on the ridge.' }),
      mk({ name: 'Outpost', callsign: '', nodeId: '!d3a00002', relation: 'Family', notes: 'Sample contact. Solar-powered fixed node.' }),
      mk({ name: 'Rover', callsign: '', nodeId: '!d3a00004', relation: 'Friend', notes: 'Sample contact. Vehicle node.' })
    );
    const now = Date.now();
    D.log.push(
      { id: store.id(), created: now, sample: true, ts: now - 86400000, call: 'N0CALL', freq: 146.52, mode: 'FM', rstSent: '59', rstRcvd: '59', name: 'Sample', qth: 'Somewhere', notes: 'Sample entry (not exported)' },
      { id: store.id(), created: now, sample: true, ts: now - 3 * 86400000, call: 'N0CALL', freq: 146.52, mode: 'FM', rstSent: '57', rstRcvd: '55', name: 'Sample', qth: 'Somewhere', notes: 'Sample entry (not exported)' }
    );
    store.save(); res.json({ ok: true });
  });
  app.delete('/api/sample', (req, res) => {
    for (const k of ['contacts', 'freqs', 'log']) D[k] = D[k].filter((x) => !x.sample);
    // keep the store's references in sync
    store.data.contacts = D.contacts; store.data.freqs = D.freqs; store.data.log = D.log;
    store.save(); res.json({ ok: true });
  });

  // ---- backup / restore (your data only: contacts, frequencies, logbook, settings) ----
  app.get('/api/backup', (req, res) => {
    res.set({ 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="skynet-backup.json"' });
    res.send(JSON.stringify({ skynet: 1, exported: new Date().toISOString(), settings: D.settings, contacts: D.contacts, freqs: D.freqs, log: D.log }, null, 1));
  });
  app.post('/api/restore', (req, res) => {
    const b = req.body;
    if (!b || b.skynet !== 1) return bad(res, 'This is not a Skynet backup file');
    const redo = (list, fn) => (Array.isArray(list) ? list.slice(0, 5000).map((x) => { const r = fn(x || {}); return r.error ? null : { ...r.value, id: store.id(), created: Number(x.created) || Date.now() }; }).filter(Boolean) : []);
    D.contacts.length = 0; D.freqs.length = 0; D.log.length = 0;
    D.contacts.push(...redo(b.contacts, radio.sanitizeContact));
    D.freqs.push(...redo(b.freqs, radio.sanitizeFreq));
    D.log.push(...redo(b.log, radio.sanitizeQso));
    store.save(); res.json({ contacts: D.contacts.length, freqs: D.freqs.length, log: D.log.length });
  });

  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err && err.type === 'entity.parse.failed') return bad(res, 'bad JSON');
    if (err && err.type === 'entity.too.large') return bad(res, 'too large', 413);
    console.error(err); res.status(500).json({ error: 'server error' });
  });
  return app;
}

if (require.main === module) {
  process.on('uncaughtException', (e) => console.error('uncaught', e));
  process.on('unhandledRejection', (e) => console.error('unhandled', e));
  dropPrivileges();
  const store = new Store(DATA_DIR);
  const mesh = new Mesh(store);
  const app = createApp(store, mesh);
  mesh.start();
  const server = app.listen(PORT, '0.0.0.0', () => console.log(`Skynet listening on ${PORT} (${mesh.mode} mode)`));
  const bye = () => { try { mesh.stop(); store.flush(); } catch (_) {} server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
}

module.exports = { createApp };
