'use strict';
// Demo mesh: fictional stations moving around a fictional spot, so the app is
// fully usable before a real node is connected. Nothing here is persisted.
const { EventEmitter } = require('events');

const CENTER = { lat: 39.5, lon: -98.35 }; // middle of the map; not a real station
const M_LAT = 1 / 111320;
const M_LON = (lat) => 1 / (111320 * Math.cos(lat * Math.PI / 180));

const LINES = [
  'Radio check, how copy?', 'Loud and clear', 'Heading out to the ridge', 'Back at base',
  'Battery swap in 10', 'Anyone on the net?', 'Coffee is hot', 'Copy that, 73',
  'Clouds rolling in from the west', 'Testing the new antenna'
];

class Demo extends EventEmitter {
  constructor() {
    super();
    this.t0 = Date.now();
    this.me = '!d3m00001';
    this.nodes = {
      '!d3m00001': { id: '!d3m00001', long: 'BASE (roof)', short: 'BASE', fixed: true, ox: 0, oy: 0, battery: 101, voltage: 5.0, hops: 0 },
      '!d3m00002': { id: '!d3m00002', long: 'OUTPOST', short: 'OUTP', fixed: true, ox: 1800, oy: 900, battery: 88, hops: 1 },
      '!d3m00003': { id: '!d3m00003', long: 'RIDGE', short: 'RDGE', ox: -900, oy: 1500, battery: 74, hops: 1, phase: 0 },
      '!d3m00004': { id: '!d3m00004', long: 'ROVER', short: 'RVR', ox: 600, oy: -700, battery: 92, hops: 0, phase: 2 },
      '!d3m00005': { id: '!d3m00005', long: 'TRAIL', short: 'TRL', ox: -1500, oy: -1100, battery: 31, hops: 2, phase: 4 }
    };
    this.silentTrail = false;
  }
  start() {
    this.emit('myinfo', this.me);
    this.emit('status', { connected: true, synced: true, demo: true });
    for (const n of Object.values(this.nodes)) this._emitNode(n, true);
    this.timer = setInterval(() => this._tick(), 5000);
    this.chat = setInterval(() => this._chatter(), 45000);
    for (const t of [this.timer, this.chat]) if (t.unref) t.unref();
    setTimeout(() => this._chatter(), 1500).unref?.();
  }
  stop() { clearInterval(this.timer); clearInterval(this.chat); }
  _pos(n) {
    return { lat: CENTER.lat + n.oy * M_LAT, lon: CENTER.lon + n.ox * M_LON(CENTER.lat) };
  }
  _emitNode(n, full) {
    const p = this._pos(n);
    const dist = Math.hypot(n.ox, n.oy) / 1000;
    const snr = n.id === this.me ? undefined : Math.round((11 - dist * 3.2 + (Math.random() - 0.5) * 3) * 10) / 10;
    this.emit('node', {
      id: n.id, long: n.long, short: n.short, lat: p.lat, lon: p.lon, alt: 300,
      battery: n.battery, voltage: n.battery > 100 ? 5.0 : 3.3 + n.battery / 100 * 0.9,
      chUtil: Math.round(Math.random() * 120) / 10, snr, rssi: snr === undefined ? undefined : Math.round(-95 - (12 - snr) * 3),
      hops: n.hops, lastHeard: Math.floor(Date.now() / 1000), uptime: Math.floor((Date.now() - this.t0) / 1000)
    });
  }
  _tick() {
    const el = (Date.now() - this.t0) / 1000;
    for (const n of Object.values(this.nodes)) {
      if (n.fixed && n.id === this.me) { this._emitNode(n); continue; }
      if (n.id === '!d3m00002') { n.battery = Math.round(80 + 15 * Math.sin(el / 300)); this._emitNode(n); continue; }
      if (n.id === '!d3m00005') {
        // TRAIL wanders off and goes quiet for a stretch so the alert shows up
        const cyc = el % 600;
        n.battery = Math.max(8, 31 - Math.floor(el / 90) % 24);
        if (cyc > 420) continue;
      }
      n.phase += 0.05;
      n.ox += Math.cos(n.phase) * 18 + (Math.random() - 0.5) * 8;
      n.oy += Math.sin(n.phase * 0.9) * 18 + (Math.random() - 0.5) * 8;
      const d = Math.hypot(n.ox, n.oy); if (d > 3200) { n.ox *= 0.9; n.oy *= 0.9; }
      if (n.id !== '!d3m00005') n.battery = Math.max(15, n.battery - (Math.random() < 0.02 ? 1 : 0));
      this._emitNode(n);
    }
  }
  _chatter() {
    const pool = ['!d3m00003', '!d3m00004', '!d3m00002'];
    const from = pool[Math.floor(Math.random() * pool.length)];
    this.emit('text', { from, to: '^all', channel: 0, text: LINES[Math.floor(Math.random() * LINES.length)], ts: Date.now(), snr: 6 });
  }
  sendText(text) {
    // a demo neighbour answers a few seconds later
    setTimeout(() => this.emit('text', { from: '!d3m00004', to: this.me, channel: 0, text: 'Copy: ' + text.slice(0, 40), ts: Date.now(), snr: 7 }), 3000).unref?.();
    return true;
  }
}

module.exports = { Demo, CENTER };
