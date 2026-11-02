// Scripture hotspot: the phone app. Read, Search, Timeline, Chat, About, plus a quick-hide disguise.
// Everything runs in the phone's browser; only the chat talks to the Pi (api/chat).
import { Engine, BOOKS, BOOK_BY_ID, findBook, parseRef } from './engine.js';
import { parseSpan } from './nav.js';

const CFG = window.BT || {};
const APP = CFG.appName || 'Scripture';
const $ = s => document.querySelector(s);
const view = $('#view'), ttl = $('#ttl'), sheet = $('#sheet'), selbar = $('#selbar'), tabsEl = $('#tabs');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ small saved settings (this phone only)
const LS = 'bt-m1';
let S = { size: 2, theme: 'auto', nick: '', cid: '', pos: null, intro: false, autohide: true };
try { S = { ...S, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { /* private mode */ }
const save = () => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch { /* ignore */ } };
if (!S.cid) { S.cid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4); save(); }
const ADJ = ['Quiet', 'Gentle', 'Bright', 'Steady', 'Humble', 'Faithful', 'Kind', 'Patient', 'Hopeful', 'Joyful', 'Calm', 'Brave'];
const NOUN = ['Sparrow', 'Lamp', 'Shepherd', 'Harbor', 'Oak', 'Dove', 'Lighthouse', 'Willow', 'Anchor', 'River', 'Lantern', 'Pilgrim'];
if (!S.nick) { S.nick = ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + NOUN[Math.floor(Math.random() * NOUN.length)]; save(); }

const SIZES = [16, 17.5, 19, 21, 23.5];
function applyLook() {
  const r = document.documentElement;
  r.style.setProperty('--fs', SIZES[S.size] + 'px');
  if (S.theme === 'auto') r.removeAttribute('data-theme'); else r.dataset.theme = S.theme;
  const dark = S.theme === 'dark' || (S.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#14120f' : '#f6f1e7';
}
applyLook();
document.title = APP;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
function copyText(text) {
  const done = () => toast('Copied');
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, () => fallback());
  fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    try { document.execCommand('copy'); done(); } catch { toast('Press and hold the text to copy'); }
    ta.remove();
  }
}

// ------------------------------------------------------------------ icons and tabs
const I = {
  read: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5C4.7 19 4 18.3 4 17.5zM20 5.5c0-.8-.7-1.5-1.5-1.5H13v15h5.5c.8 0 1.5-.7 1.5-1.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  time: '<path d="M3 12h18M7 12V6M12 12v6M17 12V8"/><circle cx="7" cy="5" r="1.3"/><circle cx="12" cy="19" r="1.3"/><circle cx="17" cy="7" r="1.3"/>',
  chat: '<path d="M5 5h14a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0119 16h-7l-4.5 3.5V16H5a1.5 1.5 0 01-1.5-1.5v-8A1.5 1.5 0 015 5z"/>',
  about: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/>',
  send: '<path d="M4 12l16-7-6 15-2.5-6.2z"/>',
};
const TABS = [['read', 'Read'], ['search', 'Search'], ['time', 'Timeline'], ['chat', 'Chat'], ['about', 'About']];
function drawTabs(cur) {
  tabsEl.innerHTML = TABS.map(([k, n]) => `<a href="#/${k}" class="${k === cur ? 'on' : ''}" ${k === cur ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>${n}${k === 'chat' && unread && cur !== 'chat' ? `<span class="dot">${unread > 9 ? '9+' : unread}</span>` : ''}</a>`).join('');
}

