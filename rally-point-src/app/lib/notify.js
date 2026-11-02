'use strict';
// Optional push notifications through ntfy (self-hosted or ntfy.sh).
// Off by default. Digests never include vault data.

const { todayIn, hourIn } = require('./dates');

function validUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch (e) { return false; }
}

const ascii = (s) => String(s).replace(/[^\x20-\x7E]/g, '').slice(0, 120);

async function sendNtfy(cfg, title, body, priority) {
  if (!cfg || !cfg.topic || !validUrl(cfg.url)) throw new Error('ntfy server and topic are not set');
  const url = cfg.url.replace(/\/+$/, '') + '/' + encodeURIComponent(cfg.topic);
  const headers = { Title: ascii(title), Priority: String(priority || 3), Tags: 'rotating_light' };
  if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(url, { method: 'POST', body: String(body).slice(0, 3500), headers, signal: ctl.signal });
    if (!res.ok) throw new Error('ntfy answered ' + res.status);
  } finally { clearTimeout(t); }
}

function buildDigest(sup, ready, alertList, groupName) {
  const lines = [];
  lines.push(`Readiness ${ready.score} (${ready.grade})`);
  if (sup.needs.kcal > 0) lines.push(`Food: ${sup.food.days == null ? 0 : sup.food.days} days`);
  if (sup.needs.water.survival > 0) lines.push(`Water: ${sup.water.survivalSustainable ? 'sustainable' : (sup.water.survivalDays == null ? 0 : sup.water.survivalDays) + ' days'}`);
  const crit = alertList.filter((a) => a.sev === 'crit');
  const warn = alertList.filter((a) => a.sev === 'warn');
  lines.push('');
  if (!crit.length && !warn.length) lines.push('Nothing needs attention today.');
  for (const a of [...crit, ...warn].slice(0, 12)) lines.push(`${a.sev === 'crit' ? '!! ' : '- '}${a.title}`);
  const more = crit.length + warn.length - 12;
  if (more > 0) lines.push(`...and ${more} more`);
  return {
    title: `${groupName || 'Rally Point'}: ${crit.length} critical, ${warn.length} to watch`,
    body: lines.join('\n'),
    priority: crit.length ? 4 : 3,
  };
}

// Decide whether today's digest is due. Returns the date string to record, or null.
function digestDue(cfg, now) {
  if (!cfg || !cfg.enabled || !cfg.topic) return null;
  const today = todayIn(cfg.tz, now);
  if (cfg.last === today) return null;
  if (hourIn(cfg.tz, now) < cfg.hour) return null;
  return today;
}

module.exports = { sendNtfy, buildDigest, digestDue, validUrl };
