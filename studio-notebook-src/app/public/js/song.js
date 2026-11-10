/* One song: lyric sheet, notes, takes, release and versions. */
import { h, api, toast, fail, confirmBox, promptBox, dialog, copyText, STATUS_LABEL, day, ago, size, debounce } from './util.js';
import { wordPanel } from './wordtools.js';

const TABS = [['lyrics', 'Lyrics'], ['notes', 'Notes'], ['takes', 'Art and takes'], ['release', 'Release'], ['versions', 'Versions']];
const SECTIONS = ['Verse', 'Pre-Chorus', 'Chorus', 'Hook', 'Bridge', 'Intro', 'Outro'];
const STOP = new Set('a an and are as at be but by do for from got had has have he her him his i if im in is it its just me my no not of on or our she so that the their them they this to up us was we were what when with you your youre ive ill id dont cant wont thats theres whats aint into than then been am did does would could should while'.split(' '));
const isTag = (line) => /^\s*[\[(].*[\])]\s*$/.test(line);
const pref = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

function upload(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('X-Studio-Notebook', '1');
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let data = null;
      try { data = JSON.parse(x.responseText); } catch (e) { /* not json */ }
      if (x.status >= 200 && x.status < 300) resolve(data);
      else reject(new Error((data && data.error) || `Upload failed (${x.status}).`));
    };
    x.onerror = () => reject(new Error('The upload did not reach the Umbrel.'));
    x.send(file);
  });
}

/* Line-by-line difference between two texts. */
function diffLines(a, b) {
  const A = a.split('\n').slice(0, 700), B = b.split('\n').slice(0, 700);
  const n = A.length, m = B.length;
  const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = A[i] === B[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(['same', A[i]]); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) out.push(['del', A[i++]]);
    else out.push(['add', B[j++]]);
  }
  while (i < n) out.push(['del', A[i++]]);
  while (j < m) out.push(['add', B[j++]]);
  return out;
}

