/* Studio Notebook: shell, routing and the smaller screens. */
import { h, api, toast, fail, confirmBox, promptBox, copyText, STATUS_LABEL, day, ago, daysUntil, icon, coverEl, debounce } from './util.js';
import { songView } from './song.js';
import { wordPanel } from './wordtools.js';
import './egg.js';

const LOOKS = [['studio', 'Studio', 'Black, white and one red line'], ['analog', 'Analog', 'Warm tape-machine amber'], ['legalpad', 'Legal Pad', 'Yellow ruled paper'], ['midnight', 'Midnight', 'Deep blue and brass']];
const KINDS = [['line', 'Line'], ['hook', 'Hook'], ['title', 'Title'], ['concept', 'Concept']];
const NAV = [['desk', '#/', 'Desk'], ['songs', '#/songs', 'Songs'], ['ideas', '#/ideas', 'Ideas'], ['words', '#/words', 'Words'], ['collections', '#/collections', 'Collected'], ['settings', '#/settings', 'Settings']];

const app = {
  state: { songs: [], ideas: [], collections: [], settings: { charLimit: 3000, checklist: [], artist: '' }, statuses: [], version: '' },
  async reload() { this.state = await api('/api/state'); },
  patchSong(summary) {
    const i = this.state.songs.findIndex((s) => s.id === summary.id);
    if (i > -1) this.state.songs[i] = summary;
  },
  async addToCollection(cid, text) {
    try {
      const c = await api('/api/collections/' + cid, { method: 'PUT', body: { add: text } });
      const i = this.state.collections.findIndex((x) => x.id === cid);
      if (i > -1) this.state.collections[i] = c;
      toast('Added to ' + c.name);
    } catch (e) { fail(e); }
  },
  async newCollection(name, text) {
    try {
      const c = await api('/api/collections', { method: 'POST', body: { name } });
      this.state.collections.push(c);
      if (text) await this.addToCollection(c.id, text);
      return c;
    } catch (e) { fail(e); return null; }
  },
};

const root = document.getElementById('app');
const main = h('main', { class: 'main', id: 'main' });
const rail = h('nav', { class: 'rail', 'aria-label': 'Sections' });
let current = null;

function drawRail(active) {
  rail.replaceChildren(
    h('a', { class: 'brand', href: '#/' }, 'Studio', h('br'), 'Notebook', h('i')),
    ...NAV.map(([key, href, label]) => h('a', { class: 'nav', href, 'aria-current': active === key ? 'page' : null }, icon(key), label)),
    h('div', { class: 'foot' }, app.state.version ? 'Version ' + app.state.version : ''));
}

async function newSong(seed = {}) {
  try {
    const s = await api('/api/songs', { method: 'POST', body: seed });
    await app.reload();
    location.hash = `#/song/${s.id}`;
    return s;
  } catch (e) { fail(e); return null; }
}

/* ------------------------------------------------------------------ desk */
function captureBox(onSaved) {
  let kind = 'line';
  const ta = h('textarea', { class: 'input', placeholder: 'Catch a line, a hook or a title before it gets away', 'aria-label': 'New idea', rows: 2 });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Kind of idea' });
  const drawSeg = () => seg.replaceChildren(...KINDS.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(kind === k), onclick: () => { kind = k; drawSeg(); } }, label)));
  drawSeg();
  const saveIdea = async () => {
    if (!ta.value.trim()) return ta.focus();
    try {
      const idea = await api('/api/ideas', { method: 'POST', body: { text: ta.value, kind } });
      app.state.ideas.unshift(idea);
      ta.value = '';
      toast('Idea saved');
      if (onSaved) onSaved();
    } catch (e) { fail(e); }
  };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveIdea(); });
  return h('div', { class: 'capture' }, ta, h('div', { class: 'row' }, seg, h('span', { class: 'grow' }), h('button', { class: 'btn primary', type: 'button', onclick: saveIdea }, 'Save idea')));
}

