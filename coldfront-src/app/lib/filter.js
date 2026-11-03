'use strict';
const { dateKey } = require('./schedule');

const DAY = 86400000;

function parseDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s ? null : t;
}

/** Filter status from the manual settings. Dates are whole calendar days in the home's time zone. */
function filterStatus(filter, nowMs, tz) {
  const last = filter && parseDay(filter.lastChanged);
  if (last == null) return { configured: false, name: filter?.name || 'Furnace filter' };
  const today = parseDay(dateKey(new Date(nowMs), tz));
  const due = last + filter.intervalDays * DAY;
  const daysLeft = Math.round((due - today) / DAY);
  const state = daysLeft < 0 ? 'overdue' : daysLeft <= filter.remindDaysBefore ? 'soon' : 'ok';
  return {
    configured: true, name: filter.name, lastChanged: filter.lastChanged, intervalDays: filter.intervalDays,
    remindDaysBefore: filter.remindDaysBefore, dueDate: new Date(due).toISOString().slice(0, 10), daysLeft, state,
    daysSince: Math.round((today - last) / DAY),
  };
}

function filterAlert(st) {
  if (!st.configured) return null;
  if (st.state === 'overdue') return { level: 'bad', key: 'filter', text: `${st.name} was due ${-st.daysLeft} day${st.daysLeft === -1 ? '' : 's'} ago. A clogged filter makes the furnace work harder.` };
  if (st.state === 'soon') return { level: 'warn', key: 'filter', text: `${st.name} is due ${st.daysLeft === 0 ? 'today' : `in ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'}`} (${st.dueDate}).` };
  return null;
}

/** Validate and normalise a filter settings update. Throws on bad input. */
function validateFilter(f, current) {
  const out = { ...current };
  if (f.name !== undefined) out.name = String(f.name).trim().slice(0, 40) || 'Furnace filter';
  if (f.lastChanged !== undefined) {
    if (f.lastChanged === null || f.lastChanged === '') out.lastChanged = null;
    else if (parseDay(f.lastChanged) == null) throw new Error('Filter date must look like 2026-11-03');
    else out.lastChanged = f.lastChanged;
  }
  if (f.intervalDays !== undefined) {
    const n = Number(f.intervalDays);
    if (!Number.isInteger(n) || n < 7 || n > 730) throw new Error('Replacement interval must be 7 to 730 days');
    out.intervalDays = n;
  }
  if (f.remindDaysBefore !== undefined) {
    const n = Number(f.remindDaysBefore);
    if (!Number.isInteger(n) || n < 0 || n > 60) throw new Error('Reminder lead time must be 0 to 60 days');
    out.remindDaysBefore = n;
  }
  return out;
}

module.exports = { filterStatus, filterAlert, validateFilter, parseDay };
