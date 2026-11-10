/* The word tools panel: rhymes, families, meanings, phrases, sounds,
   figures of speech and Bible search. Used beside the lyric sheet and on
   its own page. */
import { h, api, copyText, toast, fail, promptBox } from './util.js';
import { ghost } from './egg.js';

const TABS = [
  ['rhymes', 'Rhymes'], ['family', 'Family'], ['meaning', 'Meaning'], ['phrases', 'Phrases'],
  ['sounds', 'Sounds'], ['figures', 'Figures'], ['bible', 'Bible'],
];
const RHYME_TYPES = [
  ['perfect', 'Perfect'], ['close', 'Close'], ['wide', 'Wide'], ['multi2', 'Last 2'], ['multi3', 'Last 3'], ['multi4', 'Last 4'], ['phrases', 'Phrases'],
];
const FIGURE_LABEL = { similes: 'Similes', oxymorons: 'Oxymorons', onomatopoeia: 'Onomatopoeia', intensifiers: 'Intensifiers', idioms: 'Idioms and sayings' };

let pop = null;
function closePop() { if (pop) { pop.remove(); pop = null; } }
document.addEventListener('click', (e) => { if (pop && !pop.contains(e.target)) closePop(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

/* ctx: { insert?(text), collect?(text), app } where app holds the collections. */
export function wordPanel(ctx) {
  const st = { q: '', tab: 'rhymes', type: 'perfect', syl: '', rare: false, seq: 0 };
  try { Object.assign(st, JSON.parse(sessionStorage.getItem('sn.wt') || '{}'), { q: '', seq: 0 }); } catch (e) { /* ignore */ }

  const input = h('input', { class: 'input', type: 'search', placeholder: 'A word or a short phrase', 'aria-label': 'Word to look up', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  const tabs = h('div', { class: 'wt-tabs', role: 'tablist' });
  const filters = h('div', { class: 'wt-filters' });
  const body = h('div', { class: 'wt-body', 'aria-live': 'polite' });
  const form = h('form', { class: 'wt-head', onsubmit: (e) => { e.preventDefault(); lookup(input.value); input.blur(); } },
    input, h('button', { class: 'btn primary', type: 'submit' }, 'Look up'));
  const el = h('div', { class: 'wt' }, form, tabs, filters, body);

  function remember() {
    try { sessionStorage.setItem('sn.wt', JSON.stringify({ tab: st.tab, type: st.type, rare: st.rare })); } catch (e) { /* ignore */ }
  }

  function drawTabs() {
    tabs.replaceChildren(...TABS.map(([id, label]) => h('button', {
      class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(st.tab === id),
      onclick: () => { st.tab = id; remember(); drawTabs(); run(); },
    }, label)));
  }

  function drawFilters() {
    const kids = [];
    const sylSelect = () => h('select', { class: 'input', 'aria-label': 'Syllables', onchange: (e) => { st.syl = e.target.value; run(); } },
      [['', 'Any length'], ['1', '1 syllable'], ['2', '2 syllables'], ['3', '3 syllables'], ['4', '4 syllables'], ['5', '5 syllables']]
        .map(([v, l]) => h('option', { value: v, selected: st.syl === v }, l)));
    const rareChip = () => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(st.rare), title: 'Include names and uncommon words', onclick: () => { st.rare = !st.rare; remember(); drawFilters(); run(); } }, 'Names and rare words');
    if (st.tab === 'rhymes') {
      kids.push(...RHYME_TYPES.map(([id, label]) => h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(st.type === id),
        onclick: () => { st.type = id; remember(); drawFilters(); run(); },
      }, label)), sylSelect());
      if (st.type !== 'phrases') kids.push(rareChip());
    } else if (st.tab === 'sounds') kids.push(sylSelect(), rareChip());
    filters.replaceChildren(...kids);
    filters.classList.toggle('hide', !kids.length);
  }

  function note(text) { body.replaceChildren(h('p', { class: 'wt-note' }, text)); }

  function chip(text, cls) {
    return h('button', { class: 'wchip ' + (cls || ''), type: 'button', onclick: (e) => menu(e.currentTarget, text) }, text);
  }

  function menu(anchor, text) {
    closePop();
    const single = !/\s/.test(text.trim()) && text.length < 40;
    const act = (label, fn) => h('button', { type: 'button', onclick: () => { closePop(); fn(); } }, label);
    const items = [h('b', null, text.length > 60 ? text.slice(0, 57) + '...' : text)];
    if (ctx.insert) items.push(act('Put it in the lyrics', () => ctx.insert(text)));
    if (ctx.collect) items.push(act('Collect for this song', () => ctx.collect(text)));
    items.push(act('Copy', () => copyText(text)));
    if (single) {
      items.push(h('hr'));
      items.push(act('Rhymes for it', () => { st.tab = 'rhymes'; lookup(text); }));
      items.push(act('Its word family', () => { st.tab = 'family'; lookup(text); }));
      items.push(act('What it means', () => { st.tab = 'meaning'; lookup(text); }));
    }
    items.push(h('hr'));
    for (const c of ctx.app.state.collections.slice(0, 6)) {
      items.push(act('Add to ' + c.name, () => ctx.app.addToCollection(c.id, text)));
    }
    items.push(act('Add to a new collection', async () => {
      const name = await promptBox('New collection', 'Name', '', 'Create');
      if (name) ctx.app.newCollection(name, text);
    }));
    pop = h('div', { class: 'pop', role: 'menu' }, items);
    document.body.append(pop);
    const r = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, innerWidth - pr.width - 8));
    let top = r.bottom + 6;
    if (top + pr.height > innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function groupBySyllables(items, cls) {
    const out = [];
    const groups = new Map();
    for (const it of items) { if (!groups.has(it.s)) groups.set(it.s, []); groups.get(it.s).push(it); }
    for (const s of [...groups.keys()].sort((a, b) => a - b)) {
      out.push(h('div', { class: 'wt-group' }, s === 1 ? '1 syllable' : s + ' syllables'));
      out.push(h('div', { class: 'wt-words' }, groups.get(s).map((it) => chip(it.w, (cls || '') + (it.t > 50 ? ' rare' : '')))));
    }
    return out;
  }

  async function run() {
    drawFilters();
    const q = st.q.trim();
    const seq = ++st.seq;
    if (!q && st.tab !== 'figures') {
      return note(ctx.insert ? 'Type a word above, or double-click a word in your lyrics.' : 'Type a word above to see what you can do with it.');
    }
    body.replaceChildren(h('p', { class: 'wt-note' }, 'Looking...'));
    const params = new URLSearchParams({ q });
    if (st.syl) params.set('syl', st.syl);
    if (st.rare) params.set('rare', '1');
    if (st.tab === 'rhymes') params.set('type', st.type);
    let r;
    try { r = await api(`/api/w/${st.tab}?${params}`); }
    catch (e) { if (seq === st.seq) note(e.message); return; }
    if (seq !== st.seq) return;
    const kids = [];
    const more = (total, shown) => { if (total > shown) kids.push(h('p', { class: 'wt-note' }, `Showing ${shown} of ${total}. Narrow it with the syllable filter.`)); };

    if (st.tab === 'rhymes' || st.tab === 'sounds') {
      if (r.known === false) return note(`"${q}" is not in the pronouncing dictionary. Try a word that sounds like it.`);
      if (!r.items.length) {
        return note(st.tab === 'rhymes'
          ? 'Nothing here. Try Close or Wide, or switch on names and rare words.'
          : 'No common words open with that sound. Switch on names and rare words to see more.');
      }
      kids.push(...groupBySyllables(r.items, st.type === 'phrases' && st.tab === 'rhymes' ? 'phrase' : ''));
      more(r.total, r.items.length);
    } else if (st.tab === 'family') {
      if (!r.words.length && !r.phrases.length) return note(`No word family for "${q}". Try the base form of the word, or the Meaning tab.`);
      if (r.root !== q.toLowerCase()) kids.push(h('p', { class: 'wt-note' }, `Showing the family of "${r.root}".`));
      const common = r.words.filter((w) => w.t <= 40), rest = r.words.filter((w) => w.t > 40);
      if (common.length) { kids.push(h('div', { class: 'wt-group' }, 'Everyday words'), h('div', { class: 'wt-words' }, common.map((w) => chip(w.w)))); }
      if (rest.length) { kids.push(h('div', { class: 'wt-group' }, 'Further out'), h('div', { class: 'wt-words' }, rest.map((w) => chip(w.w, w.t > 60 ? 'rare' : '')))); }
      if (r.phrases.length) { kids.push(h('div', { class: 'wt-group' }, 'Phrases'), h('div', { class: 'wt-words' }, r.phrases.map((w) => chip(w, 'phrase')))); }
    } else if (st.tab === 'meaning') {
      if (!r.senses.length) return note(`No entry for "${q}".`);
      for (const s of r.senses) {
        const lists = [];
        if (s.syns.length) lists.push(h('div', { class: 'lab' }, 'Same meaning'), h('div', { class: 'wt-words' }, s.syns.map((w) => chip(w))));
        if (s.ants.length) lists.push(h('div', { class: 'lab' }, 'Opposite'), h('div', { class: 'wt-words' }, s.ants.map((w) => chip(w))));
        if (s.rel.length) lists.push(h('div', { class: 'lab' }, 'Related'), h('div', { class: 'wt-words' }, s.rel.map((w) => chip(w))));
        kids.push(h('div', { class: 'sense' }, h('div', { class: 'pos' }, s.pos), h('div', { class: 'def' }, s.def), s.ex ? h('div', { class: 'ex' }, s.ex) : null, lists));
      }
    } else if (st.tab === 'phrases') {
      if (!r.items.length) return note(`No phrases with "${q}".`);
      kids.push(h('div', { class: 'wt-words' }, r.items.map((p) => chip(p, 'phrase'))));
      more(r.total, r.items.length);
    } else if (st.tab === 'figures') {
      let any = false;
      for (const k of Object.keys(FIGURE_LABEL)) {
        if (!r[k] || !r[k].length) continue;
        any = true;
        kids.push(h('div', { class: 'wt-group' }, FIGURE_LABEL[k]), h('div', { class: 'wt-words' }, r[k].map((p) => chip(p, 'phrase'))));
      }
      if (!any) return note(`No figures of speech with "${q}". Clear the box to browse them all.`);
    } else if (st.tab === 'bible') {
      if (!r.items.length) return note(`No verse in the King James Bible has "${q}". Put a phrase in quotes to match it exactly.`);
      kids.push(h('p', { class: 'wt-note' }, r.total === 1 ? '1 verse' : `${r.total} verses` + (r.total > r.items.length ? `, showing the first ${r.items.length}` : '')));
      for (const v of r.items) {
        kids.push(h('div', { class: 'verse', role: 'button', tabindex: '0', onclick: (e) => menu(e.currentTarget, `${v.text} (${v.ref})`) }, h('b', null, v.ref), v.text));
      }
    }
    body.replaceChildren(...kids);
    body.scrollTop = 0;
  }

  function lookup(q, tab) {
    const text = String(q || '').trim().slice(0, 120);
    if (text.toLowerCase() === '/ghost') { input.value = ''; return ghost(); }
    st.q = text;
    if (tab) st.tab = tab;
    input.value = text;
    drawTabs();
    remember();
    run();
  }

  drawTabs();
  run();
  return { el, lookup, focus: () => input.focus(), get query() { return st.q; } };
}

export { toast, fail };
