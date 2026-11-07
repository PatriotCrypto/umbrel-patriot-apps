'use strict';
// Advent Calendar for Umbrel. One small server, no dependencies.
// Kids use the calendar, the North Pole cams, the Santa tracker and Santa's letter desk freely.
// Parents unlock Settings with a PIN to manage children, the Nice list and the preview date.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./lib/store');
const { DAYS } = require('./lib/days');
const santa = require('./lib/santa');

const VERSION = require('./package.json').version;
const THEMES = ['joy', 'candy', 'wonderland', 'gingerbread', 'aurora'];
const OLD_THEMES = { bethlehem: 'joy', cabin: 'gingerbread', frost: 'wonderland', command: 'aurora' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
const uid = () => crypto.randomBytes(6).toString('hex');

function defaults() {
  return {
    setup: false,
    pin: null, // { salt, hash }
    theme: 'joy',
    hometown: '',
    bedtime: '21:00',
    volume: 0.8,
    music: true,
    previewDate: '', // parents only: pretend today is YYYY-MM-DD
    snow: true,
    reduceMotion: false,
  };
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

function createApp(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || '/data';
  fs.mkdirSync(dataDir, { recursive: true });
  const store = new Store(dataDir, 'state.json');
  const loaded = store.load() || {};
  const state = {
    v: 1,
    settings: Object.assign(defaults(), loaded.settings || {}),
    children: loaded.children || [], // { id, name, list: { default, days: {} }, opened: { day: ts }, wishes: [], letters: [], found: {}, badges: {} }
    log: loaded.log || [],
  };
  store.attach(() => state);
  const tokens = new Map(); // parent tokens -> expiry

  const publicChild = (c) => ({ id: c.id, name: c.name, opened: c.opened, found: c.found || {}, badges: c.badges || {}, wishes: (c.wishes || []).length });
  const childOf = (id) => state.children.find((c) => c.id === id);

  // The date a child sees: the parent's preview date if set, otherwise the date the browser sent.
  function todayFor(q) {
    const p = state.settings.previewDate;
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
    const d = clean(q && q.get('d'), 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10);
  }
  // Which December day it is: 0 before December, 1..25 in the run-up, 26 after Christmas.
  function adventDay(today) {
    const [, m, d] = today.split('-').map(Number);
    if (m === 12) return Math.min(d, 26);
    if (m === 1) return 26;
    return 0;
  }
  function listStatus(child, today) {
    const key = today.slice(5);
    const l = child.list || { default: 'nice', days: {} };
    return (l.days && l.days[key]) || l.default || 'nice';
  }
  function requireParent(req) {
    const t = req.headers['x-parent-token'];
    const exp = t && tokens.get(t);
    if (!exp || exp < Date.now()) throw new HttpError(401, 'Grown-ups only. Enter the parent PIN.');
    tokens.set(t, Date.now() + 30 * 60 * 1000);
  }

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

  route('GET', '/healthz', () => ({ ok: true, version: VERSION }));

  route('GET', '/api/state', (req, res, c) => {
    const today = todayFor(c.query);
    const s = state.settings;
    if (OLD_THEMES[s.theme]) s.theme = OLD_THEMES[s.theme];
    if (!THEMES.includes(s.theme)) s.theme = 'joy';
    return {
      version: VERSION,
      setup: s.setup,
      today,
      day: adventDay(today),
      preview: !!s.previewDate,
      settings: { theme: s.theme, hometown: s.hometown, bedtime: s.bedtime, volume: s.volume, music: s.music, snow: s.snow, reduceMotion: s.reduceMotion },
      children: state.children.map(publicChild),
      days: DAYS.map((d) => ({ n: d.n, title: d.title, ref: d.ref, scene: d.scene })),
    };
  });

  route('GET', '/api/day/:n', (req, res, c) => {
    const n = Number(c.params.n);
    const d = DAYS.find((x) => x.n === n);
    if (!d) throw new HttpError(404, 'No such day');
    const today = todayFor(c.query);
    if (adventDay(today) < n) throw new HttpError(403, 'Not yet! This door opens on December ' + n + '.');
    return d;
  });

  route('POST', '/api/open', (req, res, c) => {
    const child = childOf(c.body.child);
    const n = Number(c.body.day);
    if (!child || !(n >= 1 && n <= 25)) throw new HttpError(400, 'Bad request');
    if (adventDay(todayFor(c.query)) < n) throw new HttpError(403, 'Not yet!');
    child.opened = child.opened || {};
    if (!child.opened[n]) child.opened[n] = Date.now();
    store.scheduleSave(500);
    return { ok: true, opened: child.opened };
  });

  // Hidden elf found, mini-game badges, and such.
  route('POST', '/api/found', (req, res, c) => {
    const child = childOf(c.body.child);
    const key = clean(c.body.key, 40);
    if (!child || !/^[a-z0-9:-]+$/.test(key)) throw new HttpError(400, 'Bad request');
    const bucket = c.body.badge ? 'badges' : 'found';
    child[bucket] = child[bucket] || {};
    const fresh = !child[bucket][key];
    child[bucket][key] = Date.now();
    store.scheduleSave(500);
    return { ok: true, fresh, count: Object.keys(child[bucket]).length };
  });

  route('GET', '/api/list', (req, res, c) => {
    const child = childOf(c.query.get('child'));
    if (!child) throw new HttpError(404, 'Who is that?');
    return { status: listStatus(child, todayFor(c.query)), name: child.name };
  });

  route('GET', '/api/santa', (req, res, c) => {
    const child = childOf(c.query.get('child'));
    if (!child) throw new HttpError(404, 'Who is that?');
    return { letters: (child.letters || []).slice(-60), wishes: child.wishes || [] };
  });

  route('POST', '/api/santa', (req, res, c) => {
    const child = childOf(c.body.child);
    const text = clean(c.body.text, 400);
    if (!child || !text) throw new HttpError(400, 'Say something first!');
    const today = todayFor(c.query);
    const day = adventDay(today);
    const r = santa.reply({ text, child, listStatus: listStatus(child, today), daysLeft: day === 0 ? 30 : Math.max(0, 25 - day), wishesCount: (child.wishes || []).length });
    child.letters = child.letters || [];
    child.letters.push({ from: 'child', text, at: Date.now() }, { from: 'santa', text: r.text, at: Date.now() });
    if (child.letters.length > 200) child.letters.splice(0, child.letters.length - 200);
    if (r.wish) {
      child.wishes = child.wishes || [];
      if (!child.wishes.some((w) => w.text.toLowerCase() === r.wish.toLowerCase()) && child.wishes.length < 40) child.wishes.push({ text: r.wish, at: Date.now() });
    }
    store.scheduleSave(500);
    return { reply: r.text, wish: r.wish, wishes: child.wishes || [] };
  });

  route('POST', '/api/wish', (req, res, c) => {
    const child = childOf(c.body.child);
    const text = clean(c.body.text, 80);
    if (!child || !text) throw new HttpError(400, 'Write a wish first!');
    child.wishes = child.wishes || [];
    if (child.wishes.length >= 40) throw new HttpError(400, 'That is a very long list already!');
    child.wishes.push({ text, at: Date.now() });
    store.scheduleSave(500);
    return { wishes: child.wishes };
  });

  route('POST', '/api/wish/remove', (req, res, c) => {
    const child = childOf(c.body.child);
    if (!child) throw new HttpError(400, 'Bad request');
    child.wishes = (child.wishes || []).filter((w) => w.text !== c.body.text);
    store.scheduleSave(500);
    return { wishes: child.wishes };
  });

  // ---------- setup and parents ----------
  route('POST', '/api/setup', (req, res, c) => {
    if (state.settings.setup) throw new HttpError(400, 'Already set up');
    const kids = Array.isArray(c.body.children) ? c.body.children : [];
    const names = kids.map((k) => clean(typeof k === 'string' ? k : k && k.name, 30)).filter(Boolean).slice(0, 8);
    if (!names.length) throw new HttpError(400, 'Add at least one child');
    const pin = clean(c.body.pin, 8);
    if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'The parent PIN must be 4 to 8 digits');
    state.children = names.map((name) => ({ id: uid(), name, list: { default: 'nice', days: {} }, opened: {}, wishes: [], letters: [], found: {}, badges: {} }));
    const salt = crypto.randomBytes(8).toString('hex');
    state.settings.pin = { salt, hash: hashPin(pin, salt) };
    applySettings(c.body);
    state.settings.setup = true;
    store.saveNow();
    return { ok: true };
  });

  route('POST', '/api/pin', (req, res, c) => {
    const p = state.settings.pin;
    const pin = clean(c.body.pin, 8);
    if (!p || hashPin(pin, p.salt) !== p.hash) throw new HttpError(401, 'That PIN is not right.');
    const token = crypto.randomBytes(16).toString('hex');
    tokens.set(token, Date.now() + 30 * 60 * 1000);
    return { token };
  });

  function applySettings(b) {
    const s = state.settings;
    if (b.theme !== undefined && THEMES.includes(b.theme)) s.theme = b.theme;
    if (b.hometown !== undefined) s.hometown = clean(b.hometown, 40);
    if (b.bedtime !== undefined && /^\d{2}:\d{2}$/.test(b.bedtime)) s.bedtime = b.bedtime;
    if (typeof b.volume === 'number') s.volume = Math.max(0, Math.min(1, b.volume));
    if (typeof b.music === 'boolean') s.music = b.music;
    if (typeof b.snow === 'boolean') s.snow = b.snow;
    if (typeof b.reduceMotion === 'boolean') s.reduceMotion = b.reduceMotion;
    if (b.previewDate !== undefined) s.previewDate = /^\d{4}-\d{2}-\d{2}$/.test(b.previewDate) ? b.previewDate : '';
  }

  // Kids may change the look and sound; everything else needs the PIN.
  route('PUT', '/api/look', (req, res, c) => {
    const b = c.body || {};
    applySettings({ theme: b.theme, volume: b.volume, music: b.music, snow: b.snow, reduceMotion: b.reduceMotion });
    store.scheduleSave(500);
    return { ok: true };
  });

  route('GET', '/api/parent', (req, res, c) => {
    requireParent(req);
    return {
      settings: state.settings,
      children: state.children.map((ch) => ({ id: ch.id, name: ch.name, list: ch.list, wishes: ch.wishes || [], letters: (ch.letters || []).slice(-40), opened: ch.opened })),
      hasPin: !!state.settings.pin,
    };
  });

  route('PUT', '/api/parent/settings', (req, res, c) => {
    requireParent(req);
    applySettings(c.body || {});
    if (c.body && c.body.newPin !== undefined) {
      const pin = clean(c.body.newPin, 8);
      if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'The PIN must be 4 to 8 digits');
      const salt = crypto.randomBytes(8).toString('hex');
      state.settings.pin = { salt, hash: hashPin(pin, salt) };
    }
    store.scheduleSave(500);
    return { ok: true, settings: state.settings };
  });

  route('POST', '/api/parent/children', (req, res, c) => {
    requireParent(req);
    const name = clean(c.body.name, 30);
    if (!name) throw new HttpError(400, 'Give the child a name');
    if (state.children.length >= 8) throw new HttpError(400, 'Eight children is the most this calendar can hold');
    const ch = { id: uid(), name, list: { default: 'nice', days: {} }, opened: {}, wishes: [], letters: [], found: {}, badges: {} };
    state.children.push(ch);
    store.scheduleSave(500);
    return { ok: true, child: publicChild(ch) };
  });

  route('PUT', '/api/parent/children/:id', (req, res, c) => {
    requireParent(req);
    const ch = childOf(c.params.id);
    if (!ch) throw new HttpError(404, 'No such child');
    const b = c.body || {};
    if (b.name !== undefined) { const n = clean(b.name, 30); if (n) ch.name = n; }
    if (b.list && typeof b.list === 'object') {
      ch.list = ch.list || { default: 'nice', days: {} };
      if (b.list.default === 'nice' || b.list.default === 'naughty') ch.list.default = b.list.default;
      if (b.list.days && typeof b.list.days === 'object') {
        for (const [k, v] of Object.entries(b.list.days)) {
          if (!/^12-(0[1-9]|[12]\d|3[01])$/.test(k)) continue;
          if (v === 'nice' || v === 'naughty') ch.list.days[k] = v; else delete ch.list.days[k];
        }
      }
    }
    if (b.resetDoors) ch.opened = {};
    if (b.clearWishes) ch.wishes = [];
    if (b.clearLetters) ch.letters = [];
    store.scheduleSave(500);
    return { ok: true };
  });

  route('POST', '/api/parent/children/:id/remove', (req, res, c) => {
    requireParent(req);
    if (state.children.length <= 1) throw new HttpError(400, 'Keep at least one child');
    state.children = state.children.filter((x) => x.id !== c.params.id);
    store.scheduleSave(500);
    return { ok: true };
  });

  // ---------- http plumbing ----------
  const pubDir = path.join(__dirname, 'public');
  function send(res, status, body, headers = {}) {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
    res.end(data);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let s = '';
      req.on('data', (ch) => { s += ch; if (s.length > 64 * 1024) { reject(new HttpError(413, 'Too big')); req.destroy(); } });
      req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(new HttpError(400, 'Bad JSON')); } });
      req.on('error', reject);
    });
  }
  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.normalize(path.join(pubDir, rel));
    if (!file.startsWith(pubDir)) return send(res, 404, { error: 'Not found' });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        if (!path.extname(rel)) return serveStatic(req, res, '/');
        return send(res, 404, { error: 'Not found' });
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : (ext === '.jpg' || ext === '.woff2') ? 'public, max-age=604800, immutable' : 'public, max-age=3600',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/healthz') {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
        return serveStatic(req, res, url.pathname);
      }
      if (req.method !== 'GET') {
        if (req.headers['x-advent'] !== '1') throw new HttpError(403, 'Bad request');
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Bad origin');
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const body = req.method === 'GET' ? {} : await readBody(req);
        const out = await r.fn(req, res, { params: m.groups || {}, query: url.searchParams, body });
        return send(res, 200, out);
      }
      throw new HttpError(404, 'Not found');
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      send(res, status, { error: status === 500 ? 'Something went wrong' : e.message });
    }
  });
  server.requestTimeout = 30000;

  let backupTimer = null;
  function start(port = Number(process.env.PORT) || 3981, host = '0.0.0.0') {
    return new Promise((resolve) => {
      server.listen(port, host, () => {
        store.backupDaily();
        backupTimer = setInterval(() => store.backupDaily(), 6 * 3600 * 1000);
        if (backupTimer.unref) backupTimer.unref();
        console.log('Advent Calendar ' + VERSION + ' listening on :' + port);
        resolve(server.address());
      });
    });
  }
  function stop() {
    clearInterval(backupTimer);
    try { store.saveNow(); } catch (e) { /* ignore */ }
    return new Promise((resolve) => server.close(() => resolve()));
  }
  return { server, state, store, start, stop, adventDay, listStatus };
}

if (require.main === module) {
  const app = createApp();
  app.start();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.stop().then(() => process.exit(0)));
}

module.exports = { createApp, DAYS, THEMES };
