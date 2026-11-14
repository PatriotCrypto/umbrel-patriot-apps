'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: { 'X-AG': '1' } };
  if (opts.body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const r = await fetch(path, o);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
const fmtBytes = (n) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (n >= 100 || i === 0 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i]; };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const show = (id, on = true) => { $(id).hidden = !on; };
const note = (id, msg) => { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; };

// ---------- theme ----------
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t); lsSet('ag.theme', t);
  document.querySelectorAll('#themes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)));
}
document.querySelectorAll('#themes button').forEach((b) => b.addEventListener('click', () => { applyTheme(b.dataset.themeSet); if (ST) renderDrive(); }));
applyTheme(lsGet('ag.theme') || 'auto');
function applySkin(k) {
  const classic = k === 'classic';
  document.documentElement.setAttribute('data-skin', classic ? 'classic' : 'modern'); lsSet('ag.skin', classic ? 'classic' : 'modern');
  $('cssModern').disabled = classic; $('cssClassic').disabled = !classic; $('sSkin').value = classic ? 'classic' : 'modern';
}
$('sSkin').addEventListener('change', () => applySkin($('sSkin').value));
applySkin(lsGet('ag.skin') === 'classic' ? 'classic' : 'modern');

// ---------- the drive picture ----------
function fmtEta(sec) {
  if (sec == null) return '';
  if (sec < 60) return 'under 1 min left';
  const m = Math.round(sec / 60);
  if (m < 60) return `about ${m} min left`;
  const h = Math.floor(m / 60), r = m % 60;
  return `about ${h} h ${String(r).padStart(2, '0')} min left`;
}
function fitDrive() { const dv = $('dv'); const w = dv.clientWidth || 460; dv.style.setProperty('--s', String(Math.min(1, w / 460))); }
window.addEventListener('resize', fitDrive);
function renderDrive() {
  fitDrive();
  const s = ST, j = s.current, d = s.drives[0], dv = $('dv');
  let mode = 'idle', text = 'No drive', eta = '', pct = null, busy = false;
  const open = !!(d && d.tray === 'open');
  if (d) {
    text = open ? 'Tray open' : d.present ? 'Disc loaded' : 'Ready';
    if (j) {
      const st = j.stage;
      if (st === 'ripping') { mode = 'work'; text = 'Ripping'; pct = j.progress; eta = j.etaSec != null ? fmtEta(j.etaSec) : (j.progress > 0 ? 'estimating time…' : ''); }
      else if (st === 'reading' || st === 'identifying') { mode = 'work'; text = st === 'reading' ? 'Reading disc' : 'Identifying'; busy = true; }
      else if (st === 'saving') { mode = 'work'; text = 'Saving'; pct = 100; }
      else if (st === 'needs_confirm') { mode = 'wait'; text = 'Needs your OK'; }
      else if (st === 'done') { mode = 'done'; text = 'Finished'; pct = 100; }
      else if (st === 'error') { mode = 'bad'; text = 'Problem'; }
    }
  }
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (document.documentElement.getAttribute('data-theme') === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  window.__dv = { open, disc: !!(d && d.present), mode, text, eta, pct, busy, dark };
  if (window.DiscDrive) window.DiscDrive.set(window.__dv);
  dv.dataset.tray = open ? 'open' : 'closed';
  dv.dataset.mode = mode;
  dv.dataset.disc = d && d.present ? '1' : '0';
  $('dvState').textContent = text; $('dvEta').textContent = eta;
  dv.classList.toggle('busy', busy);
  $('dvFill').style.transform = `scaleX(${busy || pct == null ? 0 : Math.max(0, Math.min(100, pct)) / 100})`;
  $('dvPct').textContent = pct != null && mode !== 'done' ? Math.round(pct) + '%' : '';
  $('dvLabel').setAttribute('aria-label', `DVD drive: ${text}${eta ? ', ' + eta : ''}${pct != null ? ', ' + Math.round(pct) + ' percent' : ''}`);
}

let ST = null;          // last /api/state
let cfJob = null;       // job id the confirm form was built for
const CF = { kind: 'movie', showId: null, showName: '', year: '', picked: new Set(), eps: [], names: {}, poster: '', posters: {} };

// ---------- status ----------
const STAGE_TEXT = { reading: 'Reading the disc', identifying: 'Working out what this disc is', needs_confirm: 'Waiting for your OK', ripping: 'Ripping', saving: 'Saving', done: 'All done', error: 'Something went wrong' };
function renderStatus() {
  renderDrive();
  const s = ST, j = s.current, d = s.drives[0];
  const icon = $('discIcon');
  icon.classList.toggle('spin', !!j && ['reading', 'identifying', 'ripping', 'saving'].includes(j.stage));
  icon.classList.toggle('on', !!(d && d.present) || !!j);
  $('stopBtn').hidden = true; $('ejectBtn').hidden = true; $('retryBtn').hidden = true; show('jobBox', false); show('discDetails', !!j);
  if (j) {
    const L = [`Label: ${j.label || '(none)'}`, ...(j.rawLabel && j.rawLabel !== j.label ? [`Drive label: ${j.rawLabel}`] : []), ...(j.discName && j.discName !== j.label ? [`MakeMKV name: ${j.discName}`] : []), `Looks like: ${j.kind === 'tv' ? 'TV episodes' : j.kind === 'movies' ? 'several movies' : 'a movie'}${j.suggested && j.suggested.reason ? ' (' + j.suggested.reason + ')' : ''}`, `Saved as: ${j.name || '(not decided yet)'}`, '', `Titles found (${(j.titles || []).length}):`];
    for (const t of (j.titles || [])) L.push(`  ${t.id + 1}. ${t.durText}  ${t.sizeText}${t.chapters ? '  ' + t.chapters + ' ch' : ''}`);
    $('ddBody').textContent = L.join('\n');
  }
  if (!d) { $('stTitle').textContent = 'No drive found'; $('stSub').textContent = 'Plug a USB DVD drive into your Umbrel. If it is already plugged in, open Settings and press Check drive.'; return; }
  if (!j) {
    $('stTitle').textContent = d.present ? 'Disc detected' : 'Ready for a disc';
    $('stSub').textContent = d.present ? 'Reading it in a moment…' : 'Put a DVD in the drive. Ripping starts on its own.';
    $('ejectBtn').hidden = !d.present; return;
  }
  const name = j.label ? j.label.replace(/_/g, ' ') : 'Disc';
  $('stTitle').textContent = j.stage === 'done' ? 'Done: ' + (j.name || name) : STAGE_TEXT[j.stage] || j.stage;
  $('stSub').textContent = j.stage === 'error' ? j.error + (j.ejected || j.error === 'Stopped.' ? '' : ' The disc is still in the drive: press Try again, or Eject.') : (j.stage === 'done' ? j.message : (j.message || name));
  const active = ['reading', 'identifying', 'ripping', 'saving', 'needs_confirm'].includes(j.stage);
  $('stopBtn').hidden = !active; $('ejectBtn').hidden = active || j.ejected; $('retryBtn').hidden = j.stage !== 'error' || j.ejected || j.error === 'Stopped.';
  if (['ripping', 'saving', 'done'].includes(j.stage) || j.outputs.length) {
    show('jobBox');
    $('pbar').classList.toggle('done', j.stage === 'done');
    $('pbar').firstElementChild.style.width = (j.stage === 'done' ? 100 : j.progress) + '%';
    $('pText').textContent = j.stage === 'done' ? '' : `${j.progress}%` + (j.bytesTotal ? ` · ${fmtBytes(j.bytesDone)} of about ${fmtBytes(j.bytesTotal)}` : '') + (j.stage === 'ripping' && j.etaSec != null ? ` · ${fmtEta(j.etaSec)}` : '') + (j.phase && j.stage === 'ripping' ? ` · ${j.phase}` : '');
    $('outs').innerHTML = j.outputs.map((o) => `<div><span class="ck ${o.done ? 'ok' : ''}">${o.done ? '✓' : '•'}</span><span>${esc(o.name)}${o.note ? ' <span class="muted">(' + esc(o.note) + ')</span>' : ''}</span></div>`).join('');
  }
  note('jobNote', j.autoNote);
}

// ---------- confirm form ----------
function setKind(k) {
  CF.kind = k;
  document.querySelectorAll('#cfKind button').forEach((b) => { b.classList.toggle('on', b.dataset.k === k); b.setAttribute('aria-selected', String(b.dataset.k === k)); });
  show('cfMovie', k === 'movie'); show('cfTv', k === 'tv'); renderSeriesChips();
  $('cfQLabel').textContent = k === 'tv' ? 'Find the TV show' : k === 'movies' ? 'Look up a movie name (fills the first empty name below)' : 'Find the movie';
  $('cfTitlesLabel').textContent = k === 'tv' ? 'Which titles are episodes? They are numbered in this order.' : k === 'movies' ? 'Tick each movie on the disc and give it a name.' : 'Which title is the movie?';
  $('cfCands').innerHTML = '';
  renderTitles();
}
function renderSeriesChips() {
  const list = (ST && ST.series) || [], box = $('cfSeriesList');
  show('cfSeries', CF.kind === 'tv' && list.length > 0);
  box.innerHTML = '';
  for (const s of list) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cand'; b.dataset.id = s.showId;
    if (String(CF.showId) === String(s.showId)) b.classList.add('on');
    const cov = s.poster && String(s.poster).startsWith('/api/poster?u=') ? `<img alt="" src="${esc(s.poster)}">` : '<img alt="">';
    b.innerHTML = `${cov}<span><b>${esc(s.showName)}${s.year ? ' (' + esc(s.year) + ')' : ''}</b><small>Last ripped: Season ${s.season}, up to episode ${Math.max(0, s.nextEp - 1)}</small></span>`;
    b.onclick = () => pickSeries(s);
    box.appendChild(b);
  }
}
async function pickSeries(s) {
  note('cfErr', '');
  try {
    const n = await api(`/api/series/next?showId=${encodeURIComponent(s.showId)}`);
    CF.showId = s.showId; CF.showName = s.showName; CF.year = s.year || ''; CF.poster = s.poster || '';
    $('cfSeason').value = n.season; $('cfStart').value = n.start; $('cfQ').value = s.showName;
    renderSeriesChips(); loadEps();
  } catch (ex) { note('cfErr', ex.message); }
}
function renderTitles() {
  const j = ST.current; if (!j) return;
  const box = $('cfTitles'); box.innerHTML = '';
  const tv = CF.kind === 'tv', multi = CF.kind !== 'movie';
  const start = parseInt($('cfStart').value, 10) || 1;
  const chosen = j.titles.filter((t) => CF.picked.has(t.id));
  for (const t of j.titles) {
    const l = document.createElement('label');
    const i = document.createElement('input'); i.type = multi ? 'checkbox' : 'radio'; i.name = 'ttl'; i.checked = CF.picked.has(t.id);
    i.onchange = () => { if (!multi) CF.picked = new Set([t.id]); else (i.checked ? CF.picked.add(t.id) : CF.picked.delete(t.id)); renderTitles(); };
    l.appendChild(i);
    const idx = chosen.findIndex((x) => x.id === t.id);
    let map = '';
    if (tv && idx >= 0) { const n = start + idx; const ep = CF.eps.find((e) => e.number === n); map = `Episode ${n}${ep ? ': ' + ep.name : ''}`; }
    l.insertAdjacentHTML('beforeend', `<span class="tt">${esc(t.durText)} &middot; ${esc(t.sizeText)}<small>Title ${t.id + 1}${t.chapters ? ' &middot; ' + t.chapters + ' chapters' : ''}</small></span><span class="map">${esc(map)}</span>`);
    if (CF.kind === 'movies' && CF.picked.has(t.id)) {
      const n = document.createElement('input'); n.type = 'text'; n.className = 'mname'; n.maxLength = 150; n.placeholder = 'Movie Name (Year)'; n.setAttribute('aria-label', `Name for title ${t.id + 1}`);
      n.value = CF.names[t.id] || ''; n.addEventListener('input', () => { CF.names[t.id] = n.value; });
      l.appendChild(n);
    }
    box.appendChild(l);
  }
}
async function loadEps() {
  CF.eps = [];
  if (CF.kind === 'tv' && CF.showId) { try { CF.eps = (await api(`/api/tv/episodes?showId=${encodeURIComponent(CF.showId)}&season=${parseInt($('cfSeason').value, 10) || 1}`)).episodes; } catch {} }
  renderTitles();
}
function fillMovieName(v, poster) {
  const ids = [...CF.picked]; const id = ids.find((i) => !(CF.names[i] || '').trim()); if (id == null) return;
  CF.names[id] = v; CF.posters[id] = poster || ''; renderTitles();
}
function renderCands(list, onPick) {
  const box = $('cfCands'); box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p class="muted small">No matches. Try fewer words, or type the name yourself.</p>'; return; }
  for (const c of list) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cand';
    b.innerHTML = `<img alt="" ${c.poster ? `src="${esc(c.poster)}"` : ''}><span><b>${esc(c.title)}</b><small>${esc(c.year || '')}</small></span>`;
    b.onclick = () => { box.querySelectorAll('.cand').forEach((x) => x.classList.toggle('on', x === b)); onPick(c); };
    box.appendChild(b);
  }
}
async function runSearch() {
  const q = $('cfQ').value.trim(); if (q.length < 2) return;
  note('cfErr', ''); $('cfCands').innerHTML = '<p class="muted small">Searching…</p>';
  try {
    const r = await api(`/api/find/${CF.kind === 'tv' ? 'tv' : 'movie'}?q=${encodeURIComponent(q)}`);
    renderCands(r.results, (c) => {
      if (CF.kind === 'tv') { CF.showId = c.id; CF.showName = c.title; CF.year = c.year; CF.poster = c.poster || ''; loadEps(); }
      else if (CF.kind === 'movies') fillMovieName(`${c.title} (${c.year})`, c.poster);
      else { $('cfName').value = `${c.title} (${c.year})`; CF.poster = c.poster || ''; }
    });
  } catch (ex) { $('cfCands').innerHTML = ''; note('cfErr', ex.message); }
}
function buildConfirm(j) {
  const sug = j.suggested || {};
  CF.picked = new Set(sug.titleIds || []);
  CF.eps = [];
  $('cfWhy').textContent = `This disc is called “${j.label || 'unnamed'}”. ${sug.reason || ''} Check the details, then press Rip this disc.`;
  const tv = sug.tv, mv = sug.movie;
  CF.names = {}; CF.posters = {}; CF.poster = (sug.kind === 'tv' ? tv && tv.poster : mv && mv.poster) || '';
  for (const m of sug.movies || []) { CF.names[m.titleId] = m.name; CF.posters[m.titleId] = m.poster || ''; }
  CF.showId = tv && tv.showId; CF.showName = tv ? tv.showName : ''; CF.year = tv ? tv.year : '';
  $('cfSeason').value = tv ? tv.season : (j.parsed && j.parsed.season) || 1;
  $('cfStart').value = tv ? tv.startEp : 1;
  $('cfName').value = mv ? mv.name : '';
  $('cfQ').value = (j.parsed && j.parsed.title) || '';
  setKind(['tv', 'movies'].includes(sug.kind) ? sug.kind : 'movie');
  const cands = (sug.kind === 'tv' ? tv && tv.candidates : mv && mv.candidates) || [];
  if (cands.length) renderCands(cands, (c) => { if (CF.kind === 'tv') { CF.showId = c.id; CF.showName = c.title; CF.year = c.year; CF.poster = c.poster || ''; loadEps(); } else { $('cfName').value = `${c.title} (${c.year})`; CF.poster = c.poster || ''; } });
  if (sug.kind === 'tv' && CF.showId) loadEps();
  note('cfErr', '');
}
document.querySelectorAll('#cfKind button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.k === CF.kind) return;
  const j = ST.current;
  if (j && j.suggested) { const ids = new Set(); if (b.dataset.k === 'movie') { const best = [...j.titles].sort((a, c) => c.seconds - a.seconds)[0]; if (best) ids.add(best.id); } else if (b.dataset.k === 'movies') j.titles.filter((t) => t.seconds >= 2700).forEach((t) => ids.add(t.id)); else j.titles.filter((t) => t.seconds >= 480 && t.seconds <= 4500).forEach((t) => ids.add(t.id)); CF.picked = ids; }
  setKind(b.dataset.k);
}));
$('cfSearch').addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
$('cfSeason').addEventListener('change', loadEps);
$('cfStart').addEventListener('input', renderTitles);
$('cfGo').addEventListener('click', async () => {
  note('cfErr', ''); const b = $('cfGo'); b.disabled = true;
  try {
    const body = { kind: CF.kind, titleIds: [...CF.picked] };
    if (CF.kind === 'tv') body.tv = { showId: CF.showId, showName: CF.showName, year: CF.year, season: $('cfSeason').value, startEp: $('cfStart').value, poster: CF.poster };
    else if (CF.kind === 'movies') { body.movies = Object.fromEntries([...CF.picked].map((id) => [id, CF.names[id] || ''])); body.posters = Object.fromEntries([...CF.picked].map((id) => [id, CF.posters[id] || ''])); }
    else body.movie = { name: $('cfName').value, poster: CF.poster };
    await api('/api/confirm', { method: 'POST', body });
    poll();
  } catch (ex) { note('cfErr', ex.message); }
  b.disabled = false;
});
$('cfSkip').addEventListener('click', async () => { try { await api('/api/skip', { method: 'POST' }); poll(); } catch (ex) { note('cfErr', ex.message); } });
$('stopBtn').addEventListener('click', async () => { if (!confirm('Stop and eject this disc?')) return; try { await api('/api/skip', { method: 'POST' }); poll(); } catch {} });
$('retryBtn').addEventListener('click', async () => { try { await api('/api/retry', { method: 'POST' }); poll(); } catch (ex) { $('stSub').textContent = ex.message; } });
$('ejectBtn').addEventListener('click', async () => { try { await api('/api/eject', { method: 'POST' }); poll(); } catch (ex) { $('stSub').textContent = ex.message; } });

