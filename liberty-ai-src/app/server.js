'use strict';
// Liberty AI: a Home Server Doctor and "ask anything" assistant for your Umbrel.
// Zero runtime dependencies. READ-ONLY: it looks at your server, apps and chosen folders;
// it has no code path that changes any of them.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { Store } = require('./lib/store');
const { Docker } = require('./lib/docker');
const { Doctor, analyze, score, sampleOf } = require('./lib/doctor');
const providers = require('./lib/providers');
const { Index, listDirs, resolveInRoot, cleanRel } = require('./lib/indexer');
const { Connectors } = require('./lib/connectors');
const catalog = require('./lib/catalog');
const ctxLib = require('./lib/context');
const cfg = require('./lib/config');
const { makeGuard } = require('./lib/guard');
const { sendNtfy, pickAlerts } = require('./lib/notify');
const { cleanText, HttpError, isLocalUrl, fmtDuration } = require('./lib/util');
const demoLib = require('./lib/demo');
const VERSION = require('./package.json').version;

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
};
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

const MAX_CHATS = 40;
const MAX_MSGS = 80;
const MAX_AUDIT = 200;
const KEEP_PROMPTS = 20;

function createApp(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || '/data';
  const storageDir = opts.storageDir || process.env.STORAGE_DIR || '/files';
  const demo = opts.demo !== undefined ? opts.demo : process.env.LIBERTY_DEMO === '1';
  const fetchImpl = opts.fetchImpl || (demo ? demoLib.demoFetch() : fetch);
  fs.mkdirSync(dataDir, { recursive: true });
  const startedAt = Date.now();

  // ---------- state ----------
  const store = new Store(dataDir, 'state.json');
  const loaded = store.load() || {};
  const state = {
    v: 1,
    settings: Object.assign(cfg.defaults(), loaded.settings || {}),
    chats: loaded.chats || [],
    audit: loaded.audit || [],
    history: loaded.history || [],
    alerts: loaded.alerts || {},
    custom: loaded.custom || [],
  };
  // fill in any settings added by newer versions
  const d0 = cfg.defaults();
  for (const k of Object.keys(d0)) if (state.settings[k] === undefined) state.settings[k] = d0[k];
  // 0.4: the storage root now holds Home (the Files app) and Storage side by side.
  state.settings.folders = state.settings.folders.map((f) => {
    try { if (!fs.existsSync(path.join(storageDir, f)) && fs.existsSync(path.join(storageDir, 'Storage', f))) return 'Storage/' + f; } catch (e) { /* keep */ }
    return f;
  });
  if (!state.settings.kiwix) state.settings.kiwix = { url: '' };
  if (!state.settings.sources.library) state.settings.sources.library = { enabled: true, cloud: true };
  // 0.2: lighter defaults for people who installed 0.1 (Doctor off, small prompts).
  if (!state.settings.light) {
    state.settings.light = true;
    state.settings.doctorOn = false;
    state.settings.sources.health.enabled = false;
    state.settings.sources.health.cloud = false;
    const o = state.settings.ollama;
    o.numCtx = Math.min(o.numCtx || 4096, 4096);
    o.numPredict = o.numPredict || 400;
    o.keepAlive = '2m';
  }
  for (const k of Object.keys(d0.sources)) if (!state.settings.sources[k]) state.settings.sources[k] = d0.sources[k];
  store.attach(() => state);
  const secrets = new cfg.Secrets(dataDir);

  // ---------- parts ----------
  let docker = null;
  if (demo) docker = new demoLib.FakeDocker();
  else if (opts.docker !== undefined) docker = opts.docker;
  else docker = new Docker(process.env.DOCKER_SOCKET || '/var/run/docker.sock');

  const doctor = new Doctor({
    docker,
    roots: opts.roots || { proc: '/proc', sys: '/sys', disks: [{ name: 'Storage', path: fs.existsSync(path.join(storageDir, 'Storage')) ? path.join(storageDir, 'Storage') : storageDir }, { name: 'System', path: dataDir }] },
    sysFn: demo ? demoLib.demoSystem() : opts.sysFn,
  });
  const index = new Index({ root: storageDir, file: path.join(dataDir, 'index.json') });
  index.load();
  // The built-in starter library ships with the app (public-domain books). Read-only, indexed once.
  const libDir = opts.libDir || process.env.LIBRARY_DIR || path.join(__dirname, 'library');
  const { Kiwix } = require('./lib/kiwix');
  const kiwix = new Kiwix({ fetchImpl, getUrl: () => state.settings.kiwix && state.settings.kiwix.url });
  const lib = new Index({ root: libDir, file: path.join(dataDir, 'library-index.json'), maxChunksPerDoc: 8000, weights: { '02 Bible': 0.3, '10 Faith and History': 0.6, '11 Kids': 0.5 } });
  lib.load();
  const libCats = () => { try { return fs.readdirSync(libDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch (e) { return []; } };
  const connectors = new Connectors(fetchImpl);
  const guard = makeGuard({ proxyHost: opts.proxyHost !== undefined ? opts.proxyHost : process.env.PROXY_HOST, disabled: opts.noGuard !== undefined ? opts.noGuard : (demo || process.env.LIBERTY_NO_GUARD === '1') });

  if (demo) {
    fs.mkdirSync(storageDir, { recursive: true });
    demoLib.seedStorage(storageDir);
    if (!state.settings.folders.length) state.settings.folders = ['Documents', 'Prepping'];
    if (!Object.keys(state.settings.appsOn).length) state.settings.appsOn = { 'patriot-rally-point': true, 'patriot-coldfront': true, 'patriot-zerodollar': true };
    state.settings.provider = 'ollama';
  }

  const makeProvider = () => {
    if (demo) return demoLib.demoProvider();
    if (opts.providerFactory) return opts.providerFactory(state.settings, secrets.get());
    return providers.create(state.settings, secrets.get(), fetchImpl);
  };

  // ---------- health cache + sampler ----------
  let health = null; // { at, snap, findings, score, trend }
  let healthPromise = null;
  let sampleTimer = null;
  let stopped = false;

  function trendLine(now) {
    const day = state.history.filter((s) => now - s.t <= 24 * 3600e3);
    if (day.length < 3) return '';
    const num = (k) => day.map((s) => s[k]).filter((v) => typeof v === 'number');
    const mem = num('mem');
    const disk = num('disk');
    const down = num('down');
    const bits = [];
    if (mem.length) bits.push('memory ' + Math.min(...mem) + '-' + Math.max(...mem) + '%');
    if (disk.length) bits.push('storage disk ' + disk[0] + '% -> ' + disk[disk.length - 1] + '%');
    if (down.length && Math.max(...down) > 0) bits.push('up to ' + Math.max(...down) + ' app(s) not running');
    const sc = num('score');
    if (sc.length) bits.push('health score ' + Math.min(...sc) + '-' + Math.max(...sc));
    return 'Last 24 hours (' + day.length + ' checks): ' + bits.join('; ') + '.';
  }

  async function refreshHealth(force = false) {
    const now = Date.now();
    if (!force && health && now - health.at < 20000) return health;
    if (healthPromise) return healthPromise;
    healthPromise = (async () => {
      const snap = await doctor.snapshot({ stats: true });
      const findings = analyze(snap);
      health = { at: Date.now(), snap, findings, score: score(findings), trend: '' };
      health.trend = trendLine(health.at);
      return health;
    })().finally(() => { healthPromise = null; });
    return healthPromise;
  }

  async function runSample() {
    try {
      const h = await refreshHealth(true);
      state.history.push(sampleOf(h.snap, h.findings));
      if (state.history.length > 2200) state.history.splice(0, state.history.length - 2200);
      const fresh = pickAlerts(h.findings, state.alerts, state.settings.ntfy.minSeverity, Date.now());
      for (const f of fresh.slice(0, 3)) await sendNtfy(state.settings.ntfy, 'Liberty AI: ' + f.title, f.detail, fetchImpl);
      store.scheduleSave(2000);
    } catch (e) { console.error('sample failed:', e.message); }
  }

  function loopSample(firstMs) {
    clearTimeout(sampleTimer);
    if (stopped) return;
    if (!state.settings.doctorOn) return;
    sampleTimer = setTimeout(async () => {
      await runSample();
      loopSample(state.settings.checkIntervalMin * 60 * 1000);
    }, firstMs);
    if (sampleTimer.unref) sampleTimer.unref();
  }

  // ---------- apps ----------
  function listApps() {
    const custom = state.custom.map((c) => ({ id: c.id, name: c.name, port: 0, host: null, widgets: [], keywords: [c.name.toLowerCase()], custom: true, url: c.url, reachable: true, blurb: 'Custom connector', sensitive: false }));
    return catalog.PATRIOT.concat(custom);
  }
  const knownIds = () => listApps().map((a) => a.id);
  const readApp = (app) => (app.custom ? connectors.readCustom(app) : connectors.read(app));

  function appsView() {
    const snapApps = (health && health.snap.apps) || [];
    const byId = new Map(snapApps.map((a) => [a.id, a]));
    const out = [];
    for (const a of listApps()) {
      const run = byId.get(a.id);
      out.push({
        id: a.id, name: a.name, patriot: !a.custom, custom: !!a.custom, blurb: a.blurb, port: a.port, url: a.url || null, sensitive: a.sensitive,
        installed: a.custom ? true : !!run,
        state: run ? run.state : a.custom ? 'custom' : 'not installed',
        version: run ? run.version : null,
        mem: run ? run.mem : null, cpu: run ? run.cpu : null,
        connector: a.custom ? 'custom' : !a.reachable ? 'host' : a.widgets.length ? 'widgets' : 'none',
        enabled: !!state.settings.appsOn[a.id],
      });
    }
    const others = snapApps.filter((a) => !a.patriot);
    for (const a of others) out.push({ id: a.id, name: a.name, patriot: false, custom: false, blurb: '', port: 0, installed: true, state: a.state, version: a.version, mem: a.mem, cpu: a.cpu, connector: 'none', enabled: false, other: true });
    return out;
  }

  // ---------- chat helpers ----------
  const newId = () => crypto.randomBytes(6).toString('hex');

  function sessionOf(id) { return state.chats.find((c) => c.id === id) || null; }

  function cleanHistory(msgs) {
    const out = [];
    for (const m of msgs) {
      if (!m.content || !String(m.content).trim()) continue;
      const last = out[out.length - 1];
      if (last && last.role === m.role) last.content += '\n\n' + m.content;
      else out.push({ role: m.role, content: String(m.content) });
    }
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
  }

  function pushAudit(entry) {
    state.audit.unshift(entry);
    if (state.audit.length > MAX_AUDIT) state.audit.length = MAX_AUDIT;
    state.audit.forEach((a, i) => { if (i >= KEEP_PROMPTS && a.prompt) a.prompt = null; });
  }

  // ---------- routes ----------
  const routes = [];
  function route(method, p, handler, o = {}) {
    routes.push({ method, parts: p.split('/').filter(Boolean), handler, open: !!o.open, limit: o.limit });
  }

  function readMemory() {
    if (demo) return { availGB: 1.7, swapPct: 61 };
    try {
      const t = fs.readFileSync('/proc/meminfo', 'utf8');
      const g = (k) => { const m = new RegExp('^' + k + ':\\s+(\\d+)', 'm').exec(t); return m ? Number(m[1]) : 0; };
      const swapT = g('SwapTotal');
      return { availGB: Math.round((g('MemAvailable') / 1048576) * 10) / 10, swapPct: swapT ? Math.round(((swapT - g('SwapFree')) / swapT) * 100) : 0 };
    } catch (e) { return null; }
  }
  const publicSettings = () => Object.assign({}, state.settings, { keys: secrets.has() });

  route('GET', '/healthz', () => ({ ok: true, version: VERSION }), { open: true });

  route('GET', '/api/state', async () => {
    if (!health && state.settings.doctorOn) refreshHealth(false).catch(() => {});
    const provider = makeProvider();
    const guardState = await guard.status();
    return {
      version: VERSION, demo, now: Date.now(), uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      settings: publicSettings(),
      provider: { kind: provider.kind, label: provider.label, cloud: provider.cloud, model: provider.model || '' },
      guard: guardState,
      docker: docker ? await docker.available() : false,
      health: health ? { at: health.at, score: health.score, crit: health.findings.filter((f) => f.sev === 'crit').length, warn: health.findings.filter((f) => f.sev === 'warn').length } : null,
      files: Object.assign({ root: storageDir }, index.stats()),
      library: lib.stats(),
      memory: readMemory(),
    };
  });

  route('GET', '/api/health', async (req, res, c) => {
    const h = await refreshHealth(c.query.get('fresh') === '1');
    return { at: h.at, score: h.score, findings: h.findings, snap: h.snap, trend: h.trend };
  });

  route('GET', '/api/history', () => ({ samples: state.history.slice(-600) }));

  route('GET', '/api/apps', async () => {
    if (!health) await refreshHealth(false);
    return { apps: appsView() };
  });

  route('GET', '/api/apps/:id/data', async (req, res, c) => {
    const app = listApps().find((a) => a.id === c.params.id);
    if (!app) throw new HttpError(404, 'Unknown app');
    if (!state.settings.appsOn[app.id]) throw new HttpError(403, 'Liberty AI is not allowed to read this app. Turn it on first.');
    return await readApp(app);
  });

  route('PUT', '/api/settings', (req, res, c) => {
    state.settings = cfg.validate(c.body, state.settings, knownIds());
    store.scheduleSave(500);
    loopSample(state.settings.doctorOn ? 3000 : state.settings.checkIntervalMin * 60 * 1000);
    return { ok: true, settings: publicSettings() };
  });

  route('PUT', '/api/secrets', (req, res, c) => {
    secrets.set(c.body);
    return { ok: true, keys: secrets.has() };
  });

  route('GET', '/api/models', async () => {
    const provider = makeProvider();
    try { return { models: await provider.models(), provider: provider.kind }; } catch (e) { throw e instanceof HttpError ? e : new HttpError(502, String(e.message || e)); }
  });

  route('POST', '/api/custom', (req, res, c) => {
    const name = cleanText(c.body.name, 40);
    const url = cleanText(c.body.url, 300);
    if (!name) throw new HttpError(400, 'Give the connector a name');
    if (!isLocalUrl(url)) throw new HttpError(400, 'Use an address on your home network, like http://myapp_web_1:3000/widgets/status');
    if (state.custom.length >= 12) throw new HttpError(400, 'That is plenty of connectors for now');
    const item = { id: 'custom-' + newId(), name, url };
    state.custom.push(item);
    store.scheduleSave(500);
    return { ok: true, id: item.id };
  });

  route('POST', '/api/custom/remove', (req, res, c) => {
    state.custom = state.custom.filter((x) => x.id !== c.body.id);
    delete state.settings.appsOn[c.body.id];
    connectors.clearCache();
    store.scheduleSave(500);
    return { ok: true };
  });

  // ----- files -----
  route('GET', '/api/files', () => ({
    root: storageDir,
    folders: index.perFolder(state.settings.folders),
    status: index.status,
    stats: index.stats(),
    pdf: index.hasPdf,
  }));

  route('GET', '/api/library', () => {
    const cats = libCats().map((name) => {
      const docs = Array.from(lib.docs.values()).filter((d) => d.folder === name);
      return { name, label: name.replace(/^\d+\s*/, ''), docs: docs.map((d) => d.rel.split('/').pop().replace(/\.txt$/, '')).sort(), chunks: docs.reduce((n, d) => n + d.chunks.length, 0) };
    });
    return { categories: cats, status: lib.status, stats: lib.stats() };
  });

  route('POST', '/api/kiwix/test', async () => {
    if (!state.settings.kiwix.url) throw new HttpError(400, 'Enter your Kiwix address first');
    try { const b = await kiwix.listBooks(true); return { ok: true, books: b.map((x) => x.title) }; }
    catch (e) { throw new HttpError(502, 'Could not reach Kiwix: ' + e.message); }
  });

  route('GET', '/api/fs', async (req, res, c) => {
    const r = await listDirs(storageDir, c.query.get('path') || '');
    if (!r) throw new HttpError(404, 'Folder not found');
    return r;
  });

  route('POST', '/api/files/folders', async (req, res, c) => {
    const r = await resolveInRoot(storageDir, c.body.path);
    if (!r || !r.rel) throw new HttpError(400, 'Pick a folder inside your storage');
    if (state.settings.folders.includes(r.rel)) return { ok: true };
    if (state.settings.folders.length >= 20) throw new HttpError(400, 'That is plenty of folders for now');
    state.settings.folders.push(r.rel);
    store.scheduleSave(500);
    index.scan(state.settings.folders).catch(() => {});
    return { ok: true };
  });

  route('POST', '/api/files/remove', (req, res, c) => {
    const rel = cleanRel(c.body.path);
    state.settings.folders = state.settings.folders.filter((f) => f !== rel);
    index.forgetFolder(rel);
    store.scheduleSave(500);
    return { ok: true };
  });

  route('POST', '/api/files/scan', () => {
    if (index.status.running) return { started: false };
    index.scan(state.settings.folders).catch(() => {});
    return { started: true };
  });
  route('POST', '/api/files/cancel', () => { index.cancel(); return { ok: true }; });
  route('POST', '/api/files/clear', () => { index.clear(); return { ok: true }; });

  route('GET', '/api/files/search', (req, res, c) => {
    const q = cleanText(c.query.get('q') || '', 300);
    const mine = q ? index.search(q, { k: 8 }).map((h) => Object.assign({}, h, { lib: false, text: h.text.slice(0, 500) })) : [];
    const theirs = q ? lib.search(q, { k: 8 }).map((h) => Object.assign({}, h, { lib: true, text: h.text.slice(0, 500) })) : [];
    return { hits: mine.concat(theirs).sort((a, b) => b.score - a.score).slice(0, 10) };
  });

  // ----- chats -----
  route('GET', '/api/chats', () => ({
    chats: state.chats.map((c) => ({ id: c.id, title: c.title, mode: c.mode, updated: c.updated, count: c.messages.length })).sort((a, b) => b.updated - a.updated),
  }));
  route('GET', '/api/chats/:id', (req, res, c) => {
    const s = sessionOf(c.params.id);
    if (!s) throw new HttpError(404, 'Chat not found');
    return s;
  });
  route('POST', '/api/chats/remove', (req, res, c) => {
    state.chats = state.chats.filter((x) => x.id !== c.body.id);
    store.scheduleSave(500);
    return { ok: true };
  });
  route('POST', '/api/chats/clear', () => { state.chats = []; store.scheduleSave(500); return { ok: true }; });

  // ----- audit -----
  route('GET', '/api/audit', () => ({ entries: state.audit.map((a) => Object.assign({}, a, { prompt: undefined, hasPrompt: !!a.prompt })) }));
  route('GET', '/api/audit/:id', (req, res, c) => {
    const a = state.audit.find((x) => x.id === c.params.id);
    if (!a) throw new HttpError(404, 'Not found');
    return a;
  });
  route('POST', '/api/audit/clear', () => { state.audit = []; store.scheduleSave(500); return { ok: true }; });

  route('POST', '/api/notify-test', async () => {
    const n = state.settings.ntfy;
    if (!n.enabled || !n.topic) throw new HttpError(400, 'Turn on notifications and save a topic first');
    const ok = await sendNtfy(n, 'Liberty AI test', 'Notifications are working.', fetchImpl);
    if (!ok) throw new HttpError(502, 'Could not reach the notification server');
    return { ok: true };
  });

  route('POST', '/api/health/check', async () => { await runSample(); return { ok: true }; });

  // ----- the chat itself (streams Server-Sent Events) -----
  route('POST', '/api/chat', async (req, res, c) => {
    const message = cleanText(c.body.message, 4000);
    if (!message) throw new HttpError(400, 'Type a question first');
    const mode = c.body.mode === 'doctor' ? 'doctor' : 'chat';
    const provider = makeProvider();
    if (state.settings.localOnly && provider.cloud) throw new HttpError(400, 'Local-only mode is on, but the selected AI is a cloud service. Choose a local AI or turn off Local-only mode in Settings.');

    let session = c.body.chatId ? sessionOf(c.body.chatId) : null;
    if (!session) {
      session = { id: newId(), title: message.slice(0, 60), mode, created: Date.now(), updated: Date.now(), messages: [] };
      state.chats.unshift(session);
      if (state.chats.length > MAX_CHATS) state.chats.length = MAX_CHATS;
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const emit = (ev, data) => { try { res.write('event: ' + ev + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* client gone */ } };
    const ac = new AbortController();
    res.on('close', () => ac.abort());

    const audit = { id: newId(), t: Date.now(), mode, provider: provider.label, model: provider.model || '', cloud: provider.cloud, question: message.slice(0, 200), sources: [], blocked: [], chars: 0, prompt: null, reply: 0, error: null };
    try {
      const focus = c.body.focus && typeof c.body.focus === 'object' ? { id: cleanText(c.body.focus.id, 80), container: cleanText(c.body.focus.container, 120) } : null;
      const ctx = await ctxLib.build({
        question: message, mode, focus, settings: state.settings, provider,
        deps: {
          getHealth: () => refreshHealth(false),
          logsFor: (names, tail) => doctor.logsFor(names, tail),
          readApp,
          listApps,
          index,
          library: lib,
          kiwix,
        },
      });
      emit('meta', { chatId: session.id, provider: provider.label, model: provider.model || '', cloud: provider.cloud });
      emit('sources', { sources: ctx.sources.map((s) => ({ n: s.n, kind: s.kind, label: s.label, bytes: s.bytes, path: s.path, appId: s.appId, excerpt: s.text.slice(0, 600) })), blocked: ctx.blocked });

      const history = cleanHistory(session.messages.slice(-10).map((m) => ({ role: m.role, content: m.content })));
      const messages = cleanHistory(history.concat([{ role: 'user', content: message }]));
      audit.sources = ctx.sources.map((s) => ({ n: s.n, kind: s.kind, label: s.label, bytes: s.bytes }));
      audit.blocked = ctx.blocked;
      audit.chars = ctx.system.length + messages.reduce((a, m) => a + m.content.length, 0);
      audit.prompt = 'SYSTEM\n' + ctx.system + '\n\n' + messages.map((m) => m.role.toUpperCase() + '\n' + m.content).join('\n\n');

      session.messages.push({ role: 'user', content: message, t: Date.now() });
      const out = await provider.chat({ system: ctx.system, messages, signal: ac.signal, onToken: (t) => emit('token', { t }) });
      audit.reply = out.text.length;
      audit.usage = out.usage || null;
      session.messages.push({
        role: 'assistant', content: out.text, t: Date.now(), provider: provider.label, model: provider.model || '',
        sources: ctx.sources.map((s) => ({ n: s.n, kind: s.kind, label: s.label, path: s.path, appId: s.appId, excerpt: s.text.slice(0, 600) })), blocked: ctx.blocked,
      });
      if (session.messages.length > MAX_MSGS) session.messages.splice(0, session.messages.length - MAX_MSGS);
      session.updated = Date.now();
      emit('done', { chatId: session.id, usage: out.usage || null });
    } catch (e) {
      if (e && e.name === 'AbortError') { audit.error = 'Stopped'; }
      else {
        audit.error = String((e && e.message) || e).slice(0, 200);
        emit('error', { error: e instanceof HttpError ? e.message : 'Something went wrong talking to the AI. ' + String((e && e.message) || '').slice(0, 120) });
        // drop the unanswered question so the history stays tidy
        const last = session.messages[session.messages.length - 1];
        if (last && last.role === 'user') session.messages.pop();
      }
    } finally {
      pushAudit(audit);
      store.scheduleSave(1500);
      try { res.end(); } catch (e) { /* ignore */ }
    }
    return null;
  }, { limit: 32 * 1024 });

  // ---------- http plumbing ----------
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const len = Number(req.headers['content-length'] || 0);
      if (len > limit) return reject(new HttpError(413, 'Request too large'));
      const chunks = [];
      let size = 0;
      req.on('data', (ch) => {
        size += ch.length;
        if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
        chunks.push(ch);
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
    const rel = pathname === '/' ? '/index.html' : pathname;
    let file;
    try { file = path.normalize(path.join(PUBLIC, decodeURIComponent(rel))); } catch (e) { return send(res, 400, { error: 'Bad path' }); }
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        if (!path.extname(rel)) return serveStatic(req, res, '/');
        return send(res, 404, { error: 'Not found' });
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, { error: 'Bad request' }); }

    if (!(await guard.check(req))) return send(res, 403, { error: 'Open Liberty AI from your Umbrel dashboard.' });

    if (!url.pathname.startsWith('/api/') && url.pathname !== '/healthz') {
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

      let body = {};
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.headers['x-la-request'] !== '1') throw new HttpError(403, 'Missing request header');
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
      if (out === null) return;
      send(res, 200, out);
    } catch (e) {
      const st = e.status || 500;
      if (st >= 500 && st !== 502) console.error(e);
      send(res, st, { error: st >= 500 && st !== 502 ? 'Server error' : e.message });
    }
  });
  server.requestTimeout = 0; // chat streams can run for minutes on slow local models
  server.headersTimeout = 15000;

  // ---------- lifecycle ----------
  function start(port) {
    return new Promise((resolve) => {
      server.listen(port === undefined ? Number(process.env.PORT || 3979) : port, opts.host || '0.0.0.0', async () => {
        store.backupDaily();
        loopSample(opts.firstSampleMs !== undefined ? opts.firstSampleMs : 4000);
        // keep the file index fresh once a day, and after a restart if folders exist
        if (!opts.noAutoScan) setTimeout(() => lib.scan(libCats()).catch(() => {}), 3000).unref();
        if (state.settings.folders.length && !opts.noAutoScan) setTimeout(() => index.scan(state.settings.folders).catch(() => {}), demo ? 200 : 8000).unref();
        resolve(server.address().port);
      });
    });
  }

  function stop() {
    stopped = true;
    clearTimeout(sampleTimer);
    index.cancel(); lib.cancel();
    try { store.saveNow(); } catch (e) { console.error('final save failed:', e.message); }
    return new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); });
  }

  return { server, state, store, index, doctor, start, stop, refreshHealth, runSample, makeProvider, secrets, guard, connectors };
}

if (require.main === module) {
  const app = createApp();
  app.start().then((p) => console.log('Liberty AI ' + VERSION + ' listening on :' + p + (process.env.LIBERTY_DEMO === '1' ? ' (demo mode)' : '')));
  const bye = () => { app.stop().then(() => process.exit(0)); };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
  process.on('uncaughtException', (e) => console.error('uncaught:', e));
  process.on('unhandledRejection', (e) => console.error('unhandled:', e));
}

module.exports = { createApp };
