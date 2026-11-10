/* Small DOM and API helpers shared by every screen. */

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (init.method !== 'GET') init.headers['X-Studio-Notebook'] = '1';
  if (opts.body !== undefined) {
    if (opts.raw) init.body = opts.body;
    else { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  }
  if (opts.keepalive) init.keepalive = true;
  let res;
  try { res = await fetch(path, init); }
  catch (e) { throw new Error('Could not reach the notebook. Check your connection to the Umbrel.'); }
  let data = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('json')) data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `The request failed (${res.status}).`);
  return data;
}

let toastTimer;
export function toast(msg, isError) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = h('div', { class: 'toast' + (isError ? ' err' : ''), role: 'status' }, msg);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), isError ? 5000 : 2200);
}
export const fail = (e) => toast(e.message || String(e), true);

/* A small dialog. Resolves with the clicked button's value, or null. */
export function dialog({ title, body, buttons, wide }) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: wide ? 'wide' : '' });
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    d.append(h('h2', null, title));
    if (body) d.append(typeof body === 'string' ? h('p', { class: 'mute' }, body) : body);
    d.append(h('div', { class: 'row' }, (buttons || [{ label: 'Close', value: null }]).map((b) =>
      h('button', { class: 'btn ' + (b.kind || ''), onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label))));
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(d);
    d.showModal();
  });
}
export const confirmBox = (title, body, action, danger) => dialog({
  title, body, buttons: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: action, value: true, kind: danger ? 'danger' : 'primary' }],
});
export function promptBox(title, label, initial = '', action = 'Save') {
  const input = h('input', { class: 'input', value: initial, maxlength: 160 });
  const p = dialog({
    title, body: h('label', { class: 'field' }, h('span', null, label), input),
    buttons: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: action, value: () => input.value.trim(), kind: 'primary' }],
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.closest('dialog').querySelector('.btn.primary').click(); } });
  setTimeout(() => input.select(), 30);
  return p;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    // plain http pages (umbrel.local) may not have the clipboard API
    const t = h('textarea');
    t.style.position = 'fixed'; t.style.opacity = '0';
    t.value = text; document.body.append(t); t.select();
    try { document.execCommand('copy'); } finally { t.remove(); }
  }
  toast('Copied');
}

export const STATUS_LABEL = { idea: 'Idea', writing: 'Writing', polishing: 'Polishing', producing: 'Producing', scheduled: 'Scheduled', released: 'Released', shelved: 'Shelved' };

export function day(iso) {
  if (!iso) return '';
  const d = /^\d{4}-\d\d-\d\d$/.test(iso) ? new Date(iso + 'T12:00:00') : new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 86400 * 14) return Math.round(s / 86400) + ' d ago';
  return day(iso);
}
export function daysUntil(dateStr) {
  const t = new Date(dateStr + 'T12:00:00'), n = new Date();
  n.setHours(12, 0, 0, 0);
  return Math.round((t - n) / 86400000);
}
export const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
export const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };

const ICONS = {
  desk: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  songs: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  ideas: 'M9 18h6m-5 3h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.800 1-2.5A6 6 0 0 0 12 3z',
  words: 'M4 6h16M4 12h10M4 18h13',
  collections: 'M5 4h14v17l-7-4-7 4z',
  settings: 'M4 7h10m4 0h2M4 17h2m4 0h10M16 4v6M8 14v6',
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}

export function coverEl(song, cls = 'cover') {
  if (song.cover) return h('img', { class: cls, src: `/files/${song.id}/${song.cover}`, alt: '', loading: 'lazy' });
  const initials = (song.title || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return h('div', { class: cls + ' blank', 'aria-hidden': 'true' }, initials);
}
