'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');

const { sanitize, empty } = require('./lib/userdoc');
const { Settings } = require('./lib/settings');
const { Verifier } = require('./lib/verify');
const ask = require('./lib/ask');
const site = require('./lib/site');
const { ImageBuilder } = require('./lib/image');

const VERSION = require('../package.json').version;
const DATA_FILES = new Set(['kjv.json', 'web.json', 'xref.json', 'strongs.json', 'timeline.json', 'plans.json', 'manifest.json', 'onchain.json']);

// ---- tiny per-IP rate limiter (the Umbrel gateway sets X-Forwarded-For, so req.ip is the real client)
function limiter(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' });
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    next();
  };
}

class UserStore {
  constructor(dir) {
    this.file = path.join(dir, 'user.json');
    try { this.doc = sanitize(JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { this.doc = empty(); }
  }
  get() { return this.doc; }
  put(incoming) {
    const next = sanitize(incoming);
    next.rev = this.doc.rev + 1;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next));
    fs.renameSync(tmp, this.file);
    this.doc = next;
    return next;
  }
}

function createApp({ dataDir, publicDir, appDataDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const settings = new Settings(dataDir);
  const store = new UserStore(dataDir);
  const verifier = new Verifier({ dataDir, appDataDir, getSettings: () => settings.get() });
  const images = new ImageBuilder({ dataDir, publicDir, appDataDir, version: VERSION });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });

  // Browsers can't send a custom header cross-site without permission, so this blocks drive-by posts from other websites.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-bt') !== '1') return res.status(403).json({ error: 'Forbidden.' });
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '3mb' }));

  app.get('/config.js', (req, res) => {
    res.type('js').set('Cache-Control', 'no-cache').send('window.BT = ' + JSON.stringify({ static: false, version: VERSION }) + ';\n');
  });

  // ---- data files, gzipped once and kept in memory
  const gzCache = new Map();
  app.get('/data/:file', (req, res, next) => {
    const f = req.params.file;
    if (!DATA_FILES.has(f)) return next();
    const p = path.join(appDataDir, f);
    if (!fs.existsSync(p)) return res.status(404).end();
    const st = fs.statSync(p);
    const etag = `"${VERSION}-${st.size}-${Math.floor(st.mtimeMs)}"`;
    res.set({ ETag: etag, 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' });
    if (req.get('if-none-match') === etag) return res.status(304).end();
    if (/\bgzip\b/.test(req.get('accept-encoding') || '')) {
      let buf = gzCache.get(f);
      if (!buf || buf.etag !== etag) { buf = zlib.gzipSync(fs.readFileSync(p), { level: 9 }); buf.etag = etag; gzCache.set(f, buf); }
      res.set('Content-Encoding', 'gzip');
      return res.send(buf);
    }
    res.sendFile(p);
  });

  // ---- your notes, bookmarks, highlights, plans and flashcards
  app.get('/api/user', (req, res) => res.json(store.get()));
  app.put('/api/user', (req, res) => {
    const incoming = req.body || {};
    if (Number(incoming.rev) !== store.get().rev) return res.status(409).json({ error: 'Changed on another device.', doc: store.get() });
    res.json(store.put(incoming));
  });

  // ---- settings
  app.get('/api/settings', (req, res) => res.json(settings.publicView()));
  app.put('/api/settings', (req, res) => {
    try { res.json(settings.update(req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ---- verify against Bitcoin
  app.get('/api/verify', (req, res) => res.json(verifier.status()));
  app.post('/api/verify/start', limiter(6, 60_000), (req, res) => res.json(verifier.start()));

  // ---- ask (local model)
  app.get('/api/ask/models', limiter(30, 60_000), async (req, res) => {
    const { baseUrl } = settings.get().ollama;
    if (!baseUrl) return res.status(400).json({ error: 'Enter the address of your Ollama first.' });
    try { res.json({ models: await ask.listModels(baseUrl) }); }
    catch (e) { res.status(502).json({ error: 'Could not reach Ollama at that address: ' + (e.cause && e.cause.code || e.message) }); }
  });
  app.post('/api/ask', limiter(20, 60_000), (req, res) => {
    const { baseUrl, model } = settings.get().ollama;
    if (!baseUrl || !model) return res.status(400).json({ error: 'Set up your Ollama address and model in Settings first.' });
    let input;
    try { input = ask.validate(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
    ask.streamAnswer({ baseUrl, model }, input, req, res);
  });

  // ---- Pi hotspot
  const siteArgs = opts => ({ publicDir, dataDir: appDataDir, opts, version: VERSION });
  app.post('/api/hotspot/zip', limiter(10, 60_000), (req, res) => {
    let opts;
    try { opts = site.validateOptions(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
    const zip = site.manualZip(siteArgs(opts));
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="bible-terminal-hotspot-files.zip"' }).send(zip);
  });
  app.get('/api/hotspot/image', (req, res) => res.json(images.status()));
  app.post('/api/hotspot/image/start', limiter(4, 60_000), async (req, res) => {
    let opts;
    try { opts = site.validateOptions(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
    try { res.json(await images.start(opts)); } catch (e) { res.status(409).json({ error: e.message }); }
  });
  app.get('/api/hotspot/image/download/:name', (req, res) => {
    const p = images.outputPath(req.params.name);
    if (!p) return res.status(404).json({ error: 'No such file.' });
    res.download(p, req.params.name);
  });

  app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION }));

  app.get('/package.json', (req, res) => res.status(404).end()); // present only so the browser modules load as ESM
  app.use(express.static(publicDir, { index: 'index.html', maxAge: 0, etag: true, dotfiles: 'ignore', setHeaders: res => res.set('Cache-Control', 'no-cache') }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too large to save.' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
    console.error('request error:', err && err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong.' });
  });

  return { app, settings, store, verifier, images };
}

function dropPrivileges(dir) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    fs.mkdirSync(dir, { recursive: true });
    try { fs.chownSync(dir, 1000, 1000); } catch (e) { console.error('could not chown data dir:', e.message); }
    process.setgid(1000);
    process.setuid(1000);
  }
}

if (require.main === module) {
  process.on('uncaughtException', e => console.error('uncaught:', e));
  process.on('unhandledRejection', e => console.error('unhandled:', e));
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'var'));
  dropPrivileges(DATA_DIR);
  const { app } = createApp({ dataDir: DATA_DIR, publicDir: path.join(__dirname, '..', 'public'), appDataDir: path.join(__dirname, '..', 'data') });
  app.listen(PORT, '0.0.0.0', () => console.log(`Bible Terminal ${VERSION} listening on ${PORT}`));
}

module.exports = { createApp, limiter };
