// Small DOM toolkit: hyperscript, modal, toast, formatting. No innerHTML with data.

const BOOL_PROPS = new Set(['checked', 'disabled', 'selected', 'hidden', 'readOnly', 'multiple', 'open', 'required']);

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let deferred;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'value') deferred = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (BOOL_PROPS.has(k)) el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  if (deferred !== undefined) el.value = deferred;
  return el;
}

export function svg(tag, props, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (props) for (const [k, v] of Object.entries(props)) if (v != null && v !== false) el.setAttribute(k, v);
  append(el, kids);
  return el;
}

export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// ------------------------------------------------------------------ formatting
export const n0 = (x) => (x == null || isNaN(x) ? '-' : Number(x).toLocaleString(undefined, { maximumFractionDigits: 0 }));
export const n1 = (x) => (x == null || isNaN(x) ? '-' : Number(x).toLocaleString(undefined, { maximumFractionDigits: 1 }));
export const n2 = (x) => (x == null || isNaN(x) ? '-' : Number(x).toLocaleString(undefined, { maximumFractionDigits: 2 }));
export const money = (x) => '$' + n0(x);

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function daysFrom(today, s) {
  if (!s) return null;
  return Math.round((new Date(s + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
}

export function relDays(d) {
  if (d == null) return '';
  if (d === 0) return 'today';
  if (d < 0) return `${-d}d ago`;
  if (d < 90) return `in ${d}d`;
  if (d < 730) return `in ${Math.round(d / 30)}mo`;
  return `in ${Math.round(d / 365)}y`;
}

// css class for an expiry/due offset in days
export function dueClass(d, soon, warn) {
  if (d == null) return '';
  if (d < 0) return 'crit';
  if (d <= (soon == null ? 30 : soon)) return 'warn';
  if (d <= (warn == null ? 90 : warn)) return 'info';
  return '';
}

export function badge(text, kind) { return h('span', { class: 'badge' + (kind ? ' ' + kind : '') }, text); }

export function bar(frac, kind) {
  const f = Math.max(0, Math.min(1, frac || 0));
  return h('div', { class: 'bar' + (kind ? ' ' + kind : '') }, h('i', { style: { width: (f * 100).toFixed(1) + '%' } }));
}

export function daysKind(days, target) {
  if (days == null) return 'good';
  if (days < target / 3) return 'crit';
  if (days < target) return 'warn';
  return 'good';
}

// ------------------------------------------------------------------ toast
let toastBox;
export function toast(msg, kind) {
  if (!toastBox) { toastBox = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div', { class: 'toast ' + (kind || '') }, msg);
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), kind === 'err' ? 5000 : 2600);
  setTimeout(() => t.remove(), kind === 'err' ? 5500 : 3000);
}

// ------------------------------------------------------------------ modal
const stack = [];
export function modal(opts) {
  const back = h('div', { class: 'backdrop' });
  const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
  const head = h('div', { class: 'modal-head' },
    h('h3', null, opts.title || ''),
    h('button', { class: 'x', title: 'Close', onclick: () => api.close() }, '×'));
  const body = h('div', { class: 'modal-body' }, opts.body);
  box.append(head, body);
  if (opts.buttons && opts.buttons.length) {
    box.append(h('div', { class: 'modal-foot' }, opts.buttons));
  }
  back.append(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back && !opts.sticky) api.close(); });
  const api = {
    el: box, body,
    close(val) {
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      back.remove();
      if (!stack.length) document.body.classList.remove('modal-open');
      if (opts.onclose) opts.onclose(val);
    },
  };
  stack.push(api);
  document.body.classList.add('modal-open');
  document.body.append(back);
  const first = box.querySelector('input:not([type=checkbox]),select,textarea');
  if (first && !opts.noFocus) setTimeout(() => first.focus(), 30);
  return api;
}

export function closeTopModal() { const m = stack[stack.length - 1]; if (m) { m.close(); return true; } return false; }
export function anyModal() { return stack.length > 0; }

export function btn(label, onclick, cls) { return h('button', { class: 'btn' + (cls ? ' ' + cls : ''), onclick, type: 'button' }, label); }

export function confirmBox(message, o) {
  o = o || {};
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title: o.title || 'Please confirm',
      body: h('p', null, message),
      onclose: () => finish(false),
      buttons: [
        btn('Cancel', () => m.close(), 'ghost'),
        btn(o.okText || 'OK', () => { finish(true); m.close(); }, o.danger ? 'danger' : 'primary'),
      ],
    });
  });
}

export function promptBox(label, o) {
  o = o || {};
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const input = h('input', { type: o.type || 'text', value: o.value == null ? '' : o.value, placeholder: o.placeholder || '', autocomplete: 'off',
      onkeydown: (e) => { if (e.key === 'Enter') { finish(input.value); m.close(); } } });
    const m = modal({
      title: o.title || label,
      body: h('div', null, o.title ? h('label', { class: 'lbl' }, label) : null, input, o.hint ? h('p', { class: 'hint' }, o.hint) : null),
      onclose: () => finish(null),
      buttons: [btn('Cancel', () => m.close(), 'ghost'), btn(o.okText || 'OK', () => { finish(input.value); m.close(); }, 'primary')],
    });
  });
}

// ------------------------------------------------------------------ print
export function printNode(title, node) {
  let root = document.getElementById('print-root');
  if (!root) { root = h('div', { id: 'print-root' }); document.body.append(root); }
  clear(root);
  root.append(h('h1', null, title), node);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); clear(root); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

// download a Blob/string as a file
export function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// tiny markup renderer for library guides: ## heading, - bullets, **bold**, paragraphs
export function renderGuide(text) {
  const out = h('div', { class: 'guide' });
  const inline = (s) => {
    const frag = document.createDocumentFragment();
    s.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (part.startsWith('**') && part.endsWith('**')) frag.append(h('strong', null, part.slice(2, -2)));
      else if (part) frag.append(document.createTextNode(part));
    });
    return frag;
  };
  let list = null;
  for (const raw of text.trim().split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { list = null; continue; }
    if (line.startsWith('## ')) { list = null; out.append(h('h4', null, line.slice(3))); continue; }
    if (line.startsWith('- ')) {
      if (!list) { list = h('ul'); out.append(list); }
      list.append(h('li', null, inline(line.slice(2))));
      continue;
    }
    list = null;
    out.append(h('p', null, inline(line)));
  }
  return out;
}
