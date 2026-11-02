/* Tiny DOM toolkit: h() builds elements, plus modal / toast / confirm. */

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => {
  el.replaceChildren();
  return el;
};

const ICONS = {
  budget: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  funds: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".6"/>',
  debt: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M4 20h16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  paycheck: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14.5h3"/>',
  insights: '<path d="M12 3v9h9"/><path d="M20.5 15A9 9 0 1 1 9 3.5"/>',
  networth: '<path d="M3 20h18M6 20V11M12 20V6M18 20v-6"/><path d="m4 8 5-4 4 3 7-4"/>',
  bitcoin: '<circle cx="12" cy="12" r="9"/><path d="M9.5 7.5v9M9.5 7.5h3.2a2 2 0 0 1 0 4H9.5m0 0h3.7a2.2 2.2 0 0 1 0 4.5H9.5M11 6v1.5M11 16.5V18M13.5 6v1.5M13.5 16.5V18"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  split: '<path d="M6 3v6a6 6 0 0 0 6 6h6M18 15l-3-3m3 3-3 3M6 21v-3"/>'
};
export function icon(name, cls = 'ico') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

/* ---------------- dates ---------------- */
export const pad = (n) => String(n).padStart(2, '0');
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const monthNow = () => todayLocal().slice(0, 7);
export function shiftMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export function monthLabel(m, locale) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}
export function dayLabel(d, locale) {
  const dt = new Date(d + 'T00:00:00');
  const t = todayLocal();
  if (d === t) return 'Today';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d === `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`) return 'Yesterday';
  return dt.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}
export function shortDate(d, locale) {
  return new Date(d + 'T00:00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/* ---------------- overlays ---------------- */
const layer = () => document.getElementById('layer');

export function modal({ title, body, footer, wide = false, onClose } = {}) {
  const prevFocus = document.activeElement;
  const close = () => {
    scrim.remove();
    document.removeEventListener('keydown', onKey, true);
    if (prevFocus?.focus) prevFocus.focus();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
    title ? h('header', null, h('h2', null, title), h('button', { class: 'btn ghost sm', 'aria-label': 'Close', onclick: close }, icon('x'))) : null,
    h('div', { class: 'body' }, body),
    footer ? h('footer', null, footer) : null
  );
  const scrim = h('div', { class: 'scrim', onmousedown: (e) => e.target === scrim && close() }, box);
  layer().append(scrim);
  document.addEventListener('keydown', onKey, true);
  const first = box.querySelector('[autofocus],input,select,textarea,button.primary');
  first?.focus();
  return { close, box };
}

export function confirmDialog(message, { ok = 'Confirm', danger = false, title = 'Are you sure?' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal({
      title,
      body: h('p', { style: { margin: 0 } }, message),
      footer: [h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'), h('button', { class: 'btn primary' + (danger ? ' danger' : ''), onclick: () => finish(true) }, ok)],
      onClose: () => finish(false)
    });
  });
}

let toastBox;
export function toast(msg, isErr = false) {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    layer().append(toastBox);
  }
  const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  toastBox.append(t);
  setTimeout(() => t.remove(), isErr ? 6000 : 3000);
}

/** Run an async action, show errors as a toast instead of crashing the screen. */
export async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message || 'Something went wrong', true);
    return undefined;
  }
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
