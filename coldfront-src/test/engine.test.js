'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Store } = require('../lib/store');
const { Engine } = require('../lib/engine');

// Tue 2026-11-03 07:00 EST (Wake period, 70/76)
const T0 = Date.parse('2026-11-03T12:00:00Z');

class FakeAdapter extends EventEmitter {
  constructor() { super(); this.kind = 'fake'; this.connected = true; this.writes = []; this.th = { nodeId: 2, temp: 68, humidity: 40, mode: 'auto', opState: 'idle', fan: 'auto', heat: 64, cool: 80, lastSeen: T0 }; this.sensors = []; this.fail = false; }
  snapshot() { return { connected: this.connected, kind: 'fake', error: null, thermostat: this.th, sensors: this.sensors }; }
  async setSetpoints(p) { if (this.fail) throw new Error('boom'); this.writes.push(p); if (p.heat != null) this.th.heat = p.heat; if (p.cool != null) this.th.cool = p.cool; }
}

function setup(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldfront-'));
  const store = new Store(dir).load();
  Object.assign(store.data.settings, { tz: 'America/New_York' }, over);
  let t = T0;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const engine = new Engine(store, { now: clock.now });
  const adapter = new FakeAdapter();
  engine.setAdapter(adapter, { persist: true });
  return { store, engine, adapter, clock, dir };
}

test('first tick pushes the schedule to a thermostat that disagrees', async () => {
  const { engine, adapter } = setup();
  await engine.tick();
  assert.deepEqual(adapter.writes, [{ heat: 70, cool: 76 }]);
  assert.equal(engine.last.status, 'ok');
});

test('no write when the thermostat already matches', async () => {
  const { engine, adapter } = setup();
  adapter.th.heat = 70; adapter.th.cool = 76;
  await engine.tick();
  assert.equal(adapter.writes.length, 0);
});

test('enforce off only observes', async () => {
  const { engine, adapter } = setup({ enforce: false });
  await engine.tick();
  assert.equal(adapter.writes.length, 0);
  assert.equal(engine.last.status, 'observing');
});

test('a change at the wall becomes a hold until the next period', async () => {
  const { engine, adapter, clock, store } = setup();
  await engine.tick(); // pushes 70/76
  clock.advance(5 * 60000); // 07:05, outside the 3 minute grace window
  adapter.th.heat = 73; // someone turns it up at the wall
  await engine.tick();
  assert.equal(store.data.hold.source, 'wall');
  assert.equal(store.data.hold.heat, 73);
  assert.equal(store.data.hold.until, '2026-11-03T13:30:00.000Z'); // Away at 08:30 EST
  assert.equal(store.data.events.some((e) => e.type === 'external'), true);
  assert.equal(adapter.writes.length, 1, 'Cold Front must not fight the wall change');
});

test('revert policy puts the schedule back', async () => {
  const { engine, adapter, clock, store } = setup({ wallChange: 'revert' });
  await engine.tick();
  clock.advance(5 * 60000);
  adapter.th.heat = 73;
  await engine.tick();
  assert.equal(store.data.hold, null);
  assert.deepEqual(adapter.writes.at(-1), { heat: 70, cool: null });
});

test('changes right at a period start are not treated as wall changes', async () => {
  const { engine, adapter, clock, store } = setup();
  clock.advance(-60 * 60000); // 06:00 exactly, Wake starts
  await engine.tick();
  clock.advance(60000); // 06:01
  adapter.th.heat = 71; // the thermostat's own onboard schedule disagreeing slightly
  await engine.tick();
  assert.equal(store.data.hold, null);
  assert.equal(store.data.events.some((e) => e.type === 'external'), false);
});

test('own writes are not mistaken for external changes while the thermostat catches up', async () => {
  const { engine, adapter, clock, store } = setup();
  await engine.tick();
  adapter.th.heat = 64; // thermostat has not reported our write yet
  clock.advance(30000);
  await engine.tick();
  assert.equal(store.data.hold, null);
});

