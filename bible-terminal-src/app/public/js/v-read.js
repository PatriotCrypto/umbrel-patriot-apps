import { BOOKS, BOOK_BY_ID } from './engine.js';
import { esc, toast, download } from './ui.js';
import { href, readHref } from './nav.js';

const COLORS = [['y', 'Yellow'], ['g', 'Green'], ['b', 'Blue'], ['p', 'Purple'], ['r', 'Red']];
const SWATCH = { y: '#d9c21c', g: '#2fb866', b: '#3a9be0', p: '#a066d6', r: '#e05252' };

export async function readView(ctx, r, root) {
  const { engine: E, store } = ctx;
  let id = r.parts[0] && BOOK_BY_ID[r.parts[0]] ? r.parts[0] : 'John';
  let c = Math.min(Math.max(parseInt(r.parts[1], 10) || 1, 1), E.chapterCount(id));
  const tr = r.q.get('tr') === 'web' && E.web ? 'web' : r.q.get('tr') === 'both' && E.web ? 'both' : 'kjv';
  let sel = null; // { i, len }
  const vq = r.q.get('v');
  if (vq) {
    const m = vq.match(/^(\d+)(?:-(\d+))?$/);
    if (m) { const i = E.idx(id, c, +m[1]); if (i >= 0) sel = { i, len: m[2] ? Math.max(0, Math.min(+m[2], E.verseCount(id, c)) - +m[1]) : 0 }; }
  }
  store.change(d => { d.prefs.lastRead = { b: id, c }; });

  const { start, count } = E.chapter(id, c);
  const book = BOOK_BY_ID[id];
  const prev = c > 1 ? [id, c - 1] : book.index > 0 ? [BOOKS[book.index - 1].id, E.chapterCount(BOOKS[book.index - 1].id)] : null;
  const next = c < E.chapterCount(id) ? [id, c + 1] : book.index < 65 ? [BOOKS[book.index + 1].id, 1] : null;
  const trHref = t => href('read', [id, c], { tr: t === 'kjv' ? '' : t });

  root.innerHTML = `
  <div class="rhead noprint">
    <select id="bsel" aria-label="Book" style="width:auto">${BOOKS.map(b => `<option value="${b.id}"${b.id === id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
    <select id="csel" aria-label="Chapter" style="width:auto">${Array.from({ length: E.chapterCount(id) }, (_, k) => `<option${k + 1 === c ? ' selected' : ''}>${k + 1}</option>`).join('')}</select>
    <a class="chip" data-nav="prev" ${prev ? `href="${readHref(prev[0], prev[1])}"` : 'hidden'}>◀ prev</a>
    <a class="chip" data-nav="next" ${next ? `href="${readHref(next[0], next[1])}"` : 'hidden'}>next ▶</a>
    <span class="grow"></span>
    ${E.web ? `<span>${['kjv', 'web', 'both'].map(t => `<a class="chip${t === tr ? ' on' : ''}" href="${trHref(t)}">${t === 'both' ? 'KJV | WEB' : t.toUpperCase()}</a>`).join('')}</span>` : ''}
    <button id="print" title="Print this chapter">print</button>
  </div>
  <div class="reader">
    <section>
      <h1 class="rhead" style="margin-bottom:.6rem">${esc(book.name)} ${c}</h1>
      <div id="chapter" class="chapter${tr === 'both' ? ' cols' : ''}"></div>
      <div class="pager noprint">
        ${prev ? `<a href="${readHref(prev[0], prev[1])}">◀ ${esc(BOOK_BY_ID[prev[0]].name)} ${prev[1]}</a>` : '<span></span>'}
        ${next ? `<a href="${readHref(next[0], next[1])}">${esc(BOOK_BY_ID[next[0]].name)} ${next[1]} ▶</a>` : ''}
      </div>
    </section>
    <aside class="card study noprint" id="study" aria-label="Study panel"></aside>
  </div>`;

  const chap = root.querySelector('#chapter');

  function verseHtml(i, t) {
    const a = E.at(i);
    const key = `${a.id}.${a.c}.${a.v}`;
    const hl = store.doc.highlights[key];
    const cls = ['v'];
    if (hl) cls.push('hl-' + hl);
    if (sel && i >= sel.i && i <= sel.i + sel.len) cls.push('sel');
    if (noteIdx.has(i)) cls.push('has-note');
    if (bmIdx.has(i)) cls.push('bm');
    return `<span class="${cls.join(' ')}" data-i="${i}"><span class="vn">${a.v}</span>${esc(E.text(i, t))}</span>`;
  }
  let noteIdx = new Set(), bmIdx = new Set();
  function indexMarks() {
    noteIdx = new Set(); bmIdx = new Set();
    const mark = (k, set) => { const f = E.fromKey(k); if (f) for (let j = 0; j <= f.len; j++) set.add(f.idx + j); };
    for (const k of Object.keys(store.doc.notes)) mark(k, noteIdx);
    for (const b of store.doc.bookmarks) mark(b.ref, bmIdx);
  }
  function renderChapter() {
    indexMarks();
    if (tr === 'both') {
      const col = t => `<div><h3>${t.toUpperCase()}</h3>${Array.from({ length: count }, (_, k) => verseHtml(start + k, t)).join('')}</div>`;
      chap.innerHTML = col('kjv') + col('web');
    } else chap.innerHTML = Array.from({ length: count }, (_, k) => verseHtml(start + k, tr)).join('');
  }

  function syncSheet() {
    root.querySelector('#study').classList.toggle('open', !!sel);
    document.body.classList.toggle('sheet-open', !!sel);
  }
  function renderStudy() {
    const box = root.querySelector('#study');
    syncSheet();
    if (!sel) {
      box.innerHTML = `<h2>Study</h2><p class="muted">Click a verse to bookmark it, highlight it, write a note, see cross-references, or add it to your memory cards. Shift-click another verse to select a range.</p>
        <p class="muted">Tip: press <code>/</code> to jump anywhere — try <code>Rom 8:28</code>, <code>faith hope</code>, <code>H7225</code> or <code>? what is grace</code>.</p>`;
      return;
    }
    const key = E.key(sel.i, sel.len);
    const label = E.labelRange(sel.i, sel.len);
    const note = store.doc.notes[key];
    const card = store.doc.cards[key];
    const hlNow = sel.len === 0 ? store.doc.highlights[key] : null;
    const xs = sel.len === 0 ? E.xrefs(sel.i) : [];
    const kjv = E.rangeText(sel.i, sel.len, 'kjv');
    box.innerHTML = `
      <button data-act="close" class="sheet-close" aria-label="Close study panel">×</button>
      <h2>${esc(label)}</h2>
      <div class="vt">${esc(kjv)}</div>
      ${E.web && tr !== 'both' ? `<details><summary>${tr === 'web' ? 'KJV' : 'WEB'}</summary><div class="vt muted">${esc(E.rangeText(sel.i, sel.len, tr === 'web' ? 'kjv' : 'web'))}</div></details>` : ''}
      <div class="row" style="margin:.6rem 0">
        <button data-act="bm">${store.isBookmarked(key) ? '★ bookmarked' : '☆ bookmark'}</button>
        <button data-act="copy">copy</button>
        <button data-act="card">${card ? '✓ in memory cards' : '+ memorize'}</button>
      </div>
      <div class="row swatches" aria-label="Highlight">
        ${COLORS.map(([k, n]) => `<button data-hl="${k}" title="${n}" aria-label="Highlight ${n}" style="background:${SWATCH[k]};${hlNow === k ? 'outline:2px solid var(--fg)' : ''}"></button>`).join('')}
        <button class="none" data-hl="" title="Remove highlight" aria-label="Remove highlight">×</button>
      </div>
      <h3>Note</h3>
      <textarea id="note" placeholder="Your note on ${esc(label)}">${esc(note ? note.text : '')}</textarea>
      ${sel.len === 0 && E.xref ? `<h3>Cross-references (${xs.length})</h3>${xs.length ? xs.map(x => `<a class="xr" href="${readHref(E.at(x.idx).id, E.at(x.idx).c, E.at(x.idx).v, x.len)}"><b>${esc(E.labelRange(x.idx, x.len))}</b><div class="vt">${esc(E.rangeText(x.idx, Math.min(x.len, 3)))}</div></a>`).join('') : '<p class="muted">None listed.</p>'}` : ''}
      <h3>Word study</h3>
      <form id="wf" class="row"><input type="text" id="wq" placeholder="an English word, e.g. love" aria-label="English word"><button>look up</button></form>`;
  }

  function select(i, extend) {
    if (extend && sel && E.bi[i] === E.bi[sel.i] && E.ci[i] === E.ci[sel.i]) {
      const a = Math.min(sel.i, i), b = Math.max(sel.i + sel.len, i);
      sel = { i: a, len: b - a };
    } else if (sel && sel.len === 0 && sel.i === i) sel = null;
    else sel = { i, len: 0 };
    const q = sel ? `?v=${E.vi[sel.i]}${sel.len ? '-' + (E.vi[sel.i] + sel.len) : ''}${tr !== 'kjv' ? '&tr=' + tr : ''}` : (tr !== 'kjv' ? '?tr=' + tr : '');
    history.replaceState(null, '', `#/read/${id}/${c}${q}`);
    renderChapter(); renderStudy();
  }

  renderChapter(); renderStudy();
  if (sel) requestAnimationFrame(() => chap.querySelector('.v.sel')?.scrollIntoView({ block: 'center' }));

  chap.addEventListener('click', e => {
    const v = e.target.closest('.v'); if (!v) return;
    if (window.getSelection().toString()) return; // let people copy text
    select(+v.dataset.i, e.shiftKey);
  });
  root.querySelector('#bsel').onchange = e => { location.hash = readHref(e.target.value, 1); };
  root.querySelector('#csel').onchange = e => { location.hash = readHref(id, +e.target.value); };
  root.querySelector('#print').onclick = () => window.print();
  root.querySelector('#study').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !sel) return;
    const key = E.key(sel.i, sel.len);
    const ta = root.querySelector('#note');
    if (ta && ta.value !== (store.doc.notes[key] ? store.doc.notes[key].text : '')) { clearTimeout(noteTimer); store.setNote(key, ta.value); }
    if (b.dataset.act === 'close') {
      sel = null;
      history.replaceState(null, '', `#/read/${id}/${c}${tr !== 'kjv' ? '?tr=' + tr : ''}`);
    } else if (b.dataset.act === 'bm') { store.toggleBookmark(key, E.labelRange(sel.i, sel.len)); }
    else if (b.dataset.act === 'copy') {
      const txt = `${E.rangeText(sel.i, sel.len, tr === 'web' ? 'web' : 'kjv')} — ${E.labelRange(sel.i, sel.len)} (${tr === 'web' ? 'WEB' : 'KJV'})`;
      navigator.clipboard?.writeText(txt).then(() => toast('Copied'), () => toast('Could not copy'));
      return;
    } else if (b.dataset.act === 'card') {
      store.change(d => { if (d.cards[key]) delete d.cards[key]; else d.cards[key] = { box: 0, due: Date.now(), added: Date.now() }; });
    } else if (b.dataset.hl !== undefined) {
      for (let j = 0; j <= sel.len; j++) { const a = E.at(sel.i + j); store.setHighlight(`${a.id}.${a.c}.${a.v}`, b.dataset.hl); }
    }
    renderChapter(); renderStudy();
  });
  let noteTimer;
  root.querySelector('#study').addEventListener('input', e => {
    if (e.target.id !== 'note' || !sel) return;
    const key = E.key(sel.i, sel.len), val = e.target.value;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { store.setNote(key, val); indexMarks(); }, 400);
  });
  root.querySelector('#study').addEventListener('submit', e => {
    if (e.target.id !== 'wf') return;
    e.preventDefault();
    const q = root.querySelector('#wq').value.trim();
    if (q) location.hash = href('words', [q]);
  });
  return () => {
    document.body.classList.remove('sheet-open');
    clearTimeout(noteTimer);
    const ta = root.querySelector('#note');
    if (ta && sel) { const key = E.key(sel.i, sel.len); if (ta.value !== (store.doc.notes[key] ? store.doc.notes[key].text : '')) store.setNote(key, ta.value); }
    store.flush();
  };
}
