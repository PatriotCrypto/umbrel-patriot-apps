'use strict';
// Client for zwave-js-server (the WebSocket server inside Z-Wave JS UI).
// Uses Node's built-in WebSocket, so there are no extra dependencies.
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

const CC = { BINARY_SENSOR: 48, SENSOR: 49, MODE: 64, OPSTATE: 66, SETPOINT: 67, FAN: 68, NOTIFICATION: 113, BATTERY: 128 };
const MODE_NAME = { 0: 'off', 1: 'heat', 2: 'cool', 3: 'auto' };
const MODE_NUM = { off: 0, heat: 1, cool: 2, auto: 3 };
const OP_NAME = { 0: 'idle', 1: 'heating', 2: 'cooling', 3: 'fan' };
const FAN_NAME = { 0: 'auto', 1: 'on' };
const FAN_NUM = { auto: 0, on: 1 };

const round1 = (v) => Math.round(v * 10) / 10;
const toF = (v, unit) => (unit && /C/i.test(unit) ? round1((v * 9) / 5 + 32) : v);
const fromF = (v, unit) => (unit && /C/i.test(unit) ? Math.round(((v - 32) * 5) / 9 * 2) / 2 : Math.round(v));

const keyOf = (cc, ep, prop, pk) => `${cc}:${ep || 0}:${prop}:${pk === undefined || pk === null ? '' : pk}`;

class ZWaveAdapter extends EventEmitter {
  constructor({ url, thermostatNode = null, WebSocketImpl = globalThis.WebSocket } = {}) {
    super();
    this.url = url;
    this.preferred = thermostatNode;
    this.WS = WebSocketImpl;
    this.kind = 'zwave';
    this.connected = false;
    this.error = 'Not started';
    this.nodes = new Map(); // nodeId -> {nodeId, name, location, values: Map, lastSeen}
    this.pending = new Map();
    this._backoff = 2000;
    this._stopped = false;
  }

