// Shared app state and API access.
import { toast } from './ui.js';

export const RP = { st: null, meta: null, render: null, go: null, vdata: null };

export async function api(method, url, body) {
  const opts = { method, headers: { 'x-rp': '1' } };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opts); } catch (e) { throw new Error('Cannot reach the server'); }
  let j = null;
  try { j = await res.json(); } catch (e) { /* not json */ }
  if (!res.ok) {
    const err = new Error((j && j.error) || ('Request failed (' + res.status + ')'));
    err.status = res.status;
    throw err;
  }
  return j;
}

export async function loadState() {
  RP.st = await api('GET', '/api/state');
  if (!RP.meta) RP.meta = await api('GET', '/api/meta');
  return RP.st;
}

// reload data then re-render the current view
export async function refresh() {
  await loadState();
  if (RP.render) RP.render();
}

// run an action, toast failures, refresh on success
export async function act(fn, o) {
  o = o || {};
  try {
    const r = await fn();
    if (o.ok) toast(o.ok);
    if (o.refresh !== false) await refresh();
    return r === undefined ? true : r;
  } catch (e) {
    toast(e.message, 'err');
    if (e.status === 423 && o.refresh !== false) { try { await refresh(); } catch (e2) { /* ignore */ } }
    return false;
  }
}

export const find = (coll, id) => (RP.st[coll] || []).find((x) => x.id === id);
export const nameOf = (coll, id) => { const r = find(coll, id); return r ? (r.name || r.title || r.crop) : ''; };
export const catLabel = (id) => { const c = (RP.meta.cats || []).find((x) => x.id === id); return c ? c.label : id; };
export const catCode = (id) => { const c = (RP.meta.cats || []).find((x) => x.id === id); return c ? c.code : '?'; };

// settings helper: PUT a partial
export async function saveSettings(patch, okMsg) {
  return act(() => api('PUT', '/api/settings', patch), { ok: okMsg });
}

export function go(view, sub) { if (RP.go) RP.go(view, sub); }