function deskView() {
  const { songs, ideas } = app.state;
  const el = h('div', { class: 'page narrow' });
  el.append(h('div', { class: 'pagehead' }, h('div', { class: 'grow' }, h('h1', null, 'Desk')), h('button', { class: 'btn primary', type: 'button', onclick: () => newSong() }, 'New song')));
  const ideaCount = h('b');
  const drawCount = () => { ideaCount.textContent = String(app.state.ideas.length); };
  el.append(captureBox(drawCount));

  if (!songs.length) {
    el.append(h('div', { class: 'sect' }, h('div', { class: 'empty' },
      h('h2', null, 'Your notebook is empty'),
      h('p', null, 'Start a song, or bring in lyrics you have already written. Everything you write stays on your Umbrel.'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => newSong() }, 'Start a song'), h('a', { class: 'btn', href: '#/settings' }, 'Import lyrics')))));
    return { el };
  }

  const active = songs.filter((s) => !['released', 'shelved'].includes(s.status)).sort((a, b) => (a.updated < b.updated ? 1 : -1)).slice(0, 4);
  if (active.length) {
    el.append(h('section', { class: 'sect' }, h('h2', null, 'Keep writing'), h('div', { class: 'list' }, active.map((s) =>
      h('a', { class: 'item', href: `#/song/${s.id}` }, coverEl(s),
        h('div', { class: 'grow' }, h('div', { class: 't' }, s.title), h('div', { class: 's' }, s.first || 'Nothing written yet')),
        h('div', { class: 'small mute' }, ago(s.updated)))))));
  }
  const coming = songs.filter((s) => s.releaseDate && daysUntil(s.releaseDate) >= 0 && s.status !== 'released').sort((a, b) => (a.releaseDate < b.releaseDate ? -1 : 1)).slice(0, 6);
  if (coming.length) {
    el.append(h('section', { class: 'sect' }, h('h2', null, 'Coming up'), h('div', { class: 'list' }, coming.map((s) => {
      const d = daysUntil(s.releaseDate);
      return h('a', { class: 'item', href: `#/song/${s.id}/release` }, coverEl(s),
        h('div', { class: 'grow' }, h('div', { class: 't' }, s.title), h('div', { class: 's' }, `${day(s.releaseDate)}, checklist ${s.checklistDone} of ${s.checklistTotal}`)),
        h('div', { class: 'days' }, d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `${d} days`));
    }))));
  }
  drawCount();
  el.append(h('section', { class: 'sect' }, h('div', { class: 'stats' },
    h('div', { class: 'stat' }, h('b', null, songs.filter((s) => !['released', 'shelved'].includes(s.status)).length), h('span', null, 'in progress')),
    h('div', { class: 'stat' }, h('b', null, songs.filter((s) => s.status === 'released').length), h('span', null, 'released')),
    h('div', { class: 'stat' }, h('b', null, songs.reduce((n, s) => n + s.words, 0).toLocaleString()), h('span', null, 'words written')),
    h('div', { class: 'stat' }, ideaCount, h('span', null, 'ideas waiting')))));
  return { el };
}