// ------------------------------------------------------------------ router
let E = null, cleanup = null;
const parse = () => {
  const raw = location.hash.replace(/^#\/?/, ''); const [p, q = ''] = raw.split('?');
  return { name: p.split('/')[0] || 'read', parts: p.split('/').slice(1).map(x => { try { return decodeURIComponent(x); } catch { return x; } }), q: new URLSearchParams(q) };
};
const readHref = (id, c, v, len = 0) => `#/read/${id}/${c}` + (v ? `?v=${v}${len ? '-' + (v + len) : ''}` : '');

async function route() {
  if (!E) return;
  const r = parse();
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  clearSel();
  closeSheet();
  view.className = r.name === 'chat' ? 'chat' : '';
  view.scrollTop = 0;
  if (r.name === 'chat') unread = 0;
  drawTabs(r.name);
  const fn = { read: readView, search: searchView, time: timeView, chat: chatView, about: aboutView }[r.name] || readView;
  cleanup = (await fn(r)) || null;
}

function setTitle(html) { ttl.innerHTML = html; }

// ------------------------------------------------------------------ Read
let sel = new Set();
function clearSel() { sel = new Set(); selbar.hidden = true; document.querySelectorAll('.v.sel').forEach(e => e.classList.remove('sel')); }
function drawSel() {
  if (!sel.size) { selbar.hidden = true; return; }
  selbar.hidden = false;
  selbar.innerHTML = `<span>${sel.size} verse${sel.size > 1 ? 's' : ''}</span><button data-a="copy">Copy</button><button data-a="chat">To chat</button><button data-a="x" aria-label="Clear selection">✕</button>`;
}
function selection() {
  const idx = [...sel].sort((a, b) => a - b);
  const first = idx[0];
  let len = 0; while (len + 1 < idx.length && idx[len + 1] === idx[len] + 1) len++;
  return { idx, first, len };
}
selbar.addEventListener('click', e => {
  const a = e.target.closest('button')?.dataset.a; if (!a) return;
  const { idx, first, len } = selection();
  if (a === 'x') return clearSel();
  if (a === 'copy') {
    const lines = idx.map(i => `${E.at(i).v}. ${E.text(i)}`);
    copyText(`${lines.join(' ')}\n— ${E.labelRange(first, len)} (KJV)`); clearSel();
  }
  if (a === 'chat') { pendingRef = E.key(first, len); clearSel(); location.hash = '#/chat'; }
});

function readPos(r) {
  let id = r.parts[0], c = +r.parts[1];
  if (!id || !BOOK_BY_ID[id]) { const p = S.pos; id = p && BOOK_BY_ID[p.id] ? p.id : 'John'; c = p ? p.c : 1; }
  c = Math.min(Math.max(c || 1, 1), E.chapterCount(id));
  return { id, c };
}
function readView(r) {
  const { id, c } = readPos(r);
  S.pos = { id, c }; save();
  const b = BOOK_BY_ID[id], ch = E.chapter(id, c);
  setTitle(`<button type="button" id="pick">${esc(b.name)} ${c}</button>`);
  $('#pick').onclick = () => bookSheet(id);
  let hi = null;
  const vq = r.q.get('v'); if (vq) { const m = vq.match(/^(\d+)(?:-(\d+))?$/); if (m) hi = [+m[1], +(m[2] || m[1])]; }
  const verses = [];
  for (let k = 0; k < ch.count; k++) verses.push(`<span class="v${hi && k + 1 >= hi[0] && k + 1 <= hi[1] ? ' sel' : ''}" data-i="${ch.start + k}"><sup>${k + 1}</sup>${esc(E.text(ch.start + k))} </span>`);
  const prev = c > 1 ? readHref(id, c - 1) : (b.index > 0 ? readHref(BOOKS[b.index - 1].id, E.chapterCount(BOOKS[b.index - 1].id)) : null);
  const next = c < E.chapterCount(id) ? readHref(id, c + 1) : (b.index < 65 ? readHref(BOOKS[b.index + 1].id, 1) : null);
  view.innerHTML = `<article class="chap"><h2 class="ct">${esc(b.name)} ${c}</h2><p class="t">${verses.join('')}</p>
    <div class="pager">${prev ? `<a class="btn" href="${prev}">‹ Previous</a>` : '<span></span>'}${next ? `<a class="btn pri" href="${next}">Next ›</a>` : '<span></span>'}</div>
    <p class="mute" style="text-align:center;font-size:.85rem">Tap a verse to select it. Swipe left or right to turn the page.</p></article>`;
  if (hi) { for (let v = hi[0]; v <= hi[1]; v++) sel.add(ch.start + v - 1); drawSel(); const el = view.querySelector(`.v[data-i="${ch.start + hi[0] - 1}"]`); if (el) el.scrollIntoView({ block: 'center' }); }
  view.onclick = e => {
    const v = e.target.closest('.v'); if (!v) return;
    const i = +v.dataset.i;
    if (sel.has(i)) { sel.delete(i); v.classList.remove('sel'); } else { sel.add(i); v.classList.add('sel'); }
    drawSel();
  };
  let x0 = 0, y0 = 0, t0 = 0;
  view.ontouchstart = e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); };
  view.ontouchend = e => {
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) > 90 && Math.abs(dy) < 45 && Date.now() - t0 < 600 && !String(getSelection())) { const go = dx < 0 ? next : prev; if (go) location.hash = go; }
  };
  return () => { view.onclick = view.ontouchstart = view.ontouchend = null; };
}
function bookSheet(curId, testament) {
  const t = testament || BOOK_BY_ID[curId].testament;
  openSheet(`<h3>Choose a book</h3><div class="seg" id="tt"><button class="${t === 'OT' ? 'on' : ''}" data-t="OT">Old Testament</button><button class="${t === 'NT' ? 'on' : ''}" data-t="NT">New Testament</button></div>
    <div class="grid" id="bk">${BOOKS.filter(b => b.testament === t).map(b => `<button data-b="${b.id}" class="${b.id === curId ? 'on' : ''}">${esc(b.name)}</button>`).join('')}</div>`, p => {
    p.onclick = e => {
      const tb = e.target.closest('[data-t]'); if (tb) return bookSheet(curId, tb.dataset.t);
      const bb = e.target.closest('[data-b]'); if (!bb) return;
      const id = bb.dataset.b, n = E.chapterCount(id);
      if (n === 1) { location.hash = readHref(id, 1); return; }
      openSheet(`<h3>${esc(BOOK_BY_ID[id].name)}</h3><div class="grid n">${Array.from({ length: n }, (_, k) => `<button data-c="${k + 1}">${k + 1}</button>`).join('')}</div><p><button class="btn" id="back" style="width:100%">‹ All books</button></p>`, q => {
        q.onclick = ev => { const cb = ev.target.closest('[data-c]'); if (cb) location.hash = readHref(id, +cb.dataset.c); if (ev.target.closest('#back')) bookSheet(curId, t); };
      });
    };
  });
}

