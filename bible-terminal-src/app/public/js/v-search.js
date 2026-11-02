import { BOOKS, BOOK_BY_ID } from './engine.js';
import { esc, markHtml, download } from './ui.js';
import { href, readHref } from './nav.js';

const PAGE = 40;

export async function searchView(ctx, r, root) {
  const E = ctx.engine, store = ctx.store;
  const q = (r.parts[0] || '').trim();
  const tr = r.q.get('tr') === 'web' && E.web ? 'web' : 'kjv';
  const exact = r.q.has('x') ? r.q.get('x') === '1' : store.pref('exact', false);
  const scopeQ = r.q.get('s') || '';
  const page = Math.max(1, parseInt(r.q.get('p'), 10) || 1);
  const scope = scopeQ === 'OT' || scopeQ === 'NT' ? { type: 't', value: scopeQ } : BOOK_BY_ID[scopeQ] ? { type: 'b', value: scopeQ } : null;
  const link = (over = {}) => {
    const o = { tr: tr === 'web' ? 'web' : '', x: exact ? 1 : 0, s: scopeQ, p: page, ...over };
    return href('search', q ? [q] : [], { tr: o.tr, x: r.q.has('x') || o.x ? o.x : '', s: o.s, p: o.p > 1 ? o.p : '' });
  };

  root.innerHTML = `<h1>Search</h1>
    <form id="sf" class="card row"><input type="text" id="sq" class="grow" value="${esc(q)}" placeholder='faith hope · "in the beginning" · lov* · grace -works · in:john love' aria-label="Search words">
      <label class="inline"><input type="checkbox" id="sx"${exact ? ' checked' : ''}> exact words</label>
      ${E.web ? `<select id="st" style="width:auto"><option value="kjv">KJV</option><option value="web"${tr === 'web' ? ' selected' : ''}>WEB</option></select>` : ''}
      <select id="ss" style="width:auto"><option value="">Whole Bible</option><option value="OT"${scopeQ === 'OT' ? ' selected' : ''}>Old Testament</option><option value="NT"${scopeQ === 'NT' ? ' selected' : ''}>New Testament</option></select>
      <button class="primary">search</button></form>
    <div id="out"></div>`;
  const go = () => {
    const nq = root.querySelector('#sq').value.trim();
    const x = root.querySelector('#sx').checked;
    store.setPref('exact', x);
    const t = root.querySelector('#st')?.value === 'web' ? 'web' : '';
    location.hash = href('search', nq ? [nq] : [], { tr: t, x: x ? 1 : 0, s: root.querySelector('#ss').value });
  };
  root.querySelector('#sf').addEventListener('submit', e => { e.preventDefault(); go(); });
  const out = root.querySelector('#out');
  if (!q) {
    out.innerHTML = `<div class="card help"><h2>Ways to search</h2><table>
      <tr><td>love faith</td><td>verses containing both words (any ending: love, loved, loveth)</td></tr>
      <tr><td>"in the beginning"</td><td>an exact phrase</td></tr>
      <tr><td>lov*</td><td>any word that starts with “lov”</td></tr>
      <tr><td>grace -works</td><td>grace, but not works</td></tr>
      <tr><td>in:john love</td><td>only in one book (also <code>in:nt</code>, <code>in:ot</code>)</td></tr>
      <tr><td>exact words</td><td>tick the box to match the word exactly, no endings</td></tr></table></div>`;
    return;
  }
  const t0 = performance.now();
  const res = E.search(q, { tr, exact, scope });
  const ms = Math.round(performance.now() - t0);
  if (res.empty) { out.innerHTML = '<p class="muted">Type at least one word.</p>'; return; }
  const totalAll = res.byBook.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...res.byBook);
  const pages = Math.max(1, Math.ceil(res.total / PAGE));
  const p = Math.min(page, pages);
  const slice = res.hits.slice((p - 1) * PAGE, p * PAGE);

  out.innerHTML = `
    <p><b class="good">${res.total.toLocaleString()}</b> verse${res.total === 1 ? '' : 's'} ${scope ? 'in ' + esc(scope.type === 'b' ? BOOK_BY_ID[scope.value].name : scope.value === 'OT' ? 'the Old Testament' : 'the New Testament') : 'in the Bible'}
      ${scope ? `<span class="muted">(${totalAll.toLocaleString()} in the whole Bible)</span>` : ''} <span class="muted">· ${ms} ms · ${tr.toUpperCase()}</span></p>
    ${totalAll ? `<div class="dist" aria-label="Where the matches are, book by book">${BOOKS.map(b => `<button data-b="${b.id}" class="${b.testament === 'NT' ? 'nt ' : ''}${scopeQ === b.id ? 'on' : ''}" title="${esc(b.name)}: ${res.byBook[b.index]}" aria-label="${esc(b.name)}: ${res.byBook[b.index]} matches"><i style="height:${res.byBook[b.index] ? Math.max(3, Math.round(res.byBook[b.index] / max * 42)) : 0}px"></i></button>`).join('')}</div>
    <div class="row noprint" style="margin-bottom:.6rem">${scope ? `<a class="chip" href="${link({ s: '', p: 1 })}">show whole Bible</a>` : '<span class="muted">Click a bar to search just that book.</span>'}<span class="grow"></span><button id="exp">export results (.md)</button></div>` : ''}
    <div id="hits">${slice.map(i => {
      const a = E.at(i);
      return `<div class="hit"><a class="ref" href="${readHref(a.id, a.c, a.v)}">${esc(E.label(i))}</a><span class="vt">${markHtml(E.text(i, tr), res.highlight)}</span></div>`;
    }).join('') || '<p class="muted">No verses found. Try fewer words, or untick “exact words”.</p>'}</div>
    ${pages > 1 ? `<div class="pager noprint">${p > 1 ? `<a href="${link({ p: p - 1 })}">◀ previous</a>` : '<span></span>'}<span class="muted">page ${p} of ${pages}</span>${p < pages ? `<a href="${link({ p: p + 1 })}">next ▶</a>` : '<span></span>'}</div>` : ''}`;
  out.querySelector('.dist')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    location.hash = link({ s: scopeQ === b.dataset.b ? '' : b.dataset.b, p: 1 });
  });
  out.querySelector('#exp')?.addEventListener('click', () => {
    const lines = [`# Search: ${q}`, '', `${res.total} verses (${tr.toUpperCase()})`, ''];
    for (const i of res.hits) lines.push(`- **${E.label(i)}** — ${E.text(i, tr)}`);
    download(`search-${q.replace(/\W+/g, '-').slice(0, 30)}.md`, lines.join('\n') + '\n');
  });
}

