'use strict';
// Pure schedule logic: no I/O, no clock. Everything takes `now` and `tz`.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const WALL_NAMES = ['Wake', 'Away', 'Home', 'Sleep'];
const MAX_PERIODS = 8;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

function localParts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: DAYS.indexOf(p.weekday.slice(0, 3).toLowerCase()), minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function dateKey(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function defaultSchedule() {
  const weekday = [
    { name: 'Wake', time: '06:00', heat: 70, cool: 76 },
    { name: 'Away', time: '08:30', heat: 63, cool: 82 },
    { name: 'Home', time: '17:00', heat: 70, cool: 76 },
    { name: 'Sleep', time: '22:00', heat: 66, cool: 76 },
  ];
  const weekend = [
    { name: 'Wake', time: '07:30', heat: 70, cool: 76 },
    { name: 'Home', time: '09:00', heat: 70, cool: 76 },
    { name: 'Sleep', time: '22:30', heat: 66, cool: 76 },
  ];
  const days = {};
  for (const d of DAYS) days[d] = (d === 'sun' || d === 'sat' ? weekend : weekday).map((p, i) => ({ id: `${d}${i}`, ...p }));
  return { days };
}

function sortedPeriods(schedule, day) {
  return [...(schedule.days[DAYS[day]] || [])].sort((a, b) => toMin(a.time) - toMin(b.time));
}

/** The period in force at `now`: the latest start at/before now, looking back up to a week. */
function activePeriod(schedule, now, tz) {
  const lp = localParts(now, tz);
  for (let back = 0; back < 7; back++) {
    const day = (lp.day - back + 7) % 7;
    const list = sortedPeriods(schedule, day);
    const eligible = back === 0 ? list.filter((p) => toMin(p.time) <= lp.minutes) : list;
    if (eligible.length) return { period: eligible[eligible.length - 1], day: DAYS[day] };
  }
  return null;
}

/** Next moment any period starts after `now`. Returns {at: Date, period, day} or null. */
function nextBoundary(schedule, now, tz) {
  const lp = localParts(now, tz);
  const base = Math.floor(now.getTime() / 60000) * 60000;
  for (let ahead = 0; ahead <= 7; ahead++) {
    const day = (lp.day + ahead) % 7;
    for (const p of sortedPeriods(schedule, day)) {
      const m = toMin(p.time);
      if (ahead === 0 && m <= lp.minutes) continue;
      return { at: new Date(base + (ahead * 1440 + m - lp.minutes) * 60000), period: p, day: DAYS[day] };
    }
  }
  return null;
}

function clampPair(heat, cool, limits) {
  let h = clamp(heat, limits.heatMin, limits.heatMax);
  let c = clamp(cool, limits.coolMin, limits.coolMax);
  if (c - h < limits.minGap) {
    c = Math.min(limits.coolMax, h + limits.minGap);
    if (c - h < limits.minGap) h = c - limits.minGap;
  }
  return { heat: h, cool: c };
}

/** What the thermostat should be doing right now. Precedence: away > hold > schedule. */
function resolve({ schedule, hold, away, now, tz, limits }) {
  const t = now.getTime();
  const live = (x) => x && (!x.until || new Date(x.until).getTime() > t);
  let out;
  if (live(away)) out = { source: 'away', label: 'Away', heat: away.heat, cool: away.cool, until: away.until || null };
  else if (live(hold)) out = { source: 'hold', label: hold.source === 'wall' ? 'Hold (set at wall)' : 'Hold', heat: hold.heat, cool: hold.cool, until: hold.until || null };
  else {
    const a = activePeriod(schedule, now, tz);
    if (!a) return null;
    out = { source: 'schedule', label: a.period.name, heat: a.period.heat, cool: a.period.cool, until: null };
  }
  const c = clampPair(out.heat, out.cool, limits);
  return { ...out, heat: c.heat, cool: c.cool };
}

function validateSchedule(input) {
  if (!input || typeof input !== 'object' || !input.days || typeof input.days !== 'object') throw new Error('schedule.days missing');
  const days = {};
  for (const d of DAYS) {
    const list = input.days[d];
    if (!Array.isArray(list) || list.length < 1) throw new Error(`${DAY_LABELS[d]} needs at least one period`);
    if (list.length > MAX_PERIODS) throw new Error(`${DAY_LABELS[d]} has more than ${MAX_PERIODS} periods`);
    const seen = new Set();
    days[d] = list.map((p, i) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(p.time))) throw new Error(`${DAY_LABELS[d]} period ${i + 1}: bad time`);
      if (seen.has(p.time)) throw new Error(`${DAY_LABELS[d]} has two periods at ${p.time}`);
      seen.add(p.time);
      const heat = Number(p.heat), cool = Number(p.cool);
      if (!(heat >= 40 && heat <= 95) || !(cool >= 50 && cool <= 99)) throw new Error(`${DAY_LABELS[d]} period ${i + 1}: temperatures out of range`);
      return { id: `${d}${i}`, name: String(p.name || 'Period').slice(0, 20), time: p.time, heat: Math.round(heat), cool: Math.round(cool) };
    }).sort((a, b) => toMin(a.time) - toMin(b.time)).map((p, i) => ({ ...p, id: `${d}${i}` }));
  }
  return { days };
}

/** The T6 Pro stores Wake/Away/Home/Sleep per day; list what to key in at the wall as a fallback. */
function wallSchedule(schedule) {
  const lines = [];
  const warnings = [];
  for (const d of DAYS) {
    const list = sortedPeriods(schedule, DAYS.indexOf(d));
    if (list.length > 4) warnings.push(`${DAY_LABELS[d]} has ${list.length} periods; the thermostat holds 4 (Wake, Away, Home, Sleep), so only the first 4 are listed.`);
    lines.push({ day: d, label: DAY_LABELS[d], periods: list.slice(0, 4).map((p, i) => ({ slot: WALL_NAMES.includes(p.name) ? p.name : WALL_NAMES[i], time: p.time, heat: p.heat, cool: p.cool })) });
  }
  return { lines, warnings };
}

module.exports = { DAYS, DAY_LABELS, MAX_PERIODS, clamp, toMin, localParts, dateKey, defaultSchedule, sortedPeriods, activePeriod, nextBoundary, clampPair, resolve, validateSchedule, wallSchedule };