// ------------------------------------------------------------------ Search
const TOPICS = ['peace', 'fear not', 'hope', 'forgive*', 'strength', 'comfort', 'courage', 'love', 'prayer', 'faith', 'grace', 'wisdom'];
let lastQ = '', lastScope = 'all';
function markHtml(text, re) {
  if (!re) return esc(text);
  let out = '', last = 0, m; re.lastIndex = 0;
  const padded = ' ' + text + ' ';
  while ((m = re.exec(padded))) {
    if (!m[0]) { re.lastIndex++; continue; }
    const s = m.index - 1, e = s + m[0].length;
    if (s < last) continue;
    out += esc(text.slice(last, Math.max(s, 0))) + '<mark>' + esc(text.slice(Math.max(s, 0), e)) + '</mark>'; last = e;
  }
  return out + esc(text.slice(last));
}
function searchView(r) {
  setTitle('Search');
  const q0 = r.q.get('q') || ''; const scope0 = r.q.get('in') || lastScope;
  view.innerHTML = `<form class="sbox" id="sf" role="search"><input id="sq" type="search" enterkeyhint="search" placeholder="A word, a phrase, or Psalm 23" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(q0)}"><button class="btn pri" type="submit">Go</button></form>
    <div class="seg" id="sc"><button type="button" data-s="all" class="${scope0 === 'all' ? 'on' : ''}">Whole Bible</button><button type="button" data-s="OT" class="${scope0 === 'OT' ? 'on' : ''}">Old</button><button type="button" data-s="NT" class="${scope0 === 'NT' ? 'on' : ''}">New</button></div><div id="out"></div>`;
  const out = $('#out'); let scope = scope0, shown = 40, res = null;
  const go = (q, push = true) => {
    q = q.trim(); lastQ = q; lastScope = scope;
    if (push) history.replaceState(null, '', `#/search?q=${encodeURIComponent(q)}${scope !== 'all' ? '&in=' + scope : ''}`);
    if (!q) return empty();
    const ref = parseRef(q);
    if (ref && ref.chapter) { const c = Math.min(ref.chapter, E.chapterCount(ref.book)); location.hash = readHref(ref.book, c, ref.verse, ref.verseEnd && ref.verse ? ref.verseEnd - ref.verse : 0); return; }
    res = E.search(q, { scope: scope === 'all' ? null : { type: 't', value: scope } }); shown = 40; paint(ref);
  };
  function empty() {
    out.innerHTML = `<p class="mute">Search every verse. Put a phrase in quotes, add * to match word endings (lov*), or type a place like <b>John 3:16</b>.</p><h2>Try one of these</h2><div style="display:flex;flex-wrap:wrap;gap:8px">${TOPICS.map(t => `<button class="chip" type="button" data-t="${esc(t)}">${esc(t.replace('*', ''))}</button>`).join('')}</div>`;
  }
  function paint(ref) {
    const bk = ref && ref.book ? `<a class="chip on" style="margin-bottom:8px" href="${readHref(ref.book, 1)}">Open ${esc(BOOK_BY_ID[ref.book].name)} ›</a>` : '';
    if (!res.total) { out.innerHTML = `${bk}<p class="mute" style="margin-top:16px">No verses found. Try a simpler word, or check the spelling.</p>`; return; }
    const hits = res.hits.slice(0, shown);
    out.innerHTML = `${bk}<p class="mute" style="margin:12px 0 2px">${res.total.toLocaleString()} verse${res.total === 1 ? '' : 's'}</p>` + hits.map(i => {
      const a = E.at(i); return `<a class="hit" href="${readHref(a.id, a.c, a.v)}"><b>${esc(E.label(i))}</b><span>${markHtml(E.text(i), res.highlight)}</span></a>`;
    }).join('') + (res.total > shown ? `<p><button class="btn" id="more" style="width:100%">Show more</button></p>` : '');
  }
  $('#sf').onsubmit = e => { e.preventDefault(); $('#sq').blur(); go($('#sq').value); };
  $('#sc').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; scope = b.dataset.s; $('#sc').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); if ($('#sq').value.trim()) go($('#sq').value); };
  out.onclick = e => {
    const t = e.target.closest('[data-t]'); if (t) { $('#sq').value = t.dataset.t; go(t.dataset.t); }
    if (e.target.closest('#more')) { shown += 40; paint(parseRef($('#sq').value)); }
  };
  if (q0) go(q0, false); else empty();
}

