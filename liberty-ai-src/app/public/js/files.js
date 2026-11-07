// The Files page: choose which folders Liberty AI may search. Nothing is read until you add one.
(function () {
  'use strict';
  const { h, clear, icon, api, toast, ago, S } = LA;
  let host = null;
  let poll = null;
  let browse = '';
  let pickerEl = null;
  let listEl = null;
  let statusEl = null;
  let resultsEl = null;
  let shelfEl = null;
  let kiwixEl = null;

  async function loadPicker() {
    if (!pickerEl) return;
    try {
      const r = await api('GET', '/api/fs?path=' + encodeURIComponent(browse));
      if (!pickerEl) return;
      clear(pickerEl);
      const crumbs = h('div', { class: 'crumbs' }, h('button', { class: 'crumb', type: 'button', onclick: () => { browse = ''; loadPicker(); } }, icon('home'), 'Storage'));
      let acc = '';
      for (const part of r.path ? r.path.split('/') : []) {
        acc = acc ? acc + '/' + part : part;
        const p = acc;
        crumbs.appendChild(h('span', { class: 'sep', text: '/' }));
        crumbs.appendChild(h('button', { class: 'crumb', type: 'button', text: part, onclick: () => { browse = p; loadPicker(); } }));
      }
      pickerEl.appendChild(crumbs);
      const list = h('div', { class: 'dirs' });
      if (!r.dirs.length) list.appendChild(h('p', { class: 'muted small pad', text: 'No more folders here.' }));
      for (const d of r.dirs) {
        const p = r.path ? r.path + '/' + d : d;
        list.appendChild(h('button', { class: 'dir', type: 'button', onclick: () => { browse = p; loadPicker(); } }, icon('folder'), h('span', { text: d })));
      }
      pickerEl.appendChild(list);
      if (r.path) pickerEl.appendChild(h('button', { class: 'btn primary', type: 'button', onclick: () => addFolder(r.path) }, icon('plus'), 'Let Liberty AI search “' + r.path + '”'));
      else pickerEl.appendChild(h('p', { class: 'muted small', text: 'Open a folder, then choose it. Hidden files and anything that looks like a password, key or wallet are always skipped.' }));
    } catch (e) {
      clear(pickerEl);
      pickerEl.appendChild(h('p', { class: 'muted', text: 'I can not see your storage: ' + e.message }));
    }
  }

  async function addFolder(p) {
    try { await api('POST', '/api/files/folders', { path: p }); toast('Added. Reading the files now…', 'ok'); refresh(); startPoll(); } catch (e) { toast(e.message, 'crit'); }
  }

  async function refresh() {
    try {
      const r = await api('GET', '/api/files');
      S.state && (S.state.files = Object.assign({}, S.state.files, r.stats));
      if (!host || !host.isConnected) return r;
      if (listEl) {
        clear(listEl);
        if (!r.folders.length) listEl.appendChild(h('p', { class: 'muted', text: 'No folders yet. Choose one below to start.' }));
        for (const f of r.folders) {
          listEl.appendChild(h('div', { class: 'folder-row' }, icon('folder'), h('div', { class: 'grow' }, h('b', { text: f.path }), h('small', { class: 'muted', text: f.files + ' file' + (f.files === 1 ? '' : 's') + ' · ' + f.chunks + ' passages' })),
            h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await api('POST', '/api/files/remove', { path: f.path }); refresh(); } }, icon('x'), 'Remove')));
        }
      }
      if (statusEl) {
        clear(statusEl);
        const st = r.status;
        if (st.running) statusEl.appendChild(h('div', { class: 'banner info' }, h('span', { class: 'spinner' }), h('span', { text: 'Reading files… ' + st.scanned + ' checked, ' + st.indexed + ' new or changed' }), h('button', { class: 'btn small', type: 'button', onclick: () => api('POST', '/api/files/cancel', {}) }, 'Stop')));
        else {
          statusEl.appendChild(h('p', { class: 'muted small', text: r.stats.docs + ' files · ' + r.stats.chunks + ' passages searchable' + (st.finishedAt ? ' · last read ' + ago(st.finishedAt) : '') + (r.pdf ? ' · PDFs supported' : ' · PDFs not supported in this install') }));
          if (r.folders.length && !r.stats.docs) {
            const ex = Object.entries(st.ext || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => n + ' .' + k).join(', ');
            let why = 'No readable documents were found in those folders.';
            if (st.unreadable && st.firstError) why = 'I could not open part of the storage (' + st.firstError + '). The app may not have permission yet.';
            else if (ex) why += ' I skipped files I can not read: ' + ex + '. Add a folder that holds documents (PDF, Word, text, ebooks).';
            else if (!st.dirs) why = 'The storage looks empty or is not mounted. Folders here come from Umbrel Files.';
            if (!r.pdf && /\.pdf/.test(ex)) why += ' PDFs need pdftotext, which is missing in this install.';
            statusEl.appendChild(h('div', { class: 'banner warn' }, icon('alert'), h('span', { text: why })));
          }
          if (st.full) statusEl.appendChild(h('div', { class: 'banner warn' }, icon('alert'), h('span', { text: 'The index is full. Remove a folder you do not need.' })));
          if (st.error) statusEl.appendChild(h('div', { class: 'banner warn' }, icon('alert'), h('span', { text: st.error })));
        }
      }
      return r;
    } catch (e) { return null; }
  }

  function startPoll() {
    clearInterval(poll);
    poll = setInterval(async () => {
      const r = await refresh();
      if (r && !r.status.running) { clearInterval(poll); poll = null; }
    }, 1500);
  }

  async function doSearch(q) {
    if (!resultsEl) return;
    clear(resultsEl);
    if (!q.trim()) return;
    try {
      const r = await api('GET', '/api/files/search?q=' + encodeURIComponent(q));
      if (!r.hits.length) { resultsEl.appendChild(h('p', { class: 'muted', text: 'Nothing found. Try other words, or add the folder that holds it.' })); return; }
      for (const hit of r.hits) {
        resultsEl.appendChild(h('div', { class: 'hit' }, h('div', { class: 'hit-top' }, icon(hit.lib ? 'book' : 'file'), h('code', { text: (hit.lib ? 'Library: ' : '') + hit.path.replace(/^\d+\s*/, '').replace(/\.txt$/, '') }), h('small', { class: 'muted', text: 'part ' + (hit.chunk + 1) + ' of ' + hit.of })), h('p', { text: hit.text })));
      }
    } catch (e) { resultsEl.appendChild(h('p', { class: 'muted', text: e.message })); }
  }

  const SHELF_ICON = { 'Founding Documents': 'shield', 'Bible': 'book', 'Survival and Preparedness': 'flame', 'Medical and Health': 'pulse', 'Food and Homesteading': 'leaf', 'Communications and Navigation': 'wifioff', 'Energy and Infrastructure': 'bolt', 'Financial Sovereignty': 'coin', 'Faith and History': 'book', 'Kids': 'star' };

  async function loadShelf() {
    if (!shelfEl) return;
    try {
      const r = await api('GET', '/api/library');
      if (!shelfEl) return;
      clear(shelfEl);
      const st = r.status;
      shelfEl.appendChild(h('p', { class: 'muted small', text: st.running ? 'Getting the shelves ready… (one time only)' : r.stats.docs + ' books and documents · ' + r.stats.chunks.toLocaleString() + ' passages · included with Liberty AI, public domain' }));
      const grid = h('div', { class: 'shelf-grid' });
      for (const c of r.categories) {
        grid.appendChild(h('details', { class: 'shelf' }, h('summary', null, icon(SHELF_ICON[c.label] || 'folder'), h('span', { text: c.label }), h('small', { class: 'muted', text: c.docs.length + (c.docs.length === 1 ? ' book' : ' books') })),
          h('ul', { class: 'plain small' }, c.docs.map((d) => h('li', { text: d })))));
      }
      shelfEl.appendChild(grid);
      shelfEl.appendChild(h('p', { class: 'muted small', text: 'Medical, security, maps and more come from your own folders below, and the big Wikipedia-style shelf comes from Kiwix. The starter books here are classics, so for current medical advice always see a doctor.' }));
      if (st.running) setTimeout(loadShelf, 3000);
    } catch (e) { /* ignore */ }
  }

  function paintKiwix() {
    if (!kiwixEl) return;
    clear(kiwixEl);
    const cur = (S.state && S.state.settings.kiwix && S.state.settings.kiwix.url) || '';
    const url = h('input', { class: 'input', value: cur, placeholder: 'http://kiwix-serve_server_1:8080' });
    const out = h('p', { class: 'muted small' });
    kiwixEl.appendChild(h('p', { class: 'muted', text: 'Like the Liberty Drive, Liberty AI can read Wikipedia, WikiMed, MedlinePlus and other reference sets through Kiwix. Install a Kiwix server on your Umbrel, add the reference books you want, then enter its address here.' }));
    kiwixEl.appendChild(h('div', { class: 'row gap' }, url,
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        try {
          await api('PUT', '/api/settings', { kiwix: { url: url.value } });
          await LA.refreshState();
          if (!url.value.trim()) { out.textContent = 'Kiwix is off.'; return; }
          out.textContent = 'Checking…';
          const r = await api('POST', '/api/kiwix/test', {});
          out.textContent = 'Connected. Books found: ' + (r.books.length ? r.books.slice(0, 6).join(', ') : 'none yet');
        } catch (e) { out.textContent = e.message; }
      } }, 'Save and test')));
    kiwixEl.appendChild(out);
  }

  function render(into) {
    shelfEl = h('div', { class: 'shelf-wrap' });
    kiwixEl = h('div', { class: 'kiwix' });
    pickerEl = h('div', { class: 'picker' });
    listEl = h('div', { class: 'folders' });
    statusEl = h('div', { class: 'status' });
    resultsEl = h('div', { class: 'results' });
    const q = h('input', { class: 'input', placeholder: 'Try a search, e.g. insurance renewal', onkeydown: (e) => { if (e.key === 'Enter') doSearch(q.value); } });
    host = h('div', { class: 'files' },
      h('div', { class: 'card glass' }, h('h3', { text: 'Built-in library' }), shelfEl),
      h('div', { class: 'card glass' }, h('h3', { text: 'Wikipedia and reference (Kiwix)' }), kiwixEl),
      h('div', { class: 'card glass' }, h('h3', { text: 'Your own folders' }), listEl, statusEl,
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn small', type: 'button', onclick: async () => { await api('POST', '/api/files/scan', {}); startPoll(); refresh(); } }, icon('refresh'), 'Read again'),
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await api('POST', '/api/files/clear', {}); refresh(); toast('Index cleared'); } }, icon('trash'), 'Forget everything'))),
      h('div', { class: 'card glass' }, h('h3', { text: 'Choose a folder' }), pickerEl),
      h('div', { class: 'card glass' }, h('h3', { text: 'Try a search' }), h('div', { class: 'row gap' }, q, h('button', { class: 'btn', type: 'button', onclick: () => doSearch(q.value) }, icon('send'), 'Search')), resultsEl));
    into.appendChild(h('section', { class: 'page' },
      h('div', { class: 'page-head' }, h('h2', { text: 'Library' }),
        h('p', { class: 'muted', text: 'Your offline library, like the Liberty Drive. A starter shelf of books is built in. Add your own manuals, guides and family papers from folders on your Umbrel (for example one called Liberty Library), and connect Kiwix for Wikipedia-sized reference. I search them with no internet, and read-only: I can never change a file. I read text, Word, PDF, ebooks, slides and spreadsheets, not photos, music or video.' })),
      host));
    browse = '';
    loadPicker();
    loadShelf();
    paintKiwix();
    refresh().then((r) => { if (r && r.status.running) startPoll(); });
  }

  LA.pages.files = { render, leave() { clearInterval(poll); poll = null; host = pickerEl = listEl = statusEl = resultsEl = shelfEl = kiwixEl = null; } };
})();
