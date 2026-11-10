'use strict';
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { Store } = require('./lib/store');
const { Engine } = require('./lib/engine');
const { ZWaveAdapter } = require('./lib/zwave');
const { Weather } = require('./lib/weather');
const { SimAdapter, seedDemoHistory } = require('./lib/sim');
const { summarize } = require('./lib/insights');
const { validateSchedule, wallSchedule, DAYS, clampPair, dateKey } = require('./lib/schedule');
const { filterStatus, filterAlert, validateFilter } = require('./lib/filter');
const { Notifier, TRIGGERS, validNtfy } = require('./lib/notify');

function createApp({ dataDir, zwaveUrl, now = () => Date.now(), simSpeed = 1, autoStart = true, notifyFetch } = {}) {
  const store = new Store(dataDir).load();
  const engine = new Engine(store, { now });
  const notifier = new Notifier(store, { now, fetchFn: notifyFetch, onLog: (t, m) => store.event(t, m, now()) });
  const publicSettings = () => { const s = JSON.parse(JSON.stringify(store.data.settings)); s.ntfy.hasToken = !!s.ntfy.token; delete s.ntfy.token; return s; };
  const sim = new SimAdapter({ now, speed: simSpeed });
  let live = null;
  const getLive = () => (live ||= new ZWaveAdapter({ url: zwaveUrl, thermostatNode: store.data.settings.thermostatNode }));
  let timer = null;

  function useAdapter() {
    const s = store.data.settings;
    if (s.mode === 'live' && zwaveUrl) {
      sim.stop();
      const z = getLive();
      z.setPreferredNode(s.thermostatNode);
      engine.setAdapter(z, { persist: true });
      if (autoStart) z.start();
    } else {
      live?.stop();
      engine.setAdapter(sim, { persist: false });
      engine.demoHist = seedDemoHistory({ sim, schedule: store.data.schedule, limits: s.limits, tz: s.tz, days: 7, endMs: now() });
      if (autoStart) sim.start();
    }
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));
  app.use('/api', express.json({ limit: '200kb' }));
  // Browsers cannot send application/json cross-site without a preflight, so requiring it blocks form-post CSRF.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'Send JSON' });
    next();
  });

  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Umbrel home-screen widget ("four-stats"). Umbrel fetches this from inside the app network, so it carries no login and only shows summary numbers.
  app.get('/api/widget/status', (req, res) => {
    const st = engine.state();
    const t = st.thermostat;
    const num = (v) => (v == null || Number.isNaN(Number(v)) ? '--' : String(Math.round(Number(v) * 10) / 10));
    const wet = (st.leaks || []).find((l) => l.wet);
    // no thermostat yet: show the first room sensor so the widget still says something useful
    const room = (st.sensors || []).find((r) => r.include !== false && r.temp != null) || (st.sensors || [])[0];
    const label = { heating: 'Heating', cooling: 'Cooling', fan: 'Fan', idle: 'Idle' };
    let target = '--';
    if (t) {
      if (t.mode === 'heat') target = num(t.heat);
      else if (t.mode === 'cool') target = num(t.cool);
      else if (t.mode === 'auto') target = `${num(t.heat)}-${num(t.cool)}`;
      else if (t.mode === 'off') target = 'Off';
    }
    const status = wet ? { title: 'ALERT', text: 'Water leak', subtext: wet.name }
      : !t ? { title: 'Status', text: 'No thermostat', subtext: st.adapter?.connected ? 'paired?' : 'not connected' }
      : { title: 'Status', text: label[t.opState] || 'Idle', subtext: st.hold ? 'hold' : st.away ? 'away' : t.mode };
    res.set('Cache-Control', 'no-store');
    res.json({
      type: 'four-stats',
      refresh: '30s', // umbreld reads this from the response itself, so it must be here
      link: '',
      items: [
        { title: t ? 'Indoor' : (room?.name || 'Indoor'), text: num(t ? t.temp : room?.temp), subtext: '°F' },
        { title: 'Target', text: target, subtext: t && t.mode !== 'off' ? '°F' : '' },
        status,
        { title: 'Humidity', text: (t ? t.humidity : room?.humidity) == null ? '--' : String(Math.round(t ? t.humidity : room.humidity)), subtext: '%' },
      ],
    });
  });

  // Second Umbrel widget ("text-with-progress", same card style as the built-in Storage widget): how used-up the furnace filter is.
  app.get('/api/widget/filter', (req, res) => {
    const f = filterStatus(store.data.settings.filter, now(), store.data.settings.tz);
    res.set('Cache-Control', 'no-store');
    if (!f.configured) return res.json({ type: 'text-with-progress', refresh: '60s', link: '', title: f.name, text: 'Not set', subtext: '', progressLabel: 'Add a change date in Cold Front', progress: 0 });
    const plural = (n) => `${n} day${n === 1 ? '' : 's'}`;
    res.json({
      type: 'text-with-progress',
      refresh: '60s',
      link: '',
      title: f.name,
      text: plural(Math.max(f.daysSince, 0)),
      subtext: `/ ${plural(f.intervalDays)}`,
      progressLabel: f.daysLeft < 0 ? `${plural(-f.daysLeft)} overdue` : f.daysLeft === 0 ? 'Due today' : `${plural(f.daysLeft)} left`,
      progress: Math.min(1, Math.max(0, f.daysSince / f.intervalDays)),
    });
  });

  app.get('/api/state', (req, res) => {
    const st = engine.state();
    const filter = filterStatus(store.data.settings.filter, now(), store.data.settings.tz);
    const fa = filterAlert(filter);
    if (fa) st.alerts.push(fa);
    res.json({ ...st, filter, settings: publicSettings(), triggers: TRIGGERS, rooms: store.data.rooms, zwaveConfigured: !!zwaveUrl, version: require('./package.json').version });
  });

  app.post('/api/filter/changed', (req, res) => {
    const d = req.body?.date || dateKey(new Date(now()), store.data.settings.tz);
    try { store.data.settings.filter = validateFilter({ lastChanged: d }, store.data.settings.filter); } catch (e) { return bad(res, e.message); }
    store.data.notifyState.filter = {};
    store.save();
    store.event('filter', `${store.data.settings.filter.name} changed (${d})`, now());
    res.json({ filter: filterStatus(store.data.settings.filter, now(), store.data.settings.tz) });
  });

  app.post('/api/ntfy/test', async (req, res) => {
    try { await notifier.send({ title: 'Cold Front test', message: 'If you can read this, notifications work.', tags: 'white_check_mark' }); res.json({ ok: true }); } catch (e) { bad(res, `Could not send: ${e.message}`, 502); }
  });

  app.post('/api/setpoints', (req, res) => {
    const heat = num(req.body.heat), cool = num(req.body.cool);
    if (heat == null || cool == null || Number.isNaN(heat) || Number.isNaN(cool)) return bad(res, 'heat and cool are required numbers');
    const until = req.body.until === 'next' ? 'next' : req.body.until == null ? null : Number(req.body.until);
    if (until !== null && until !== 'next' && !(until > 0)) return bad(res, 'until must be "next", hours, or null');
    res.json({ hold: engine.setHold({ heat, cool, until }) });
    engine.tick().catch(() => {});
  });

  app.delete('/api/hold', (req, res) => { engine.clearHold(); res.json({ ok: true }); engine.tick().catch(() => {}); });

  app.post('/api/away', (req, res) => {
    const { on, heat, cool, hours } = req.body || {};
    res.json({ away: engine.setAway({ on: !!on, heat: num(heat) ?? undefined, cool: num(cool) ?? undefined, hours: num(hours) || null }) });
    engine.tick().catch(() => {});
  });

  app.post('/api/mode', async (req, res) => {
    const m = req.body?.mode;
    if (!['off', 'heat', 'cool', 'auto'].includes(m)) return bad(res, 'mode must be off, heat, cool or auto');
    res.json({ ok: true, pending: true });
    engine.adapter.setMode(m).then(() => store.event('mode', `Mode set to ${m}`), (e) => store.event('error', `Could not set mode ${m}: ${e.message}`));
  });

  app.post('/api/fan', async (req, res) => {
    const f = req.body?.fan;
    if (!['auto', 'on'].includes(f)) return bad(res, 'fan must be auto or on');
    res.json({ ok: true, pending: true });
    engine.adapter.setFan(f).then(() => store.event('fan', `Fan set to ${f}`), (e) => store.event('error', `Could not set fan ${f}: ${e.message}`));
  });

  app.get('/api/schedule', (req, res) => res.json({ schedule: store.data.schedule, wall: wallSchedule(store.data.schedule) }));

  app.put('/api/schedule', (req, res) => {
    try {
      const sch = validateSchedule(req.body.schedule);
      const lim = store.data.settings.limits;
      // keep the schedule inside the safety limits so what you see is what gets sent
      for (const d of DAYS) sch.days[d] = sch.days[d].map((p) => { const c = clampPair(p.heat, p.cool, lim); return { ...p, heat: c.heat, cool: c.cool }; });
      store.data.schedule = sch;
      store.save();
      store.event('schedule', 'Schedule updated');
      engine._userChanged();
      res.json({ schedule: sch, wall: wallSchedule(sch) });
      engine.tick().catch(() => {});
    } catch (e) { bad(res, e.message); }
  });

  const weather = new Weather();
  app.get('/api/weather', async (req, res) => {
    const w = store.data.settings.weather;
    if (!w || w.lat == null) return res.json({ configured: false });
    try { res.json({ configured: true, ...(await weather.get(w)) }); } catch (e) { res.json({ configured: true, error: e.message }); }
  });
  app.get('/api/weather/search', async (req, res) => {
    try { res.json({ results: await weather.search(req.query.q) }); } catch (e) { bad(res, e.message, 502); }
  });

  app.put('/api/settings', (req, res) => {
    const b = req.body || {};
    const s = store.data.settings;
    const L = b.limits;
    if (L) {
      const l = { heatMin: num(L.heatMin), heatMax: num(L.heatMax), coolMin: num(L.coolMin), coolMax: num(L.coolMax), minGap: num(L.minGap) };
      if (Object.values(l).some((v) => v == null || Number.isNaN(v))) return bad(res, 'limits must be numbers');
      if (!(l.heatMin >= 40 && l.heatMax <= 90 && l.heatMin < l.heatMax && l.coolMin >= 60 && l.coolMax <= 95 && l.coolMin < l.coolMax && l.minGap >= 2 && l.minGap <= 10)) return bad(res, 'limits out of range (heat 40-90, cool 60-95, gap 2-10)');
      s.limits = l;
    }
    if (b.humidity) { const mn = num(b.humidity.min), mx = num(b.humidity.max); if (mn != null && mx != null && mn < mx && mn >= 0 && mx <= 100) s.humidity = { min: mn, max: mx }; else return bad(res, 'humidity range invalid'); }
    if (b.enforce !== undefined) s.enforce = !!b.enforce;
    if (b.wallChange !== undefined) { if (!['hold', 'revert'].includes(b.wallChange)) return bad(res, 'wallChange must be hold or revert'); s.wallChange = b.wallChange; }
    if (b.costPerHour !== undefined) { const c = num(b.costPerHour); if (c == null || Number.isNaN(c) || c < 0 || c > 50) return bad(res, 'costPerHour invalid'); s.costPerHour = c; }
    if (b.tz !== undefined) { try { new Intl.DateTimeFormat('en-US', { timeZone: b.tz }); s.tz = b.tz; } catch { return bad(res, 'unknown time zone'); } }
    if (b.filter) { try { s.filter = validateFilter(b.filter, s.filter); } catch (e) { return bad(res, e.message); } }
    if (b.ntfy) {
      const n = b.ntfy;
      try { validNtfy(n); } catch (e) { return bad(res, e.message); }
      if (n.enabled !== undefined) s.ntfy.enabled = !!n.enabled;
      if (n.server !== undefined) s.ntfy.server = String(n.server).trim();
      if (n.topic !== undefined) s.ntfy.topic = String(n.topic).trim();
      if (typeof n.token === 'string' && n.token.trim()) s.ntfy.token = n.token.trim().slice(0, 200);
      if (n.clearToken) s.ntfy.token = '';
      if (n.triggers && typeof n.triggers === 'object') for (const k of Object.keys(TRIGGERS)) if (k in n.triggers) s.ntfy.triggers[k] = !!n.triggers[k];
    }
    if (b.weather !== undefined) {
      if (b.weather === null) s.weather = { lat: null, lon: null, name: '' };
      else {
        const lat = num(b.weather.lat), lon = num(b.weather.lon);
        if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return bad(res, 'weather location must be a latitude and longitude');
        s.weather = { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, name: String(b.weather.name || '').trim().slice(0, 60) };
      }
    }
    if (b.name !== undefined) s.name = String(b.name).trim().slice(0, 30);
    if (b.dashboard !== undefined) {
      if (b.dashboard === null) s.dashboard = null;
      else {
        const d = b.dashboard, seen = new Set();
        if (!Array.isArray(d) || d.length > 24) return bad(res, 'dashboard must be a list of up to 24 widgets');
        for (const w of d) {
          if (!w || typeof w.id !== 'string' || !/^[a-z]{2,24}$/.test(w.id) || seen.has(w.id)) return bad(res, 'dashboard widget ids are invalid');
          if (typeof w.size !== 'string' || !/^[1-4]x[1-4]$/.test(w.size)) return bad(res, 'dashboard widget sizes are invalid');
          seen.add(w.id);
        }
        s.dashboard = d.map((w) => ({ id: w.id, size: w.size }));
      }
    }
    if (b.thermostatNode !== undefined) s.thermostatNode = b.thermostatNode ? Number(b.thermostatNode) : null;
    if (b.roomAware) {
      const r = b.roomAware;
      s.roomAware = { enabled: !!r.enabled, roomId: r.roomId ? String(r.roomId) : null, maxOffset: Math.min(5, Math.max(0, num(r.maxOffset) ?? 3)) };
      engine.offset = { heat: 0, cool: 0, at: 0 };
    }
    let switched = false;
    if (b.mode !== undefined) {
      if (!['demo', 'live'].includes(b.mode)) return bad(res, 'mode must be demo or live');
      if (b.mode === 'live' && !zwaveUrl) return bad(res, 'No Z-Wave JS server is configured for this install', 409);
      switched = s.mode !== b.mode;
      s.mode = b.mode;
    }
    store.save();
    store.event('settings', 'Settings updated');
    if (switched) useAdapter();
    res.json({ settings: publicSettings() });
  });

  // Demo only: flip the pretend basement water sensor so alerts and notifications can be tried before real hardware exists.
  app.post('/api/demo/leak', async (req, res) => {
    if (store.data.settings.mode === 'live') return bad(res, 'The test button only works in Demo mode', 409);
    sim.wet = req.body?.wet !== false;
    await engine.tick(); // so the alert (and any notification) shows right away instead of at the next 30 s tick
    res.json({ wet: sim.wet });
  });

  app.put('/api/rooms/:id', (req, res) => {
    const id = String(req.params.id).replace(/[^\w-]/g, '').slice(0, 20);
    const name = String(req.body?.name ?? '').trim().slice(0, 30);
    store.data.rooms[id] = { name, include: req.body?.include !== false };
    store.touch();
    res.json({ room: store.data.rooms[id] });
  });

  app.get('/api/history', (req, res) => {
    const hours = Math.min(24 * 30, Math.max(1, Number(req.query.hours) || 24));
    const since = now() - hours * 3600000;
    const h = engine.hist;
    res.json({ samples: h.samples.filter((s) => s.t >= since), runs: h.runs.filter((r) => (r.end || now()) >= since) });
  });

  // friendly names from Z-Wave (name, else location) and the thermostat node itself, which is not a room sensor
  const roomMeta = () => {
    const snap = (engine.last && engine.last.snap) || {};
    const names = {}; const skip = [];
    for (const r of snap.sensors || []) names[r.nodeId] = r.name || r.location || null;
    if (snap.thermostat && snap.thermostat.nodeId != null) skip.push(snap.thermostat.nodeId);
    return { names, skip };
  };

  app.get('/api/insights', (req, res) => {
    res.json(summarize({ history: engine.hist, events: store.data.events, rooms: store.data.rooms, ...roomMeta(), settings: store.data.settings, now: now() }));
  });

  app.get('/api/events', (req, res) => res.json({ events: store.data.events.slice(-200).reverse() }));

  app.post('/api/events', (req, res) => {
    const text = String(req.body?.text ?? '').trim().slice(0, 300);
    if (!text) return bad(res, 'empty note');
    store.event('note', text, now());
    res.json({ ok: true });
  });

  app.get('/api/backup', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="coldfront-backup.json"');
    const data = JSON.parse(JSON.stringify(store.data)); data.settings.ntfy.token = ''; res.json({ app: 'coldfront', version: 1, data });
  });

  app.post('/api/restore', (req, res) => {
    const b = req.body;
    if (!b || b.app !== 'coldfront' || !b.data?.schedule) return bad(res, 'Not a Cold Front backup');
    try {
      const sch = validateSchedule(b.data.schedule);
      const keepToken = store.data.settings.ntfy.token;
      store.data = require('./lib/store').merge(require('./lib/store').DEFAULTS(), { ...b.data, schedule: sch, hold: null, away: null });
      store.data.schedule = sch;
      store.data.settings.ntfy.token = keepToken;
      store.save();
      useAdapter();
      res.json({ ok: true });
    } catch (e) { bad(res, e.message); }
  });

  app.use('/api', (req, res) => bad(res, 'Not found', 404));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.parse.failed') return bad(res, 'Bad JSON');
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  function start() {
    useAdapter();
    const loop = async () => { try { await engine.tick(); await notifier.evaluate(engine.state()); } catch (e) { console.error('tick failed:', e.message); } };
    loop();
    timer = setInterval(loop, 20000);
    timer.unref?.();
  }
  function stop() { clearInterval(timer); sim.stop(); live?.stop(); store.flush(); }

  return { app, store, engine, sim, notifier, start, stop, useAdapter };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3971;
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  // Start as root only to fix ownership of the mounted data folder, then drop to uid 1000.
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.chownSync(dataDir, 1000, 1000); process.setgid(1000); process.setuid(1000); } catch (e) { console.error('could not drop privileges:', e.message); }
  }
  const h = createApp({ dataDir, zwaveUrl: process.env.ZWAVE_WS_URL || null, simSpeed: Number(process.env.SIM_SPEED) || 1 });
  h.start();
  const srv = h.app.listen(port, '0.0.0.0', () => console.log(`Cold Front listening on ${port}`));
  const bye = () => { h.stop(); srv.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
  process.on('uncaughtException', (e) => console.error('uncaught:', e));
  process.on('unhandledRejection', (e) => console.error('unhandled:', e));
}

module.exports = { createApp };
