import { bad, addMonths, isMonth } from './util.js';
import { computeBudget } from './budget.js';
import { dueThisWeek } from './paycheck.js';

export const DEFAULT_NTFY = {
  enabled: false,
  server: 'https://ntfy.sh',
  topic: '',
  appUrl: '',
  timezone: 'America/New_York',
  weekly: { enabled: true, day: 1, time: '09:00' }, // day: 0 Sunday .. 6 Saturday
  monthly: { enabled: true, day: 1, time: '09:00' } // day of month 1..28
};
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeNtfy(cur, body) {
  const n = structuredClone({ ...DEFAULT_NTFY, ...(cur || {}), weekly: { ...DEFAULT_NTFY.weekly, ...(cur?.weekly || {}) }, monthly: { ...DEFAULT_NTFY.monthly, ...(cur?.monthly || {}) } });
  const b = body || {};
  if (b.enabled !== undefined) n.enabled = !!b.enabled;
  if (b.server !== undefined) {
    const s = String(b.server).trim().replace(/\/+$/, '');
    let u;
    try { u = new URL(s); } catch { throw bad('The ntfy server must be a full web address, like https://ntfy.sh'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw bad('The ntfy server must start with http:// or https://');
    n.server = s;
  }
  if (b.topic !== undefined) {
    const t = String(b.topic).trim();
    if (t && !/^[A-Za-z0-9_-]{1,64}$/.test(t)) throw bad('A topic can use letters, numbers, dashes and underscores only.');
    n.topic = t;
  }
  if (b.appUrl !== undefined) {
    const a = String(b.appUrl).trim();
    if (a && !/^https?:\/\/\S+$/.test(a)) throw bad('The app address must start with http:// or https://');
    n.appUrl = a.slice(0, 200);
  }
  if (b.timezone !== undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: b.timezone }); } catch { throw bad('Unknown time zone'); }
    n.timezone = b.timezone;
  }
  for (const k of ['weekly', 'monthly']) {
    const c = b[k];
    if (!c) continue;
    if (c.enabled !== undefined) n[k].enabled = !!c.enabled;
    if (c.time !== undefined) {
      if (!TIME.test(c.time)) throw bad('Time must look like 09:00');
      n[k].time = c.time;
    }
    if (c.day !== undefined) {
      const max = k === 'weekly' ? 6 : 28;
      const min = k === 'weekly' ? 0 : 1;
      if (!Number.isInteger(c.day) || c.day < min || c.day > max) throw bad(k === 'weekly' ? 'Pick a day of the week' : 'Pick a day from 1 to 28');
      n[k].day = c.day;
    }
  }
  if (n.enabled && !n.topic) throw bad('Enter a topic first. It is the private channel name your phone subscribes to.');
  return n;
}

/** Local date, time and weekday in a time zone. */
export function localParts(now, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), day: Number(p.day), month: `${p.year}-${p.month}` };
}

const money = (state, c) => new Intl.NumberFormat(state.settings.locale, { style: 'currency', currency: state.settings.currency }).format(c / 100);

export function buildMessages(state, local) {
  const b = computeBudget(state, local.month);
  const due = dueThisWeek(state, local.date, 7);
  const lines = [];
  lines.push(b.totals.uncategorized ? `${b.totals.uncategorized} transaction${b.totals.uncategorized === 1 ? '' : 's'} still need a category.` : 'Look over this week\'s transactions and make sure each one has a category.');
  if (due.items.length) lines.push(`${due.items.length} bill${due.items.length === 1 ? '' : 's'} due in the next 7 days (${money(state, due.total)}).`);
  const next = addMonths(local.month, 1);
  const nextLabel = new Date(next + '-01T00:00:00').toLocaleDateString(state.settings.locale, { month: 'long', year: 'numeric' });
  return {
    weekly: { title: 'ZeroDollar: review your transactions', message: lines.join('\n'), tags: 'receipt' },
    monthly: { title: 'ZeroDollar: month-end tasks', message: `Reconcile your accounts with your bank statements, then set up ${nextLabel}${state.months[next] ? ' (already started)' : ' (not planned yet)'}.`, tags: 'white_check_mark' }
  };
}

export async function sendNtfy(cfg, token, msg, fetchImpl = fetch) {
  if (!cfg.topic) throw bad('Enter a topic first.');
  const headers = { Title: msg.title, Tags: msg.tags || '', 'Content-Type': 'text/plain; charset=utf-8' };
  if (msg.click || cfg.appUrl) headers.Click = msg.click || cfg.appUrl;
  if (token) headers.Authorization = 'Bearer ' + token;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  let res;
  try {
    res = await fetchImpl(`${cfg.server}/${cfg.topic}`, { method: 'POST', headers, body: msg.message, signal: ctl.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'ntfy did not answer in time' : 'Could not reach the ntfy server');
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'ntfy refused the message (check the access token)' : `ntfy answered HTTP ${res.status}`);
}

/**
 * Send whichever reminders are due right now. `sent` is a map of keys already delivered; it is updated.
 * A reminder goes out once on its day, at or after its time (so a restart does not lose it).
 */
export async function runReminders({ state, token, sent, now = new Date(), fetchImpl = fetch }) {
  const cfg = state.settings.ntfy;
  const out = [];
  if (!cfg?.enabled || !cfg.topic) return out;
  const local = localParts(now, cfg.timezone);
  const msgs = buildMessages(state, local);
  const todo = [];
  if (cfg.weekly.enabled && local.dow === cfg.weekly.day && local.time >= cfg.weekly.time) todo.push(['weekly', `weekly:${local.date}`]);
  if (cfg.monthly.enabled && local.day === cfg.monthly.day && local.time >= cfg.monthly.time) todo.push(['monthly', `monthly:${local.month}`]);
  for (const [kind, key] of todo) {
    if (sent[key]) continue;
    try {
      await sendNtfy(cfg, token, msgs[kind], fetchImpl);
      sent[key] = now.toISOString();
      out.push(kind);
    } catch (e) {
      out.push(`${kind} failed: ${e.message}`);
    }
  }
  for (const k of Object.keys(sent)) if (sent[k] < new Date(now - 90 * 86400000).toISOString()) delete sent[k];
  return out;
}
void isMonth;