export async function wordsView(ctx, r, root) {
  const E = ctx.engine;
  const q = (r.parts[0] || '').trim();
  const lang = r.q.get('l') === 'H' || r.q.get('l') === 'G' ? r.q.get('l') : '';
  if (!E.strongsData) {
    root.innerHTML = '<h1>Words</h1><p class="muted">Strong’s dictionaries were not included on this device.</p>'; return;
  }
  root.innerHTML = `<h1>Words</h1>
    <form id="wf" class="card row"><input type="text" id="wq" class="grow" value="${esc(q)}" placeholder="H7225 · G26 · agape · beginning · mercy" aria-label="Find a Hebrew or Greek word">
    <span>${[['', 'both'], ['H', 'Hebrew'], ['G', 'Greek']].map(([k, n]) => `<a class="chip${lang === k ? ' on' : ''}" href="${href('words', q ? [q] : [], { l: k })}">${n}</a>`).join('')}</span>
    <button class="primary">find</button></form><div id="out"></div>`;
  root.querySelector('#wf').addEventListener('submit', e => { e.preventDefault(); const v = root.querySelector('#wq').value.trim(); location.hash = href('words', v ? [v] : [], { l: lang }); });
  const out = root.querySelector('#out');
  if (!q) { out.innerHTML = '<div class="card muted">Look up any Strong’s number (like <a href="#/words/G26">G26</a> or <a href="#/words/H7225">H7225</a>), or search by English meaning or by the original word spelled in English letters. Strong’s entries are the original Hebrew and Greek words behind the King James text.</div>'; return; }
  const linkCodes = s => esc(s).replace(/\b([HG])0*(\d{1,4})\b/g, (m, l, n) => `<a href="#/words/${l}${n}">${l}${n}</a>`);
  let list = E.strongsSearch(q, 80);
  if (lang) list = list.filter(e => e.code[0] === lang);
  if (!list.length) { out.innerHTML = '<p class="muted">Nothing found. Try a simpler English word.</p>'; return; }
  if (list.length === 1 || (/^[HG]\d+$/i.test(q) && list[0])) {
    const e = list[0];
    const first = (e.kjv.match(/[A-Za-z][A-Za-z' -]+/) || [''])[0].trim().split(/[,(]/)[0].trim();
    out.innerHTML = `<div class="card strong">
      <div class="row"><h2>${esc(e.code)}</h2><span class="muted">${e.code[0] === 'H' ? 'Hebrew' : 'Greek'}</span></div>
      <div class="${e.code[0] === 'H' ? 'heb' : 'scripture'}" style="font-size:1.8em">${esc(e.lemma)}</div>
      <p><b>${esc(e.translit)}</b> ${e.pron ? `<span class="muted">(${esc(e.pron)})</span>` : ""}</p>
      <table><tr><th>Meaning</th><td class="vt">${linkCodes(e.def)}</td></tr>
      <tr><th>Origin</th><td>${linkCodes(e.derivation)}</td></tr>
      <tr><th>Translated in the KJV as</th><td class="vt">${linkCodes(e.kjv)}</td></tr></table>
      ${first ? `<p class="noprint"><a href="${href('search', [first], { x: 0 })}">Search the Bible for “${esc(first)}”</a></p>` : ''}
    </div>`;
    return;
  }
  out.innerHTML = `<p class="muted">${list.length} entries</p><div class="card"><table>${list.map(e => `<tr><td><a href="#/words/${e.code}">${e.code}</a></td><td class="${e.code[0] === 'H' ? 'heb' : 'scripture'}" style="font-size:1.2em;direction:ltr">${esc(e.lemma)}</td><td>${esc(e.translit)}</td><td class="vt">${esc(e.def.slice(0, 90))}</td></tr>`).join('')}</table></div>`;
}
