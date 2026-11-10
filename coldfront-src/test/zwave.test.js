'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ZWaveAdapter, toF, fromF } = require('../lib/zwave');

// Shaped like zwave-js-server's start_listening result (trimmed to the values we read).
const v = (commandClass, property, value, extra = {}) => ({ commandClass, endpoint: 0, property, value, ...extra });
const STATE = {
  state: {
    nodes: [
      { nodeId: 1, values: [] },
      { nodeId: 2, name: 'Thermostat', values: [
        v(49, 'Air temperature', 69.5, { metadata: { unit: '°F' } }),
        v(49, 'Humidity', 38),
        v(64, 'mode', 3),
        v(66, 'state', 1),
        v(67, 'setpoint', 68, { propertyKey: 1, metadata: { unit: '°F' } }),
        v(67, 'setpoint', 76, { propertyKey: 2, metadata: { unit: '°F' } }),
        v(68, 'mode', 0),
      ] },
      { nodeId: 7, name: 'Bedroom', values: [v(49, 'Air temperature', 20, { metadata: { unit: '°C' } }), v(49, 'Humidity', 44), v(128, 'level', 88)] },
    ],
  },
};

class FakeWS {
  constructor(url) { this.url = url; this.readyState = 1; this.sent = []; FakeWS.last = this; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.onclose?.(); }
}

function adapter() {
  const a = new ZWaveAdapter({ url: 'ws://x', WebSocketImpl: FakeWS });
  a._load(STATE);
  a.connected = true;
  a.ws = new FakeWS('ws://x');
  return a;
}

test('unit conversion', () => {
  assert.equal(toF(20, '°C'), 68);
  assert.equal(toF(68, '°F'), 68);
  assert.equal(fromF(68, '°C'), 20);
  assert.equal(fromF(69.4, '°F'), 69);
});

test('snapshot finds the thermostat and sensors', () => {
  const s = adapter().snapshot();
  assert.equal(s.thermostat.nodeId, 2);
  assert.equal(s.thermostat.temp, 69.5);
  assert.equal(s.thermostat.humidity, 38);
  assert.equal(s.thermostat.mode, 'auto');
  assert.equal(s.thermostat.opState, 'heating');
  assert.equal(s.thermostat.heat, 68);
  assert.equal(s.thermostat.cool, 76);
  assert.equal(s.sensors.length, 1);
  assert.equal(s.sensors[0].name, 'Bedroom');
  assert.equal(s.sensors[0].temp, 68); // 20 C
  assert.equal(s.sensors[0].battery, 88);
});

test('value updated events change the snapshot', () => {
  const a = adapter();
  a._onMessage({ type: 'event', event: { source: 'node', event: 'value updated', nodeId: 2, args: { commandClass: 67, endpoint: 0, property: 'setpoint', propertyKey: 1, newValue: 71 } } });
  a._onMessage({ type: 'event', event: { source: 'node', event: 'value updated', nodeId: 2, args: { commandClass: 66, endpoint: 0, property: 'state', newValue: 0 } } });
  const s = a.snapshot();
  assert.equal(s.thermostat.heat, 71);
  assert.equal(s.thermostat.opState, 'idle');
});

test('removed nodes disappear', () => {
  const a = adapter();
  a._onMessage({ type: 'event', event: { source: 'node', event: 'node removed', nodeId: 7 } });
  assert.equal(a.snapshot().sensors.length, 0);
});

test('setSetpoints sends node.set_value with the right value ids', async () => {
  const a = adapter();
  const p = a.setSetpoints({ heat: 70, cool: 77 });
  await new Promise((r) => setImmediate(r));
  const first = a.ws.sent[0];
  assert.equal(first.command, 'node.set_value');
  assert.equal(first.nodeId, 2);
  assert.deepEqual(first.valueId, { commandClass: 67, endpoint: 0, property: 'setpoint', propertyKey: 1 });
  assert.equal(first.value, 70);
  a._onMessage({ type: 'result', messageId: first.messageId, success: true, result: {} });
  await new Promise((r) => setImmediate(r));
  const second = a.ws.sent[1];
  assert.equal(second.valueId.propertyKey, 2);
  assert.equal(second.value, 77);
  a._onMessage({ type: 'result', messageId: second.messageId, success: true, result: {} });
  await p;
});