// ------------------------------------------------------------------ Timeline
function timeView(r) {
  setTitle('Timeline');
  const T = E.timeline; const era = r.parts[0] || '';
  const eras = era ? T.eras.filter(e => e.id === era) : T.eras;
  const link = text => {
    const s = parseSpan(text, findBook);
    if (!s || !BOOK_BY_ID[s.book]) return `<span class="mute">${esc(text)}</span>`;
    const c = Math.min(Math.max(s.c, 1), E.chapterCount(s.book));
    return `<a class="chip" href="${readHref(s.book, c, s.v, s.v && s.v2 ? s.v2 - s.v : 0)}">${esc(text)}</a>`;
  };
  view.innerHTML = `<div class="chips"><a class="chip${era ? '' : ' on'}" href="#/time">All</a>${T.eras.map(e => `<a class="chip${era === e.id ? ' on' : ''}" href="#/time/${e.id}">${esc(e.name)}</a>`).join('')}</div>
    ${eras.map(e => `<section class="era"><h2>${esc(e.name)}</h2><div class="span">${esc(e.span)}</div>${T.events.filter(ev => ev.era === e.id).map(ev => `<div class="ev"><div class="when">${esc(ev.date)}</div><div class="t">${esc(ev.title)}</div><div class="s">${esc(ev.summary)}</div><div>${(ev.refs || []).map(link).join('')}</div></div>`).join('')}</section>`).join('')}
    <p class="mute" style="font-size:.85rem">Dates are approximate and follow a traditional chronology; scholars differ.</p>`;
}

