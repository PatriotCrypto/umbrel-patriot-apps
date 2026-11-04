'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store');
const { Notifier, TRIGGERS } = require('../lib/notify');
const { filterStatus, filterAlert, validateFilter } = require('../lib/filter');

const TZ = 'America/New_York';
function rig(over = {}) {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'cf-notify-'))).load();
  Object.assign(store.data.settings.ntfy, { enabled: true, topic: 'house', ...over });
  let t = Date.parse('2026-11-03T15:00:00Z');
  const sent = [];
  const n = new Notifier(store, { now: () => t, fetchFn: async (url, o) => { sent.push({ url, headers: o.headers, body: o.body }); return { ok: true, status: 200 }; } });
  return { store, n, sent, advance: (ms) => { t += ms; }, now: () => t };
}
const state = (alerts = [], mode = 'live') => ({ mode, alerts });
const on = (store, ...k) => k.forEach((x) => { store.data.settings.ntfy.triggers[x] = true; });

test('every trigger starts off', () => {
  const { store } = rig();
  assert.equal(Object.keys(TRIGGERS).length, Object.keys(store.data.settings.ntfy.triggers).length);
  assert.ok(Object.values(store.data.settings.ntfy.triggers).every((v) => v === false));
});

test('nothing sends for a trigger that is off, even with a topic set', async () => {
  const { n, sent } = rig();
  await n.evaluate(state([{ level: 'bad', key: 'freeze', text: 'cold' }]));
  assert.equal(sent.length, 0);
});

test('freeze alert sends once with priority 5, not again while it stays active', async () => {
  const { store, n, sent, advance } = rig(); on(store, 'freeze');
  const a = [{ level: 'bad', key: 'freeze', text: 'Indoor temperature is 40°F.' }];
  await n.evaluate(state(a)); advance(20000); await n.evaluate(state(a));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers.Priority, '5');
  assert.equal(sent[0].url, 'https://ntfy.sh/house');
});

test('link lost waits 2 minutes, then sends; restored sends once afterwards', async () => {
  const { store, n, sent, advance } = rig(); on(store, 'linkLost', 'linkRestored');
  const down = [{ level: 'bad', key: 'link', text: 'x' }];
  await n.evaluate(state(down)); assert.equal(sent.length, 0);
  advance(60000); await n.evaluate(state(down)); assert.equal(sent.length, 0);
  advance(70000); await n.evaluate(state(down)); assert.equal(sent.length, 1);
  advance(20000); await n.evaluate(state(down)); assert.equal(sent.length, 1);
  advance(20000); await n.evaluate(state([])); assert.equal(sent.length, 2);
  assert.match(sent[1].headers.Title, /restored/);
  await n.evaluate(state([])); assert.equal(sent.length, 2);
});

test('a link blip shorter than 2 minutes never sends lost or restored', async () => {
  const { store, n, sent, advance } = rig(); on(store, 'linkLost', 'linkRestored');
  await n.evaluate(state([{ level: 'bad', key: 'link', text: 'x' }])); advance(30000); await n.evaluate(state([]));
  assert.equal(sent.length, 0);
});

test('thermostat lost and found', async () => {
  const { store, n, sent, advance } = rig(); on(store, 'thermostatLost', 'thermostatRestored');
  await n.evaluate(state([{ level: 'warn', key: 'stale', text: 'x' }])); advance(20000);
  await n.evaluate(state([])); assert.equal(sent.length, 2);
});

test('demo mode never sends signal or sensor alerts', async () => {
  const { store, n, sent } = rig(); on(store, 'freeze', 'linkLost');
  await n.evaluate(state([{ level: 'bad', key: 'freeze', text: 'x' }, { level: 'bad', key: 'link', text: 'x' }], 'demo'));
  assert.equal(sent.length, 0);
});

test('wall changes send once per event', async () => {
  const { store, n, sent, now, advance } = rig(); on(store, 'wallChange');
  await n.evaluate(state([])); advance(5000);
  store.event('external', 'Setpoints changed outside Cold Front: heat 68→72', now());
  await n.evaluate(state([])); advance(5000); await n.evaluate(state([]));
  assert.equal(sent.length, 1);
});