test('failed commands reject with the server message', async () => {
  const a = adapter();
  const p = a.setMode('heat');
  await new Promise((r) => setImmediate(r));
  a._onMessage({ type: 'result', messageId: a.ws.sent[0].messageId, success: false, error: { message: 'node is dead' } });
  await assert.rejects(p, /node is dead/);
});

test('setMode sends the numeric mode', async () => {
  const a = adapter();
  const p = a.setMode('cool');
  await new Promise((r) => setImmediate(r));
  assert.equal(a.ws.sent[0].value, 2);
  assert.deepEqual(a.ws.sent[0].valueId, { commandClass: 64, endpoint: 0, property: 'mode' });
  a._onMessage({ type: 'result', messageId: a.ws.sent[0].messageId, success: true, result: {} });
  await p;
});

test('writes in Celsius when the thermostat is in Celsius', async () => {
  const a = adapter();
  a.nodes.get(2).values.get('67:0:setpoint:1').unit = '°C';
  const p = a.setSetpoints({ heat: 70 });
  await new Promise((r) => setImmediate(r));
  assert.equal(a.ws.sent[0].value, 21);
  a._onMessage({ type: 'result', messageId: a.ws.sent[0].messageId, success: true, result: {} });
  await p;
});

test('no thermostat paired gives a null thermostat, not a crash', () => {
  const a = new ZWaveAdapter({ url: 'ws://x', WebSocketImpl: FakeWS });
  a._load({ state: { nodes: [{ nodeId: 1, values: [] }] } });
  a.connected = true;
  assert.equal(a.snapshot().thermostat, null);
});

test('a water leak sensor is listed as a leak sensor, not a room, and reports wet or dry', () => {
  const a = adapter();
  a._ingestNode({ nodeId: 9, name: 'Basement water', values: [
    v(113, 'Water Alarm', 0, { propertyKey: 'Sensor status' }),
    v(128, 'level', 77),
  ] });
  let snap = a.snapshot();
  assert.equal(snap.leaks.length, 1);
  assert.deepEqual({ id: snap.leaks[0].nodeId, name: snap.leaks[0].name, wet: snap.leaks[0].wet, battery: snap.leaks[0].battery }, { id: 9, name: 'Basement water', wet: false, battery: 77 });
  assert.ok(!snap.sensors.some((s) => s.nodeId === 9), 'not in the room list');
  a._onMessage({ type: 'event', event: { source: 'node', event: 'value updated', nodeId: 9, args: { commandClass: 113, endpoint: 0, property: 'Water Alarm', propertyKey: 'Sensor status', newValue: 2 } } });
  snap = a.snapshot();
  assert.equal(snap.leaks[0].wet, true);
  a._onMessage({ type: 'event', event: { source: 'node', event: 'value updated', nodeId: 9, args: { commandClass: 113, endpoint: 0, property: 'Water Alarm', propertyKey: 'Sensor status', newValue: 0 } } });
  assert.equal(a.snapshot().leaks[0].wet, false);
});

test('a node with only a binary water sensor also counts, and room sensors are not mistaken for leak sensors', () => {
  const a = adapter();
  a._ingestNode({ nodeId: 10, values: [v(48, 'Water', true)] });
  const snap = a.snapshot();
  assert.equal(snap.leaks.find((l) => l.nodeId === 10).wet, true);
  assert.equal(snap.leaks.length, 1);
  assert.ok(snap.sensors.some((s) => s.nodeId === 7));
});

test('a failed first load (Z-Wave JS still opening the stick) drops the socket and reconnects on its own', async () => {
  const sockets = [];
  class WS {
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); setImmediate(() => this.onopen?.()); }
    send(s) {
      const m = JSON.parse(s); this.sent.push(m);
      // first socket: server says the driver is not ready; second socket: success
      setImmediate(() => this.onmessage?.({ data: JSON.stringify(sockets.length === 1 ? { type: 'result', messageId: m.messageId, success: false, errorCode: 'driver_not_ready' } : { type: 'result', messageId: m.messageId, success: true, result: STATE }) }));
    }
    close() { this.readyState = 3; setImmediate(() => this.onclose?.()); }
  }
  const a = new ZWaveAdapter({ url: 'ws://x', WebSocketImpl: WS });
  a._backoff = 10;
  a.start();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(sockets.length >= 2, true, 'tried again');
  assert.equal(a.connected, true);
  a.stop();
});
