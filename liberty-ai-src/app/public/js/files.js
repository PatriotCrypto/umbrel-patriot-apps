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
        resultsEl.appendChild(h('div', { class: 'hit' }, h('div', { class: 'hit-top' }, icon('file'), h('code', { text: hit.path }), h('small', { class: 'muted', text: 'part ' + (hit.chunk + 1) + ' of ' + hit.of })), h('p', { text: hit.text })));
      }
    } catch (e) { resultsEl.appendChild(h('p', { class: 'muted', text: e.message })); }
  }

  function render(into) {
    pickerEl = h('div', { class: 'picker' });
    listEl = h('div', { class: 'folders' });
    statusEl = h('div', { class: 'status' });
    resultsEl = h('div', { class: 'results' });
    const q = h('input', { class: 'input', placeholder: 'Try a search, e.g. insurance renewal', onkeydown: (e) => { if (e.key === 'Enter') doSearch(q.value); } });
    host = h('div', { class: 'files' },
      h('div', { class: 'card glass' }, h('h3', { text: 'Folders Liberty AI may search' }), listEl, statusEl,
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn small', type: 'button', onclick: async () => { await api('POST', '/api/files/scan', {}); startPoll(); refresh(); } }, icon('refresh'), 'Read again'),
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await api('POST', '/api/files/clear', {}); refresh(); toast('Index cleared'); } }, icon('trash'), 'Forget everything'))),
      h('div', { class: 'card glass' }, h('h3', { text: 'Choose a folder' }), pickerEl),
      h('div', { class: 'card glass' }, h('h3', { text: 'Try a search' }), h('div', { class: 'row gap' }, q, h('button', { class: 'btn', type: 'button', onclick: () => doSearch(q.value) }, icon('send'), 'Search')), resultsEl));
    into.appendChild(h('section', { class: 'page' },
      h('div', { class: 'page-head' }, h('h2', { text: 'Library' }),
        h('p', { class: 'muted', text: 'Your offline library, like the Liberty Drive. Put manuals, guides, books and family papers in folders on your Umbrel (for example a folder called Liberty Library), then add them here. I search them with no internet, and read-only: I can never change a file. I read text, Word, PDF, ebooks, slides and spreadsheets, not photos, music or video.' })),
      host));
    browse = '';
    loadPicker();
    refresh().then((r) => { if (r && r.status.running) startPoll(); });
  }

  LA.pages.files = { render, leave() { clearInterval(poll); poll = null; host = pickerEl = listEl = statusEl = resultsEl = null; } };
})();
