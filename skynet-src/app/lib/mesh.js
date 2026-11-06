'use strict';
const { EventEmitter } = require('events');
const { Live } = require('./live');
const { Demo } = require('./demo');

const MAX_MESSAGES = 3000, MAX_TRAIL = 600;
const TRAIL_MIN_MOVE_M = 15;

function meters(a, b) {
  const dy = (a.lat - b.lat) * 111320;
  const dx = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(dx, dy);
}
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

class Mesh extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.src = null;
    this.mode = 'demo';
    this.status = { connected: false };
    this.me = null;
    this.nodes = {};
    this.trails = {};
    this.messages = [];
    this.activity = []; this.actSeq = 0; // recent packets (memory only), drives the map pulses
  }
  _act(dir, from, to, kind, snr) {
    this.activity.push({ id: ++this.actSeq, ts: Date.now(), dir, from, to: to || '^all', kind, snr: typeof snr === 'number' ? snr : undefined });
    if (this.activity.length > 30) this.activity.splice(0, this.activity.length - 30);
    this.emit('change', 'activity');
  }
  _packet(p) {
    const kinds = { 1: 'text', 3: 'position', 4: 'node info', 67: 'telemetry' };
    const mine = !!this.me && p.from === this.me;
    if (mine && p.portnum === 1) return; // our own sent text is logged by send()
    this._act(mine ? 'tx' : 'rx', p.from, p.to, kinds[p.portnum] || 'data', p.snr);
  }
  start() {
    this.stop();
    const s = this.store.data.settings;
    this.mode = s.mode === 'live' ? 'live' : 'demo';
    this.status = { connected: false };
    this.me = null; this.activity = [];
    if (this.mode === 'live') {
      this.nodes = this.store.data.nodes; this.trails = this.store.data.trails; this.messages = this.store.data.messages;
      this.src = new Live({ host: s.host, port: s.port });
    } else {
      this.nodes = {}; this.trails = {}; this.messages = [];
      this.src = new Demo();
    }
    const src = this.src;
    src.on('myinfo', (id) => { this.me = id; this.emit('change', 'nodes'); });
    src.on('status', (st) => { this.status = { ...this.status, ...st }; this.emit('change', 'status'); });
    src.on('node', (n) => this._node(n));
    src.on('text', (t) => this._text(t));
    src.on('packet', (p) => this._packet(p));
    src.start();
  }
  stop() {
    if (this.src) { this.src.removeAllListeners(); this.src.stop(); this.src = null; }
  }
  _persist() { if (this.mode === 'live') this.store.save(); }
  _node(u) {
    if (!u || !u.id) return;
    const prev = this.nodes[u.id] || { id: u.id };
    const n = { ...prev };
    for (const k of ['long', 'short']) if (u[k]) n[k] = clean(u[k], 40);
    for (const k of ['lat', 'lon', 'alt', 'battery', 'voltage', 'chUtil', 'airTx', 'uptime', 'snr', 'rssi', 'hops']) {
      if (typeof u[k] === 'number' && Number.isFinite(u[k])) n[k] = u[k];
    }
    n.lastHeard = Math.max(prev.lastHeard || 0, u.lastHeard || Math.floor(Date.now() / 1000));
    this.nodes[u.id] = n;
    if (this.mode === 'demo' && u.id !== this.me) this._act('rx', u.id, '^all', typeof u.lat === 'number' ? 'position' : 'telemetry', u.snr);
    if (typeof u.lat === 'number' && typeof u.lon === 'number') this._trail(n.id, u);
    this._persist();
    this.emit('change', 'nodes');
  }
  _trail(id, u) {
    const t = this.trails[id] = this.trails[id] || [];
    const last = t[t.length - 1];
    const pt = { t: Date.now(), lat: u.lat, lon: u.lon };
    if (typeof u.snr === 'number' && id !== this.me) pt.snr = u.snr;
    if (!last || meters(last, pt) >= TRAIL_MIN_MOVE_M) {
      t.push(pt);
      if (t.length > MAX_TRAIL) t.splice(0, t.length - MAX_TRAIL);
    }
  }
  _text(t) {
    const m = {
      id: this.store.id(), ts: t.ts || Date.now(), from: t.from, to: t.to || '^all', channel: t.channel || 0,
      text: clean(t.text, 500), snr: t.snr, mine: t.from === this.me && !!this.me
    };
    this.messages.push(m);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    this._persist();
    this.emit('change', 'messages');
  }
  send(text, to) {
    text = clean(text, 200);
    if (!text) return { ok: false, error: 'empty message' };
    if (!this.src) return { ok: false, error: 'not running' };
    if (this.mode === 'live' && !this.status.connected) return { ok: false, error: 'node not connected' };
    const ok = this.src.sendText(text, to || '^all', 0);
    if (!ok) return { ok: false, error: 'send failed' };
    this._text({ from: this.me || 'me', to: to || '^all', text, ts: Date.now() });
    this._act('tx', this.me || 'me', to || '^all', 'text');
    return { ok: true };
  }
  alerts() {
    const s = this.store.data.settings, now = Date.now() / 1000, out = [];
    for (const n of Object.values(this.nodes)) {
      if (n.id === this.me) continue;
      const name = n.long || n.short || n.id;
      const age = now - (n.lastHeard || 0);
      if (age > s.staleMinutes * 60 && age < 7 * 86400) out.push({ type: 'silent', node: n.id, msg: `${name} has not been heard for ${Math.round(age / 60)} min` });
      if (typeof n.battery === 'number' && n.battery <= s.lowBattery && n.battery <= 100) out.push({ type: 'lowbat', node: n.id, msg: `${name} battery at ${n.battery}%` });
    }
    return out;
  }
  coverage() {
    // Where portable nodes were heard from the base, bucketed to ~55 m cells.
    const cells = new Map();
    for (const [id, t] of Object.entries(this.trails)) {
      if (id === this.me) continue;
      for (const p of t) {
        if (typeof p.snr !== 'number') continue;
        const k = Math.round(p.lat * 2000) + ':' + Math.round(p.lon * 2000);
        const c = cells.get(k);
        if (!c || p.snr > c.snr) cells.set(k, { lat: p.lat, lon: p.lon, snr: p.snr });
      }
    }
    return [...cells.values()];
  }
  snapshot() {
    return {
      mode: this.mode, status: this.status, me: this.me,
      nodes: Object.values(this.nodes), alerts: this.alerts(), activity: this.activity.slice(), now: Date.now()
    };
  }
}

module.exports = { Mesh, meters };
