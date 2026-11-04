'use strict';
// Demo adapter: a small thermal model of a house so the app is fully usable before hardware arrives.
const { EventEmitter } = require('node:events');
const { resolve } = require('./schedule');

const ROOMS = [
  { nodeId: 21, name: 'Bedroom', off: -1.2, hum: 3 },
  { nodeId: 22, name: 'Basement', off: -5.5, hum: 12 },
  { nodeId: 23, name: 'Office', off: 1.4, hum: -2 },
];

function outdoorF(ms) {
  const d = new Date(ms);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  return 38 + 9 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
}

class SimAdapter extends EventEmitter {
  constructor({ now = () => Date.now(), speed = 1 } = {}) {
    super();
    this.kind = 'sim';
    this.connected = true;
    this.error = null;
    this.now = now;
    this.speed = speed;
    this.T = 69.5;
    this.mode = 'auto';
    this.op = 'idle';
    this.fan = 'auto';
    this.heat = 68;
    this.cool = 76;
    this.t = now();
    this.wet = false; // demo water sensor, flipped by the demo test button
  }

  start() {
    this._i = setInterval(() => this.step(((this.now() - this.t) / 1000) * this.speed), 5000);
    this._i.unref?.();
  }

  stop() { clearInterval(this._i); }

  /** Advance the model by `sec` seconds. */
  step(sec) {
    const dt = Math.max(0, sec) / 3600; // hours
    this.t = this.now();
    const out = outdoorF(this.t);
    // thermostat logic with a small deadband, like a real one
    if (this.op === 'heating' && (this.T >= this.heat + 0.3 || this.mode === 'off' || this.mode === 'cool')) this.op = 'idle';
    else if (this.op === 'cooling' && (this.T <= this.cool - 0.3 || this.mode === 'off' || this.mode === 'heat')) this.op = 'idle';
    else if (this.op === 'idle') {
      if ((this.mode === 'heat' || this.mode === 'auto') && this.T <= this.heat - 0.5) this.op = 'heating';
      else if ((this.mode === 'cool' || this.mode === 'auto') && this.T >= this.cool + 0.5) this.op = 'cooling';
    }
    const loss = 0.05 * (out - this.T);
    const plant = this.op === 'heating' ? 4.5 : this.op === 'cooling' ? -4 : 0;
    this.T += (loss + plant) * dt;
    this.emit('update');
  }

  snapshot() {
    const out = outdoorF(this.t);
    const wobble = (n) => Math.sin(this.t / 1.7e6 + n) * 0.3;
    return {
      connected: true,
      kind: 'sim',
      error: null,
      thermostat: {
        nodeId: 2,
        temp: Math.round(this.T * 10) / 10,
        humidity: Math.round(34 + (out - 30) * 0.25 + wobble(0) * 3),
        mode: this.mode,
        opState: this.op,
        fan: this.fan,
        heat: this.heat,
        cool: this.cool,
        lastSeen: this.t,
      },
      sensors: ROOMS.map((r) => ({
        nodeId: r.nodeId,
        name: r.name,
        temp: Math.round((this.T + r.off + wobble(r.nodeId)) * 10) / 10,
        humidity: Math.round(36 + r.hum + (out - 30) * 0.25 + wobble(r.nodeId + 5) * 3),
        battery: 60 + ((r.nodeId * 7) % 35),
        lastSeen: this.t,
      })),
      leaks: [{ nodeId: 31, name: 'Basement water', wet: this.wet, battery: 88, temp: null, lastSeen: this.t }],
    };
  }

  async setSetpoints({ heat, cool }) {
    if (heat != null) this.heat = heat;
    if (cool != null) this.cool = cool;
    this.emit('update');
  }

  async setMode(mode) { this.mode = mode; this.emit('update'); }
  async setFan(fan) { this.fan = fan; this.emit('update'); }
}

/** Fill history with `days` of plausible data using the real schedule, so charts and insights have something to show. */
function seedDemoHistory({ sim, schedule, limits, tz, days = 7, endMs = Date.now() }) {
  const samples = [];
  const runs = [];
  const s = new SimAdapter({ now: () => 0 });
  s.mode = 'auto';
  const start = endMs - days * 86400000;
  let openRun = null;
  for (let t = start; t <= endMs; t += 60000) {
    s.t = t;
    const d = resolve({ schedule, hold: null, away: null, now: new Date(t), tz, limits });
    if (d) { s.heat = d.heat; s.cool = d.cool; }
    s.step(60);
    if (s.op !== (openRun ? openRun.kind : 'idle')) {
      if (openRun) { openRun.end = t; runs.push(openRun); openRun = null; }
      if (s.op !== 'idle') openRun = { kind: s.op, start: t };
    }
    if (((t - start) / 60000) % 5 === 0) {
      const snap = s.snapshot();
      const rooms = {};
      for (const r of snap.sensors) rooms[r.nodeId] = { t: r.temp, h: r.humidity };
      samples.push({ t, in: snap.thermostat.temp, hum: snap.thermostat.humidity, heat: s.heat, cool: s.cool, op: s.op, mode: s.mode, rooms });
    }
  }
  if (openRun) { openRun.end = endMs; runs.push(openRun); }
  sim.T = s.T; sim.op = s.op; sim.t = endMs;
  return { samples, runs };
}

module.exports = { SimAdapter, seedDemoHistory, ROOMS, outdoorF };
