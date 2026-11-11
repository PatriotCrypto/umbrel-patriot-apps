'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { defaultSchedule } = require('./schedule');
const { DEFAULT_TRIGGERS } = require('./notify');

const DEFAULTS = () => ({
  version: 1,
  settings: {
    name: '', // shown in the Dashboard greeting
    mode: 'demo', // 'demo' = built-in simulator, 'live' = Z-Wave JS server
    tz: process.env.TZ || 'America/New_York',
    enforce: true, // push the schedule to the thermostat
    wallChange: 'hold', // 'hold' = a change at the wall holds until the next period, 'revert' = put the schedule back
    thermostatNode: null, // null = auto-detect
    limits: { heatMin: 55, heatMax: 78, coolMin: 70, coolMax: 85, minGap: 3 },
    humidity: { min: 25, max: 60 },
    costPerHour: 0, // furnace running cost in dollars per hour, 0 = hide cost
    roomAware: { enabled: false, roomId: null, maxOffset: 3 }, // roomId may be 'avg' = the average of the thermostat and all included rooms
    plan: 'range', // 'range' = keep the house between a Home low/high (Away has its own), 'schedule' = weekly periods
    comfort: { home: { heat: 68, cool: 72 }, away: { heat: 62, cool: 80 } },
    keepAuto: true, // a low/high range only works in the thermostat's Auto mode, so put it back if it drifts to Heat or Cool
    pin: '', // the thermostat's screen-lock code, kept here only so it is not forgotten
    dashboard: null, // null = default widget layout; otherwise [{id, size:'2x3'}] in display order
    filter: { name: 'Furnace filter', lastChanged: null, intervalDays: 90, remindDaysBefore: 7 }, // set by hand
    weather: { lat: null, lon: null, name: '' }, // optional, for the Weather widget (Open-Meteo)
    ntfy: { enabled: false, server: 'https://ntfy.sh', topic: '', token: '', triggers: DEFAULT_TRIGGERS() },
  },
  notifyState: {}, // what has already been announced, so a restart does not repeat it
  schedule: defaultSchedule(),
  hold: null,
  away: null,
  rooms: {}, // nodeId -> {name, include}
  events: [],
});

function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
function merge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
  return out;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'coldfront.json');
    this.histFile = path.join(dir, 'history.json');
    this.data = DEFAULTS();
    this.history = { samples: [], runs: [] };
    this._t = null;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = merge(DEFAULTS(), raw);
      if (raw.schedule) this.data.schedule = raw.schedule;
      if (!raw.settings || raw.settings.plan === undefined) this._migratePlan(raw);
    } catch (e) { if (e.code !== 'ENOENT') console.error('coldfront.json unreadable, starting fresh:', e.message); }
    try {
      const h = JSON.parse(fs.readFileSync(this.histFile, 'utf8'));
      this.history = { samples: Array.isArray(h.samples) ? h.samples : [], runs: Array.isArray(h.runs) ? h.runs : [] };
    } catch (e) { if (e.code !== 'ENOENT') console.error('history.json unreadable, starting fresh:', e.message); }
    return this;
  }

  /** Installs from before 0.5.0 had only a schedule. One flat schedule becomes a Home range; a real one is kept. */
  _migratePlan(raw) {
    if (!raw.schedule || !raw.schedule.days) return;
    const keys = new Set();
    for (const list of Object.values(raw.schedule.days)) for (const p of list) keys.add(`${p.heat}/${p.cool}`);
    if (keys.size <= 1 && keys.size === 1) {
      const [h, c] = [...keys][0].split('/').map(Number);
      this.data.settings.plan = 'range';
      this.data.settings.comfort.home = { heat: h, cool: c };
    } else if (keys.size > 1) this.data.settings.plan = 'schedule';
  }

  _atomic(file, obj) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  }

  save() {
    this._atomic(this.file, this.data);
    this._backup();
  }

  saveHistory() {
    const cutoff = Date.now() - 31 * 86400000;
    this.history.samples = this.history.samples.filter((s) => s.t >= cutoff);
    this.history.runs = this.history.runs.filter((r) => (r.end || r.start) >= cutoff).slice(-6000);
    this._atomic(this.histFile, this.history);
  }

  _backup() {
    try {
      const dir = path.join(this.dir, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      const target = path.join(dir, `coldfront-${day}.json`);
      if (!fs.existsSync(target)) fs.copyFileSync(this.file, target);
      const files = fs.readdirSync(dir).filter((f) => /^coldfront-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 7))) fs.unlinkSync(path.join(dir, f));
    } catch (e) { console.error('backup failed:', e.message); }
  }

  /** Debounced save for frequent changes. */
  touch() {
    clearTimeout(this._t);
    this._t = setTimeout(() => { try { this.save(); } catch (e) { console.error('save failed:', e.message); } }, 800);
    this._t.unref?.();
  }

  event(type, msg, t = Date.now()) {
    this.data.events.push({ t, type, msg });
    if (this.data.events.length > 500) this.data.events.splice(0, this.data.events.length - 500);
    this.touch();
  }

  flush() { clearTimeout(this._t); this.save(); this.saveHistory(); }
}

module.exports = { Store, DEFAULTS, merge };