export async function songView(app, id, tabName) {
  let song;
  try { song = await api('/api/songs/' + id); }
  catch (e) {
    return { el: h('div', { class: 'page narrow' }, h('div', { class: 'empty' }, h('h2', null, 'That song is gone'), h('p', null, e.message), h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/songs' }, 'Back to songs')))) };
  }
  let tab = TABS.some((t) => t[0] === tabName) ? tabName : 'lyrics';
  const pending = {};
  const savedEl = h('span', { class: 'saved', 'aria-live': 'polite' }, 'Saved');
  let saving = false, again = false;

  async function flush(keepalive) {
    save.cancel();
    if (saving) { again = true; return; }
    const body = Object.assign({}, pending);
    if (!Object.keys(body).length) return;
    for (const k of Object.keys(pending)) delete pending[k];
    saving = true;
    savedEl.textContent = 'Saving';
    savedEl.classList.remove('err');
    try {
      const r = await api('/api/songs/' + id, { method: 'PUT', body, keepalive });
      song.updated = r.updated;
      app.patchSong(r.summary);
      if (!Object.keys(pending).length) savedEl.textContent = 'Saved';
    } catch (e) {
      // put the unsent changes back and try again shortly
      for (const k of Object.keys(body)) if (!(k in pending)) pending[k] = body[k];
      savedEl.textContent = 'Not saved yet, retrying';
      savedEl.classList.add('err');
      setTimeout(() => flush(), 4000);
    } finally {
      saving = false;
      if (again) { again = false; flush(); }
    }
  }
  const save = debounce(() => flush(), 900);
  function change(patch) {
    Object.assign(pending, patch);
    Object.assign(song, patch);
    savedEl.textContent = 'Editing';
    save();
  }

  /* ---------- header ---------- */
  const title = h('input', { class: 'title-input', value: song.title === 'Untitled' ? '' : song.title, placeholder: 'Untitled', 'aria-label': 'Song title', maxlength: 200, oninput: (e) => change({ title: e.target.value }) });
  const statusSel = h('select', { class: 'input', 'aria-label': 'Status', onchange: (e) => { change({ status: e.target.value }); flush(); } },
    app.state.statuses.map((s) => h('option', { value: s, selected: song.status === s }, STATUS_LABEL[s])));
  statusSel.style.width = 'auto';
  const head = h('div', { class: 'songhead' },
    h('a', { class: 'back', href: '#/songs' }, '‹ Songs'),
    title,
    h('div', { class: 'row' }, statusSel,
      h('button', { class: 'btn sm', type: 'button', onclick: () => copyText(song.lyrics) }, 'Copy lyrics'),
      h('a', { class: 'btn sm', href: `/api/songs/${id}/export.txt`, download: '' }, 'Download .txt'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => window.print() }, 'Print'),
      h('button', { class: 'btn sm danger', type: 'button', onclick: removeSong }, 'Delete'),
      savedEl));

  async function removeSong() {
    if (!await confirmBox(`Delete "${song.title}"?`, 'The lyrics, every saved version, the cover art and all takes are removed from your Umbrel. This cannot be undone.', 'Delete song', true)) return;
    try { await flush(); await api('/api/songs/' + id, { method: 'DELETE' }); await app.reload(); location.hash = '#/songs'; toast('Deleted'); }
    catch (e) { fail(e); }
  }

  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const bodyEl = h('div');
  const el = h('div', { class: 'page' }, head, tabsEl, bodyEl);

  function drawTabs() {
    tabsEl.replaceChildren(...TABS.map(([k, label]) => h('button', {
      class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(tab === k),
      onclick: () => { tab = k; history.replaceState(null, '', `#/song/${id}/${k}`); drawTabs(); drawBody(); },
    }, label)));
  }
  function drawBody() {
    const make = { lyrics: lyricsTab, notes: notesTab, takes: takesTab, release: releaseTab, versions: versionsTab }[tab];
    bodyEl.replaceChildren(make());
  }

  /* ---------- lyrics ---------- */
  const cache = new Map();   // line text -> { syl, tag, toks }
  function lyricsTab() {
    let mode = pref('sn.hl', 'ends');
    let showSyl = pref('sn.syl', '1') === '1';
    let sel = [song.lyrics.length, song.lyrics.length];
    const ta = h('textarea', { class: 'ink', spellcheck: 'true', autocapitalize: 'sentences', 'aria-label': 'Lyrics', placeholder: 'Start writing. Section names go in brackets, like [Verse 1].' });
    ta.value = song.lyrics;
    const back = h('div', { class: 'back-layer', 'aria-hidden': 'true' });
    const counts = h('div', { class: 'counts' });
    const meterBar = h('i');
    const meter = h('div', { class: 'meter' }, meterBar);
    const lookBtn = h('button', { class: 'btn sm hide', type: 'button' });
    const collectedEl = h('div', { class: 'collected' });

    function insert(text) {
      const v = ta.value;
      let [a, b] = sel;
      a = Math.min(a, v.length); b = Math.min(b, v.length);
      const before = a > 0 && !/\s/.test(v[a - 1]) ? ' ' : '';
      ta.setRangeText(before + text, a, b, 'end');
      sel = [ta.selectionStart, ta.selectionEnd];
      onInput();
      toast('Added to the lyrics');
    }
    function collect(text) {
      if (song.collected.includes(text)) return toast('Already collected');
      change({ collected: song.collected.concat(text) });
      drawCollected();
      toast('Collected');
    }
    const panel = wordPanel({ app, insert, collect });
    const side = h('aside', { class: 'side', 'aria-label': 'Word tools' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Word tools'), h('button', { class: 'btn sm sheet-close', type: 'button', onclick: () => side.classList.remove('open') }, 'Close')),
      panel.el);
    side.firstChild.style.marginBottom = '12px';
    const fab = h('button', { class: 'btn primary words-fab', type: 'button', onclick: () => { side.classList.add('open'); } }, 'Word tools');

    function drawCollected() {
      if (!song.collected.length) return collectedEl.replaceChildren();
      collectedEl.replaceChildren(h('h3', null, 'Collected for this song'),
        h('div', { class: 'wt-words' }, song.collected.map((w) => h('button', {
          class: 'wchip', type: 'button', title: 'Tap to add to the lyrics. Press and hold to remove.',
          onclick: () => insert(w),
          oncontextmenu: (e) => { e.preventDefault(); change({ collected: song.collected.filter((x) => x !== w) }); drawCollected(); },
        }, w))),
        h('p', { class: 'small mute' }, 'Tap a word to drop it in at the cursor. Right-click or press and hold to remove it.'));
      collectedEl.lastChild.style.marginTop = '8px';
    }

    /* Words in a stanza rhyme when they share any rhyme sound. Linked words form a family and
       each family gets a colour. A word repeating itself is not a rhyme, so a family needs two
       different words. */
    function colorize(lines) {
      const colors = lines.map(() => null);
      if (mode === 'off') return colors;
      let stanza = [];
      const assign = () => {
        const picks = [];
        for (const i of stanza) {
          const a = cache.get(lines[i]);
          if (!a) continue;
          const toks = mode === 'ends' ? a.toks.slice(-1).map((t) => [t, a.toks.length - 1]) : a.toks.map((t, k) => [t, k]);
          for (const [t, k] of toks) {
            const keys = Array.isArray(t[2]) ? t[2] : [];
            const word = lines[i].slice(t[0], t[1]).toLowerCase().replace(/[^a-z]/g, '');
            if (!keys.length || (mode === 'all' && STOP.has(word))) continue;
            picks.push([i, k, word, keys]);
          }
        }
        // strong links: the same vowels from the stress on, or the same last two syllables
        const parent = picks.map((_, n) => n);
        const find = (n) => { while (parent[n] !== n) { parent[n] = parent[parent[n]]; n = parent[n]; } return n; };
        const first = new Map();
        picks.forEach((p, n) => { for (const key of p[3]) { if (key[0] === 'h') continue; if (first.has(key)) parent[find(n)] = find(first.get(key)); else first.set(key, n); } });
        const group = () => {
          const fams = new Map();
          picks.forEach((p, n) => { const r = find(n); if (!fams.has(r)) fams.set(r, []); fams.get(r).push(n); });
          return fams;
        };
        const real = (fam) => new Set(fam.map((n) => picks[n][2])).size > 1;
        // weak link: a long word with no family joins a neighbour (same or next line) that opens its rhyme the same way
        const before = group();
        const alone = (n) => !real(before.get(find(n)));
        picks.forEach((p, n) => {
          if (!alone(n)) return;
          const weak = p[3].filter((k) => k[0] === 'h');
          if (!weak.length) return;
          const mate = picks.findIndex((q, m) => m !== n && q[2] !== p[2] && Math.abs(q[0] - p[0]) <= 1 && q[3].some((k) => weak.includes(k)));
          if (mate > -1) parent[find(n)] = find(mate);
        });
        let colour = 0;
        for (const fam of group().values()) {
          if (!real(fam)) continue;
          for (const n of fam) { const [i, k] = picks[n]; (colors[i] || (colors[i] = new Map())).set(k, colour % 8); }
          colour++;
        }
        stanza = [];
      };
      lines.forEach((l, i) => { if (!l.trim() || isTag(l)) assign(); else stanza.push(i); });
      assign();
      return colors;
    }

    function paint() {
      const lines = ta.value.split('\n');
      const colors = colorize(lines);
      const frag = document.createDocumentFragment();
      let syllables = 0;
      lines.forEach((line, i) => {
        const a = cache.get(line);
        const tag = isTag(line);
        const row = h('div', { class: 'ln' + (tag ? ' tag' : '') });
        if (a && !a.tag) {
          syllables += a.syl;
          if (showSyl && a.syl) row.append(h('span', { class: 'syl' }, a.syl));
        }
        const c = colors[i];
        if (c && a) {
          let at = 0;
          a.toks.forEach((t, k) => {
            if (!c.has(k)) return;
            if (t[0] > at) row.append(line.slice(at, t[0]));
            row.append(h('span', { class: 'hl c' + c.get(k) }, line.slice(t[0], t[1])));
            at = t[1];
          });
          row.append(line.slice(at));
        } else row.append(line || '​');
        frag.append(row);
      });
      back.replaceChildren(frag);
      const text = ta.value;
      const limit = app.state.settings.charLimit;
      const wordsN = (text.match(/[A-Za-z][A-Za-z'’]*/g) || []).length;
      const linesN = lines.filter((l) => l.trim() && !isTag(l)).length;
      const over = limit > 0 && text.length > limit;
      counts.replaceChildren(...[
        h('span', { class: over ? 'over' : '' }, limit > 0 ? `${text.length.toLocaleString()} / ${limit.toLocaleString()} characters` : `${text.length.toLocaleString()} characters`),
        over ? h('span', { class: 'over' }, `${(text.length - limit).toLocaleString()} over the limit`) : null,
        h('span', null, `${wordsN.toLocaleString()} words`), h('span', null, `${linesN} lines`), h('span', null, `${syllables.toLocaleString()} syllables`)].filter(Boolean));
      meter.classList.toggle('hide', !(limit > 0));
      meter.classList.toggle('over', over);
      meterBar.style.width = limit > 0 ? Math.min(100, (text.length / limit) * 100) + '%' : '0';
    }

    const analyze = debounce(async () => {
      const need = [...new Set(ta.value.split('\n'))].filter((l) => !cache.has(l));
      if (!need.length) return;
      try {
        const r = await api('/api/analyze', { method: 'POST', body: { text: need.join('\n') } });
        if (!r.lines) return;
        if (cache.size > 6000) cache.clear();
        need.forEach((l, i) => { if (r.lines[i]) cache.set(l, r.lines[i]); });
        paint();
      } catch (e) { /* the sheet still works without analysis */ }
    }, 280);

    function onInput() {
      change({ lyrics: ta.value });
      paint();
      analyze();
    }
    ta.addEventListener('input', onInput);

    function trackSelection() {
      sel = [ta.selectionStart, ta.selectionEnd];
      const picked = ta.value.slice(sel[0], sel[1]).trim();
      if (picked && picked.length <= 40 && picked.split(/\s+/).length <= 4 && !picked.includes('\n')) {
        lookBtn.textContent = `Look up "${picked}"`;
        lookBtn.classList.remove('hide');
        lookBtn.onclick = () => { panel.lookup(picked); side.classList.add('open'); };
      } else lookBtn.classList.add('hide');
    }
    for (const ev of ['select', 'keyup', 'mouseup', 'touchend', 'blur']) ta.addEventListener(ev, () => setTimeout(trackSelection, 0));
    ta.addEventListener('dblclick', () => setTimeout(() => {
      const picked = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
      if (picked && !/\s/.test(picked)) panel.lookup(picked);
    }, 0));

    function addSection(name) {
      const v = ta.value;
      const lineStart = v.lastIndexOf('\n', sel[0] - 1) + 1;
      const n = (v.match(new RegExp('^\\[' + name.replace('-', '[- ]?') + '( \\d+)?\\]', 'gmi')) || []).length;
      const label = name === 'Verse' ? `[Verse ${n + 1}]` : `[${name}]`;
      const lead = lineStart > 0 && v.slice(0, lineStart).replace(/\n$/, '').split('\n').pop().trim() ? '\n' : '';
      ta.setRangeText(lead + label + '\n', lineStart, lineStart, 'end');
      ta.focus();
      sel = [ta.selectionStart, ta.selectionEnd];
      onInput();
    }

    const hlSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Rhyme colours' });
    const drawSeg = () => hlSeg.replaceChildren(...[['off', 'No colours'], ['ends', 'Line ends'], ['all', 'Every rhyme']].map(([k, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(mode === k), onclick: () => { mode = k; setPref('sn.hl', k); drawSeg(); paint(); } }, label)));
    drawSeg();
    const sylBtn = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(showSyl), onclick: () => { showSyl = !showSyl; setPref('sn.syl', showSyl ? '1' : '0'); sylBtn.setAttribute('aria-pressed', String(showSyl)); paint(); } }, 'Syllable counts');

    const toolbar = h('div', { class: 'toolbar scroll' },
      SECTIONS.map((s) => h('button', { class: 'chip', type: 'button', onclick: () => addSection(s) }, '+ ' + s)));
    const toolbar2 = h('div', { class: 'toolbar' }, hlSeg, sylBtn, lookBtn,
      h('button', { class: 'btn sm', type: 'button', onclick: saveVersion }, 'Save a version'));

    paint();
    analyze();
    drawCollected();
    return h('div', { class: 'write' },
      h('div', null, toolbar, toolbar2,
        h('div', { class: 'sheet' }, h('div', { class: 'sheet-inner' }, back, ta)),
        meter, counts, collectedEl),
      side, fab);
  }

  async function saveVersion() {
    const label = await promptBox('Save a version', 'What is this version? (optional)', '', 'Save version');
    if (label === null) return;
    try { await flush(); await api(`/api/songs/${id}/versions`, { method: 'POST', body: { label: label || 'Saved version' } }); toast('Version saved'); if (tab === 'versions') drawBody(); }
    catch (e) { fail(e); }
  }

  /* ---------- notes ---------- */
  function field(label, node, hint) {
    return h('label', { class: 'field' }, h('span', null, label), node, hint ? h('span', { class: 'small' }, hint) : null);
  }
  function notesTab() {
    const prod = song.production;
    const setProd = (k) => (e) => change({ production: Object.assign({}, song.production, { [k]: e.target.value }) });
    const story = h('textarea', { class: 'input', rows: 12, oninput: (e) => change({ notes: e.target.value }) });
    story.value = song.notes;
    const style = h('textarea', { class: 'input', rows: 4, oninput: setProd('style') });
    style.value = prod.style;
    const pnotes = h('textarea', { class: 'input', rows: 4, oninput: setProd('notes') });
    pnotes.value = prod.notes;
    return h('div', { class: 'two' },
      h('div', { class: 'stack' },
        field('Behind the lyrics', story, 'Where the song came from and what it means. Handy later for your website.')),
      h('div', { class: 'stack' },
        field('Sound and style', style, 'Genre, mood, instruments, or the style prompt you give your music tool.'),
        h('div', { class: 'cols' },
          field('Tempo (BPM)', h('input', { class: 'input', value: prod.bpm, inputmode: 'numeric', oninput: setProd('bpm') })),
          field('Key', h('input', { class: 'input', value: prod.key, oninput: setProd('key') }))),
        field('Voice', h('input', { class: 'input', value: prod.voice, oninput: setProd('voice') })),
        field('Production notes', pnotes),
        field('Project or album', h('input', { class: 'input', value: song.project, oninput: (e) => change({ project: e.target.value }) })),
        field('Tags', h('input', { class: 'input', value: song.tags.join(', '), placeholder: 'faith, family, home', oninput: (e) => change({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }) }), 'Separate tags with commas.')));
  }

  /* ---------- art and takes ---------- */
  function takesTab() {
    const coverBox = h('div');
    const list = h('div');
    const progress = h('p', { class: 'small mute' });
    function drawCover() {
      const pick = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hide', onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try { const r = await upload(`/api/songs/${id}/cover?name=${encodeURIComponent(f.name)}`, f); song.cover = r.cover; await app.reload(); drawCover(); toast('Cover art saved'); }
        catch (err) { fail(err); }
      } });
      coverBox.replaceChildren(
        song.cover ? h('img', { class: 'bigcover', src: `/files/${id}/${song.cover}`, alt: 'Cover art' }) : h('div', { class: 'bigcover' }, 'No cover art yet'),
        pick,
        h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: () => pick.click() }, song.cover ? 'Replace cover art' : 'Add cover art'),
          song.cover ? h('a', { class: 'btn sm', href: `/files/${id}/${song.cover}?download=${encodeURIComponent(song.title + ' cover')}` }, 'Download') : null,
          song.cover ? h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { try { await api(`/api/songs/${id}/cover`, { method: 'DELETE' }); song.cover = ''; await app.reload(); drawCover(); } catch (err) { fail(err); } } }, 'Remove') : null));
      coverBox.lastChild.style.marginTop = '12px';
    }
    function drawList() {
      if (!song.audio.length) return list.replaceChildren(h('p', { class: 'mute' }, 'No takes yet. Add a demo, a bounce from your music tool, or the final master, and play it back here next to the lyrics.'));
      list.replaceChildren(...song.audio.map((a) => h('div', { class: 'take' },
        h('div', { class: 'row' },
          h('input', { class: 'input grow', value: a.name, 'aria-label': 'Take name', onchange: (e) => { a.name = e.target.value || a.name; change({ audioNotes: [{ id: a.id, name: a.name, note: a.note }] }); flush(); } }),
          h('span', { class: 'small mute mono' }, `${size(a.size)}, ${day(a.added)}`)),
        h('audio', { controls: true, preload: 'none', src: `/files/${id}/${a.file}` }),
        h('div', { class: 'row' },
          h('input', { class: 'input grow', value: a.note, placeholder: 'Note about this take', 'aria-label': 'Note', onchange: (e) => { a.note = e.target.value; change({ audioNotes: [{ id: a.id, name: a.name, note: a.note }] }); flush(); } }),
          h('a', { class: 'btn sm', href: `/files/${id}/${a.file}?download=${encodeURIComponent(a.name)}` }, 'Download'),
          h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
            if (!await confirmBox(`Delete "${a.name}"?`, 'The audio file is removed from your Umbrel.', 'Delete take', true)) return;
            try { await api(`/api/songs/${id}/audio/${a.id}`, { method: 'DELETE' }); song.audio = song.audio.filter((x) => x.id !== a.id); drawList(); }
            catch (err) { fail(err); }
          } }, 'Delete')))));
    }
    const pickAudio = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.aif,.aiff', multiple: true, class: 'hide', onchange: async (e) => {
      for (const f of [...e.target.files]) {
        try {
          const take = await upload(`/api/songs/${id}/audio?name=${encodeURIComponent(f.name)}`, f, (p) => { progress.textContent = `Uploading ${f.name}: ${Math.round(p * 100)}%`; });
          song.audio.unshift(take);
          drawList();
        } catch (err) { fail(err); }
      }
      progress.textContent = '';
      e.target.value = '';
    } });
    drawCover();
    drawList();
    return h('div', { class: 'two' },
      h('div', null, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Takes'), pickAudio, h('button', { class: 'btn sm primary', type: 'button', onclick: () => pickAudio.click() }, 'Add audio')), progress, list),
      h('div', null, h('h2', null, 'Cover art'), coverBox));
  }

  /* ---------- release ---------- */
  function releaseTab() {
    const listEl = h('div');
    const prog = h('span', { class: 'small mute mono' });
    function drawChecks() {
      const done = song.checklist.filter((c) => c.done).length;
      prog.textContent = `${done} of ${song.checklist.length} done`;
      listEl.replaceChildren(...song.checklist.map((c) => h('label', { class: 'check' + (c.done ? ' done' : '') },
        h('input', { type: 'checkbox', checked: c.done, onchange: (e) => { c.done = e.target.checked; change({ checklist: song.checklist }); drawChecks(); } }),
        h('span', { class: 'grow' }, c.text),
        h('button', { class: 'linkbtn', type: 'button', 'aria-label': 'Remove step', onclick: (e) => { e.preventDefault(); song.checklist = song.checklist.filter((x) => x !== c); change({ checklist: song.checklist }); drawChecks(); } }, 'Remove'))));
    }
    const addStep = h('input', { class: 'input', placeholder: 'Add a step', 'aria-label': 'Add a step', onkeydown: (e) => {
      if (e.key !== 'Enter' || !e.target.value.trim()) return;
      song.checklist = song.checklist.concat({ id: '', text: e.target.value.trim(), done: false });
      change({ checklist: song.checklist }); e.target.value = ''; drawChecks();
    } });
    const setLink = (k) => (e) => change({ links: Object.assign({}, song.links, { [k]: e.target.value }) });
    const setId = (k) => (e) => change({ ids: Object.assign({}, song.ids, { [k]: e.target.value }) });
    const link = (k, label) => field(label, h('input', { class: 'input', type: 'url', value: song.links[k], placeholder: 'https://', oninput: setLink(k) }));
    drawChecks();
    const dateInput = h('input', { class: 'input', type: 'date', value: song.releaseDate, onchange: (e) => { change({ releaseDate: e.target.value }); flush(); } });
    const sg = app.state.suggest;
    const nice = (d) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const suggestEl = sg && song.status !== 'released' && !song.releaseDate ? h('p', { class: 'small mute' }, `Suggested: ${nice(sg.date)}. `,
      h('button', { class: 'linkbtn', type: 'button', onclick: () => { dateInput.value = sg.date; change({ releaseDate: sg.date }); flush(); toast('Release date set'); } }, 'Use this date'), ' ',
      h('a', { href: '#/calendar' }, 'Why this date')) : null;
    const on = [['spotify', 'Spotify', /^https:\/\/open\.spotify\.com\//]].filter(([k, , re]) => re.test(song.links[k]));
    const liveEl = h('div', { class: 'live' }, on.length ? on.map(([k, label]) => h('a', { class: 'pill ' + k, href: song.links[k], target: '_blank', rel: 'noopener noreferrer' }, 'Live on ' + label))
      : h('span', { class: 'small mute' }, 'Not found on Spotify yet. Sync from the Songs page, or paste the link below.'));
    return h('div', { class: 'two' },
      h('div', null,
        h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Release checklist'), prog), listEl, addStep,
        h('p', { class: 'small mute' }, 'New songs start with the checklist from Settings. Changes here only affect this song.')),
      h('div', { class: 'stack' },
        field('Release date', dateInput), suggestEl, liveEl,
        link('spotify', 'Spotify link'), link('apple', 'Apple Music link'), link('distributor', 'Distributor link'), link('site', 'Website page'), link('other', 'Other link'),
        h('div', { class: 'cols' },
          field('ISRC', h('input', { class: 'input mono', value: song.ids.isrc, oninput: setId('isrc') })),
          field('UPC', h('input', { class: 'input mono', value: song.ids.upc, oninput: setId('upc') })))));
  }

  /* ---------- versions ---------- */
  function versionsTab() {
    const list = h('div', null, h('p', { class: 'mute' }, 'Loading versions'));
    const wrap = h('div', { class: 'page narrow' },
      h('div', { class: 'row' }, h('p', { class: 'mute grow' }, 'A copy is kept automatically before the first edit of each day. Save one yourself before a big rewrite.'),
        h('button', { class: 'btn primary', type: 'button', onclick: saveVersion }, 'Save a version')),
      list);
    wrap.style.margin = '0';
    list.style.marginTop = '16px';
    (async () => {
      let versions;
      try { await flush(); versions = await api(`/api/songs/${id}/versions`); } catch (e) { return list.replaceChildren(h('p', { class: 'mute' }, e.message)); }
      if (!versions.length) return list.replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'No versions yet'), h('p', null, 'Once you start editing, earlier drafts show up here so you can compare them or go back.')));
      list.replaceChildren(...versions.map((v) => h('div', { class: 'version' },
        h('div', { class: 'grow' }, h('div', null, v.label || 'Saved version'), h('div', { class: 'small mute' }, `${ago(v.at)}, ${v.chars.toLocaleString()} characters${v.auto ? ', automatic' : ''}`)),
        h('button', { class: 'btn sm', type: 'button', onclick: () => openVersion(v.id) }, 'Compare'),
        h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
          if (!await confirmBox('Delete this version?', 'Only this saved copy is removed. Your current lyrics stay as they are.', 'Delete version', true)) return;
          try { await api(`/api/songs/${id}/versions/${v.id}`, { method: 'DELETE' }); drawBody(); } catch (e) { fail(e); }
        } }, 'Delete'))));
    })();
    return wrap;
  }
  async function openVersion(vid) {
    let v;
    try { v = await api(`/api/songs/${id}/versions/${vid}`); } catch (e) { return fail(e); }
    const box = h('div', { class: 'diff' }, diffLines(v.lyrics, song.lyrics).map(([kind, text]) => h('span', { class: kind }, text || '​')));
    const choice = await dialog({
      title: v.label || 'Saved version', wide: true,
      body: h('div', { class: 'stack' }, h('p', { class: 'mute small' }, 'Struck-through lines are in this version but not in your current lyrics. Green lines were added since.'), box),
      buttons: [{ label: 'Close', value: null, kind: 'ghost' }, { label: 'Copy this version', value: 'copy' }, { label: 'Go back to this version', value: 'restore', kind: 'primary' }],
    });
    if (choice === 'copy') copyText(v.lyrics);
    if (choice === 'restore') {
      try {
        await flush();
        await api(`/api/songs/${id}/versions`, { method: 'POST', body: { label: 'Before going back to an earlier version' } });
        change({ lyrics: v.lyrics });
        await flush();
        tab = 'lyrics'; drawTabs(); drawBody();
        toast('Went back to that version');
      } catch (e) { fail(e); }
    }
  }

  drawTabs();
  drawBody();
  return { el, leave: () => flush(true) };
}
