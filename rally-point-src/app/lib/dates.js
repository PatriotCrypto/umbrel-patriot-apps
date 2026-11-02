'use strict';
// Small date helpers. All dates are plain YYYY-MM-DD strings (no time zones).

const RE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(s) {
  if (typeof s !== 'string' || !RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function toUTC(s) {
  return new Date(s + 'T00:00:00Z');
}

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(s, n) {
  const d = toUTC(s);
  d.setUTCDate(d.getUTCDate() + Math.round(n));
  return fmt(d);
}

function addMonths(s, n) {
  const d = toUTC(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Math.round(n));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return fmt(d);
}

// whole days from a to b (b - a)
function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

// "today" in an IANA zone; falls back to UTC
function todayIn(tz, now) {
  const t = now instanceof Date ? now : new Date();
  try {
    if (tz) {
      const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(t);
      if (isDate(p)) return p;
    }
  } catch (e) { /* bad zone */ }
  return fmt(t);
}

function hourIn(tz, now) {
  const t = now instanceof Date ? now : new Date();
  try {
    if (tz) {
      const h = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(t);
      const n = parseInt(h, 10);
      if (n >= 0 && n < 24) return n;
    }
  } catch (e) { /* bad zone */ }
  return t.getUTCHours();
}

// MM-DD + year -> YYYY-MM-DD (clamps invalid like 02-30)
function mmddToDate(mmdd, year) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(mmdd || ''));
  if (!m) return null;
  const mo = Math.min(12, Math.max(1, +m[1]));
  const last = new Date(Date.UTC(year, mo, 0)).getUTCDate();
  const da = Math.min(last, Math.max(1, +m[2]));
  return `${year}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

module.exports = { isDate, addDays, addMonths, daysBetween, todayIn, hourIn, mmddToDate, toUTC, fmt };
