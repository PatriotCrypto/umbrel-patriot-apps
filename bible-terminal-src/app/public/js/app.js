import { loadEngine, BOOKS, BOOK_BY_ID, parseRef, findBook } from './engine.js';
import { Store } from './store.js';
import { esc, toast } from './ui.js';
import { manna, cw, watchKonami } from './egg.js';
import { parseHash, href, readHref } from './nav.js';
import { readView } from './v-read.js';
import { searchView, wordsView } from './v-search.js';
import { timelineView, plansView, memorizeView, notesView } from './v-study.js';
import { askView, verifyView, hotspotView, settingsView, aboutView } from './v-system.js';

const cfg = window.BT || { static: false };
const $ = id => document.getElementById(id);
const SKINS = ['phosphor', 'amber', 'scriptorium', 'blueprint'];
const SKIN_ALIAS = { paper: 'scriptorium', ice: 'blueprint' };

const ctx = { cfg, engine: null, store: null, toast, skins: SKINS };

const SECTIONS = [
  ['read', 'Read', readView], ['search', 'Search', searchView], ['words', 'Words', wordsView],
  ['timeline', 'Timeline', timelineView], ['plans', 'Plans', plansView], ['memorize', 'Memorize', memorizeView],
  ['notes', 'Notes', notesView], ['ask', 'Ask', askView, true], ['verify', 'Verify', verifyView, true],
  ['hotspot', 'Hotspot', hotspotView, true], ['settings', 'Settings', settingsView, true], ['about', 'About', aboutView],
].filter(s => !(s[3] && cfg.static));

export function applyPrefs() {
  let skin = ctx.store.pref('skin', 'phosphor');
  skin = SKIN_ALIAS[skin] || skin;
  document.documentElement.dataset.skin = SKINS.includes(skin) ? skin : 'phosphor';
  document.documentElement.style.setProperty('--size', String(ctx.store.pref('size', 1)));
}

let cleanup = null;
function renderNav(active) {
  $('nav').innerHTML = SECTIONS.map(([id, label]) =>
    `<a href="#/${id}"${id === active ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('');
}

async function route() {
  if (!ctx.engine) return;
  const r = parseHash();
  let sec = SECTIONS.find(s => s[0] === r.name);
  if (!sec) {
    // first visit: continue where you left off
    const last = ctx.store.pref('lastRead', null);
    const target = last && BOOK_BY_ID[last.b] ? readHref(last.b, last.c) : readHref('John', 3);
    history.replaceState(null, '', target); return route();
  }
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  renderNav(sec[0]);
  const main = $('view');
  main.innerHTML = '';
  document.title = sec[1] + ' · Bible Terminal';
  try { cleanup = (await sec[2](ctx, r, main)) || null; }
  catch (e) { console.error(e); main.innerHTML = `<div class="card bad">Something went wrong showing this page: ${esc(e.message)}</div>`; }
  if (!r.q.get('v')) window.scrollTo(0, 0);
}

/** What the command bar does with what you typed. */
export function runCommand(text) {
  const t = text.trim();
  if (!t) return;
  if (/^\/manna$/i.test(t)) { manna(); return; }
  if (/^\/cw$/i.test(t)) { cw(); return; }
  if (t[0] === '?') { if (cfg.static) { location.hash = href('search', [t.slice(1).trim()]); } else location.hash = href('ask', [], { q: t.slice(1).trim() }); return; }
  if (/^[hg]\s*0*\d{1,4}$/i.test(t)) { location.hash = href('words', [t.replace(/\s+/g, '').toUpperCase()]); return; }
  if (/^\/(?:s|search)\s+/i.test(t)) { location.hash = href('search', [t.replace(/^\/\w+\s+/, '')]); return; }
  if (/^\/(?:w|word)\s+/i.test(t)) { location.hash = href('words', [t.replace(/^\/\w+\s+/, '')]); return; }
  const r = parseRef(t);
  // a bare short word like "is" or "am" is a search; a reference needs a chapter or a full book name
  const bookText = t.replace(/[\d:.\-–\s]+$/, '');
  const fullName = r && BOOK_BY_ID[r.book].name.toLowerCase().replace(/\W/g, '') === bookText.toLowerCase().replace(/\W/g, '');
  if (r && (r.chapter || fullName) && !/["*]/.test(t)) {
    const max = ctx.engine.chapterCount(r.book);
    const c = Math.min(r.chapter || 1, max);
    location.hash = readHref(r.book, c, r.verse, r.verseEnd && r.verse ? r.verseEnd - r.verse : 0);
    return;
  }
  location.hash = href('search', [t]);
}

function keys(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  if (e.key === 'Escape' && typing) { e.target.blur(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/' || e.key === ':') { e.preventDefault(); $('cmdin').focus(); $('cmdin').select(); }
  else if (e.key === 'ArrowLeft') document.querySelector('[data-nav=prev]')?.click();
  else if (e.key === 'ArrowRight') document.querySelector('[data-nav=next]')?.click();
}

function renderSaveState() {
  const s = ctx.store.status;
  const el = $('savestate');
  el.textContent = cfg.static ? 'saved on this device' : s === 'saving' ? 'saving…' : s === 'error' ? '⚠ not saved' : '';
  el.className = s === 'error' ? 'warn' : 'muted';
}

async function boot() {
  $('foot').textContent = 'Bible Terminal · King James Bible read from Bitcoin · no accounts, no tracking';
  const main = $('view');
  ctx.store = new Store(cfg.static);
  await ctx.store.init();
  applyPrefs();
  ctx.store.on(k => { if (k === 'status') renderSaveState(); });
  renderSaveState();
  main.innerHTML = '<p class="muted pad" id="loadmsg">Loading the Bible…</p>';
  try {
    ctx.engine = await loadEngine(cfg, (d, n) => { const m = $('loadmsg'); if (m) m.textContent = `Loading the Bible… ${d}/${n}`; });
  } catch (e) {
    main.innerHTML = `<div class="card bad">Could not load the Bible data: ${esc(e.message)}</div>`; return;
  }
  $('cmd').addEventListener('submit', e => { e.preventDefault(); runCommand($('cmdin').value); $('cmdin').value = ''; $('cmdin').blur(); });
  document.addEventListener('keydown', keys);
  watchKonami(manna);
  $('look').addEventListener('click', () => {
    const cur = document.documentElement.dataset.skin;
    const next = SKINS[(SKINS.indexOf(cur) + 1) % SKINS.length];
    ctx.store.setPref('skin', next); applyPrefs(); toast('Look: ' + next);
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', () => { ctx.store.flush(); });
  await route();
}
boot();
export { ctx, BOOKS, findBook };
