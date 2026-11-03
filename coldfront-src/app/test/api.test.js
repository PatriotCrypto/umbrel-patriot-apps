'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const { summarize } = require('../lib/insights');
const { seedDemoHistory, SimAdapter } = require('../lib/sim');
const { defaultSchedule } = require('../lib/schedule');

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldfront-api-'));
  const h = createApp({ dataDir: dir, zwaveUrl: null, autoStart: false });
  h.useAdapter();
  await h.engine.tick();
  const srv = await new Promise((r) => { const s = h.app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const j = (p, method = 'GET', body) => fetch(base + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { h, srv, base, j, close: () => { h.stop(); srv.closeAllConnections?.(); srv.close(); } };
}

test('state comes back in demo mode with rooms and a desired setpoint', async () => {
  const t = await boot();
  const s = await (await t.j('/api/state')).json();
  assert.equal(s.mode, 'demo');
  assert.ok(s.thermostat.temp > 50);
  assert.equal(s.sensors.length, 3);
  assert.ok(s.desired.heat >= 55);
  assert.ok(s.next.name);
  t.close();
});

test('setting a hold, then cancelling it', async () => {
  const t = await boot();
  let r = await t.j('/api/setpoints', 'POST', { heat: 72, cool: 78, until: 'next' });
  assert.equal(r.status, 200);
  await t.h.engine.tick();
  let s = await (await t.j('/api/state')).json();
  assert.equal(s.hold.heat, 72);
  assert.equal(s.desired.source, 'hold');
  r = await t.j('/api/hold', 'DELETE');
  assert.equal(r.status, 200);
  s = await (await t.j('/api/state')).json();
  assert.equal(s.hold, null);
  t.close();
});

test('bad input is rejected', async () => {
  const t = await boot();
  assert.equal((await t.j('/api/setpoints', 'POST', { heat: 'x', cool: 70 })).status, 400);
  assert.equal((await t.j('/api/mode', 'POST', { mode: 'turbo' })).status, 400);
  assert.equal((await t.j('/api/settings', 'PUT', { limits: { heatMin: 10, heatMax: 70, coolMin: 70, coolMax: 80, minGap: 3 } })).status, 400);
  assert.equal((await t.j('/api/settings', 'PUT', { mode: 'live' })).status, 409);
  t.close();
});

test('non-JSON posts are refused (CSRF guard)', async () => {
  const t = await boot();
  const r = await fetch(`${t.base}/api/setpoints`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'heat=90&cool=95' });
  assert.equal(r.status, 415);
  t.close();
});

test('schedule round trip, clamped to limits', async () => {
  const t = await boot();
  const cur = await (await t.j('/api/schedule')).json();
  cur.schedule.days.mon[0].heat = 90;
  const r = await t.j('/api/schedule', 'PUT', { schedule: cur.schedule });
  assert.equal(r.status, 200);
  const back = await r.json();
  assert.equal(back.schedule.days.mon[0].heat, 78);
  const bad = await t.j('/api/schedule', 'PUT', { schedule: { days: {} } });
  assert.equal(bad.status, 400);
  t.close();
});

test('mode changes reach the simulator', async () => {
  const t = await boot();
  assert.equal((await t.j('/api/mode', 'POST', { mode: 'heat' })).status, 200);
  await t.h.engine.tick();
  const s = await (await t.j('/api/state')).json();
  assert.equal(s.thermostat.mode, 'heat');
  t.close();
});

test('room names, insights, history, backup and restore', async () => {
  const t = await boot();
  await t.j('/api/rooms/21', 'PUT', { name: 'Master bedroom' });
  const ins = await (await t.j('/api/insights')).json();
  assert.ok(ins.daily.length >= 6);
  assert.ok(ins.daily.some((d) => d.heatMin > 0));
  assert.equal(ins.rooms.find((r) => r.id === '21').name, 'Master bedroom');
  const hist = await (await t.j('/api/history?hours=24')).json();
  assert.ok(hist.samples.length > 200);
  const bk = await (await t.j('/api/backup')).json();
  assert.equal(bk.app, 'coldfront');
  assert.equal((await t.j('/api/restore', 'POST', bk)).status, 200);
  assert.equal((await t.j('/api/restore', 'POST', { app: 'nope' })).status, 400);
  t.close();
});

test('settings persist to disk', async () => {
  const t = await boot();
  await t.j('/api/settings', 'PUT', { costPerHour: 0.42, wallChange: 'revert' });
  const saved = JSON.parse(fs.readFileSync(path.join(t.h.store.dir, 'coldfront.json'), 'utf8'));
  assert.equal(saved.settings.costPerHour, 0.42);
  assert.equal(saved.settings.wallChange, 'revert');
  t.close();
});

test('insights: totals, short-cycle finding and day splitting across midnight', () => {
  const tz = 'America/New_York';
  const now = Date.parse('2026-11-04T17:00:00Z');
  const runs = [{ kind: 'heating', start: Date.parse('2026-11-03T04:30:00Z'), end: Date.parse('2026-11-03T05:30:00Z') }]; // 23:30 to 00:30 local
  const r = summarize({ history: { samples: [], runs }, events: [], rooms: {}, settings: { tz, costPerHour: 0.5, humidity: { min: 25, max: 60 } }, now });
  const byDate = Object.fromEntries(r.daily.map((d) => [d.date, d.heatMin]));
  assert.equal(byDate['2026-11-02'], 30);
  assert.equal(byDate['2026-11-03'], 30);
  assert.equal(r.totals.cost, 0.5);
  const many = Array.from({ length: 20 }, (_, i) => ({ kind: 'heating', start: now - 86400000 + i * 600000, end: now - 86400000 + i * 600000 + 120000 }));
  const s = summarize({ history: { samples: [], runs: many }, events: [], rooms: {}, settings: { tz, costPerHour: 0, humidity: { min: 25, max: 60 } }, now });
  assert.ok(s.findings.some((f) => /under 5 minutes/.test(f)));
});

test('simulator holds the setpoint over a day and the seeded history looks sane', () => {
  const sim = new SimAdapter({ now: () => 0 });
  const h = seedDemoHistory({ sim, schedule: defaultSchedule(), limits: { heatMin: 55, heatMax: 78, coolMin: 70, coolMax: 85, minGap: 3 }, tz: 'America/New_York', days: 2, endMs: Date.parse('2026-11-03T12:00:00Z') });
  const temps = h.samples.map((s) => s.in);
  assert.ok(Math.min(...temps) > 58 && Math.max(...temps) < 78, `range ${Math.min(...temps)}-${Math.max(...temps)}`);
  assert.ok(h.runs.length > 5);
});

test('filter and ntfy settings: validation, token never echoed, test send, mark changed', async () => {
  const t = await boot();
  const sent = [];
  t.h.notifier.fetch = async (url, o) => { sent.push({ url, o }); return { ok: true, status: 200 }; };
  let r = await t.j('/api/settings', 'PUT', { ntfy: { server: 'ftp://x' } });
  assert.equal(r.status, 400);
  r = await t.j('/api/settings', 'PUT', { ntfy: { topic: 'bad topic!' } });
  assert.equal(r.status, 400);
  r = await t.j('/api/settings', 'PUT', { ntfy: { enabled: true, topic: 'wyley-house', token: 'tk_secret', triggers: { freeze: true, bogus: true } }, filter: { lastChanged: '2026-10-01', intervalDays: 60 } });
  assert.equal(r.status, 200);
  const st = await (await t.j('/api/state')).json();
  assert.equal(st.settings.ntfy.hasToken, true);
  assert.equal(st.settings.ntfy.token, undefined);
  assert.equal(st.settings.ntfy.triggers.freeze, true);
  assert.equal(st.settings.ntfy.triggers.bogus, undefined);
  assert.equal(st.filter.dueDate, '2026-11-30');
  const bk = await (await t.j('/api/backup')).json();
  assert.equal(bk.data.settings.ntfy.token, '');
  r = await t.j('/api/ntfy/test', 'POST', {});
  assert.equal(r.status, 200);
  assert.equal(sent[0].url, 'https://ntfy.sh/wyley-house');
  assert.equal(sent[0].o.headers.Authorization, 'Bearer tk_secret');
  r = await t.j('/api/filter/changed', 'POST', { date: '2026-11-03' });
  assert.equal((await r.json()).filter.dueDate, '2027-01-02');
  r = await t.j('/api/filter/changed', 'POST', { date: 'nope' });
  assert.equal(r.status, 400);
  t.close();
});
