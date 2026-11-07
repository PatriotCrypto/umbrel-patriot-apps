'use strict';
// Optional phone alerts through ntfy (https://ntfy.sh or your own ntfy server).
// Only the finding title and a short detail are sent, never file or app contents.
async function sendNtfy(cfg, title, body, fetchImpl = fetch) {
  if (!cfg.enabled || !cfg.topic) return false;
  try {
    const res = await fetchImpl(cfg.server.replace(/\/+$/, '') + '/' + encodeURIComponent(cfg.topic), {
      method: 'POST',
      headers: { Title: String(title).slice(0, 120).replace(/[^\x20-\x7e]/g, ''), Tags: 'warning', Priority: 'high' },
      body: String(body).slice(0, 500),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (e) { return false; }
}

// Decide which findings deserve a new alert. `sent` maps finding id -> last alert time.
function pickAlerts(findings, sent, minSeverity, now, repeatMs = 24 * 3600e3) {
  const ok = (f) => f.sev === 'crit' || (minSeverity === 'warn' && f.sev === 'warn');
  const live = new Set(findings.map((f) => f.id));
  for (const id of Object.keys(sent)) if (!live.has(id)) delete sent[id];
  const out = [];
  for (const f of findings) {
    if (!ok(f)) continue;
    if (sent[f.id] && now - sent[f.id] < repeatMs) continue;
    sent[f.id] = now;
    out.push(f);
  }
  return out;
}

module.exports = { sendNtfy, pickAlerts };