// ------------------------------------------------------------------ Chat (the only part that talks to the Pi)
let msgs = [], after = 0, online = 1, unread = 0, pollTok = 0, pollCtl = null, pendingRef = null, chatUp = true, onChatMsg = null;
async function pollLoop(tok) {
  let fail = 0;
  while (tok === pollTok) {
    try {
      pollCtl = new AbortController();
      const res = await fetch(`api/chat?after=${after}&cid=${encodeURIComponent(S.cid)}&wait=20`, { signal: pollCtl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json(); if (tok !== pollTok) return;
      chatUp = true; fail = 0; online = d.online || 1;
      if (d.reset) msgs = [];
      const fresh = d.msgs.filter(m => !msgs.some(x => x.id === m.id));
      msgs = msgs.concat(fresh); after = d.last;
      const incoming = fresh.filter(m => !m.mine).length;
      if (incoming && parse().name !== 'chat') { unread += incoming; drawTabs(parse().name); }
      if (onChatMsg) onChatMsg(fresh.length > 0);
    } catch { if (tok !== pollTok) return; chatUp = false; if (onChatMsg) onChatMsg(false); fail++; await sleep(Math.min(8000, 1500 * fail)); }
  }
}
function startPoll() { stopPoll(); pollTok++; pollLoop(pollTok); }
function stopPoll() { pollTok++; if (pollCtl) pollCtl.abort(); }
const hhmm = t => new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function verseCard(ref) {
  const k = E.fromKey(ref); if (!k) return '';
  const a = E.at(k.idx);
  return `<a class="vc" href="${readHref(a.id, a.c, a.v, k.len)}"><b>${esc(E.labelRange(k.idx, k.len))}</b><i>${esc(E.rangeText(k.idx, k.len))}</i></a>`;
}
function chatView() {
  setTitle('Chat');
  view.innerHTML = `<div class="chathead"><span id="who" class="mute"></span><button type="button" id="nick">Change name</button></div>
    <div class="msgs" id="ml"></div>
    <form class="compose" id="cf"><div id="att"></div><div class="row"><textarea id="ct" rows="1" maxlength="400" placeholder="Message everyone here" enterkeyhint="send" autocomplete="off"></textarea><button class="send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24">${I.send}</svg></button></div></form>`;
  const ml = $('#ml'), ct = $('#ct');
  const head = () => { $('#who').textContent = chatUp ? `You are ${S.nick} · ${online} here` : 'Reconnecting…'; };
  function draw(stick) {
    const near = ml.scrollHeight - ml.scrollTop - ml.clientHeight < 140;
    ml.innerHTML = `<div class="note">Everyone connected to this hotspot can read these messages. Nothing is saved: they disappear when the device restarts.</div>` +
      msgs.map(m => { const me = !!m.mine; return `<div class="m${me ? ' me' : ''}"><div class="who">${me ? 'You' : esc(m.nick)} · ${hhmm(m.t)}</div><div class="b">${m.text ? esc(m.text) : ''}${m.ref ? verseCard(m.ref) : ''}</div></div>`; }).join('');
    if (stick || near) ml.scrollTop = ml.scrollHeight;
    head();
  }
  function att() { $('#att').innerHTML = pendingRef ? `<div class="attach"><b>${esc((() => { const k = E.fromKey(pendingRef); return k ? E.labelRange(k.idx, k.len) : ''; })())}</b><span class="mute">attached</span><button type="button" id="unatt" aria-label="Remove verse">✕</button></div>` : ''; const u = $('#unatt'); if (u) u.onclick = () => { pendingRef = null; att(); }; }
  draw(true); att();
  onChatMsg = () => { if (parse().name === 'chat') draw(false); };
  ct.oninput = () => { ct.style.height = 'auto'; ct.style.height = Math.min(120, ct.scrollHeight) + 'px'; };
  ct.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#cf').requestSubmit(); } };
  $('#cf').onsubmit = async e => {
    e.preventDefault();
    const text = ct.value.trim(); if (!text && !pendingRef) return;
    ct.value = ''; ct.style.height = 'auto';
    const ref = pendingRef; pendingRef = null; att();
    try {
      const res = await fetch('api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify({ cid: S.cid, nick: S.nick, text, ref }) });
      if (res.status === 429) { toast('Slow down a little'); ct.value = text; pendingRef = ref; att(); }
      else if (!res.ok) throw new Error();
    } catch { toast('Could not send. Try again.'); ct.value = text; pendingRef = ref; att(); }
  };
  $('#nick').onclick = () => openSheet(`<h3>Your name in chat</h3><p class="mute">Pick anything. It is only used here and is not tied to you.</p><form id="nf"><div class="sbox"><input id="ni" maxlength="24" value="${esc(S.nick)}" autocomplete="off"><button class="btn pri" type="submit">Save</button></div></form>`, p => {
    p.querySelector('#nf').onsubmit = e => { e.preventDefault(); const v = p.querySelector('#ni').value.replace(/\s+/g, ' ').trim().slice(0, 24); if (v) { S.nick = v; save(); head(); } closeSheet(); };
  });
  return () => { onChatMsg = null; };
}

// ------------------------------------------------------------------ About
function aboutView() {
  setTitle('About');
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const cna = /CaptiveNetworkSupport/i.test(navigator.userAgent);
  view.innerHTML = `${cna ? `<div class="card intro"><b>Tip:</b> this small window closes when you leave. For the best experience open your phone's normal browser (${ios ? 'Safari' : 'Chrome'}) and go to <b>http://${esc(location.host)}</b></div>` : ''}
    <div class="card"><h2 style="margin-top:0">${esc(APP)}</h2><p>The complete King James Bible, working with no internet and no cell service. Read, search, follow the timeline, and talk with others on this same Wi-Fi.</p>
    <p class="mute" style="margin-bottom:0">King James Version (public domain)${CFG.version ? ' · v' + esc(CFG.version) : ''}</p></div>
    <h2>Quick hide</h2><div class="card"><p style="margin-top:0">Tap the <b>eye</b> at the top right and the screen turns into a plain calculator. To come back, <b>press and hold the = key</b> for a second.</p>
    <label class="opt"><input type="checkbox" id="ah" ${S.autohide ? 'checked' : ''}> Hide automatically when I switch apps or lock my phone</label>
    <button class="btn" id="hidebtn" style="width:100%;margin-top:6px">Try it now</button></div>
    <h2>Use it like an app</h2><div class="card"><p style="margin-top:0">${ios ? 'In Safari tap the <b>Share</b> button, then <b>Add to Home Screen</b>.' : 'In Chrome tap the <b>⋮ menu</b>, then <b>Add to Home screen</b> (or <b>Install app</b>).'} It opens full screen like an app. You still need to be connected to this Wi-Fi for it to load.</p></div>
    <h2>Privacy</h2><div class="card"><p style="margin-top:0">This device keeps no record of who connects or what anyone reads. Chat messages live only in its memory and vanish when it restarts. On your phone only your text size, color choice, chat name and last place read are remembered.</p><button class="btn" id="wipe" style="width:100%">Erase what this phone remembers</button></div>`;
  $('#ah').onchange = e => { S.autohide = e.target.checked; save(); };
  $('#hidebtn').onclick = () => hideNow();
  $('#wipe').onclick = () => { try { localStorage.removeItem(LS); } catch { /* ignore */ } S = { size: 2, theme: 'auto', nick: '', cid: S.cid, pos: null, intro: true, autohide: true }; S.nick = ADJ[0] + ' ' + NOUN[0]; save(); applyLook(); toast('Erased'); };
}

// ------------------------------------------------------------------ sheet and display options
function openSheet(html, init) {
  sheet.innerHTML = `<div class="pane" role="dialog"><div class="grab"></div>${html}</div>`; sheet.hidden = false;
  const pane = sheet.firstChild; if (init) init(pane);
}
function closeSheet() { sheet.hidden = true; sheet.innerHTML = ''; }
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
$('#aa').onclick = () => {
  const draw = p => {
    p.innerHTML = `<div class="grab"></div><h3>Text and color</h3><div class="sz"><button data-z="-1" aria-label="Smaller">A−</button><span style="font-size:${SIZES[S.size]}px">In the beginning</span><button data-z="1" aria-label="Larger">A+</button></div>
      <div class="seg">${['auto', 'light', 'dark'].map(t => `<button data-th="${t}" class="${S.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div><p><button class="btn pri" style="width:100%;margin-top:16px" data-done="1">Done</button></p>`;
  };
  openSheet('', p => {
    draw(p);
    p.onclick = e => {
      const z = e.target.closest('[data-z]'), th = e.target.closest('[data-th]');
      if (z) S.size = Math.min(4, Math.max(0, S.size + +z.dataset.z));
      if (th) S.theme = th.dataset.th;
      if (z || th) { save(); applyLook(); draw(p); }
      if (e.target.closest('[data-done]')) closeSheet();
    };
  });
};

// ------------------------------------------------------------------ the disguise (a working calculator)
const decoy = $('#decoy'); let hidden = false;
const CALC = [['AC', 'f'], ['±', 'f'], ['%', 'f'], ['÷', 'o'], ['7'], ['8'], ['9'], ['×', 'o'], ['4'], ['5'], ['6'], ['−', 'o'], ['1'], ['2'], ['3'], ['+', 'o'], ['0', 'z'], ['.'], ['=', 'o']];
decoy.innerHTML = `<div class="disp" id="dd">0</div><div class="keys">${CALC.map(([k, c]) => `<button type="button" data-k="${k}" class="${c || ''}">${k}</button>`).join('')}</div>`;
let cur = '0', acc = null, op = null, fresh = true, holdT = null;
const fmt = n => { if (!isFinite(n)) return 'Error'; let s = String(+n.toPrecision(9)); if (s.includes('e')) s = n.toExponential(4); return s; };
function key(k) {
  const dd = $('#dd');
  if (/^\d$/.test(k)) { cur = fresh || cur === '0' ? k : (cur.length < 12 ? cur + k : cur); fresh = false; }
  else if (k === '.') { if (fresh) { cur = '0.'; fresh = false; } else if (!cur.includes('.')) cur += '.'; }
  else if (k === 'AC') { cur = '0'; acc = null; op = null; fresh = true; }
  else if (k === '±') cur = cur.startsWith('-') ? cur.slice(1) : (cur === '0' ? cur : '-' + cur);
  else if (k === '%') { cur = fmt(parseFloat(cur) / 100); fresh = true; }
  else {
    const v = parseFloat(cur);
    if (op && !fresh) { acc = apply(acc, v, op); cur = fmt(acc); } else acc = v;
    op = k === '=' ? null : k; fresh = true;
  }
  dd.textContent = cur;
}
const apply = (a, b, o) => o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : (b === 0 ? NaN : a / b);
decoy.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) key(b.dataset.k); });
const eq = decoy.querySelector('[data-k="="]');
const down = e => { clearTimeout(holdT); holdT = setTimeout(() => { holdT = null; if (navigator.vibrate) navigator.vibrate(30); showNow(); }, 900); };
const up = () => clearTimeout(holdT);
eq.addEventListener('pointerdown', down); eq.addEventListener('pointerup', up); eq.addEventListener('pointerleave', up); eq.addEventListener('pointercancel', up);
eq.addEventListener('contextmenu', e => e.preventDefault());
function hideNow() {
  if (hidden) return;
  hidden = true; clearSel(); closeSheet(); stopPoll();
  cur = '0'; acc = null; op = null; fresh = true; $('#dd').textContent = '0';
  decoy.hidden = false; decoy.removeAttribute('aria-hidden'); document.title = 'Calculator';
  document.querySelector('meta[name=theme-color]').content = '#1c1c1e';
  document.getElementById('app').style.visibility = 'hidden';
}
function showNow() {
  if (!hidden) return;
  hidden = false; decoy.hidden = true; decoy.setAttribute('aria-hidden', 'true'); document.title = APP;
  document.getElementById('app').style.visibility = ''; applyLook();
  if (document.visibilityState === 'visible') startPoll();
}
$('#hide').onclick = hideNow;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !hidden) hideNow(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (S.autohide) hideNow(); else stopPoll(); }
  else if (!hidden && E) startPoll();
});
window.addEventListener('pagehide', () => { if (S.autohide) hideNow(); });