/* ----------------------------------------------------------------- songs */
function songsView() {
  let filter = 'all', term = '';
  const el = h('div', { class: 'page' });
  const chips = h('div', { class: 'chips' });
  const grid = h('div');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search titles and lyrics', 'aria-label': 'Search songs' });
  search.style.maxWidth = '340px';
  let hits = null;
  const runSearch = debounce(async () => {
    term = search.value.trim();
    hits = null;
    if (term.length >= 2) { try { hits = await api('/api/search?q=' + encodeURIComponent(term)); } catch (e) { hits = []; } }
    draw();
  }, 220);
  search.addEventListener('input', runSearch);

  function draw() {
    const songs = app.state.songs;
    const counts = {};
    for (const s of songs) counts[s.status] = (counts[s.status] || 0) + 1;
    chips.replaceChildren(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === 'all'), onclick: () => { filter = 'all'; draw(); } }, 'All', h('span', { class: 'n' }, songs.length)),
      app.state.statuses.filter((s) => counts[s]).map((s) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === s), onclick: () => { filter = s; draw(); } }, STATUS_LABEL[s], h('span', { class: 'n' }, counts[s]))));
    if (!songs.length) {
      return grid.replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'No songs yet'), h('p', null, 'Every song gets its own page for lyrics, notes, takes and its release.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => newSong() }, 'Start a song'))));
    }
    let list = songs.filter((s) => filter === 'all' || s.status === filter);
    const lines = new Map();
    if (hits) { for (const x of hits) lines.set(x.id, x.lines); list = list.filter((s) => lines.has(s.id)); }
    list.sort((a, b) => (a.updated < b.updated ? 1 : -1));
    if (!list.length) return grid.replaceChildren(h('p', { class: 'mute' }, term ? `Nothing matches "${term}".` : 'No songs with that status.'));
    grid.replaceChildren(h('div', { class: 'grid' }, list.map((s) => h('a', { class: 'card', href: `#/song/${s.id}` },
      coverEl(s),
      h('div', { class: 't' }, s.title),
      hits && lines.get(s.id) && lines.get(s.id).length ? h('div', { class: 'small mute' }, lines.get(s.id)[0]) : null,
      h('div', { class: 'meta' }, h('span', { class: 'status', dataset: { s: s.status } }, STATUS_LABEL[s.status]), h('span', null, s.releaseDate ? day(s.releaseDate) : ago(s.updated)))))));
  }
  el.append(h('div', { class: 'pagehead' }, h('div', { class: 'grow' }, h('h1', null, 'Songs')), h('button', { class: 'btn primary', type: 'button', onclick: () => newSong() }, 'New song')),
    h('div', { class: 'row' }, search), chips, grid);
  chips.style.margin = '16px 0 24px';
  draw();
  return { el };
}

/* ----------------------------------------------------------------- ideas */
function ideasView() {
  let filter = 'all';
  const el = h('div', { class: 'page narrow' });
  const list = h('div');
  const chips = h('div', { class: 'chips' });

  function draw() {
    const ideas = app.state.ideas;
    chips.replaceChildren(...[['all', 'All']].concat(KINDS).map(([k, label]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; draw(); } },
      k === 'all' ? label : label + 's', h('span', { class: 'n' }, k === 'all' ? ideas.length : ideas.filter((i) => i.kind === k).length))));
    const shown = ideas.filter((i) => filter === 'all' || i.kind === filter).sort((a, b) => (b.pinned - a.pinned) || (a.created < b.created ? 1 : -1));
    if (!shown.length) {
      return list.replaceChildren(h('div', { class: 'empty' }, h('h2', null, ideas.length ? 'Nothing of that kind yet' : 'No ideas saved yet'), h('p', null, 'Lines, hooks and titles you catch here wait until you are ready to build a song around them.')));
    }
    list.replaceChildren(...shown.map((idea) => {
      const song = idea.songId && app.state.songs.find((s) => s.id === idea.songId);
      const update = async (patch) => {
        try { Object.assign(idea, await api('/api/ideas/' + idea.id, { method: 'PUT', body: patch })); draw(); } catch (e) { fail(e); }
      };
      return h('div', { class: 'idea' + (idea.pinned ? ' pinned' : '') },
        h('div', { class: 'text' }, idea.text),
        h('div', { class: 'acts' },
          h('span', null, `${KINDS.find((k) => k[0] === idea.kind)[1]}, ${ago(idea.created)}`),
          song ? h('a', { class: 'linkbtn', href: `#/song/${song.id}` }, `Used in ${song.title}`) : null,
          h('span', { class: 'grow' }),
          h('button', { class: 'linkbtn', type: 'button', onclick: async () => {
            const s = await newSong(idea.kind === 'title' ? { title: idea.text.slice(0, 200) } : { lyrics: idea.text + '\n' });
            if (s) api('/api/ideas/' + idea.id, { method: 'PUT', body: { songId: s.id } }).then(() => app.reload()).catch(() => {});
          } }, 'Start a song'),
          h('button', { class: 'linkbtn', type: 'button', onclick: () => copyText(idea.text) }, 'Copy'),
          h('button', { class: 'linkbtn', type: 'button', onclick: async () => { const t = await promptBox('Edit idea', 'Idea', idea.text); if (t) update({ text: t }); } }, 'Edit'),
          h('button', { class: 'linkbtn', type: 'button', onclick: () => update({ pinned: !idea.pinned }) }, idea.pinned ? 'Unpin' : 'Pin'),
          h('button', { class: 'linkbtn', type: 'button', onclick: async () => {
            if (!await confirmBox('Delete this idea?', idea.text.slice(0, 140), 'Delete idea', true)) return;
            try { await api('/api/ideas/' + idea.id, { method: 'DELETE' }); app.state.ideas = app.state.ideas.filter((x) => x.id !== idea.id); draw(); } catch (e) { fail(e); }
          } }, 'Delete')));
    }));
  }
  el.append(h('div', { class: 'pagehead' }, h('div', null, h('h1', null, 'Ideas'))), captureBox(draw), chips, list);
  chips.style.margin = '30px 0 10px';
  draw();
  return { el };
}

