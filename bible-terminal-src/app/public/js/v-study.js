import { BOOK_BY_ID, findBook } from './engine.js';
import { esc, download, fmtDate } from './ui.js';
import { href, readHref, parseSpan } from './nav.js';

const DAY = 86400000;
const spanLink = (E, text) => {
  const s = parseSpan(text, findBook);
  if (!s || !BOOK_BY_ID[s.book]) return `<span>${esc(text)}</span>`;
  const c = Math.min(Math.max(s.c, 1), E.chapterCount(s.book));
  return `<a class="chip" href="${readHref(s.book, c, s.v, s.v && s.v2 ? s.v2 - s.v : 0)}">${esc(text)}</a>`;
};

// ------------------------------------------------------------------ timeline
export async function timelineView(ctx, r, root) {
  const E = ctx.engine, T = E.timeline;
  const era = r.parts[0] || '';
  const eras = era ? T.eras.filter(e => e.id === era) : T.eras;
  root.innerHTML = `<h1>Timeline</h1>
    <p class="muted">Dates are approximate and follow a traditional conservative chronology; scholars differ. Events link to the passage.</p>
    <div class="eras noprint"><a class="chip${era ? '' : ' on'}" href="#/timeline">All</a>${T.eras.map(e => `<a class="chip${era === e.id ? ' on' : ''}" href="${href('timeline', [e.id])}">${esc(e.name)}</a>`).join('')}</div>
    ${eras.map(e => `<section class="era"><h2>${esc(e.name)}</h2><div class="span">${esc(e.span)}</div>
      ${T.events.filter(ev => ev.era === e.id).map(ev => `<div class="ev"><div class="when">${esc(ev.date)}</div><div class="t">${esc(ev.title)}</div>
        <div class="s">${esc(ev.summary)}</div><div>${(ev.refs || []).map(x => spanLink(E, x)).join('')}</div></div>`).join('')}
    </section>`).join('')}`;
}

// ------------------------------------------------------------------ plans
const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
export async function plansView(ctx, r, root) {
  const E = ctx.engine, store = ctx.store, plans = E.plans;
  const pid = r.parts[0];
  if (!pid || !plans.find(p => p.id === pid)) {
    root.innerHTML = `<h1>Reading plans</h1><div class="grid2">${plans.map(p => {
      const st = store.doc.plans[p.id];
      return `<a class="card" style="text-decoration:none;color:inherit" href="${href('plans', [p.id])}"><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p>
        ${st ? `<div class="bar"><i style="width:${Math.round(st.done.length / p.days.length * 100)}%"></i></div><p class="muted">${st.done.length} of ${p.days.length} days done</p>` : '<p class="muted">Not started</p>'}</a>`;
    }).join('')}</div>`;
    return;
  }
  const plan = plans.find(p => p.id === pid);
  const st = store.doc.plans[pid];
  if (!st) {
    root.innerHTML = `<h1>${esc(plan.name)}</h1><div class="card"><p>${esc(plan.description)}</p><p class="muted">${plan.days.length} days. You can read at your own pace — tick days as you finish them.</p><button class="primary" id="start">start this plan today</button> <a href="#/plans">back</a></div>`;
    root.querySelector('#start').onclick = () => { store.change(d => { d.plans[pid] = { start: startOfDay(Date.now()), done: [] }; }); plansView(ctx, r, root); };
    return;
  }
  const today = Math.min(plan.days.length, Math.max(1, Math.floor((startOfDay(Date.now()) - st.start) / DAY) + 1));
  const done = new Set(st.done);
  let next = 1; while (done.has(next) && next < plan.days.length) next++;
  const show = Math.max(1, parseInt(r.q.get('d'), 10) || next);
  const dayRefs = n => plan.days[n - 1].map(([b, c1, c2]) => {
    const name = BOOK_BY_ID[b].name;
    const label = c1 === c2 ? `${name} ${c1}` : `${name} ${c1}–${c2}`;
    return `<a class="chip" href="${readHref(b, c1)}">${esc(label)}</a>`;
  }).join('');
  root.innerHTML = `<h1>${esc(plan.name)}</h1>
    <div class="card"><div class="row"><b>${done.size}</b> of ${plan.days.length} days done · day ${today} by the calendar ${done.size < today - 1 ? `<span class="warn">(${today - 1 - done.size} behind — no pressure)</span>` : ''}<span class="grow"></span><a href="#/plans">all plans</a><button id="reset">reset</button></div>
      <div class="bar" style="margin-top:.5rem"><i style="width:${Math.round(done.size / plan.days.length * 100)}%"></i></div></div>
    <div class="card"><h2>Day ${show}</h2><div>${dayRefs(show)}</div>
      <p><button class="primary" id="mark">${done.has(show) ? 'mark not done' : 'mark day ' + show + ' done'}</button>
      ${show > 1 ? `<a class="chip" href="${href('plans', [pid], { d: show - 1 })}">◀ day ${show - 1}</a>` : ''}${show < plan.days.length ? `<a class="chip" href="${href('plans', [pid], { d: show + 1 })}">day ${show + 1} ▶</a>` : ''}</p></div>
    <details open><summary>All days</summary><div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.6rem">
      ${plan.days.map((_, k) => `<a class="chip${done.has(k + 1) ? ' on' : ''}" href="${href('plans', [pid], { d: k + 1 })}" title="Day ${k + 1}">${done.has(k + 1) ? '✓' : ''}${k + 1}</a>`).join('')}</div></details>`;
  root.querySelector('#mark').onclick = () => {
    store.change(d => { const s = d.plans[pid]; const i = s.done.indexOf(show); if (i >= 0) s.done.splice(i, 1); else s.done = [...s.done, show].sort((a, b) => a - b); });
    const nx = show < plan.days.length && !done.has(show) ? show + 1 : show;
    location.hash = href('plans', [pid], { d: nx }); if (nx === show) plansView(ctx, r, root);
  };
  root.querySelector('#reset').onclick = () => { if (confirm('Start this plan over? Your progress on it will be cleared.')) { store.change(d => { delete d.plans[pid]; }); plansView(ctx, r, root); } };
}

