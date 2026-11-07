// Liberty AI front end: shared helpers. No frameworks and no innerHTML: every piece of
// text goes in through textContent, so nothing a file or an AI says can inject markup.
(function () {
  'use strict';
  const LA = (window.LA = { pages: {}, S: {} });
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- DOM ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const k of kids) {
      if (k === null || k === undefined || k === false) continue;
      if (Array.isArray(k)) add(el, k);
      else el.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    }
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
    for (const c of kids) if (c) el.appendChild(c);
    return el;
  }

  // ---------- icons (24px, stroke) ----------
  const PATHS = {
    chat: 'M4 5h16v11H9l-5 4z', pulse: 'M3 12h4l2-6 4 12 2-6h6', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    folder: 'M3 6h6l2 2h10v11H3z', gear: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
    send: 'M4 12l16-8-6 16-3-7z', stop: 'M7 7h10v10H7z', check: 'M5 12l5 5 9-10', alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
    copy: 'M9 9h11v11H9zM5 15V4h11', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3', cloud: 'M7 18a4 4 0 010-8 5 5 0 019.5 1A3.5 3.5 0 0116 18z',
    home: 'M4 11l8-7 8 7v9H4z', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18', trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
    refresh: 'M20 12a8 8 0 11-3-6.2M20 4v5h-5', file: 'M6 3h8l4 4v14H6zM14 3v4h4', up: 'M12 19V5M6 11l6-6 6 6', menu: 'M4 7h16M4 12h16M4 17h16',
    open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
    app: 'M5 5h14v14H5zM9 9h6v6H9z', db: 'M5 6c0-1.7 3-3 7-3s7 1.3 7 3-3 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3 3 7 3s7-1.3 7-3V6', bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20h4',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', wifioff: 'M3 3l18 18M5 10a10 10 0 014-2.4M9 14a5 5 0 016 0M12 18h.01',
    book: 'M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h10', flame: 'M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 2 1.5 2C10 8 11 5 12 3z', leaf: 'M5 19C5 10 10 5 20 4c0 10-5 15-14 15zM5 19l8-8',
    bolt: 'M13 3L5 14h6l-1 7 8-11h-6z', coin: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 8v8M9.5 10.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4', star: 'M12 4l2.4 5 5.6.7-4 4 1 5.6-5-2.7-5 2.7 1-5.6-4-4 5.6-.7z',
  };
  function icon(name, cls) {
    const s = svg('svg', { viewBox: '0 0 24 24', class: 'ico ' + (cls || ''), 'aria-hidden': 'true', fill: 'none', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    s.appendChild(svg('path', { d: PATHS[name] || PATHS.app }));
    return s;
  }

  // ---------- formatting ----------
  function bytes(n) {
    if (n == null || !isFinite(n)) return '?';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = Math.abs(n);
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }
  function ago(t) {
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function dur(sec) {
    sec = Math.floor(sec);
    const d = Math.floor(sec / 86400);
    const hr = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return d ? d + 'd ' + hr + 'h' : hr ? hr + 'h ' + m + 'm' : m + 'm';
  }

  // ---------- network ----------
  async function api(method, path, body) {
    const opts = { method, headers: { 'X-LA-Request': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, opts); } catch (e) { throw new Error('Cannot reach Liberty AI. Is the app running?'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not json */ }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
    return data;
  }

  // POST and read a Server-Sent Events stream: onEvent(name, data)
  async function stream(path, body, onEvent, signal) {
    const res = await fetch(path, { method: 'POST', headers: { 'X-LA-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!res.ok) {
      let msg = 'Request failed (' + res.status + ')';
      try { msg = (await res.json()).error || msg; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let ev = 'message';
        let data = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) { try { onEvent(ev, JSON.parse(data)); } catch (e) { /* skip bad frame */ } }
      }
    }
  }

  // ---------- a small, safe Markdown renderer ----------
  function inline(text, onCite) {
    const frag = document.createDocumentFragment();
    const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[(\d{1,2})\])/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const t = m[1];
      if (t[0] === '`') frag.appendChild(h('code', { text: t.slice(1, -1) }));
      else if (t.startsWith('**')) frag.appendChild(h('strong', { text: t.slice(2, -2) }));
      else if (t[0] === '*') frag.appendChild(h('em', { text: t.slice(1, -1) }));
      else if (onCite) { const n = Number(m[2]); frag.appendChild(h('button', { class: 'cite', type: 'button', text: String(n), title: 'Show source ' + n, onclick: () => onCite(n) })); }
      else frag.appendChild(document.createTextNode(t));
      last = m.index + t.length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  function md(text, onCite) {
    const root = h('div', { class: 'md' });
    const lines = String(text).replace(/\r/g, '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        i++;
        const body = code.join('\n');
        root.appendChild(h('div', { class: 'codeblock' }, h('button', { class: 'copy', type: 'button', title: 'Copy', onclick: (e) => { copyText(body); toast('Copied'); e.currentTarget.blur(); } }, icon('copy')), h('pre', null, h('code', { text: body }))));
        continue;
      }
      const hd = /^(#{1,4})\s+(.*)$/.exec(line);
      if (hd) { root.appendChild(h('h4', null, inline(hd[2], onCite))); i++; continue; }
      if (/^\s*([-*•])\s+/.test(line)) {
        const ul = h('ul');
        while (i < lines.length && /^\s*([-*•])\s+/.test(lines[i])) ul.appendChild(h('li', null, inline(lines[i++].replace(/^\s*([-*•])\s+/, ''), onCite)));
        root.appendChild(ul);
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const ol = h('ol');
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) ol.appendChild(h('li', null, inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ''), onCite)));
        root.appendChild(ol);
        continue;
      }
      if (!line.trim()) { i++; continue; }
      const para = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
      const p = h('p');
      para.forEach((l, k) => { if (k) p.appendChild(document.createElement('br')); p.appendChild(inline(l, onCite)); });
      root.appendChild(p);
    }
    return root;
  }

  function copyText(t) {
    try { navigator.clipboard.writeText(t); return; } catch (e) { /* fall back */ }
    const ta = h('textarea', { value: t });
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }

  // ---------- toast + modal ----------
  let toastEl = null;
  let toastT = null;
  function toast(msg, kind) {
    if (!toastEl) { toastEl = h('div', { class: 'toast', role: 'status' }); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.className = 'toast show ' + (kind || '');
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.className = 'toast'; }, 3200);
  }

  function modal(title, body, actions) {
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } },
      h('div', { class: 'modal glass', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'modal-head' }, h('h3', { text: title }), h('button', { class: 'icon-btn', type: 'button', title: 'Close', onclick: close }, icon('x'))),
        h('div', { class: 'modal-body' }, body),
        actions ? h('div', { class: 'modal-actions' }, actions(close)) : null));
    document.body.appendChild(back);
    document.addEventListener('keydown', onKey);
    return close;
  }

  // ---------- small visuals ----------
  function spark(values, cls, max) {
    const w = 160;
    const ht = 40;
    const vs = values.filter((v) => typeof v === 'number');
    const s = svg('svg', { viewBox: '0 0 ' + w + ' ' + ht, class: 'spark ' + (cls || ''), preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    if (vs.length < 2) return s;
    const lo = 0;
    const hi = max || Math.max(...vs, 1);
    const pts = values.map((v, i) => (typeof v === 'number' ? [Math.round((i / (values.length - 1)) * w * 10) / 10, Math.round((ht - 3 - ((v - lo) / (hi - lo || 1)) * (ht - 6)) * 10) / 10] : null)).filter(Boolean);
    const d = 'M' + pts.map((p) => p.join(' ')).join(' L');
    s.appendChild(svg('path', { d: d + ' L' + w + ' ' + ht + ' L0 ' + ht + ' Z', class: 'fill' }));
    s.appendChild(svg('path', { d, class: 'line' }));
    return s;
  }

  function ring(pct, label, sub, tone) {
    const r = 52;
    const c = 2 * Math.PI * r;
    const wrap = h('div', { class: 'ring ' + (tone || '') });
    const s = svg('svg', { viewBox: '0 0 128 128', 'aria-hidden': 'true' });
    s.appendChild(svg('circle', { cx: 64, cy: 64, r, class: 'track' }));
    s.appendChild(svg('circle', { cx: 64, cy: 64, r, class: 'arc', 'stroke-dasharray': (c * Math.max(0, Math.min(100, pct))) / 100 + ' ' + c, transform: 'rotate(-90 64 64)' }));
    wrap.appendChild(s);
    wrap.appendChild(h('div', { class: 'ring-text' }, h('b', { text: label }), sub ? h('small', { text: sub }) : null));
    return wrap;
  }

  function bar(pct, tone) {
    const f = h('i');
    f.style.width = Math.max(0, Math.min(100, pct)) + '%';
    return h('div', { class: 'bar ' + (tone || '') }, f);
  }
  const tone = (pct, warn, crit) => (pct >= crit ? 'crit' : pct >= warn ? 'warn' : 'ok');

  function hueOf(str) {
    let x = 0;
    for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0;
    return x % 360;
  }
  function monogram(name, id) {
    const m = h('span', { class: 'mono', 'aria-hidden': 'true', text: name.replace(/[^A-Za-z0-9 ]/g, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?' });
    m.style.setProperty('--hue', String(hueOf(id || name)));
    return m;
  }

  Object.assign(LA, { h, clear, svg, icon, bytes, ago, dur, api, stream, md, copyText, toast, modal, spark, ring, bar, tone, monogram, add });
})();