/* ----------------------------------------------------------------- words */
function wordsView(query) {
  const panel = wordPanel({ app });
  const el = h('div', { class: 'page narrow words-page' },
    h('div', { class: 'pagehead' }, h('div', null, h('h1', null, 'Words'), h('p', null, 'Rhymes, word families, meanings, phrases, alliteration, figures of speech and the King James Bible. It all runs on your Umbrel, with no internet needed.'))),
    panel.el);
  if (query) panel.lookup(query);
  return { el };
}

/* ----------------------------------------------------------- collections */
function collectionsView() {
  const el = h('div', { class: 'page narrow' });
  const list = h('div', { class: 'stack' });
  function draw() {
    const cols = app.state.collections;
    if (!cols.length) {
      return list.replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'Nothing collected yet'),
        h('p', null, 'Collections are word lists you keep across songs, like images of home or words for grace. Tap any word in the word tools and choose a collection.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: create }, 'New collection'))));
    }
    list.replaceChildren(...cols.map((c) => {
      const put = async (patch) => { try { Object.assign(c, await api('/api/collections/' + c.id, { method: 'PUT', body: patch })); draw(); } catch (e) { fail(e); } };
      const adder = h('input', { class: 'input', placeholder: 'Add a word or phrase', 'aria-label': 'Add to ' + c.name, onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) put({ add: e.target.value }); } });
      return h('section', { class: 'panel' },
        h('div', { class: 'row' }, h('h2', { class: 'grow' }, c.name), h('span', { class: 'small mute mono' }, c.items.length),
          h('button', { class: 'linkbtn', type: 'button', onclick: () => copyText(c.items.join('\n')) }, 'Copy all'),
          h('button', { class: 'linkbtn', type: 'button', onclick: async () => { const n = await promptBox('Rename collection', 'Name', c.name); if (n) put({ name: n }); } }, 'Rename'),
          h('button', { class: 'linkbtn', type: 'button', onclick: async () => {
            if (!await confirmBox(`Delete "${c.name}"?`, `Its ${c.items.length} entries are removed.`, 'Delete collection', true)) return;
            try { await api('/api/collections/' + c.id, { method: 'DELETE' }); app.state.collections = app.state.collections.filter((x) => x.id !== c.id); draw(); } catch (e) { fail(e); }
          } }, 'Delete')),
        h('div', { class: 'wt-words' }, c.items.map((w) => h('button', { class: 'wchip', type: 'button', title: 'Look it up. Right-click or press and hold to remove.',
          onclick: () => { location.hash = '#/words/' + encodeURIComponent(w); },
          oncontextmenu: (e) => { e.preventDefault(); put({ items: c.items.filter((x) => x !== w) }); } }, w))),
        adder);
    }));
    for (const p of list.querySelectorAll('.panel')) { p.children[1].style.margin = '14px 0'; }
  }
  async function create() {
    const name = await promptBox('New collection', 'Name', '', 'Create');
    if (name && await app.newCollection(name)) draw();
  }
  el.append(h('div', { class: 'pagehead' }, h('div', { class: 'grow' }, h('h1', null, 'Collected'), h('p', null, 'Tap a word to look it up. Right-click or press and hold to remove it.')), h('button', { class: 'btn', type: 'button', onclick: create }, 'New collection')), list);
  draw();
  return { el };
}