  start() {
    this._stopped = false; this._connect();
    // The thermostat is mains powered but only reports when something changes. Ask it every few minutes so a steady room
    // is not mistaken for a silent device, and so mode/setpoint changes made at the wall are noticed quickly.
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => this._pollThermostat().catch(() => {}), this.pollMs || 4 * 60000);
    this._pollTimer.unref?.();
    setTimeout(() => this._pollThermostat().catch(() => {}), 20000).unref?.();
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._retry); clearInterval(this._pollTimer);
    try { this.ws?.close(); } catch { /* ignore */ }
    this.connected = false;
  }

  async _pollThermostat() {
    if (!this.connected || this._polling) return;
    const node = this._findThermostat();
    if (!node) return;
    this._polling = true;
    try {
      let heard = false;
      for (const [k, v] of node.values) {
        const cc = Number(k.split(':')[0]);
        if (![CC.SENSOR, CC.MODE, CC.OPSTATE, CC.SETPOINT, CC.FAN].includes(cc) || !v.id) continue;
        const r = await this._send('node.poll_value', { nodeId: node.nodeId, valueId: v.id }, 15000).catch(() => null);
        if (!r) continue;
        heard = true;
        if (r.value !== undefined && r.value !== null && r.value !== v.value) node.values.set(k, { ...v, value: r.value });
      }
      if (heard) { node.lastSeen = Date.now(); this.emit('update'); }
    } finally { this._polling = false; }
  }

  /** Drop the connection and start over (the Reconnect button). */
  reconnect() { this.stop(); this._backoff = 2000; this.error = 'Reconnecting'; this.start(); }

  setPreferredNode(id) { this.preferred = id ? Number(id) : null; }

  _connect() {
    if (this._stopped) return;
    if (!this.WS) { this.error = 'WebSocket is not available in this Node version'; return; }
    try {
      this.ws = new this.WS(this.url);
    } catch (e) { this.error = e.message; this._reconnect(); return; }
    this.ws.onopen = () => {
      this.error = 'Connected, loading nodes';
      // Z-Wave JS UI accepts connections before its driver has finished opening the stick, so the first request can fail or
      // stall during an app restart or update. Don't sit on a half-open socket: drop it and try again shortly.
      const sock = this.ws;
      this._send('start_listening', {}, 30000).then((res) => { this._load(res); this.connected = true; this.error = null; this._backoff = 2000; this.emit('update'); })
        .catch((e) => { this.error = `Could not load Z-Wave state (${e.message}), retrying`; try { sock.close(); } catch { /* ignore */ } });
    };
    this.ws.onmessage = (ev) => { try { this._onMessage(JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data))); } catch { /* ignore bad frame */ } };
    this.ws.onerror = () => { if (!this.connected) this.error = `Cannot reach the Z-Wave JS server at ${this.url}. Is the Z-Wave JS UI container running with its WS server turned on?`; };
    this.ws.onclose = () => {
      this.connected = false;
      for (const [, p] of this.pending) p.reject(new Error('connection closed'));
      this.pending.clear();
      if (!this.error || this.error === 'Connected, loading nodes') this.error = 'Disconnected from Z-Wave JS server';
      this._reconnect();
    };
  }

  _reconnect() {
    if (this._stopped) return;
    clearTimeout(this._retry);
    this._retry = setTimeout(() => this._connect(), this._backoff);
    this._retry.unref?.();
    this._backoff = Math.min(this._backoff * 2, 15000);
  }

  _send(command, args = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) return reject(new Error('not connected'));
      const messageId = crypto.randomUUID();
      const timer = setTimeout(() => { this.pending.delete(messageId); reject(new Error(`${command} timed out`)); }, timeout);
      this.pending.set(messageId, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ messageId, command, ...args }));
    });
  }

  _load(result) {
    this.nodes.clear();
    for (const n of result?.state?.nodes || []) this._ingestNode(n);
  }

  _ingestNode(n) {
    const node = { nodeId: n.nodeId, name: n.name || '', location: n.location || '', values: new Map(), lastSeen: n.lastSeen ? Date.parse(n.lastSeen) || Date.now() : null };
    for (const v of n.values || []) {
      node.values.set(keyOf(v.commandClass, v.endpoint, v.property, v.propertyKey), { value: v.value, unit: v.metadata?.unit, id: { commandClass: v.commandClass, endpoint: v.endpoint || 0, property: v.property, ...(v.propertyKey !== undefined ? { propertyKey: v.propertyKey } : {}) } });
    }
    this.nodes.set(node.nodeId, node);
  }

  /** Feed one parsed server message (also used by tests). */
  _onMessage(msg) {
    if (msg.type === 'result') {
      const p = this.pending.get(msg.messageId);
      if (!p) return;
      this.pending.delete(msg.messageId);
      if (msg.success) p.resolve(msg.result); else p.reject(new Error(msg.error?.message || msg.errorCode || 'command failed'));
      return;
    }
    if (msg.type !== 'event' || !msg.event) return;
    const e = msg.event;
    if (e.source !== 'node') return;
    if (e.event === 'value updated' || e.event === 'value added') {
      const a = e.args || {};
      let node = this.nodes.get(e.nodeId);
      if (!node) { node = { nodeId: e.nodeId, name: '', location: '', values: new Map(), lastSeen: null }; this.nodes.set(e.nodeId, node); }
      const k = keyOf(a.commandClass, a.endpoint, a.property, a.propertyKey);
      const prev = node.values.get(k);
      node.values.set(k, { value: a.newValue, unit: a.metadata?.unit || prev?.unit, id: prev?.id || { commandClass: a.commandClass, endpoint: a.endpoint || 0, property: a.property, ...(a.propertyKey !== undefined ? { propertyKey: a.propertyKey } : {}) } });
      node.lastSeen = Date.now();
      this.emit('update');
    } else if (e.event === 'node removed') {
      this.nodes.delete(e.nodeId);
      this.emit('update');
    } else if (e.event === 'wake up' || e.event === 'alive') {
      const node = this.nodes.get(e.nodeId);
      if (node) node.lastSeen = Date.now();
    }
  }

  _get(node, cc, prop, pk, ep = 0) { return node.values.get(keyOf(cc, ep, prop, pk)); }

  /** Is this node a water leak sensor, and is it wet right now? Reads the Water Alarm notification (or a binary Water sensor). */
  _leakState(node) {
    let found = false; let wet = false;
    for (const [, v] of node.values) {
      const id = v.id || {};
      if (id.commandClass === CC.NOTIFICATION && /^water alarm$/i.test(String(id.property))) {
        // "Sensor status" is the leak flag: 0 = dry, 1 or 2 = leak detected. Other water keys (like water level) do not count.
        if (id.propertyKey === undefined || /sensor status/i.test(String(id.propertyKey))) {
          found = true;
          if (typeof v.value === 'number' && v.value !== 0) wet = true;
        }
      } else if (id.commandClass === CC.BINARY_SENSOR && /^water$/i.test(String(id.property))) {
        found = true;
        if (v.value === true) wet = true;
      }
    }
    return found ? { wet } : null;
  }

  _findThermostat() {
    const has = (n) => this._get(n, CC.SETPOINT, 'setpoint', 1) || this._get(n, CC.SETPOINT, 'setpoint', 2);
    if (this.preferred && this.nodes.get(this.preferred) && has(this.nodes.get(this.preferred))) return this.nodes.get(this.preferred);
    for (const n of this.nodes.values()) if (has(n)) return n;
    return null;
  }

  snapshot() {
    const t = this._findThermostat();
    const out = { connected: this.connected, kind: 'zwave', error: this.error, thermostat: null, sensors: [] };
    if (t) {
      const sp1 = this._get(t, CC.SETPOINT, 'setpoint', 1);
      const sp2 = this._get(t, CC.SETPOINT, 'setpoint', 2);
      const temp = this._get(t, CC.SENSOR, 'Air temperature');
      const hum = this._get(t, CC.SENSOR, 'Humidity');
      const mode = this._get(t, CC.MODE, 'mode');
      const op = this._get(t, CC.OPSTATE, 'state');
      const fan = this._get(t, CC.FAN, 'mode');
      out.thermostat = {
        nodeId: t.nodeId,
        temp: temp && typeof temp.value === 'number' ? toF(temp.value, temp.unit) : null,
        humidity: hum && typeof hum.value === 'number' ? hum.value : null,
        mode: MODE_NAME[mode?.value] || null,
        opState: OP_NAME[op?.value] || 'idle',
        fan: FAN_NAME[fan?.value] || null,
        heat: sp1 && typeof sp1.value === 'number' ? toF(sp1.value, sp1.unit) : null,
        cool: sp2 && typeof sp2.value === 'number' ? toF(sp2.value, sp2.unit) : null,
        lastSeen: t.lastSeen || Date.now(),
      };
    }
    out.leaks = [];
    for (const n of this.nodes.values()) {
      if (t && n.nodeId === t.nodeId) continue;
      const leak = this._leakState(n);
      if (leak) {
        const lbat = this._get(n, CC.BATTERY, 'level');
        const ltemp = this._get(n, CC.SENSOR, 'Air temperature');
        out.leaks.push({
          nodeId: n.nodeId,
          name: n.name || n.location || `Water sensor ${n.nodeId}`,
          wet: leak.wet,
          battery: lbat && typeof lbat.value === 'number' ? lbat.value : null,
          temp: ltemp && typeof ltemp.value === 'number' ? toF(ltemp.value, ltemp.unit) : null,
          lastSeen: n.lastSeen || Date.now(),
        });
        continue; // a leak sensor is listed under water sensors, not rooms
      }
      const temp = this._get(n, CC.SENSOR, 'Air temperature');
      const hum = this._get(n, CC.SENSOR, 'Humidity');
      if (!temp && !hum) continue;
      const bat = this._get(n, CC.BATTERY, 'level');
      out.sensors.push({
        nodeId: n.nodeId,
        name: n.name || n.location || `Node ${n.nodeId}`,
        temp: temp && typeof temp.value === 'number' ? toF(temp.value, temp.unit) : null,
        humidity: hum && typeof hum.value === 'number' ? hum.value : null,
        battery: bat && typeof bat.value === 'number' ? bat.value : null,
        lastSeen: n.lastSeen || Date.now(),
      });
    }
    return out;
  }

  async _write(node, cc, prop, pk, value) {
    const v = this._get(node, cc, prop, pk);
    if (!v) throw new Error(`Thermostat has no ${prop}${pk ? ` (${pk})` : ''} value`);
    const res = await this._send('node.set_value', { nodeId: node.nodeId, valueId: v.id, value }, 20000);
    const st = res && res.result && res.result.status;
    // Z-Wave status 2 = Fail, 1 = no device support. 0/3/254/255 = success / working / sent.
    if (st === 1 || st === 2) throw new Error('The thermostat did not accept the change (it may be asleep or out of range)');
    // show the new value right away, then confirm with the device a few seconds later
    node.values.set(keyOf(cc, 0, prop, pk), { ...v, value });
    node.lastSeen = Date.now();
    this.emit('update');
    // Ask the thermostat what it really holds and trust that over our local echo. zwave-js sends no
    // "value updated" event when the device still holds the old value, so apply the poll result ourselves.
    const confirm = () => this._send('node.poll_value', { nodeId: node.nodeId, valueId: v.id }, 15000).then((r) => {
      if (r && r.value !== undefined && r.value !== null) {
        const cur = node.values.get(keyOf(cc, 0, prop, pk));
        if (cur && cur.value !== r.value) { node.values.set(keyOf(cc, 0, prop, pk), { ...cur, value: r.value }); this.emit('update'); }
      }
    }).catch(() => {});
    setTimeout(confirm, 6000);
    setTimeout(confirm, 25000);
  }

  async setSetpoints({ heat, cool }) {
    const t = this._findThermostat();
    if (!t) throw new Error('No thermostat found');
    const jobs = [];
    if (heat != null) { const v = this._get(t, CC.SETPOINT, 'setpoint', 1); if (v) jobs.push(this._write(t, CC.SETPOINT, 'setpoint', 1, fromF(heat, v.unit))); }
    if (cool != null) { const v = this._get(t, CC.SETPOINT, 'setpoint', 2); if (v) jobs.push(this._write(t, CC.SETPOINT, 'setpoint', 2, fromF(cool, v.unit))); }
    await Promise.all(jobs);
  }

  async setMode(mode) {
    const t = this._findThermostat();
    if (!t) throw new Error('No thermostat found');
    if (!(mode in MODE_NUM)) throw new Error('bad mode');
    await this._write(t, CC.MODE, 'mode', undefined, MODE_NUM[mode]);
  }

  async setFan(fan) {
    const t = this._findThermostat();
    if (!t) throw new Error('No thermostat found');
    if (!(fan in FAN_NUM)) throw new Error('bad fan mode');
    await this._write(t, CC.FAN, 'mode', undefined, FAN_NUM[fan]);
  }
}

module.exports = { ZWaveAdapter, toF, fromF, CC };