// ------------------------------------------------------------------ memorize
const INTERVALS = [0, 1, 3, 7, 14, 30].map(d => d * DAY);
export async function memorizeView(ctx, r, root) {
  const E = ctx.engine, store = ctx.store;
  const cards = () => Object.entries(store.doc.cards);
  const dueList = () => cards().filter(([, c]) => c.due <= Date.now()).sort((a, b) => a[1].due - b[1].due);
  let revealed = false;

  function render() {
    const all = cards(), due = dueList();
    const cur = due[0];
    let review;
    if (!all.length) review = '<p class="muted">No cards yet. Open a verse in <a href="#/read">Read</a>, click it and choose “+ memorize”. Or add one here:</p>';
    else if (!cur) review = `<div class="flash"><div class="good">All caught up ✓</div><div class="muted">${all.length} card${all.length === 1 ? '' : 's'} · next review ${fmtDate(Math.min(...all.map(([, c]) => c.due)))}</div></div>`;
    else {
      const f = E.fromKey(cur[0]);
      review = f ? `<div class="flash"><div class="muted">${due.length} due · box ${cur[1].box + 1} of 6</div>
        <h2 style="margin:0">${esc(E.labelRange(f.idx, f.len))}</h2>
        ${revealed ? `<div class="vt">${esc(E.rangeText(f.idx, f.len))}</div><div class="row"><button id="miss">✗ missed it</button><button id="got" class="primary">✓ got it</button></div>`
          : `<p class="muted">Say it from memory, then check.</p><button id="show" class="primary">show the verse</button>`}</div>` : '';
    }
    root.innerHTML = `<h1>Memorize</h1><div class="card">${review}
      <form id="add" class="row noprint"><input type="text" id="aref" class="grow" placeholder="add a verse, e.g. Ps 23:1-3" aria-label="Reference to memorize"><button>add card</button></form><div id="amsg" class="warn"></div></div>
      ${all.length ? `<h2>All cards (${all.length})</h2><div class="card"><table>${all.sort((a, b) => a[1].added - b[1].added).map(([k, c]) => {
        const f = E.fromKey(k); return f ? `<tr><td><a href="${readHref(E.at(f.idx).id, E.at(f.idx).c, E.at(f.idx).v, f.len)}">${esc(E.labelRange(f.idx, f.len))}</a></td><td class="muted">box ${c.box + 1}/6</td><td class="muted">${c.due <= Date.now() ? 'due now' : 'due ' + fmtDate(c.due)}</td><td><button data-rm="${esc(k)}" aria-label="Remove card">×</button></td></tr>` : '';
      }).join('')}</table></div>` : ''}`;
    root.querySelector('#show')?.addEventListener('click', () => { revealed = true; render(); });
    const grade = ok => {
      store.change(d => { const c = d.cards[cur[0]]; c.box = ok ? Math.min(5, c.box + 1) : 0; c.due = Date.now() + (ok ? INTERVALS[c.box] : 10 * 60 * 1000); });
      revealed = false; render();
    };
    root.querySelector('#got')?.addEventListener('click', () => grade(true));
    root.querySelector('#miss')?.addEventListener('click', () => grade(false));
    root.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { store.change(d => { delete d.cards[b.dataset.rm]; }); render(); }));
    root.querySelector('#add').addEventListener('submit', e => {
      e.preventDefault();
      const t = root.querySelector('#aref').value.trim();
      const s = parseSpan(t.replace(/\s+(\d+)\s*$/, ' $1'), findBook);
      const msg = root.querySelector('#amsg');
      if (!s || !s.v) { msg.textContent = 'Use a book, chapter and verse, like John 3:16 or Ps 23:1-3.'; return; }
      const i = E.idx(s.book, s.c, s.v);
      if (i < 0) { msg.textContent = 'That verse does not exist.'; return; }
      const len = s.v2 && s.v2 > s.v ? Math.min(s.v2, E.verseCount(s.book, s.c)) - s.v : (s.c2 ? 0 : 0);
      store.change(d => { d.cards[E.key(i, len)] = { box: 0, due: Date.now(), added: Date.now() }; });
      render();
    });
  }
  render();
}

