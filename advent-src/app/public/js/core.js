// Shared helpers: tiny DOM builder, icons, API calls, toasts, modals, shared state.
(function () {
  'use strict';
  const S = { state: null, child: null, parentToken: null };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (k) => { if (k == null || k === false) return; if (Array.isArray(k)) k.forEach(add); else el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); };
    kids.forEach(add);
    return el;
  }
  const clear = (el) => { while (el && el.firstChild) el.removeChild(el.firstChild); };
  const svgNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) { const el = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); return el; }

  const PATHS = {
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    cam: 'M3 8h4l2-3h6l2 3h4v11H3zM12 10a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
    globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
    gear: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
    star: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L5.3 9.3l6.1-.7z',
    play: 'M7 5l12 7-12 7z', pause: 'M7 5h4v14H7zM13 5h4v14h-4z', note: 'M9 18a3 3 0 100-6 3 3 0 000 6zM12 15V5l8-2v10M20 13a3 3 0 11-6 0 3 3 0 016 0z',
    sound: 'M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11', mute: 'M4 10v4h4l5 4V6L8 10zM16 9l5 6M21 9l-5 6',
    x: 'M6 6l12 12M18 6L6 18', check: 'M5 12l5 5 9-10', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3', plus: 'M12 5v14M5 12h14',
    back: 'M15 5l-7 7 7 7', trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13', gift: 'M4 11h16v10H4zM2 7h20v4H2zM12 7v14M12 7c-3 0-5-1-5-3s2-2 3-1 2 4 2 4zM12 7c3 0 5-1 5-3s-2-2-3-1-2 4-2 4z',
    elf: 'M12 3l5 8H7zM8 11h8v5a4 4 0 01-8 0zM12 3v-1', snow: 'M12 2v20M4 6l16 12M4 18L20 6M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z', bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20h4',
    home: 'M4 11l8-7 8 7v9H4z', users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M16 11a3 3 0 100-6M21 20a6 6 0 00-5-5.9',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', heart: 'M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z',
    refresh: 'M20 12a8 8 0 11-3-6.2M20 4v5h-5', sleigh: 'M3 14h3l2-6h8l3 6h2v3H3zM6 20a2 2 0 100-4 2 2 0 000 4zM18 20a2 2 0 100-4 2 2 0 000 4z',
    quiz: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4M12 17h.01', target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 12h.01',
    radar: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7a5 5 0 100 10 5 5 0 000-10zM12 12l6-6', menu: 'M4 7h16M4 12h16M4 17h16', info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7h.01',
  };
  function icon(name, cls) {
    const s = svg('svg', { viewBox: '0 0 24 24', class: 'ico ' + (cls || ''), 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    s.appendChild(svg('path', { d: PATHS[name] || PATHS.star }));
    return s;
  }

  const today = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  async function api(method, url, body, parent) {
    const headers = { 'X-Advent': '1' };
    if (body) headers['Content-Type'] = 'application/json';
    if (parent && S.parentToken) headers['X-Parent-Token'] = S.parentToken;
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(url + sep + 'd=' + today(), { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || ('Error ' + res.status)); e.status = res.status; throw e; }
    return data;
  }

  let toastEl = null;
  function toast(msg, kind) {
    if (toastEl) toastEl.remove();
    toastEl = h('div', { class: 'toast ' + (kind || ''), role: 'status', text: msg });
    document.body.appendChild(toastEl);
    requestAnimationFrame(() => toastEl.classList.add('show'));
    setTimeout(() => { if (toastEl) { toastEl.classList.remove('show'); setTimeout(() => toastEl && toastEl.remove(), 400); } }, 3200);
  }

  function modal(title, body, actions, opts = {}) {
    const back = h('div', { class: 'modal-back' + (opts.cls ? ' ' + opts.cls : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
    const close = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 250); document.removeEventListener('keydown', esc); if (opts.onClose) opts.onClose(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    const card = h('div', { class: 'modal' },
      title ? h('header', null, h('h2', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))) : null,
      h('div', { class: 'modal-body' }, body),
      actions ? h('footer', null, typeof actions === 'function' ? actions(close) : actions) : null);
    back.appendChild(card);
    back.addEventListener('click', (e) => { if (e.target === back && !opts.sticky) close(); });
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
    return close;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const dayName = (n) => 'December ' + n;

  window.AD = { S, h, clear, svg, icon, api, toast, modal, rnd, pick, dayName, today, pages: {} };
})();