test('sensor alerts map to their own toggles', async () => {
  const { store, n, sent } = rig(); on(store, 'batteryLow');
  await n.evaluate(state([{ level: 'warn', key: 'bat21', text: 'Bedroom battery is at 12%.' }, { level: 'warn', key: 'hum22', text: 'Basement humidity is 70%.' }]));
  assert.equal(sent.length, 1);
  assert.match(sent[0].headers.Title, /battery/i);
});

test('bearer token is sent when set', async () => {
  const { store, n, sent } = rig({ token: 'tk_abc' }); on(store, 'freeze');
  await n.evaluate(state([{ level: 'bad', key: 'freeze', text: 'x' }]));
  assert.equal(sent[0].headers.Authorization, 'Bearer tk_abc');
});

test('filter math: dates are whole days and the lead time works', () => {
  const f = { name: 'Furnace filter', lastChanged: '2026-08-05', intervalDays: 90, remindDaysBefore: 7 };
  const st = filterStatus(f, Date.parse('2026-11-03T15:00:00Z'), TZ);
  assert.equal(st.dueDate, '2026-11-03'); assert.equal(st.daysLeft, 0); assert.equal(st.state, 'soon');
  assert.equal(filterStatus(f, Date.parse('2026-10-01T15:00:00Z'), TZ).state, 'ok');
  const od = filterStatus(f, Date.parse('2026-11-10T15:00:00Z'), TZ);
  assert.equal(od.state, 'overdue'); assert.equal(od.daysLeft, -7);
  assert.match(filterAlert(od).text, /7 days ago/);
  assert.equal(filterStatus({ ...f, lastChanged: null }, Date.now(), TZ).configured, false);
});

test('filter settings reject bad input', () => {
  const cur = { name: 'F', lastChanged: null, intervalDays: 90, remindDaysBefore: 7 };
  assert.throws(() => validateFilter({ lastChanged: '11/03/2026' }, cur));
  assert.throws(() => validateFilter({ lastChanged: '2026-02-31' }, cur));
  assert.throws(() => validateFilter({ intervalDays: 2 }, cur));
  assert.equal(validateFilter({ intervalDays: 60, lastChanged: '2026-10-01' }, cur).intervalDays, 60);
});

test('filter reminders send once when soon, weekly when overdue, and reset after a change', async () => {
  const { store, n, sent, advance } = rig(); on(store, 'filterDue', 'filterOverdue');
  store.data.settings.filter = { name: 'Furnace filter', lastChanged: '2026-08-10', intervalDays: 90, remindDaysBefore: 7 }; // due 11-08, 5 days left
  await n.evaluate(state([], 'demo')); advance(86400000); await n.evaluate(state([], 'demo'));
  assert.equal(sent.length, 1); assert.match(sent[0].headers.Title, /due in/);
  advance(6 * 86400000); await n.evaluate(state([], 'demo')); assert.equal(sent.length, 2); assert.match(sent[1].headers.Title, /overdue/);
  advance(3 * 86400000); await n.evaluate(state([], 'demo')); assert.equal(sent.length, 2);
  advance(5 * 86400000); await n.evaluate(state([], 'demo')); assert.equal(sent.length, 3);
});

test('water leak sends at once with top priority, repeats after 30 min while wet, and says when it is dry', async () => {
  const { store, n, sent, advance } = rig();
  on(store, 'leak', 'leakClear');
  const wet = [{ level: 'bad', key: 'leak9', text: 'Water detected at Basement water. Go and check it now.' }];
  await n.evaluate(state(wet, 'demo'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers.Priority, '5');
  assert.match(sent[0].body, /Basement water/);
  await n.evaluate(state(wet, 'demo'));
  assert.equal(sent.length, 1, 'no repeat inside the cooldown');
  advance(31 * 60000);
  await n.evaluate(state(wet, 'demo'));
  assert.equal(sent.length, 2, 'repeats after 30 minutes');
  await n.evaluate(state([], 'demo'));
  assert.equal(sent.length, 3);
  assert.match(sent[2].body, /Basement water no longer reports water/);
});

test('water leak stays silent when its trigger is off', async () => {
  const { n, sent } = rig();
  await n.evaluate(state([{ level: 'bad', key: 'leak9', text: 'Water detected at X. Go and check it now.' }], 'live'));
  assert.equal(sent.length, 0);
});