// ------------------------------------------------------------------ notes, bookmarks, highlights
export async function notesView(ctx, r, root) {
  const E = ctx.engine, store = ctx.store;
  const tab = r.parts[0] || 'bookmarks';
  const d = store.doc;
  const rows = (keys, build) => keys.map(k => { const f = E.fromKey(k); return f ? build(k, f) : ''; }).join('');
  const a = f => E.at(f.idx);
  const link = (k, f) => `<a href="${readHref(a(f).id, a(f).c, a(f).v, f.len)}"><b>${esc(E.labelRange(f.idx, f.len))}</b></a>`;
  let body;
  if (tab === 'notes') {
    const keys = Object.keys(d.notes).sort((x, y) => (E.fromKey(x)?.idx ?? 0) - (E.fromKey(y)?.idx ?? 0));
    body = keys.length ? rows(keys, (k, f) => `<div class="card">${link(k, f)} <button data-del-note="${esc(k)}" class="noprint" style="float:right">delete</button>
      <div class="vt muted">${esc(E.rangeText(f.idx, Math.min(f.len, 3)).slice(0, 220))}</div><div class="answer" style="margin-top:.4rem">${esc(d.notes[k].text)}</div></div>`) : '<p class="muted">No notes yet. Click a verse in Read and write one in the study panel.</p>';
  } else if (tab === 'highlights') {
    const keys = Object.keys(d.highlights).sort((x, y) => (E.fromKey(x)?.idx ?? 0) - (E.fromKey(y)?.idx ?? 0));
    body = keys.length ? `<div class="card">${rows(keys, (k, f) => `<div class="hit"><a class="ref" href="${readHref(a(f).id, a(f).c, a(f).v)}">${esc(E.label(f.idx))}</a><span class="vt hl-${d.highlights[k]}">${esc(E.text(f.idx))}</span></div>`)}</div>` : '<p class="muted">No highlights yet.</p>';
  } else {
    const keys = d.bookmarks.map(b => b.ref);
    body = keys.length ? `<div class="card">${rows(keys, (k, f) => `<div class="hit">${link(k, f)} <button data-del-bm="${esc(k)}" class="noprint" style="float:right" aria-label="Remove bookmark">×</button><div class="vt">${esc(E.rangeText(f.idx, Math.min(f.len, 4)))}</div></div>`)}</div>` : '<p class="muted">No bookmarks yet. Click a verse in Read and choose “bookmark”.</p>';
  }
  root.innerHTML = `<h1>Notes &amp; bookmarks</h1>
    <div class="row noprint" style="margin-bottom:1rem">${[['bookmarks', `Bookmarks (${d.bookmarks.length})`], ['notes', `Notes (${Object.keys(d.notes).length})`], ['highlights', `Highlights (${Object.keys(d.highlights).length})`]].map(([k, n]) => `<a class="chip${tab === k ? ' on' : ''}" href="${href('notes', [k])}">${n}</a>`).join('')}
      <span class="grow"></span><button id="exp">export everything (.md)</button></div>${body}`;
  root.querySelectorAll('[data-del-note]').forEach(b => b.onclick = () => { store.setNote(b.dataset.delNote, ''); notesView(ctx, r, root); });
  root.querySelectorAll('[data-del-bm]').forEach(b => b.onclick = () => { store.toggleBookmark(b.dataset.delBm); notesView(ctx, r, root); });
  root.querySelector('#exp').onclick = () => {
    const L = ['# My Bible study', '', `_Exported ${new Date().toISOString().slice(0, 10)} from Bible Terminal. Scripture is the King James Version._`, ''];
    if (d.bookmarks.length) { L.push('## Bookmarks', ''); for (const b of d.bookmarks) { const f = E.fromKey(b.ref); if (f) L.push(`- **${E.labelRange(f.idx, f.len)}** — ${E.rangeText(f.idx, f.len)}`); } L.push(''); }
    const nk = Object.keys(d.notes);
    if (nk.length) { L.push('## Notes', ''); for (const k of nk.sort((x, y) => (E.fromKey(x)?.idx ?? 0) - (E.fromKey(y)?.idx ?? 0))) { const f = E.fromKey(k); if (f) L.push(`### ${E.labelRange(f.idx, f.len)}`, '', `> ${E.rangeText(f.idx, f.len)}`, '', d.notes[k].text, ''); } }
    const hk = Object.keys(d.highlights);
    if (hk.length) { L.push('## Highlights', ''); for (const k of hk.sort((x, y) => (E.fromKey(x)?.idx ?? 0) - (E.fromKey(y)?.idx ?? 0))) { const f = E.fromKey(k); if (f) L.push(`- **${E.label(f.idx)}** (${d.highlights[k]}) — ${E.text(f.idx)}`); } L.push(''); }
    download('my-bible-study.md', L.join('\n'));
  };
}
