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

// Which conversation a message belongs to: '^all' (the shared channel) or the other person's node id.
function peerOf(m, me) {
  if (!m.to || m.to === '^all') return '^all';
  const mine = m.mine || m.from === 'me' || (!!me && m.from === me);
  return mine ? m.to : m.from;
}

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
    this.msgRev = 0;                      // bumps on every change to the message list, so browsers can tell they are behind
    this.link = { events: [], downSince: Date.now(), upSince: 0 }; // connection history (memory only)
  }
  _linkEvent(connected, why) {
    const L = this.link, now = Date.now();
    if (connected) { L.upSince = now; L.downSince = 0; L.events.push({ ts: now, ev: 'up' }); }
    else { L.downSince = now; L.upSince = 0; L.events.push({ ts: now, ev: 'down', why: why || '' }); }
    if (L.events.length > 30) L.events.splice(0, L.events.length - 30);
  }
  linkInfo() {
    const L = this.link, day = Date.now() - 86400000;
    return { upSince: L.upSince, downSince: L.downSince, drops24h: L.events.filter((e) => e.ev === 'down' && e.ts > day && e.why !== 'start').length, events: L.events.slice(-10) };
  }
  _bump() { this.msgRev++; this.emit('change', 'messages'); }
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
    this.link = { events: [], downSince: Date.now(), upSince: 0 };
    if (this.mode === 'live') {
      this.nodes = this.store.data.nodes; this.trails = this.store.data.trails; this.messages = this.store.data.messages;
      this.src = new Live({ host: s.host, port: s.port });
    } else {
      this.nodes = {}; this.trails = {}; this.messages = [];
      this.src = new Demo();
    }
    const src = this.src;
    src.on('myinfo', (id) => { this.me = id; this.emit('change', 'nodes'); });
    src.on('status', (st) => {
      const was = !!this.status.connected;
      this.status = { ...this.status, ...st };
      if (this.mode === 'live' && was !== !!this.status.connected) this._linkEvent(!!this.status.connected, this.status.error);
      this.emit('change', 'status');
    });
    src.on('node', (n) => this._node(n));
    src.on('text', (t) => this._text(t));
    src.on('packet', (p) => this._packet(p));
    src.start();
    this.sweepArchive();
    this.sweeper = setInterval(() => this.sweepArchive(), 3600000); if (this.sweeper.unref) this.sweeper.unref();
  }
  stop() {
    clearInterval(this.sweeper);
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
      text: clean(t.text, 500), snr: t.snr, mine: !!t.mine || (t.from === this.me && !!this.me)
    };
    this.messages.push(m);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    this._persist();
    this._bump();
  }
  // ---- housekeeping: archive / delete messages, clear alerts, forget nodes ----
  _match(f) { // f: { ids, scope: 'all'|'everyone'|'private'|<node id>, before: ms, archived: true|false }
    const ids = f.ids ? new Set(f.ids) : null, me = this.me;
    return this.messages.filter((m) => {
      if (ids && !ids.has(m.id)) return false;
      if (f.archived !== undefined && !!m.archived !== f.archived) return false;
      if (f.before && !(m.ts < f.before)) return false;
      const sc = f.scope || 'all';
      if (sc !== 'all') { const p = peerOf(m, me); if (sc === 'everyone' ? p !== '^all' : sc === 'private' ? p === '^all' : p !== sc) return false; }
      return true;
    });
  }
  archive(f, on = true) { const hit = this._match({ ...f, archived: !on }); for (const m of hit) { if (on) m.archived = true; else delete m.archived; } if (hit.length) { this._persist(); this._bump(); } return hit.length; }
  remove(f) { const hit = new Set(this._match(f)); if (!hit.size) return 0; this.messages = this.messages.filter((m) => !hit.has(m)); if (this.mode === 'live') this.store.data.messages = this.messages; this._persist(); this._bump(); return hit.size; }
  sweepArchive() {
    const d = this.store.data.settings.archiveDays;
    if (d > 0) this.archive({ before: Date.now() - d * 86400000 }, true);
  }
  dismiss(key) {
    const D = this.store.data.dismissed = this.store.data.dismissed || {};
    if (key === 'all') { for (const a of this._rawAlerts()) D[a.key] = 1; } else if (typeof key === 'string' && key.length < 80) D[key] = 1; else return false;
    this.store.save(); this.emit('change', 'nodes'); return true;
  }
  forget(id) {
    if (!this.nodes[id] || id === this.me) return false;
    delete this.nodes[id]; delete this.trails[id];
    if (this.mode === 'live') { this.store.data.nodes = this.nodes; this.store.data.trails = this.trails; }
    this._persist(); this.emit('change', 'nodes'); return true;
  }
  send(text, to) {
    text = clean(text, 200);
    if (!text) return { ok: false, error: 'empty message' };
    if (!this.src) return { ok: false, error: 'not running' };
    if (this.mode === 'live' && !this.status.connected) return { ok: false, error: 'node not connected' };
    const ok = this.src.sendText(text, to || '^all', 0);
    if (!ok) return { ok: false, error: 'send failed' };
    this._text({ from: this.me || 'me', to: to || '^all', text, ts: Date.now(), mine: true });
    this._act('tx', this.me || 'me', to || '^all', 'text');
    return { ok: true };
  }
  alerts() {
    const raw = this._rawAlerts(), D = this.store.data.dismissed || (this.store.data.dismissed = {});
    // A cleared alert stays cleared until its cause goes away (the node is heard again, the battery recovers).
    const live = new Set(raw.map((a) => a.key)); let changed = false;
    for (const k of Object.keys(D)) if (!live.has(k)) { delete D[k]; changed = true; }
    if (changed) this.store.save();
    return raw.filter((a) => !D[a.key]);
  }
  _rawAlerts() {
    const s = this.store.data.settings, now = Date.now() / 1000, out = [];
    for (const n of Object.values(this.nodes)) {
      if (n.id === this.me) continue;
      const name = n.long || n.short || n.id;
      const age = now - (n.lastHeard || 0);
      if (age > s.staleMinutes * 60 && age < 7 * 86400) out.push({ type: 'silent', key: 'silent:' + n.id, node: n.id, days: Math.floor(age / 86400), msg: `${name} has not been heard for ${age >= 172800 ? Math.floor(age / 86400) + ' days' : age >= 7200 ? Math.round(age / 3600) + ' hours' : Math.round(age / 60) + ' min'}` });
      if (typeof n.battery === 'number' && n.battery <= s.lowBattery && n.battery <= 100) out.push({ type: 'lowbat', key: 'lowbat:' + n.id, node: n.id, msg: `${name} battery at ${n.battery}%` });
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
      nodes: Object.values(this.nodes), alerts: this.alerts(), activity: this.activity.slice(), now: Date.now(),
      msgRev: this.msgRev, link: this.mode === 'live' ? this.linkInfo() : null
    };
  }
}

module.exports = { Mesh, meters, peerOf };
