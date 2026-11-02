'use strict';
// Settings: defaults and a whitelist-based merge so bad input can never add keys.

const { cleanStr, FUEL_TYPES, uid } = require('./schema');

const DEFAULTS = {
  groupName: 'My Group',
  guests: 0,                 // extra adults counted on top of members
  targetDays: 30,
  countExpired: false,       // do expired lots count toward days of supply?
  calories: {
    perDay: 2000,
    mult: { adult: 1, teen: 1.2, child: 0.75, infant: 0.4, senior: 0.85 },
  },
  water: {
    drink: 1,                // gallons per person per day
    cook: 0.5,
    hygiene: 1,
    mult: { adult: 1, teen: 1, child: 0.75, infant: 0.5, senior: 1 },
    petGal: 0.15,
  },
  pet: { foodLb: 0.5 },      // lb per pet per day
  expiry: { soonDays: 30, warnDays: 90 },
  stealth: false,
  vaultAutoLockMin: 15,
  home: { lat: null, lon: null, label: '' },
  frost: { last: '04-25', first: '10-15' },
  rainfallIn: 40,
  power: { solarW: 0, sunHours: 4, bankWh: 0, dod: 80, inverterW: 0, genSupplementHrs: 0, genWatts: 0, systemEff: 75 },
  generators: [],            // {id,name,fuelType,gph,hoursPerDay,watts}
  keyRoles: ['Leader', 'Medic', 'Security', 'Comms', 'Cook', 'Mechanic', 'Gardener', 'Water / sanitation'],
  comms: {
    pace: [
      { level: 'Primary', method: '', details: '', schedule: '' },
      { level: 'Alternate', method: '', details: '', schedule: '' },
      { level: 'Contingency', method: '', details: '', schedule: '' },
      { level: 'Emergency', method: '', details: '', schedule: '' },
    ],
    notes: '',
  },
  ntfy: { enabled: false, url: 'https://ntfy.sh', topic: '', token: '', hour: 8, tz: '', last: '' },
  lookupOnline: false,
  setupDone: false,
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function num(v, def, min, max) {
  if (v === '' || v == null) return def;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) return def;
  return Math.min(max == null ? 1e9 : max, Math.max(min == null ? 0 : min, n));
}

// recursive merge guided by `def`
function merge(def, cur, patch, path) {
  const out = {};
  for (const key of Object.keys(def)) {
    const d = def[key];
    const c = cur ? cur[key] : undefined;
    const has = patch && Object.prototype.hasOwnProperty.call(patch, key);
    const p = has ? patch[key] : undefined;
    const here = path ? path + '.' + key : key;
    if (key === 'generators') { out[key] = has ? cleanGenerators(p) : (c !== undefined ? c : clone(d)); continue; }
    if (key === 'keyRoles') { out[key] = has ? cleanRoles(p) : (c !== undefined ? c : clone(d)); continue; }
    if (here === 'comms.pace') { out[key] = has ? cleanPace(p) : (c !== undefined ? c : clone(d)); continue; }
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      // numeric-or-null leaves (home.lat/lon) are handled below, so plain objects recurse
      out[key] = merge(d, c && typeof c === 'object' ? c : null, has && p && typeof p === 'object' ? p : null, here);
    } else if (typeof d === 'boolean') {
      out[key] = has ? (p === true || p === 'true' || p === 1) : (typeof c === 'boolean' ? c : d);
    } else if (typeof d === 'number') {
      out[key] = has ? num(p, typeof c === 'number' ? c : d, 0, key === 'hour' ? 23 : 1e7) : (typeof c === 'number' ? c : d);
    } else if (d === null) {
      // nullable number (lat/lon)
      if (has) out[key] = (p === '' || p == null) ? null : num(p, null, -180, 180);
      else out[key] = c !== undefined ? c : null;
      if (key === 'lat' && out[key] != null && Math.abs(out[key]) > 90) out[key] = null;
    } else if (typeof d === 'string') {
      const max = key === 'notes' ? 4000 : 200;
      out[key] = has ? cleanStr(p, max) : (typeof c === 'string' ? c : d);
    } else {
      out[key] = c !== undefined ? c : clone(d);
    }
  }
  return out;
}

function cleanGenerators(a) {
  if (!Array.isArray(a)) return [];
  return a.slice(0, 20).map((g) => ({
    id: cleanStr(g && g.id, 24) || uid(),
    name: cleanStr(g && g.name, 80) || 'Generator',
    fuelType: FUEL_TYPES.includes(g && g.fuelType) ? g.fuelType : 'gasoline',
    gph: num(g && g.gph, 0.5, 0, 100),
    hoursPerDay: num(g && g.hoursPerDay, 4, 0, 24),
    watts: num(g && g.watts, 0, 0, 1e6),
  }));
}

function cleanRoles(a) {
  const src = Array.isArray(a) ? a : String(a == null ? '' : a).split(',');
  return src.map((r) => cleanStr(r, 40)).filter(Boolean).slice(0, 20);
}

function cleanPace(a) {
  const levels = ['Primary', 'Alternate', 'Contingency', 'Emergency'];
  const src = Array.isArray(a) ? a : [];
  return levels.map((level, i) => ({
    level,
    method: cleanStr(src[i] && src[i].method, 120),
    details: cleanStr(src[i] && src[i].details, 300),
    schedule: cleanStr(src[i] && src[i].schedule, 200),
  }));
}

function mergeSettings(cur, patch) {
  return merge(DEFAULTS, cur || null, patch || null, '');
}

function defaultSettings() { return clone(DEFAULTS); }

module.exports = { DEFAULTS, mergeSettings, defaultSettings };
