'use strict';
// Read-only connectors to other apps. Liberty AI only ever sends GET requests, only to
// containers on your own Docker network, and only for apps you switched ON.
//
// An app can share data in two ways:
//   1. GET /liberty-ai/summary   -> { "title": "...", "lines": ["...", "..."] }   (the open contract)
//   2. the umbrelOS widget JSON it already publishes for the home screen.
const catalog = require('./catalog');
const { isLocalUrl, cleanText } = require('./util');

function widgetLines(w) {
  if (!w || typeof w !== 'object') return [];
  const t = (x) => cleanText(x, 160);
  const out = [];
  switch (w.type) {
    case 'text-with-progress':
      out.push(t(w.title) + ': ' + t(w.text) + (w.progressLabel ? ' (' + t(w.progressLabel) + ')' : ''));
      break;
    case 'two-stats':
    case 'three-stats':
    case 'four-stats':
      for (const i of w.items || []) out.push(t(i.title) + ': ' + t(i.text) + (i.subtext ? ' ' + t(i.subtext) : ''));
      break;
    case 'list-emoji':
    case 'list':
      if (!(w.items || []).length && w.noItemsText) out.push(t(w.noItemsText));
      for (const i of w.items || []) out.push(t(i.text) + (i.subtext ? ' - ' + t(i.subtext) : ''));
      break;
    case 'text-with-buttons':
      out.push(t(w.title) + ': ' + t(w.text));
      break;
    default:
      out.push(cleanText(JSON.stringify(w), 300));
  }
  return out.filter(Boolean);
}

function summaryLines(j) {
  if (!j || typeof j !== 'object') return [];
  const out = [];
  if (Array.isArray(j.lines)) for (const l of j.lines.slice(0, 40)) out.push(cleanText(l, 240));
  if (Array.isArray(j.items)) for (const i of j.items.slice(0, 40)) if (i && i.label) out.push(cleanText(i.label, 80) + ': ' + cleanText(i.value, 160));
  return out.filter(Boolean);
}

async function getJson(url, fetchImpl, timeoutMs = 4000) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
  const ct = String(res.headers.get('content-type') || '');
  if (!/json/i.test(ct)) throw new Error('Not JSON');
  const text = await res.text();
  if (text.length > 200000) throw new Error('Response too large');
  return JSON.parse(text);
}

class Connectors {
  constructor(fetchImpl = fetch) {
    this.fetch = fetchImpl;
    this.cache = new Map();
  }

  async _load(key, fn, ttlMs = 30000) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.t < ttlMs) return hit.v;
    const v = await fn();
    this.cache.set(key, { t: Date.now(), v });
    return v;
  }

  // Returns { ok, title, lines, source } or { ok:false, error }.
  async read(app) {
    if (!app.reachable || !app.host) return { ok: false, error: 'This app runs on the host network and cannot be reached yet.' };
    return this._load('app:' + app.id, async () => {
      const base = 'http://' + app.host + ':' + app.internal;
      try {
        const j = await getJson(base + '/liberty-ai/summary', this.fetch);
        const lines = summaryLines(j);
        if (lines.length) return { ok: true, title: cleanText(j.title || app.name, 80), lines, source: 'summary' };
      } catch (e) { /* fall through to widgets */ }
      if (!app.widgets.length) return { ok: false, error: 'No data connector yet.', none: true };
      const lines = [];
      let anyOk = false;
      for (const w of app.widgets) {
        try {
          const j = await getJson(base + w.path, this.fetch);
          anyOk = true;
          lines.push(...widgetLines(j));
        } catch (e) { /* skip this widget */ }
      }
      if (!anyOk) return { ok: false, error: 'The app did not answer (is it running?).' };
      return { ok: true, title: app.name, lines: lines.slice(0, 40), source: 'widgets' };
    });
  }

  async readCustom(c) {
    if (!isLocalUrl(c.url)) return { ok: false, error: 'Only addresses on your home network are allowed.' };
    return this._load('custom:' + c.id, async () => {
      try {
        const j = await getJson(c.url, this.fetch);
        const lines = j && (j.lines || j.items) && !j.type ? summaryLines(j) : widgetLines(j);
        return lines.length ? { ok: true, title: cleanText(c.name, 80), lines: lines.slice(0, 40), source: 'custom' } : { ok: false, error: 'No readable data in the response.' };
      } catch (e) { return { ok: false, error: 'Could not read it: ' + cleanText(e.message, 80) }; }
    });
  }

  clearCache() { this.cache.clear(); }
}

// Which enabled apps does this question mention?
function matchApps(question, apps) {
  const q = ' ' + String(question || '').toLowerCase() + ' ';
  const hit = [];
  for (const a of apps) {
    const names = [a.name.toLowerCase()].concat(a.keywords || []);
    if (names.some((k) => q.includes(k.length < 5 ? ' ' + k + ' ' : k))) hit.push(a);
  }
  return hit;
}

const OVERVIEW = /\b(everything|all (of )?my apps|overview|status of|how('| i)?s (everything|it all)|briefing|brief me|summary of|what('| i)?s going on|update me)\b/i;

module.exports = { Connectors, widgetLines, summaryLines, matchApps, OVERVIEW, catalogFind: catalog.find };