test('holds expire and the schedule resumes', async () => {
  const { engine, adapter, clock, store } = setup();
  adapter.th.heat = 70; adapter.th.cool = 76;
  engine.setHold({ heat: 72, cool: 78, until: 1 });
  await engine.tick();
  assert.deepEqual(adapter.writes.at(-1), { heat: 72, cool: 78 });
  clock.advance(61 * 60000);
  await engine.tick();
  assert.equal(store.data.hold, null);
  assert.deepEqual(adapter.writes.at(-1), { heat: 70, cool: 76 });
});

test('holds are clamped to the safety limits', () => {
  const { engine } = setup();
  const h = engine.setHold({ heat: 95, cool: 60, until: 'next' });
  assert.equal(h.heat, 78);
  assert.equal(h.cool, 81);
});

test('a failed write is reported and retried after the gap', async () => {
  const { engine, adapter, clock } = setup();
  adapter.fail = true;
  await engine.tick();
  assert.equal(engine.last.status, 'write-failed');
  assert.ok(engine.alerts(adapter.snapshot(), clock.now()).some((a) => a.key === 'write'));
  adapter.fail = false;
  clock.advance(61000);
  await engine.tick();
  assert.equal(engine.last.status, 'ok');
});

test('away mode wins over the schedule and ends on time', async () => {
  const { engine, adapter, clock } = setup();
  engine.setAway({ on: true, hours: 2 });
  await engine.tick();
  assert.equal(engine.last.desired.source, 'away');
  clock.advance(3 * 3600000);
  await engine.tick();
  assert.equal(engine.last.desired.source, 'schedule');
});

test('runs and samples are recorded', async () => {
  const { engine, adapter, clock } = setup();
  adapter.th.opState = 'heating';
  await engine.tick();
  clock.advance(10 * 60000);
  adapter.th.opState = 'idle';
  await engine.tick();
  const runs = engine.hist.runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].kind, 'heating');
  assert.equal((runs[0].end - runs[0].start) / 60000, 10);
  assert.ok(engine.hist.samples.length >= 1);
});

test('alerts: freeze, no-heat, humidity, battery', async () => {
  const { engine, adapter, clock } = setup();
  adapter.th.temp = 44; adapter.th.heat = 70; adapter.th.cool = 76;
  adapter.sensors = [{ nodeId: 21, name: 'Basement', temp: 50, humidity: 72, battery: 10, lastSeen: clock.now() }];
  await engine.tick();
  clock.advance(46 * 60000);
  adapter.th.lastSeen = clock.now(); adapter.sensors[0].lastSeen = clock.now();
  await engine.tick();
  const keys = engine.alerts(adapter.snapshot(), clock.now()).map((a) => a.key);
  for (const k of ['freeze', 'noheat', 'hum21', 'bat21']) assert.ok(keys.includes(k), `missing ${k}`);
});

test('room-aware raises the heat setpoint when the chosen room is cold, within the cap', async () => {
  const { engine, adapter, clock } = setup({ roomAware: { enabled: true, roomId: '21', maxOffset: 3 } });
  adapter.sensors = [{ nodeId: 21, name: 'Bedroom', temp: 66, humidity: 40, battery: 80, lastSeen: clock.now() }];
  await engine.tick();
  assert.deepEqual(adapter.writes.at(-1), { heat: 73, cool: 76 }); // 70 target, room 66 -> +4 capped at +3
});

test('disconnected adapter is reported, not crashed on', async () => {
  const { engine, adapter } = setup();
  adapter.connected = false;
  await engine.tick();
  assert.equal(engine.last.status, 'disconnected');
});

test('room sensors are recorded in history even before a thermostat is paired', async () => {
  const { engine, adapter, store } = setup();
  adapter.th = null;
  adapter.sensors = [{ nodeId: 2, temp: 74, humidity: 54, battery: 100, lastSeen: T0 }];
  await engine.tick();
  const s = engine.hist.samples.at(-1);
  assert.equal(s.in, null);
  assert.deepEqual(s.rooms[2], { t: 74, h: 54 });
});