/* -------------------------------------------------------------- settings */
function settingsView() {
  const el = h('div', { class: 'page narrow' });
  const s = app.state.settings;
  const current = document.documentElement.getAttribute('data-look');
  const looks = h('div', { class: 'looks' }, LOOKS.map(([id, name, desc]) => h('button', {
    class: 'look', type: 'button', 'aria-pressed': String(current === id),
    onclick: (e) => {
      document.documentElement.setAttribute('data-look', id);
      try { localStorage.setItem('sn.look', id); } catch (err) { /* ignore */ }
      looks.querySelectorAll('.look').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      e.currentTarget.setAttribute('aria-pressed', 'true');
    },
  }, h('div', { class: 'sw sw-' + id }, h('i'), h('i')), h('b', null, name), h('span', { class: 'small mute' }, desc))));

  const saveSettings = debounce(async (patch) => { try { app.state.settings = await api('/api/settings', { method: 'PUT', body: patch }); toast('Saved'); } catch (e) { fail(e); } }, 600);
  const limit = h('input', { class: 'input mono', type: 'number', min: 0, max: 100000, step: 100, value: s.charLimit, oninput: (e) => saveSettings({ charLimit: e.target.value || 0 }) });
  limit.style.maxWidth = '160px';
  const artist = h('input', { class: 'input', value: s.artist, placeholder: 'Shown on exported lyrics', oninput: (e) => saveSettings({ artist: e.target.value }) });
  const checklist = h('textarea', { class: 'input', rows: 9, oninput: (e) => saveSettings({ checklist: e.target.value.split('\n') }) });
  checklist.value = s.checklist.join('\n');

  const importPick = h('input', { type: 'file', accept: '.txt,.md,.lrc,text/plain', multiple: true, class: 'hide', onchange: async (e) => {
    const items = [];
    for (const f of [...e.target.files]) {
      if (f.size > 500000) continue;
      items.push({ title: f.name.replace(/\.[^.]+$/, ''), lyrics: await f.text() });
    }
    e.target.value = '';
    if (!items.length) return toast('No text files to import', true);
    try { const r = await api('/api/import', { method: 'POST', body: { items } }); await app.reload(); toast(`Imported ${r.imported} ${r.imported === 1 ? 'song' : 'songs'}`); location.hash = '#/songs'; }
    catch (err) { fail(err); }
  } });
  const restorePick = h('input', { type: 'file', accept: '.json,application/json', class: 'hide', onchange: async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!await confirmBox('Restore from this backup?', 'Songs, ideas and collections are replaced by the ones in the backup file. Audio and cover art already on this Umbrel are kept. A copy of the current data is saved first.', 'Restore', true)) return;
    try { const r = await api('/api/restore', { method: 'POST', body: f, raw: true }); await app.reload(); toast(`Restored ${r.songs} songs`); location.hash = '#/songs'; }
    catch (err) { fail(err); }
  } });
  const field = (label, node, hint) => h('label', { class: 'field' }, h('span', null, label), node, hint ? h('span', { class: 'small' }, hint) : null);

  el.append(
    h('div', { class: 'pagehead' }, h('h1', null, 'Settings')),
    h('section', null, h('h2', null, 'Look'), looks, h('p', { class: 'small mute' }, 'Saved for this browser only, so your phone and your computer can each have their own.')),
    h('section', { class: 'sect stack' }, h('h2', null, 'Writing'),
      field('Character limit for lyrics', limit, 'The sheet warns you when lyrics run past this. AI music tools often cap lyrics at around 3,000 characters. Use 0 for no limit.'),
      field('Artist name', artist)),
    h('section', { class: 'sect stack' }, h('h2', null, 'Release checklist for new songs'), field('One step per line', checklist, 'Songs you already have keep their own checklists.')),
    h('section', { class: 'sect stack' }, h('h2', null, 'Bring lyrics in'),
      h('p', { class: 'mute' }, 'Pick one or more plain text files. Each file becomes a song named after the file. To move from another writing app, export or copy each lyric to a .txt file first.'),
      h('div', { class: 'row' }, importPick, h('button', { class: 'btn', type: 'button', onclick: () => importPick.click() }, 'Import text files'))),
    h('section', { class: 'sect stack' }, h('h2', null, 'Backup'),
      h('p', { class: 'mute' }, 'The backup file holds every song, version, idea, collection and setting. Audio and cover art are not inside it. They live in the app’s data folder on your Umbrel and are covered by Umbrel’s own backup.'),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '/api/backup', download: '' }, 'Download backup'), h('a', { class: 'btn', href: '/api/export/lyrics.txt', download: '' }, 'Download all lyrics'), restorePick, h('button', { class: 'btn', type: 'button', onclick: () => restorePick.click() }, 'Restore from a backup'))),
    h('section', { class: 'sect' }, h('h2', null, 'About the word tools'), h('div', { class: 'credits' },
      h('p', null, 'Rhymes and syllables come from the CMU Pronouncing Dictionary. Meanings and synonyms come from Princeton WordNet. Word families come from the Moby Thesaurus, which is in the public domain. Commonness ranking uses SCOWL word lists. The Bible text is the King James Version.'),
      h('p', null, 'The figures of speech are a short hand-picked list, and there is no pop-culture dictionary. Nothing you type is sent anywhere.'),
      h('p', null, 'Studio Notebook is an independent hobby project. It is not affiliated with MasterWriter, Suno, DistroKid, Spotify, Apple or Umbrel.'))));
  for (const sec of el.querySelectorAll('section > h2')) sec.style.marginBottom = '12px';
  return { el };
}

/* ---------------------------------------------------------------- router */
async function route() {
  if (current && current.leave) { try { await current.leave(); } catch (e) { /* keep going */ } }
  document.querySelectorAll('.pop').forEach((p) => p.remove());
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  let key = parts[0] || 'desk', view;
  if (key === 'song' && parts[1]) { view = await songView(app, parts[1], parts[2]); key = 'songs'; }
  else if (key === 'songs') view = songsView();
  else if (key === 'ideas') view = ideasView();
  else if (key === 'words') view = wordsView(parts.slice(1).join('/'));
  else if (key === 'collections') view = collectionsView();
  else if (key === 'settings') view = settingsView();
  else { key = 'desk'; view = deskView(); }
  current = view;
  drawRail(key);
  main.replaceChildren(view.el);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
window.addEventListener('pagehide', () => { if (current && current.leave) current.leave(); });

(async () => {
  try { await app.reload(); }
  catch (e) {
    root.replaceChildren(h('div', { class: 'boot' }, h('h2', null, 'The notebook did not open'), h('p', { class: 'mute' }, e.message), h('p', null, h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Try again'))));
    return;
  }
  root.replaceChildren(h('div', { class: 'shell' }, rail, main));
  route();
})();