// ---------- history ----------
function renderHistory() {
  const h = ST.history;
  $('hist').innerHTML = h.length ? '' : '<p class="muted">Nothing yet. Put a DVD in the drive.</p>';
  $('histClear').hidden = !h.length;
  for (const x of h) {
    const el = document.createElement('div'); el.className = 'hrow';
    const when = new Date(x.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const detail = x.status === 'done' ? `${x.files.length} file${x.files.length === 1 ? '' : 's'} saved · ${when}` : `${x.status === 'skipped' ? 'Skipped' : 'Failed'} · ${when}`;
    const poster = x.poster && String(x.poster).startsWith('/api/poster?u=') ? x.poster : '';
    const cov = poster ? `<img alt="" loading="lazy" src="${esc(poster)}">` : '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="5"/></svg>';
    el.innerHTML = `<div class="hcov">${cov}</div><div class="hmeta"><b>${esc(x.name || (x.label || 'Disc').replace(/_/g, ' '))}</b><small class="${x.status === 'error' ? 'bad' : ''}">${esc(detail)}${x.status === 'error' && x.error ? ' · ' + esc(x.error) : ''}</small>${x.note ? `<small>${esc(x.note)}</small>` : ''}</div>`;
    if (x.status === 'done' && x.kind === 'movie' && x.files && x.files.length === 1) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small rn'; b.textContent = 'Rename';
      b.addEventListener('click', async () => {
        const nn = prompt('New name for this movie, e.g. Movie Name (2020):', x.name || '');
        if (!nn || nn.trim() === x.name) return;
        try { await api('/api/history/rename', { method: 'POST', body: { id: x.id, name: nn } }); poll(); } catch (ex) { alert(ex.message); }
      });
      el.querySelector('.hmeta').appendChild(b);
    }
    $('hist').appendChild(el);
  }
}