// ------------------------------------------------------------------ start
async function boot() {
  view.innerHTML = `<div class="load"><div><p>Opening…</p><div class="bar"><i id="bar"></i></div></div></div>`;
  tabsEl.innerHTML = '';
  try {
    const names = ['kjv', 'timeline']; const d = { plans: [], manifest: {} }; let n = 0;
    const v = CFG.version ? '?v=' + encodeURIComponent(CFG.version) : '';
    await Promise.all(names.map(async nm => { const r = await fetch(`data/${nm}.json${v}`); if (!r.ok) throw new Error(nm + ' ' + r.status); d[nm] = await r.json(); $('#bar').style.width = (++n / names.length * 100) + '%'; }));
    E = new Engine(d);
  } catch (e) { view.innerHTML = `<div class="load"><div><p>Could not load the Bible.</p><p><button class="btn pri" id="retry">Try again</button></p><p class="mute" style="font-size:.8rem">${esc(e.message)}</p></div></div>`; $('#retry').onclick = () => location.reload(); return; }
  if (!location.hash) history.replaceState(null, '', '#/read');
  await route();
  window.addEventListener('hashchange', route);
  if (!S.intro && parse().name === 'read') {
    S.intro = true; save();
    const card = document.createElement('div'); card.className = 'card intro';
    card.innerHTML = `<b>Welcome.</b> Use the tabs below to read, search, follow the timeline or chat. The <b>eye</b> at the top right hides the screen instantly; hold <b>=</b> on the calculator to come back. <div><button class="btn pri" type="button">Got it</button></div>`;
    card.querySelector('button').onclick = () => card.remove();
    view.prepend(card);
  }
  startPoll();
}
boot();
