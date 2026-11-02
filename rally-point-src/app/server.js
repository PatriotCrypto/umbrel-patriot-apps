'use strict';
// Rally Point: private preparedness and homestead planner for Umbrel.
// Express is the only dependency. Data lives in /data (JSON + encrypted vault).

const fs = require('fs');
const path = require('path');
const express = require('express');

const { Store } = require('./lib/store');
const { Vault } = require('./lib/vault');
const S = require('./lib/schema');
const { mergeSettings } = require('./lib/settings');
const calc = require('./lib/calc');
const crops = require('./lib/crops');
const seed = require('./lib/seed');
const lib = require('./lib/library');
const widgets = require('./lib/widgets');
const notify = require('./lib/notify');
const { addDays, addMonths, todayIn, isDate } = require('./lib/dates');

const pkg = require('./package.json');
const MASK = '********';

function createApp(opts) {
  opts = opts || {};
  const dataDir = opts.dataDir || process.env.DATA_DIR || '/data';
  fs.mkdirSync(dataDir, { recursive: true });
  const store = new Store(dataDir);
  const vault = new Vault(dataDir, () => store.data.settings.vaultAutoLockMin);
  const nowFn = opts.now || (() => new Date());

  const app = express();
  app.disable('x-powered-by');

  // ---------------------------------------------------------------- helpers
  const today = () => todayIn(store.data.settings.ntfy.tz, nowFn());
  const hideCats = () => (store.data.settings.stealth ? S.SENSITIVE_CATS : []);
  const calcState = () => Object.assign({}, store.data, { today: today(), hideCats: hideCats() });

  if (store.fresh) {
    store.data.checklists = seed.defaultChecklists().map((c) => Object.assign({ id: S.uid(), created: new Date().toISOString(), updated: new Date().toISOString() }, c));
    store.flush();
  }

  function vaultAlertData() {
    if (store.data.settings.stealth || !vault.isUnlocked()) return null;
    return vault.data;
  }

  function itemView(it, st, inBags) {
    const info = calc.expInfo(it, st.today, st.settings.expiry.soonDays);
    return Object.assign({}, it, {
      st: {
        qty: Math.round(info.qty * 100) / 100,
        nearest: info.nearest, nearestDays: info.nearestDays,
        expiredQty: info.expiredQty, soonQty: info.soonQty,
        inBags: inBags[it.id] || 0,
        lots: info.lots,
      },
    });
  }

  function publicSettings() {
    const s = JSON.parse(JSON.stringify(store.data.settings));
    s.ntfy.tokenSet = !!s.ntfy.token;
    s.ntfy.token = s.ntfy.token ? MASK : '';
    return s;
  }

  function buildState() {
    const st = calcState();
    const d = store.data;
    const hidden = st.hideCats;
    const inBags = {};
    for (const b of d.bags) for (const l of b.lines || []) if (l.itemId) inBags[l.itemId] = (inBags[l.itemId] || 0) + (+l.qty || 0);

    const sup = calc.supply(st);
    const vdata = vaultAlertData();
    const alertList = calc.alerts(st, { supply: sup, vault: vdata });
    const ready = calc.readiness(st, sup, alertList);
    const year = +st.today.slice(0, 4);
    const fd = crops.frostDates(d.settings, year);

    const home = d.settings.home;
    const hasHome = home.lat != null && home.lon != null;
    const places = d.places.map((p) => Object.assign({}, p, {
      distMi: hasHome && p.lat != null && p.lon != null ? Math.round(calc.dist(home.lat, home.lon, p.lat, p.lon) * 10) / 10 : null,
    }));

    const harvest = {};
    for (const h of d.hlog) {
      if (!h.date || +h.date.slice(0, 4) !== year) continue;
      const k = h.what.toLowerCase() + '|' + (h.unit || '').toLowerCase();
      harvest[k] = harvest[k] || { what: h.what, unit: h.unit, qty: 0 };
      harvest[k].qty += +h.qty || 0;
    }

    const wsrc = d.wsources;
    const water = {
      capacity: wsrc.reduce((t, w) => t + (+w.capacityGal || 0), 0),
      level: wsrc.reduce((t, w) => t + (+w.currentGal || 0), 0),
    };

    return {
      version: pkg.version,
      today: st.today,
      fresh: store.fresh,
      stealth: !!d.settings.stealth,
      settings: publicSettings(),
      items: d.items.filter((i) => !hidden.includes(i.cat)).map((i) => itemView(i, st, inBags)),
      members: d.members,
      tasks: d.tasks,
      maint: d.maint.map((m) => Object.assign({}, m, { st: calc.maintStatus(m, st.today) })),
      checklists: d.checklists,
      contacts: d.contacts,
      places,
      docs: d.docs,
      beds: d.beds,
      plantings: d.plantings,
      seeds: d.seeds,
      livestock: d.livestock,
      hlog: d.hlog.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 500),
      canning: d.canning.slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
      bags: d.bags,
      loads: d.loads,
      wsources: d.wsources,
      wlog: d.wlog.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 300),
      shopping: d.shopping,
      log: d.log.slice(-200).reverse(),
      vault: Object.assign(vault.status(), { stealthBlocked: !!d.settings.stealth }),
      photoCount: store.photoCount(),
      calc: {
        supply: sup,
        alerts: alertList,
        ready,
        timeline: calc.expiryTimeline(st),
        value: calc.valueTotals(st),
        roles: calc.roleCoverage(d.members, d.settings.keyRoles),
        power: calc.powerPlan(st),
        water,
        frost: fd,
        sowPlan: crops.CROPS.map((c) => Object.assign({ crop: c.crop, dtm: c.dtm, kind: c.kind }, crops.plan(c, fd.last, fd.first))),
        garden: crops.gardenStats(d.plantings, year),
        harvest: Object.values(harvest),
        year,
      },
    };
  }

  // ---------------------------------------------------------------- middleware
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'",
    });
    next();
  });

  // state-changing requests must carry our header (blocks cross-site form posts)
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.get('x-rp') !== '1') return res.status(403).json({ error: 'Missing X-RP header' });
    next();
  });

  const bigJson = express.json({ limit: '60mb' });
  const smallJson = express.json({ limit: '1mb' });
  app.use('/api/restore', bigJson);
  app.use('/api/photo', express.raw({ type: ['image/jpeg'], limit: '900kb' }));
  app.use((req, res, next) => (req.path === '/api/restore' || req.path === '/api/photo' ? next() : smallJson(req, res, next)));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const ok = (res, extra) => res.json(Object.assign({ ok: true }, extra || {}));
  const bad = (res, msg, code) => res.status(code || 400).json({ error: msg });

  // ---------------------------------------------------------------- reads
  app.get('/healthz', (req, res) => res.json({ ok: true, version: pkg.version }));

  app.get('/api/state', (req, res) => res.json(buildState()));

  app.get('/api/meta', (req, res) => {
    res.json(Object.assign(S.publicMeta(), {
      crops: crops.publicCrops(),
      guides: lib.GUIDES,
      calories: lib.CALORIES,
      radio: lib.RADIO,
      starter: seed.starterList(),
    }));
  });

  // ---------------------------------------------------------------- settings
  app.put('/api/settings', (req, res) => {
    const body = req.body || {};
    const cur = store.data.settings;
    const patch = JSON.parse(JSON.stringify(body));
    delete patch.stealth; // changed only through /api/stealth
    if (patch.ntfy) {
      if (patch.ntfy.token === MASK) patch.ntfy.token = cur.ntfy.token;
      if (patch.ntfy.url && !notify.validUrl(patch.ntfy.url)) return bad(res, 'ntfy server must be an http or https address');
      delete patch.ntfy.last;
    }
    store.data.settings = mergeSettings(cur, patch);
    store.data.settings.stealth = cur.stealth;
    store.save();
    vault.touch();
    ok(res, { settings: publicSettings() });
  });

  app.post('/api/stealth', wrap(async (req, res) => {
    const on = !!(req.body && req.body.on);
    const s = store.data.settings;
    if (on) {
      s.stealth = true;
      vault.lock();
      store.save();
      return ok(res, { stealth: true });
    }
    if (vault.exists()) {
      let good;
      try { good = await vault.verify(req.body && req.body.code); } catch (e) { return bad(res, e.message, 429); }
      if (!good) return bad(res, 'Wrong PIN or recovery code', 401);
    }
    s.stealth = false;
    store.save();
    ok(res, { stealth: false });
  }));

  // ---------------------------------------------------------------- generic collections
  function checkColl(req, res) {
    const name = req.params.coll;
    if (!S.COLL[name]) { bad(res, 'Unknown collection', 404); return null; }
    return name;
  }

  function hiddenItem(name, doc) {
    return name === 'items' && doc && hideCats().includes(doc.cat);
  }

  function unlinkItem(id) {
    for (const m of store.data.maint) if (m.itemId === id) m.itemId = '';
    for (const sh of store.data.shopping) if (sh.itemId === id) sh.itemId = '';
    for (const b of store.data.bags) for (const l of b.lines || []) if (l.itemId === id) l.itemId = '';
  }

  function unlinkMember(id) {
    const d = store.data;
    for (const t of d.tasks) if (t.assignee === id) t.assignee = '';
    for (const b of d.bags) if (b.owner === id) b.owner = '';
    for (const x of d.docs) if (x.owner === id) x.owner = '';
    if (vault.isUnlocked()) {
      for (const g of vault.data.firearms) if (g.assignedTo === id) g.assignedTo = '';
      vault.data.medical = vault.data.medical.filter((m) => m.member !== id);
      vault.save();
    }
  }

  app.post('/api/c/:coll', (req, res) => {
    const name = checkColl(req, res); if (!name) return;
    const spec = S.COLL[name];
    if (store.data[name].length >= spec.max) return bad(res, `Limit of ${spec.max} reached`);
    const doc = S.cleanColl(S.COLL, name, req.body);
    if (hiddenItem(name, doc)) return bad(res, 'Stealth mode is on. Turn it off to add this category.', 423);
    if (name === 'items' && doc.photo && !fs.existsSync(store.photoPath(doc.photo))) doc.photo = '';
    const rec = store.add(name, doc);
    store.log(`Added ${spec.label.toLowerCase()}: ${rec[spec.title] || ''}`);
    ok(res, { rec });
  });

  app.put('/api/c/:coll/:id', (req, res) => {
    const name = checkColl(req, res); if (!name) return;
    const old = store.find(name, req.params.id);
    if (!old || hiddenItem(name, old)) return bad(res, 'Not found', 404);
    const doc = S.cleanColl(S.COLL, name, req.body, old);
    if ((name === 'items' || name === 'members') && old.photo && doc.photo !== old.photo) store.deletePhoto(old.photo);
    const rec = store.update(name, req.params.id, doc);
    ok(res, { rec });
  });

  app.delete('/api/c/:coll/:id', (req, res) => {
    const name = checkColl(req, res); if (!name) return;
    const old = store.find(name, req.params.id);
    if (!old || hiddenItem(name, old)) return bad(res, 'Not found', 404);
    store.remove(name, req.params.id);
    if (old.photo) store.deletePhoto(old.photo);
    if (name === 'items') unlinkItem(old.id);
    if (name === 'members') unlinkMember(old.id);
    if (name === 'beds') for (const p of store.data.plantings) if (p.bed === old.id) p.bed = '';
    store.log(`Removed ${S.COLL[name].label.toLowerCase()}: ${old[S.COLL[name].title] || ''}`);
    ok(res);
  });

  // ---------------------------------------------------------------- items
  function consume(item, qty) {
    const lots = (item.lots || []).filter((l) => l.qty > 0);
    const exp = (l) => calc.lotExp(item, l) || '9999-12-31';
    lots.sort((a, b) => (exp(a) < exp(b) ? -1 : exp(a) > exp(b) ? 1 : 0));
    let left = qty;
    for (const l of lots) {
      if (left <= 0) break;
      const take = Math.min(l.qty, left);
      l.qty = Math.round((l.qty - take) * 10000) / 10000;
      left -= take;
    }
    item.lots = item.lots.filter((l) => l.qty > 0);
    return qty - left;
  }

  function addQty(item, qty, lotId, bought) {
    item.lots = item.lots || [];
    let lot = lotId && item.lots.find((l) => l.id === lotId);
    if (!lot && item.lots.length === 1) lot = item.lots[0];
    if (lot) lot.qty = Math.round((lot.qty + qty) * 10000) / 10000;
    else item.lots.push({ id: S.uid(), qty, exp: '', bought: bought || today(), cost: 0, note: '' });
  }

  app.post('/api/items/:id/adjust', (req, res) => {
    const item = store.find('items', req.params.id);
    if (!item || hiddenItem('items', item)) return bad(res, 'Not found', 404);
    const delta = parseFloat(req.body && req.body.delta);
    if (!Number.isFinite(delta) || delta === 0) return bad(res, 'delta must be a non-zero number');
    if (delta < 0) {
      const have = calc.itemQty(item);
      if (have <= 0) return bad(res, 'Nothing left to use');
      consume(item, Math.min(-delta, have));
    } else {
      addQty(item, delta, req.body.lotId, req.body.bought);
    }
    item.updated = new Date().toISOString();
    store.save();
    store.log(`${delta < 0 ? 'Used' : 'Added'} ${Math.abs(delta)} ${item.unit || ''} ${item.name}`.replace(/\s+/g, ' '));
    ok(res);
  });

  app.get('/api/scan/:code', (req, res) => {
    const code = String(req.params.code).trim();
    const it = store.data.items.find((i) => i.barcode && i.barcode === code && !hiddenItem('items', i));
    res.json({ item: it ? { id: it.id, name: it.name, unit: it.unit } : null });
  });

  app.get('/api/lookup/:code', wrap(async (req, res) => {
    if (!store.data.settings.lookupOnline) return bad(res, 'Online barcode lookup is turned off in Settings', 403);
    const code = String(req.params.code).replace(/[^0-9]/g, '').slice(0, 20);
    if (code.length < 6) return bad(res, 'Barcode too short');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,quantity,product_quantity,nutriments,serving_quantity`;
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'RallyPoint/' + pkg.version + ' (Umbrel app)' } });
      const j = await r.json();
      if (!j || j.status !== 1 || !j.product) return res.json({ found: false });
      const p = j.product;
      const n = p.nutriments || {};
      let kcal = null;
      const per100 = n['energy-kcal_100g'];
      const grams = parseFloat(p.product_quantity);
      if (per100 > 0 && grams > 0) kcal = Math.round((per100 * grams) / 100);
      res.json({ found: true, name: [p.brands, p.product_name].filter(Boolean).join(' ').slice(0, 120), quantity: p.quantity || '', calories: kcal });
    } finally { clearTimeout(t); }
  }));

  // ---------------------------------------------------------------- tasks, maintenance, checklists
  app.post('/api/tasks/:id/done', (req, res) => {
    const t = store.find('tasks', req.params.id);
    if (!t) return bad(res, 'Not found', 404);
    const now = today();
    t.count = (t.count || 0) + 1;
    t.doneAt = now;
    if (t.every > 0) { t.due = addDays(now, t.every); t.done = false; } else t.done = true;
    t.updated = new Date().toISOString();
    store.save();
    store.log(`Completed task: ${t.title}`);
    ok(res);
  });

  app.post('/api/tasks/:id/undo', (req, res) => {
    const t = store.find('tasks', req.params.id);
    if (!t) return bad(res, 'Not found', 404);
    t.done = false;
    store.save();
    ok(res);
  });

  app.post('/api/maint/:id/done', (req, res) => {
    const m = store.find('maint', req.params.id);
    if (!m) return bad(res, 'Not found', 404);
    const date = isDate(req.body && req.body.date) ? req.body.date : today();
    m.lastDone = date;
    m.history = (m.history || []).concat([{ id: S.uid(), date, note: S.cleanStr(req.body && req.body.note, 200) }]).slice(-30);
    m.updated = new Date().toISOString();
    store.save();
    store.log(`Done: ${m.name}`);
    ok(res);
  });

  app.post('/api/maint/suggested', (req, res) => {
    const have = new Set(store.data.maint.map((m) => m.name.toLowerCase()));
    let n = 0;
    for (const m of seed.defaultMaint(today())) {
      if (have.has(m.name.toLowerCase())) continue;
      store.add('maint', m); n++;
    }
    ok(res, { added: n });
  });

  app.post('/api/checklists/defaults', (req, res) => {
    const have = new Set(store.data.checklists.map((c) => c.title.toLowerCase()));
    let n = 0;
    for (const c of seed.defaultChecklists()) {
      if (have.has(c.title.toLowerCase())) continue;
      store.add('checklists', c); n++;
    }
    ok(res, { added: n });
  });

  app.post('/api/checklists/:id/toggle', (req, res) => {
    const c = store.find('checklists', req.params.id);
    if (!c) return bad(res, 'Not found', 404);
    const line = (c.items || []).find((l) => l.id === (req.body && req.body.itemId));
    if (!line) return bad(res, 'Step not found', 404);
    line.done = !!req.body.done;
    store.save();
    ok(res);
  });

  app.post('/api/checklists/:id/reset', (req, res) => {
    const c = store.find('checklists', req.params.id);
    if (!c) return bad(res, 'Not found', 404);
    for (const l of c.items || []) l.done = false;
    store.save();
    ok(res);
  });

  // ---------------------------------------------------------------- preserving, shopping, starter
  app.post('/api/canning/:id/pantry', (req, res) => {
    const c = store.find('canning', req.params.id);
    if (!c) return bad(res, 'Not found', 404);
    if (c.addedToPantry) return bad(res, 'Already added to the pantry');
    const exp = c.date ? addMonths(c.date, c.shelfMonths > 0 ? c.shelfMonths : 18) : '';
    const lot = { id: S.uid(), qty: c.qty || 0, exp, bought: c.date || '', cost: 0, note: c.lot ? 'Batch ' + c.lot : '' };
    let item = store.data.items.find((i) => i.cat === 'food' && i.name.toLowerCase() === c.product.toLowerCase());
    if (item) {
      item.lots.push(lot);
      if (!(item.x && item.x.calories) && c.kcalPerJar) item.x.calories = c.kcalPerJar;
      item.updated = new Date().toISOString();
    } else {
      item = store.add('items', S.cleanColl(S.COLL, 'items', {
        name: c.product, cat: 'food', unit: 'jar', location: 'Pantry', lots: [lot],
        x: { calories: c.kcalPerJar || 0, storage: 'home-canned' },
      }));
    }
    c.addedToPantry = true;
    store.save();
    store.log(`Added ${c.qty} ${c.product} to the pantry`);
    ok(res);
  });

  app.post('/api/starter', (req, res) => {
    const have = new Set(store.data.items.map((i) => i.name.toLowerCase()));
    const names = Array.isArray(req.body && req.body.names) ? req.body.names : null;
    let n = 0;
    for (const it of seed.starterItems(names)) {
      if (have.has(it.name.toLowerCase())) continue;
      store.add('items', it); n++;
    }
    store.log(`Added ${n} starter items`);
    ok(res, { added: n });
  });

  app.post('/api/whatif', (req, res) => {
    const b = req.body || {};
    const over = {
      extra: b.extra || {}, waterMult: b.waterMult, kcalMult: b.kcalMult, countExpired: b.countExpired,
    };
    const T = Math.max(1, Math.min(3650, parseInt(b.targetDays, 10) || store.data.settings.targetDays));
    const r = calc.planGaps(calcState(), T, over);
    res.json({ gaps: r.gaps, supply: r.supply, targetDays: T });
  });

  app.post('/api/shopping/generate', (req, res) => {
    const T = Math.max(1, Math.min(3650, parseInt(req.body && req.body.targetDays, 10) || store.data.settings.targetDays));
    const { gaps } = calc.planGaps(calcState(), T);
    const open = store.data.shopping.filter((l) => !l.done);
    let n = 0;
    for (const g of gaps) {
      const exists = open.some((l) => (g.itemId && l.itemId === g.itemId) || l.name.toLowerCase() === g.name.toLowerCase());
      if (exists) continue;
      store.add('shopping', S.cleanColl(S.COLL, 'shopping', {
        name: g.name, qty: g.short, unit: g.unit, cat: g.cat, itemId: g.itemId || '', note: g.detail || '',
      }), { auto: true });
      n++;
    }
    ok(res, { added: n, targetDays: T });
  });

  app.post('/api/shopping/clear', (req, res) => {
    const all = !!(req.body && req.body.all);
    const before = store.data.shopping.length;
    store.data.shopping = store.data.shopping.filter((l) => (all ? false : !l.done));
    store.save();
    ok(res, { removed: before - store.data.shopping.length });
  });

  // mark a shopping line received: adds it to inventory
  app.post('/api/shopping/:id/stock', (req, res) => {
    const l = store.find('shopping', req.params.id);
    if (!l) return bad(res, 'Not found', 404);
    const qty = parseFloat(req.body && req.body.qty);
    const q = Number.isFinite(qty) && qty > 0 ? qty : l.qty;
    let item = l.itemId && store.find('items', l.itemId);
    if (item && !hiddenItem('items', item)) {
      addQty(item, q, null, today());
      item.updated = new Date().toISOString();
    } else if (!l.auto && l.cat) {
      store.add('items', S.cleanColl(S.COLL, 'items', {
        name: l.name, cat: l.cat, unit: l.unit || 'each', lots: [{ qty: q, bought: today() }],
      }));
    }
    store.remove('shopping', l.id);
    store.save();
    ok(res);
  });

  // ---------------------------------------------------------------- calculators
  app.get('/api/calc/rain', (req, res) => {
    const roof = Math.max(0, parseFloat(req.query.roof) || 0);
    const rain = Math.max(0, parseFloat(req.query.rain) || store.data.settings.rainfallIn);
    const eff = Math.min(1, Math.max(0.1, parseFloat(req.query.eff) || 0.8));
    res.json(calc.rainCatch(roof, rain, eff));
  });

  app.get('/api/calc/bleach', (req, res) => {
    const gal = Math.max(0, parseFloat(req.query.gal) || 0);
    res.json(calc.bleachDose(gal, parseFloat(req.query.pct) || 6, req.query.cloudy === '1'));
  });

  // ---------------------------------------------------------------- photos
  app.post('/api/photo', (req, res) => {
    const b = req.body;
    if (!Buffer.isBuffer(b) || b.length < 100) return bad(res, 'Send a JPEG image');
    if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return bad(res, 'Not a JPEG');
    if (store.photoCount() >= 600) return bad(res, 'Photo limit reached');
    ok(res, { id: store.savePhoto(b) });
  });

  app.get('/photos/:id.jpg', (req, res) => {
    const id = req.params.id;
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(id)) return res.status(404).end();
    const f = store.photoPath(id);
    if (!fs.existsSync(f)) return res.status(404).end();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(f).pipe(res);
  });

  // ---------------------------------------------------------------- sample data
  app.post('/api/sample/load', (req, res) => {
    if (store.data.items.some((i) => i.sample)) return bad(res, 'Sample data is already loaded');
    const t = today();
    const sd = seed.sampleDocs(t);
    const mark = { sample: true };
    for (const m of sd.members) store.add('members', S.cleanColl(S.COLL, 'members', m), { id: m.id, sample: true });
    for (const it of sd.items) store.add('items', S.cleanColl(S.COLL, 'items', it), mark);
    for (const k of ['wsources', 'loads', 'tasks', 'maint', 'contacts', 'places', 'docs', 'beds', 'seeds', 'livestock', 'bags', 'hlog']) {
      for (const doc of sd[k]) store.add(k, S.cleanColl(S.COLL, k, doc), mark);
    }
    const s = store.data.settings;
    s.generators = (s.generators || []).concat([{ id: 'sample-gen', name: 'Sample generator', fuelType: 'gasoline', gph: 0.5, hoursPerDay: 4, watts: 3500 }]);
    if (!s.setupDone) s.groupName = s.groupName === 'My Group' ? 'Sample Family' : s.groupName;
    store.save();
    store.log('Loaded sample data');
    ok(res);
  });

  app.delete('/api/sample', (req, res) => {
    let n = 0;
    for (const k of Object.keys(S.COLL)) {
      const before = store.data[k].length;
      store.data[k] = store.data[k].filter((x) => !x.sample);
      n += before - store.data[k].length;
    }
    store.data.settings.generators = (store.data.settings.generators || []).filter((g) => g.id !== 'sample-gen');
    store.save();
    store.log('Removed sample data');
    ok(res, { removed: n });
  });

  // ---------------------------------------------------------------- backup, restore, export
  app.get('/api/backup', (req, res) => {
    const out = { app: 'rally-point', v: 1, exported: new Date().toISOString(), data: store.data, vault: vault.exportEnvelope() };
    if (req.query.photos === '1') {
      out.photos = {};
      try {
        for (const f of fs.readdirSync(store.photoDir)) {
          if (f.endsWith('.jpg')) out.photos[f.slice(0, -4)] = fs.readFileSync(path.join(store.photoDir, f)).toString('base64');
        }
      } catch (e) { /* none */ }
    }
    res.set('Content-Disposition', `attachment; filename="rally-point-backup-${today()}.json"`);
    res.json(out);
  });

  app.post('/api/restore', (req, res) => {
    const b = req.body;
    if (!b || b.app !== 'rally-point' || !b.data || typeof b.data !== 'object') return bad(res, 'That file is not a Rally Point backup');
    store.flush();
    try { fs.copyFileSync(store.file, path.join(store.backupDir, 'before-restore.json')); } catch (e) { /* first run */ }
    store.replaceAll(b.data);
    if (b.vault) { try { vault.importEnvelope(b.vault); } catch (e) { return bad(res, 'Vault part of the backup is damaged'); } }
    if (b.photos && typeof b.photos === 'object') {
      for (const [id, b64] of Object.entries(b.photos)) {
        if (!/^[A-Za-z0-9_-]{1,24}$/.test(id)) continue;
        const buf = Buffer.from(String(b64), 'base64');
        if (buf.length > 100 && buf[0] === 0xff && buf[1] === 0xd8) fs.writeFileSync(store.photoPath(id), buf);
      }
    }
    store.log('Restored from backup');
    ok(res);
  });

  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

  app.get('/api/export/items.csv', (req, res) => {
    const st = calcState();
    const rows = [['Name', 'Category', 'Quantity', 'Unit', 'Nearest expiry', 'Location', 'Calories per unit', 'Notes']];
    for (const it of calc.visibleItems(st)) {
      const info = calc.expInfo(it, st.today, 0);
      rows.push([it.name, it.cat, info.qty, it.unit, info.nearest || '', it.location, (it.x && it.x.calories) || '', it.notes]);
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="rally-point-inventory.csv"');
    res.send(csv(rows));
  });

  app.get('/api/export/shopping.csv', (req, res) => {
    const rows = [['Item', 'Quantity', 'Unit', 'Note', 'Bought']];
    for (const l of store.data.shopping) rows.push([l.name, l.qty, l.unit, l.note, l.done ? 'yes' : '']);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="rally-point-shopping.csv"');
    res.send(csv(rows));
  });

  // ---------------------------------------------------------------- notifications
  app.post('/api/ntfy/test', wrap(async (req, res) => {
    try {
      await notify.sendNtfy(store.data.settings.ntfy, 'Rally Point test', 'Notifications are working.', 3);
      ok(res);
    } catch (e) { bad(res, 'Could not send: ' + e.message, 502); }
  }));

  async function tick() {
    const t = today();
    store.dailyBackup(t);
    const s = store.data.settings;
    const due = notify.digestDue(s.ntfy, nowFn());
    if (!due) return;
    s.ntfy.last = due; // record first so a failure cannot cause a flood
    store.save();
    const st = calcState();
    const sup = calc.supply(st);
    const al = calc.alerts(st, { supply: sup });
    const ready = calc.readiness(st, sup, al);
    const d = notify.buildDigest(sup, ready, al, s.groupName);
    try { await notify.sendNtfy(s.ntfy, d.title, d.body, d.priority); } catch (e) { console.error('ntfy digest failed:', e.message); }
  }

  // ---------------------------------------------------------------- widgets (umbrelOS home screen)
  function widgetCtx() {
    const st = calcState();
    const sup = calc.supply(st);
    const al = calc.alerts(st, { supply: sup });
    return { sup, alerts: al, ready: calc.readiness(st, sup, al), settings: st.settings };
  }
  app.get('/widgets/readiness', (req, res) => res.json(widgets.readinessWidget(widgetCtx())));
  app.get('/widgets/supplies', (req, res) => res.json(widgets.suppliesWidget(widgetCtx())));
  app.get('/widgets/attention', (req, res) => res.json(widgets.attentionWidget(widgetCtx())));

  // ---------------------------------------------------------------- vault
  const unlockedOr423 = (req, res, next) => {
    if (store.data.settings.stealth) return bad(res, 'Stealth mode is on', 423);
    if (!vault.isUnlocked()) return bad(res, 'Vault is locked', 423);
    vault.touch();
    next();
  };

  app.get('/api/vault/status', (req, res) => res.json(Object.assign(vault.status(), { stealthBlocked: !!store.data.settings.stealth })));

  app.post('/api/vault/setup', wrap(async (req, res) => {
    if (store.data.settings.stealth) return bad(res, 'Stealth mode is on', 423);
    try {
      const r = await vault.setup(String(req.body && req.body.pin || ''));
      store.log('Created the vault');
      ok(res, { recovery: r.recovery });
    } catch (e) { bad(res, e.message); }
  }));

  app.post('/api/vault/unlock', wrap(async (req, res) => {
    if (store.data.settings.stealth) return bad(res, 'Stealth mode is on', 423);
    try {
      const r = await vault.unlock(req.body && req.body.code);
      if (!r) return bad(res, 'Wrong PIN or recovery code', 401);
      ok(res, { viaRecovery: r.viaRecovery });
    } catch (e) { bad(res, e.message, e.code === 'LOCKOUT' ? 429 : 400); }
  }));

  app.post('/api/vault/lock', (req, res) => { vault.lock(); ok(res); });

  app.post('/api/vault/pin', wrap(async (req, res) => {
    try {
      const good = await vault.changePin(req.body && req.body.current, req.body && req.body.next);
      if (!good) return bad(res, 'Wrong current PIN or recovery code', 401);
      ok(res);
    } catch (e) { bad(res, e.message, e.code === 'LOCKOUT' ? 429 : 400); }
  }));

  app.post('/api/vault/recovery', unlockedOr423, wrap(async (req, res) => {
    const r = await vault.rotateRecovery();
    ok(res, { recovery: r.recovery });
  }));

  app.delete('/api/vault', wrap(async (req, res) => {
    if (!req.body || req.body.confirm !== 'ERASE') return bad(res, 'Type ERASE to confirm');
    if (vault.exists()) {
      let good;
      try { good = await vault.verify(req.body.code); } catch (e) { return bad(res, e.message, 429); }
      if (!good) return bad(res, 'Wrong PIN or recovery code', 401);
    }
    vault.destroy();
    store.log('Erased the vault');
    ok(res);
  }));

  app.get('/api/vault/data', unlockedOr423, (req, res) => {
    const v = vault.data;
    const norm = (c) => String(c || '').toLowerCase().replace(/[\s.]/g, '');
    const by = {};
    for (const g of v.firearms) {
      const k = norm(g.caliber) || 'unspecified';
      by[k] = by[k] || { caliber: g.caliber || 'unspecified', guns: 0, rounds: 0 };
      by[k].guns++;
    }
    for (const it of store.data.items.filter((i) => i.cat === 'ammo')) {
      const k = norm(it.x && it.x.caliber) || 'unspecified';
      by[k] = by[k] || { caliber: (it.x && it.x.caliber) || 'unspecified', guns: 0, rounds: 0 };
      by[k].rounds += calc.itemQty(it);
    }
    const calibers = Object.values(by).map((c) => Object.assign(c, { perGun: c.guns > 0 ? Math.round(c.rounds / c.guns) : null }));
    const medical = v.medical.map((m) => Object.assign({}, m, { rx: (m.rx || []).map((r) => Object.assign({}, r, { daysLeft: calc.medDays(r) })) }));
    res.json({ firearms: v.firearms, medical, vnotes: v.vnotes, calibers });
  });

  app.post('/api/v/:coll', unlockedOr423, (req, res) => {
    const name = req.params.coll;
    if (!S.VCOLL[name]) return bad(res, 'Unknown collection', 404);
    if (vault.data[name].length >= S.VCOLL[name].max) return bad(res, 'Limit reached');
    const doc = S.cleanColl(S.VCOLL, name, req.body);
    if (name === 'medical' && vault.data.medical.some((m) => m.member === doc.member)) return bad(res, 'That member already has a medical record');
    ok(res, { rec: vault.add(name, doc) });
  });

  app.put('/api/v/:coll/:id', unlockedOr423, (req, res) => {
    const name = req.params.coll;
    if (!S.VCOLL[name]) return bad(res, 'Unknown collection', 404);
    const old = vault.data[name].find((x) => x.id === req.params.id);
    if (!old) return bad(res, 'Not found', 404);
    const doc = S.cleanColl(S.VCOLL, name, req.body, old);
    ok(res, { rec: vault.update(name, req.params.id, doc) });
  });

  app.delete('/api/v/:coll/:id', unlockedOr423, (req, res) => {
    const name = req.params.coll;
    if (!S.VCOLL[name]) return bad(res, 'Unknown collection', 404);
    if (!vault.remove(name, req.params.id)) return bad(res, 'Not found', 404);
    ok(res);
  });

  // ---------------------------------------------------------------- static and errors
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }));

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof S.ValidationError) return res.status(400).json({ error: err.message });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too large' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return { app, store, vault, tick, buildState };
}

// ---------------------------------------------------------------- start
function dropPrivileges(dir) {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const walk = (p) => {
    try { fs.chownSync(p, 1000, 1000); } catch (e) { /* best effort */ }
    let st; try { st = fs.statSync(p); } catch (e) { return; }
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f));
  };
  fs.mkdirSync(dir, { recursive: true });
  walk(dir);
  process.setgid(1000);
  process.setuid(1000);
}

if (require.main === module) {
  const dir = process.env.DATA_DIR || '/data';
  dropPrivileges(dir);
  const { app, store, vault, tick } = createApp({ dataDir: dir });
  const port = +process.env.PORT || 3967;
  const server = app.listen(port, '0.0.0.0', () => console.log(`Rally Point ${pkg.version} listening on ${port}`));
  const timer = setInterval(() => { tick().catch((e) => console.error('tick failed:', e.message)); }, 15 * 60 * 1000);
  setTimeout(() => { tick().catch((e) => console.error('tick failed:', e.message)); }, 5000);
  const bye = () => { clearInterval(timer); vault.lock(); store.flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
  process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));
  process.on('uncaughtException', (e) => console.error('uncaught exception:', e));
}

module.exports = { createApp };