function renderSeries() {
  const list = ST.series || [];
  show('seriesCard', list.length > 0);
  $('seriesRows').innerHTML = '';
  for (const s of list) {
    const el = document.createElement('div'); el.className = 'hrow';
    const poster = s.poster && String(s.poster).startsWith('/api/poster?u=') ? s.poster : '';
    const cov = poster ? `<img alt="" loading="lazy" src="${esc(poster)}">` : '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="5"/></svg>';
    el.innerHTML = `<div class="hcov">${cov}</div><div class="hmeta"><b>${esc(s.showName)}${s.year ? ' (' + esc(s.year) + ')' : ''}</b><small>Last ripped: Season ${s.season}, up to episode ${Math.max(0, s.nextEp - 1)}${s.disc ? ' · disc ' + s.disc : ''}</small><small>The next disc starts at episode ${s.nextEp} unless it is a new season.</small></div>`;
    const row = document.createElement('div'); row.className = 'rn';
    const fix = document.createElement('button'); fix.type = 'button'; fix.className = 'btn small'; fix.textContent = 'Fix place';
    fix.addEventListener('click', async () => {
      const se = prompt(`${s.showName}: which season is next?`, String(s.season)); if (se === null) return;
      const ep = prompt(`${s.showName}: which episode number does the next disc start at?`, String(s.nextEp)); if (ep === null) return;
      try { await api('/api/series/set', { method: 'POST', body: { showId: s.showId, season: se, nextEp: ep } }); poll(); } catch (ex) { alert(ex.message); }
    });
    const del = document.createElement('button'); del.type = 'button'; del.className = 'btn small'; del.textContent = 'Forget'; del.style.marginLeft = '8px';
    del.addEventListener('click', async () => {
      if (!confirm(`Forget where ${s.showName} left off? Your ripped files are not touched.`)) return;
      try { await api('/api/series/forget', { method: 'POST', body: { showId: s.showId } }); poll(); } catch (ex) { alert(ex.message); }
    });
    row.append(fix, del); el.querySelector('.hmeta').appendChild(row);
    $('seriesRows').appendChild(el);
  }
}

$('histClear').addEventListener('click', async () => {
  if (!confirm('Clear the recently ripped list? Your ripped files are not touched.')) return;
  try { await api('/api/history/clear', { method: 'POST' }); poll(); } catch {}
});

// ---------- settings ----------
let setsLoaded = false;
function renderSettings() {
  const s = ST.settings;
  if (!setsLoaded || !$('settings').open) {
    $('sAuto').value = s.auto ? 'auto' : 'ask'; $('sEject').checked = s.eject; $('sAutoKey').checked = s.autoKey;
    $('sRoot').innerHTML = ST.roots.map((r) => `<option value="${esc(r.id)}" ${r.id === s.root ? 'selected' : ''} ${r.available && r.writable ? '' : 'disabled'}>${esc(r.label)}${r.available && r.writable ? '' : ' (not available)'}</option>`).join('');
    $('sMovies').value = s.movieDir; $('sTv').value = s.tvDir; setsLoaded = true;
    const n = s.ntfy; $('nOn').checked = n.on; $('nServer').value = n.server; $('nTopic').value = n.topic; $('nUser').value = n.user; $('nPass').value = '';
    $('nDone').checked = n.events.done; $('nConfirm').checked = n.events.confirm; $('nError').checked = n.events.error; $('nStart').checked = n.events.start; showNtfy();
  }
  $('nPassState').textContent = s.ntfy.passSet ? 'A password or token is saved. Leave blank to keep it.' : '';
  $('keyState').textContent = s.keySet ? `A key is saved (${s.keyTail}).` : 'No key yet. Press “Get the free beta key” to fetch one.';
}
async function saveSettings(extra) {
  note('sMsg', '');
  const body = { auto: $('sAuto').value === 'auto', eject: $('sEject').checked, autoKey: $('sAutoKey').checked, root: $('sRoot').value, movieDir: $('sMovies').value, tvDir: $('sTv').value, ntfy: ntfyBody(), ...extra };
  try { await api('/api/settings', { method: 'POST', body }); $('sMsg').textContent = 'Saved.'; setsLoaded = false; await poll(); } catch (ex) { $('sMsg').textContent = ex.message; }
}
$('sSave').onclick = () => saveSettings();
// ---------- phone notifications ----------
function ntfyBody() {
  const b = { on: $('nOn').checked, server: $('nServer').value.trim() || 'https://ntfy.sh', topic: $('nTopic').value.trim(), user: $('nUser').value.trim(), link: location.origin,
    events: { done: $('nDone').checked, confirm: $('nConfirm').checked, error: $('nError').checked, start: $('nStart').checked } };
  if ($('nPass').value) b.pass = $('nPass').value;
  return b;
}
function showNtfy() { $('nMore').hidden = !$('nOn').checked; }
$('nOn').addEventListener('change', showNtfy);
$('nCopy').onclick = async () => {
  const t = $('nTopic').value; let ok = false;
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); ok = true; } } catch {}
  if (!ok) { const ta = document.createElement('textarea'); ta.value = t; ta.className = 'offscreen'; document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch {} ta.remove(); }
  $('nCopy').textContent = ok ? 'Copied' : 'Select it'; setTimeout(() => { $('nCopy').textContent = 'Copy'; }, 1800);
};
$('nNewTopic').onclick = async () => {
  if (!confirm('Make a new topic? Your phone will need to subscribe to the new one.')) return;
  try { const r = await api('/api/ntfy/topic', { method: 'POST' }); $('nTopic').value = r.settings.ntfy.topic; } catch (ex) { $('nMsg').textContent = ex.message; }
};
$('nTest').onclick = async () => {
  const b = $('nTest'); b.disabled = true; $('nMsg').textContent = 'Saving and sending…';
  try { await api('/api/settings', { method: 'POST', body: { ntfy: ntfyBody() } }); await api('/api/ntfy/test', { method: 'POST' }); $('nMsg').textContent = 'Sent. Check your phone.'; setsLoaded = false; }
  catch (ex) { $('nMsg').textContent = ex.message; }
  b.disabled = false;
};
$('keySave').onclick = () => { const k = $('sKey').value.trim(); if (!k) { $('sMsg').textContent = 'Paste a key first.'; return; } saveSettings({ key: k }).then(() => { $('sKey').value = ''; }); };
$('keyFetch').onclick = async () => { $('sMsg').textContent = 'Fetching…'; try { await api('/api/key/fetch', { method: 'POST' }); $('sMsg').textContent = 'Saved the current free beta key.'; setsLoaded = false; poll(); } catch (ex) { $('sMsg').textContent = ex.message; } };
$('checkBtn').onclick = async () => {
  const out = $('checkOut'); out.hidden = false; out.textContent = 'Checking…';
  try {
    const r = await api('/api/check', { method: 'POST' });
    const lines = [];
    lines.push(`Optical drive entries: ${r.opticalNodes.length ? r.opticalNodes.join(', ') : 'none'}`);
    lines.push(`SCSI generic entries: ${r.scsiNodes.length ? r.scsiNodes.join(', ') : 'none'}`);
    for (const p of r.probes) lines.push(`${p.dev}: ${p.present ? 'disc "' + (p.label || 'no name') + '"' : 'no readable disc'}`);
    lines.push(r.makemkv.version ? r.makemkv.version : 'MakeMKV: no response');
    lines.push(r.makemkv.drives.length ? 'MakeMKV sees: ' + r.makemkv.drives.map((d) => `${d.name}${d.disc ? ' (' + d.disc + ')' : ''}`).join('; ') : 'MakeMKV sees no drive');
    if (r.makemkv.note) lines.push('MakeMKV says: ' + r.makemkv.note);
    lines.push(`Library: ${r.library.label}, ${r.library.available ? (r.library.writable ? 'writable' : 'read-only') : 'not connected'}${r.library.free ? ', ' + r.library.free + ' free' : ''}`);
    lines.push(`MakeMKV key: ${r.keySet ? 'saved' : 'not set'}`);
    if (!r.opticalNodes.length) lines.push('\nNo drive was found. Check that the drive is plugged in and powered. Slim USB DVD drives often need a second USB port or a powered hub.');
    else if (!r.scsiNodes.length) lines.push('\nThe drive shows up but its SCSI entry is missing. Try unplugging and replugging it.');
    out.textContent = lines.join('\n');
  } catch (ex) { out.textContent = ex.message; }
};

// ---------- polling ----------
let timer = null;
async function poll() {
  clearTimeout(timer);
  try {
    ST = await api('/api/state');
    const usable = ST.roots.find((r) => r.id === ST.settings.root && r.available && r.writable);
    if (!usable) { show('setup'); $('setup').innerHTML = '<b>One quick setup step.</b> This app cannot write to your library yet. In Umbrel, right-click Disc Ripper, choose <b>Settings</b>, then under <b>Storage &gt; Access to your folders</b> pick your Media folder with read and write access, and apply the changes.'; } else show('setup', false);
    renderStatus(); renderHistory(); renderSeries(); renderSettings();
    const j = ST.current;
    if (j && j.stage === 'needs_confirm') { show('confirmCard'); if (cfJob !== j.id) { cfJob = j.id; buildConfirm(j); $('confirmCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
    else { show('confirmCard', false); if (!j || j.id !== cfJob) cfJob = null; }
  } catch (ex) { $('stTitle').textContent = 'Lost contact with the app'; $('stSub').textContent = ex.message; }
  timer = setTimeout(poll, ST && ST.current && ['reading', 'identifying', 'ripping', 'saving'].includes(ST.current.stage) ? 1500 : 3000);
}
poll();
