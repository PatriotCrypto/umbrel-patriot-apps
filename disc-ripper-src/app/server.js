'use strict';
// Disc Ripper: insert a DVD, get a Jellyfin-ready file on your Umbrel, and the disc pops back out.
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const N = require('./lib/names');
const MK = require('./lib/mk');
const { classify } = require('./lib/classify');
const META = require('./lib/meta');
const DRV = require('./lib/drive');

const VERSION = '0.3.1';
const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data');
const ROOTS = [
  { id: 'media', label: 'Media', dir: path.resolve(process.env.MEDIA_DIR || '/media') },
  { id: 'downloads', label: 'Downloads', dir: path.resolve(process.env.DOWNLOADS_DIR || '/downloads') },
];
const MAKEMKV = process.env.MAKEMKVCON || 'makemkvcon';
const KEY_PAGE = process.env.MAKEMKV_KEY_URL || 'https://forum.makemkv.com/forum/viewtopic.php?t=1053';
const POLL_MS = parseInt(process.env.POLL_MS || '4000', 10);
const KEEP_FREE = 2 * 1024 ** 3;
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const MK_HOME = path.join(DATA_DIR, 'home');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(MK_HOME, '.MakeMKV'), { recursive: true });

const fmtErr = (e) => (e && e.message) || String(e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rootById = (id) => ROOTS.find((r) => r.id === id);

// ---------- settings, history, memory ----------
const DEFAULTS = { v: 2, auto: true, eject: true, root: 'media', movieDir: 'Movies', tvDir: 'TV Shows', key: '', autoKey: true };
let settings = { ...DEFAULTS };
let savedSettings = null;
try { savedSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); settings = { ...DEFAULTS, ...savedSettings }; } catch {}
let history = [];
try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
let memory = {};
try { memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch {}
const saveJson = (file, v) => { try { fs.writeFileSync(file + '.tmp', JSON.stringify(v)); fs.renameSync(file + '.tmp', file); } catch {} };
const saveSettings = () => saveJson(SETTINGS_FILE, settings);
function writeMkConf() {
  const lines = [];
  if (settings.key) lines.push(`app_Key = "${settings.key.replace(/[^A-Za-z0-9@_-]/g, '')}"`);
  try { fs.writeFileSync(path.join(MK_HOME, '.MakeMKV', 'settings.conf'), lines.join('\n') + '\n', { mode: 0o600 }); } catch {}
}
writeMkConf();
// 0.2.0: walk-away mode is now the default. Move earlier installs over once.
if (savedSettings && !(savedSettings.v >= 2)) { settings.v = 2; settings.auto = true; saveJson(SETTINGS_FILE, settings); }
const pubSettings = () => ({ auto: settings.auto, eject: settings.eject, root: settings.root, movieDir: settings.movieDir, tvDir: settings.tvDir, autoKey: settings.autoKey, keySet: !!settings.key, keyTail: settings.key ? '…' + settings.key.slice(-4) : '' });

function addHistory(h) { history.unshift({ id: crypto.randomBytes(5).toString('hex'), at: Date.now(), ...h }); history = history.slice(0, 60); saveJson(HISTORY_FILE, history); }

// ---------- destinations ----------
async function rootInfo(r) {
  try {
    const st = await fsp.stat(r.dir);
    if (!st.isDirectory()) return { id: r.id, label: r.label, available: false, writable: false };
    let writable = true; try { await fsp.access(r.dir, fs.constants.W_OK); } catch { writable = false; }
    return { id: r.id, label: r.label, available: true, writable };
  } catch { return { id: r.id, label: r.label, available: false, writable: false }; }
}
function relSegments(rel) {
  const segs = String(rel || '').split('/').map((s) => s.trim()).filter((s) => s && s !== '.');
  for (const s of segs) if (s === '..' || /[\u0000\\]/.test(s)) throw new Error('Invalid folder name.');
  return segs;
}
async function destDir(rel) {
  const root = rootById(settings.root) || ROOTS[0];
  const segs = relSegments(rel);
  const full = path.join(root.dir, ...segs);
  const realRoot = await fsp.realpath(root.dir).catch(() => { throw new Error(`The ${root.label} folder isn't connected to this app yet. Open this app's settings in Umbrel and give it access to your Media folder.`); });
  let probe = full;
  for (;;) {
    try { const rp = await fsp.realpath(probe); if (rp !== realRoot && !rp.startsWith(realRoot + path.sep)) throw new Error('Invalid folder.'); break; }
    catch (e) { if (e.code === 'ENOENT') { const up = path.dirname(probe); if (up === probe) throw new Error('Invalid folder.'); probe = up; } else throw e; }
  }
  return { root, full };
}
async function mkdirOwned(full, rootDir) {
  const owner = await fsp.stat(rootDir);
  const todo = []; let cur = full;
  while (cur !== rootDir && cur.startsWith(rootDir + path.sep)) {
    if (await fsp.stat(cur).then(() => true, () => false)) break;
    todo.unshift(cur); cur = path.dirname(cur);
  }
  for (const d of todo) { await fsp.mkdir(d); try { await fsp.chown(d, owner.uid, owner.gid); } catch {} }
}
async function chownLike(file, rootDir) { try { const o = await fsp.stat(rootDir); await fsp.chown(file, o.uid, o.gid); } catch {} }
async function moveFile(from, to) {
  try { await fsp.rename(from, to); } catch (e) { if (e.code !== 'EXDEV') throw e; await fsp.copyFile(from, to); await fsp.rm(from, { force: true }); }
}

// ---------- MakeMKV ----------
function runMakemkv(args, { onLine, signal, timeoutMs = 30 * 60e3 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(MAKEMKV, args, { env: { ...process.env, HOME: MK_HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '', buf = '', err = '';
    const kill = () => { try { p.kill('SIGTERM'); setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 4000); } catch {} };
    const timer = setTimeout(kill, timeoutMs);
    const onAbort = () => kill();
    signal && signal.addEventListener('abort', onAbort, { once: true });
    p.stdout.on('data', (c) => {
      const s = c.toString('utf8'); text += s; buf += s;
      let i; while ((i = buf.search(/\r|\n/)) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line && onLine) onLine(line); }
      if (text.length > 20e6) text = text.slice(-10e6);
    });
    p.stderr.on('data', (c) => { err += c.toString('utf8'); if (err.length > 20000) err = err.slice(-10000); });
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? 'MakeMKV is missing from this app.' : fmtErr(e))); });
    p.on('close', (code) => {
      clearTimeout(timer); signal && signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) return reject(new Error('canceled'));
      resolve({ code, text, err });
    });
  });
}

async function fetchBetaKey() {
  const res = await fetch(KEY_PAGE, { headers: { 'User-Agent': 'DiscRipper/' + VERSION }, signal: AbortSignal.timeout(20000) }).catch((e) => { throw new Error("Couldn't reach the MakeMKV forum: " + fmtErr(e)); });
  if (!res.ok) throw new Error(`The MakeMKV forum answered ${res.status}.`);
  const html = await res.text();
  const m = html.match(/<code>\s*(T-[A-Za-z0-9@_]{40,})\s*<\/code>/) || html.match(/\b(T-[A-Za-z0-9@_]{60,})\b/);
  if (!m) throw new Error("Couldn't find the free beta key on the MakeMKV forum. Paste a key in settings instead.");
  return m[1];
}
async function refreshKey() {
  const k = await fetchBetaKey();
  settings.key = k; saveSettings(); writeMkConf();
  return k;
}

// ---------- the disc watcher ----------
let current = null;          // the disc being worked on (or just finished)
let driveStates = [];
const trayRaw = new Map();   // dev -> open | closed | empty | notready | unknown, straight from the drive
const ejectHint = new Map(); // dev -> when this app last ejected the disc (a guess for drives that don't report their tray)
async function ejectDev(dev) { const r = await DRV.eject(dev); if (r.ok) ejectHint.set(dev, Date.now()); return r; }
// what the screen should show for a drive: is the tray out?
function trayView(dev, present) {
  const raw = trayRaw.get(dev) || 'unknown';
  if (raw === 'open') return { open: true, known: true };
  if (raw === 'closed' || raw === 'empty') return { open: false, known: true };
  if (present) return { open: false, known: false };
  const t = ejectHint.get(dev);
  return { open: !!(t && Date.now() - t < 10 * 60e3), known: false };
}
async function trayLoop() {
  try {
    for (const dev of await DRV.listDrives()) {
      if (isActive(current) && current.dev === dev && current.stage !== 'needs_confirm') { trayRaw.set(dev, 'closed'); continue; }
      trayRaw.set(dev, await DRV.trayState(dev));
    }
  } catch {}
  setTimeout(trayLoop, 1500);
}
const seen = new Map();      // dev -> { key, n } for debouncing
const handled = new Map();   // dev -> key already processed, until the disc leaves
let polling = false;
const TERMINAL = new Set(['done', 'error']);
const isActive = (j) => j && !TERMINAL.has(j.stage);

function setStage(job, stage, message) { job.stage = stage; if (TERMINAL.has(stage)) job.finishedAt = Date.now(); if (message !== undefined) job.message = message; }
function chk(job) { if (job.ctl.signal.aborted) throw new Error('canceled'); }

async function poll() {
  if (polling) return; polling = true;
  try {
    const devs = await DRV.listDrives();
    const states = [];
    if (isActive(current) && !devs.includes(current.dev)) { current.ctl.abort(); current.error = 'The drive was unplugged.'; }
    for (const dev of devs) {
      let st;
      if (isActive(current) && current.dev === dev) st = { present: true, label: current.label, type: current.fsType };
      else st = await DRV.probe(dev);
      if (st.present) ejectHint.delete(dev);
      states.push({ dev, present: !!st.present, label: st.label || '', detail: st.detail || '' });
      if (!st.present) {
        seen.delete(dev); handled.delete(dev);
        if (current && current.dev === dev && TERMINAL.has(current.stage)) { current.discGone = true; if (Date.now() - (current.finishedAt || 0) > 90e3) current = null; }
        continue;
      }
      const key = `${dev}|${st.label}|${st.type}`;
      if (current && TERMINAL.has(current.stage) && (current.key !== key || current.discGone)) current = null; // a different (or re-inserted) disc
      if (current) continue;
      if (handled.get(dev) === key) continue;
      const s = seen.get(dev);
      if (!s || s.key !== key) { seen.set(dev, { key, n: 1 }); continue; }
      if (++s.n >= 2) { handled.set(dev, key); startJob(dev, st, key); }
    }
    driveStates = states;
  } catch (e) { console.error('poll', fmtErr(e)); }
  polling = false;
}

function startJob(dev, st, key) {
  const job = { id: crypto.randomBytes(5).toString('hex'), dev, key, label: st.label || '', fsType: st.type || '', stage: 'reading', message: 'Reading the disc…', startedAt: Date.now(), progress: 0, ctl: new AbortController(), titles: [], suggested: null, outputs: [], files: [], error: '' };
  current = job;
  runJob(job).catch(async (e) => {
    const canceled = fmtErr(e) === 'canceled';
    job.error = job.error || (canceled ? 'Stopped.' : fmtErr(e)); setStage(job, 'error', '');
    addHistory({ label: job.label, kind: job.kind || '', name: job.name || '', status: canceled ? 'skipped' : 'error', error: job.error });
    if (settings.eject) await ejectDisc(job);
  });
}

async function ejectDisc(job) {
  const r = await ejectDev(job.dev);
  job.ejected = r.ok;
  if (!r.ok) job.message = (job.message ? job.message + ' ' : '') + "Couldn't eject the disc: " + (r.detail || 'unknown error');
}

async function readDisc(job, retried) {
  const r = await runMakemkv(['-r', '--cache=64', 'info', `dev:${job.dev}`], { signal: job.ctl.signal, timeoutMs: 25 * 60e3 });
  const info = MK.parseInfo(r.text);
  if (info.titles.length) return info;
  const prob = MK.problemFrom(info.msgs);
  if (prob.keyProblem && settings.autoKey && !retried) {
    job.message = 'Getting a fresh MakeMKV key…';
    try { await refreshKey(); return readDisc(job, true); } catch (e) { job.error = fmtErr(e); throw new Error(job.error); }
  }
  throw new Error(prob.keyProblem ? `MakeMKV needs a valid key (${prob.text}). Add one in settings.` : `Couldn't read this disc${prob.text ? ': ' + prob.text : ''}. It may be dirty, scratched or copy-protected.`);
}

const RES = require('./lib/resolve');
// a cover image we may show: only our own poster proxy, pointing at the two hosts it allows
function cleanPoster(u) {
  u = String(u || '');
  if (!u.startsWith('/api/poster?u=') || u.length > 600) return '';
  try { const h = new URL(decodeURIComponent(u.slice('/api/poster?u='.length))); return h.protocol === 'https:' && ['static.tvmaze.com', 'm.media-amazon.com'].includes(h.hostname) ? u : ''; } catch { return ''; }
}
const usefulName = (t) => { const own = String((t && t.name) || '').trim(); return own && !/^(title|chapter|track|playlist)?\s*[#_ ]*\d*$/i.test(own) && !N.parseLabel(own).generic ? own : ''; };

// Which episode does this disc start at? Uses the discs ripped before it, then the disc number.
async function startingEpisode(showId, seasonFromLabel, disc, nEps) {
  let eps = []; try { eps = (await META.showEpisodes(showId)).episodes; } catch {}
  const count = (s) => eps.filter((e) => e.season === s).length;
  if (seasonFromLabel) {
    const m = memory[`${showId}:${seasonFromLabel}`];
    if (m && disc && disc > m.disc) return { season: seasonFromLabel, start: m.nextEp, sure: true };
    if (!disc || disc <= 1) return { season: seasonFromLabel, start: 1, sure: true };
    return { season: seasonFromLabel, start: (disc - 1) * nEps + 1, sure: false }; // a guess: earlier discs held about as many episodes
  }
  // no season on the label: carry on from the last episode ripped for this show
  const last = memory[`last:${showId}`];
  if (last) {
    let { season, nextEp } = last;
    if (count(season) && nextEp > count(season) && count(season + 1)) { season += 1; nextEp = 1; }
    return { season, start: nextEp, sure: false };
  }
  return { season: 1, start: 1, sure: false };
}

async function tvSuggestion(sug, lab, query, titles, top, cands) {
  const st = await startingEpisode(top ? top.id : 0, lab.season, lab.disc, titles.length);
  if (!top) {
    sug.tv = { candidates: cands.slice(0, 5), showId: null, showName: N.titleCase(lab.title || ''), year: '', season: lab.season || 1, startEp: 1 };
  } else {
    sug.tv = { candidates: cands.slice(0, 5), showId: top.id, showName: top.title, year: top.year, season: st.season, startEp: st.start, poster: top.poster || '' };
  }
  sug.titleIds = titles.map((t) => t.id);
  sug.confident = !!(top && RES.score(query, top.title) >= 0.9 && lab.season && st.sure);
}

async function identify(job, cls) {
  const lab = N.parseLabel(job.label);
  job.parsed = lab;
  const sug = { kind: cls.kind === 'unknown' ? 'movie' : cls.kind, reason: cls.reason, confident: false };
  const query = lab.generic ? '' : lab.title;
  const main = cls.main || [...job.titles].sort((a, b) => b.seconds - a.seconds)[0];
  const ownMain = usefulName(main); // many discs store the real title on the main title

  if (sug.kind === 'tv') {
    const r = await RES.resolveShow(META, [query, ownMain].filter(Boolean));
    await tvSuggestion(sug, lab, query || ownMain, cls.episodes, r.match, r.candidates);
  } else if (cls.kind === 'movies' && query && cls.movies.every((m) => m.seconds <= 100 * 60) && await (async () => {
    // two or more titles of an hour or more can be long episodes: if the label is a TV show and not a film, it is a TV disc
    const sh = await RES.resolveShow(META, [query]);
    if (!(sh.match && sh.score >= 0.95)) return false;
    const mv = await RES.resolveMovie(META, [query]);
    if (mv.match && N.sim(query, mv.match.title) >= 0.9) return false;
    sug.kind = 'tv'; sug.reason = `${cls.movies.length} long titles, and "${sh.match.title}" is a TV show, so they are treated as episodes.`;
    await tvSuggestion(sug, lab, query, cls.movies, sh.match, sh.candidates);
    return true;
  })()) {
    // handled above
  } else if (cls.kind === 'movies') {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
    const base = lab.title ? N.titleCase(lab.title) : `Unknown disc ${stamp}`;
    const list = []; let allSure = true;
    for (let i = 0; i < cls.movies.length; i++) {
      const t = cls.movies[i];
      const own = usefulName(t);
      let r = { match: null, sure: false, candidates: [] };
      if (own) r = await RES.resolveMovie(META, [own]);
      let name;
      if (r.match) name = N.safeSegment(`${r.match.title} (${r.match.year})`);
      else if (own) name = N.safeSegment(N.titleCase(own));
      else name = N.safeSegment(`${base} - Movie ${i + 1}`);
      if (!r.sure) allSure = false;
      list.push({ titleId: t.id, name, matched: !!r.match, named: !!(r.match || own), poster: r.match ? r.match.poster || '' : '', candidates: r.candidates.slice(0, 5) });
    }
    sug.movies = list; sug.titleIds = list.map((m) => m.titleId); sug.confident = allSure;
  } else {
    const queries = [query, ownMain].filter(Boolean);
    const r = await RES.resolveMovie(META, queries);
    // A single TV episode on a disc whose label has no season: if it is not a film but is a show, treat it as an episode.
    if (!r.sure && main && main.seconds <= 80 * 60 && queries.length) {
      const sh = await RES.resolveShow(META, queries);
      if (sh.match && sh.score >= 0.9 && !(r.match && N.sim(queries[0], r.match.title) >= 0.9)) {
        sug.kind = 'tv'; sug.reason = `One episode of about ${Math.round(main.seconds / 60)} minutes, and "${sh.match.title}" is a TV show.`;
        await tvSuggestion(sug, lab, queries[0], [main], sh.match, sh.candidates);
        return sug;
      }
    }
    const name = r.match ? N.safeSegment(`${r.match.title} (${r.match.year})`) : N.safeSegment(lab.title ? N.titleCase(lab.title) : (ownMain ? N.titleCase(ownMain) : ''));
    if (r.note) sug.reason = `${sug.reason} ${r.note}`.trim();
    sug.movie = { candidates: r.candidates.slice(0, 6), name, matched: !!r.match, poster: r.match ? r.match.poster || '' : '' };
    sug.titleIds = main ? [main.id] : [];
    sug.confident = !!(r.match && r.sure && cls.kind === 'movie');
  }
  return sug;
}

async function buildOutputs(plan) {
  let warn = '';
  if (plan.kind === 'movie') {
    const name = N.safeSegment(plan.movie.name);
    if (!name) throw new Error('Give the movie a name first.');
    return { outs: [{ titleId: plan.titleIds[0], dir: [...relSegments(settings.movieDir), name], file: `${name}.mkv` }], name };
  }
  if (plan.kind === 'movies') {
    const seen = new Set();
    const outs = plan.movies.map((m) => {
      const name = N.safeSegment(m.name);
      if (!name) throw new Error('Give every movie a name first.');
      if (seen.has(name.toLowerCase())) throw new Error(`Two of the movies are named "${name}". Give each one its own name.`);
      seen.add(name.toLowerCase());
      return { titleId: m.titleId, dir: [...relSegments(settings.movieDir), name], file: `${name}.mkv`, movie: name };
    });
    return { outs, name: outs.map((o) => o.movie).join(' + ') };
  }
  const t = plan.tv;
  let sh = null;
  if (t.showId) { try { sh = await META.showEpisodes(t.showId); } catch (e) { warn = "Couldn't load episode titles, so the files are named by season and episode number only."; } }
  const showName = N.safeSegment(sh ? `${sh.name}${sh.year ? ` (${sh.year})` : ''}` : `${t.showName || 'Unknown show'}${t.year ? ` (${t.year})` : ''}`);
  if (!showName) throw new Error('Choose the show first.');
  const season = Math.max(0, Math.min(99, parseInt(t.season, 10) || 1));
  const start = Math.max(1, parseInt(t.startEp, 10) || 1);
  const outs = plan.titleIds.map((id, i) => {
    const num = start + i;
    const ep = sh && sh.episodes.find((e) => e.season === season && e.number === num);
    const title = ep && ep.name ? ep.name : '';
    const code = `S${N.pad2(season)}E${N.pad2(num)}`;
    const file = N.safeSegment(`${showName} - ${code}${title ? ' - ' + title : ''}`) + '.mkv';
    return { titleId: id, dir: [...relSegments(settings.tvDir), showName, `Season ${N.pad2(season)}`], file, num };
  });
  return { outs, name: showName, season, start, warn };
}

async function runJob(job) {
  const info = await readDisc(job);
  chk(job);
  job.discName = info.disc.name; job.rawLabel = job.label || ''; job.volume = info.disc.volume || '';
  // Blu-rays often have a useless volume label ("BDROM") but a real title in their disc info. Use the first readable one.
  const names = [job.label, info.disc.name, info.disc.volume].filter(Boolean);
  job.label = names.find((l) => !N.parseLabel(l).generic) || names[0] || '';
  job.titles = info.titles.map((t) => ({ id: t.id, name: t.name, seconds: t.seconds, durText: N.fmtDur(t.seconds), size: t.size, sizeText: N.fmtSize(t.size), chapters: t.chapters }));
  const cls = classify(info.titles, { season: !!N.parseLabel(job.label).season });
  job.kind = cls.kind === 'unknown' ? 'movie' : cls.kind;
  setStage(job, 'identifying', 'Working out what this disc is…');
  job.suggested = await identify(job, cls);
  chk(job);

  let plan;
  const unsureOk = settings.auto;
  if (job.suggested.confident || unsureOk) {
    if (!job.suggested.titleIds.length) throw new Error('No title on this disc looks like a movie or episode. Eject it and rip it by hand.');
    plan = job.suggested.kind === 'tv'
      ? { kind: 'tv', titleIds: job.suggested.titleIds, tv: job.suggested.tv }
      : job.suggested.kind === 'movies'
        ? { kind: 'movies', titleIds: job.suggested.titleIds, movies: job.suggested.movies.map((m) => ({ titleId: m.titleId, name: m.name, poster: cleanPoster(m.poster) })) }
        : { kind: 'movie', titleIds: job.suggested.titleIds, movie: job.suggested.movie };
    job.autoNote = job.suggested.confident ? '' : 'Ripped automatically (automatic mode).';
    if (plan.kind === 'movies') {
      const unnamed = job.suggested.movies.filter((m) => !m.named).length;
      job.autoNote = `This disc has ${plan.movies.length} movies, so each one was ripped to its own folder.` + (unnamed ? ` ${unnamed === plan.movies.length ? 'They' : 'Some of them'} could not be identified, so use Rename in the recent list.` : '');
    } else if (!job.suggested.confident) {
      const nm = plan.kind === 'tv' ? plan.tv.showName : plan.movie.name;
      const hasMatch = plan.kind === 'tv' ? !!plan.tv.showId : !!job.suggested.movie.matched;
      if (!String(nm || '').trim()) {
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
        const fallback = N.safeSegment(`Unknown disc ${stamp}`);
        if (plan.kind === 'tv') plan.tv.showName = fallback; else plan.movie.name = fallback;
        job.autoNote = `Couldn't tell what this disc is, so it was saved as "${fallback}". Rename the folder when you can.`;
      } else if (!hasMatch) {
        job.autoNote = `No good match was found online, so it was named from the disc label ("${nm}"). Check the name.`;
      }
    }
  } else {
    setStage(job, 'needs_confirm', 'Check the details below, then start the rip.');
    plan = await new Promise((resolve, reject) => { job.waitConfirm = resolve; job.ctl.signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true }); });
    job.waitConfirm = null;
  }
  chk(job);
  await ripPlan(job, plan);
}

async function ripPlan(job, plan) {
  job.kind = plan.kind;
  const built = await buildOutputs(plan);
  job.name = built.name; if (built.warn) job.autoNote = ((job.autoNote || '') + ' ' + built.warn).trim();
  const { root, full: libFull } = await destDir('');
  const st = await rootInfo(root);
  if (!st.available || !st.writable) throw new Error(`The ${root.label} folder isn't writable. Check this app's folder access in Umbrel.`);
  const tmpBase = path.join(root.dir, '.disc-ripper-tmp', job.id);
  await mkdirOwned(tmpBase, root.dir);
  const need = plan.titleIds.reduce((a, id) => a + ((job.titles.find((t) => t.id === id) || {}).size || 0), 0);
  const fst = await fsp.statfs(tmpBase).catch(() => null);
  if (fst && need && fst.bavail * fst.bsize < need + KEEP_FREE) throw new Error(`Not enough free space for this disc (needs about ${N.fmtSize(need + KEEP_FREE)}).`);

  job.outputs = built.outs.map((o) => ({ titleId: o.titleId, name: o.file, done: false }));
  setStage(job, 'ripping', 'Ripping…');
  try {
    for (let i = 0; i < built.outs.length; i++) {
      const o = built.outs[i]; chk(job);
      job.currentIdx = i; job.message = built.outs.length > 1 ? `Ripping ${i + 1} of ${built.outs.length}: ${o.file}` : `Ripping ${o.file}`;
      const finalDir = path.join(libFull, ...o.dir);
      const final = path.join(finalDir, o.file);
      if (await fsp.stat(final).then(() => true, () => false)) { job.outputs[i].done = true; job.outputs[i].note = 'Already in your library'; job.files.push(path.relative(root.dir, final)); continue; }
      const out = path.join(tmpBase, String(o.titleId)); await fsp.mkdir(out, { recursive: true });
      // Progress comes from how much of the file has actually been written. MakeMKV's own
      // percentages restart in every phase and are unreliable on some discs.
      const expected = (job.titles.find((t) => t.id === o.titleId) || {}).size || 0;
      const before = job.bytesDone || 0;
      let lastSum = -1, lastMove = Date.now();
      const tick = async () => {
        let sum = 0;
        try { for (const f of await fsp.readdir(out)) sum += (await fsp.stat(path.join(out, f))).size; } catch {}
        if (sum !== lastSum) { lastSum = sum; lastMove = Date.now(); }
        job.bytesDone = before + sum;
        // time left: from how fast data has been written over the last minute
        const now = Date.now(); (job.samples = job.samples || []).push([now, job.bytesDone]);
        while (job.samples.length > 2 && now - job.samples[0][0] > 60e3) job.samples.shift();
        const a = job.samples[0], b = job.samples[job.samples.length - 1], dt = (b[0] - a[0]) / 1000, db = b[1] - a[1];
        if (need > 0 && dt >= 6 && db > 0) { const rate = db / dt; const raw = Math.max(0, need - job.bytesDone) / rate; job.etaSec = job.etaSec ? job.etaSec * 0.6 + raw * 0.4 : raw; job.rate = rate; }
        if (need > 0) job.progress = Math.max(job.progress || 0, Math.min(99, (job.bytesDone / need) * 100));
        const idle = Date.now() - lastMove;
        job.stall = idle > 180000 ? `No new data has been written for ${Math.round(idle / 60000)} minutes. The disc may be dirty or the drive may be struggling.` : '';
      };
      job.bytesTotal = need; if (!job.bytesDone) job.bytesDone = 0;
      const timer = setInterval(() => { tick().catch(() => {}); }, 2000);
      try {
        await ripTitle(job, o.titleId, out, (p) => { if (!need) job.progress = Math.max(job.progress || 0, Math.min(99, ((i + p / 100) / built.outs.length) * 100)); });
      } finally { clearInterval(timer); job.stall = ''; }
      job.bytesDone = before + Math.max(expected, lastSum, 0);
      const made = (await fsp.readdir(out)).filter((f) => /\.mkv$/i.test(f));
      if (!made.length) throw new Error('MakeMKV finished but did not produce a file.');
      setStage(job, 'saving', `Saving ${o.file}…`);
      await mkdirOwned(finalDir, root.dir);
      await moveFile(path.join(out, made[0]), final);
      await chownLike(final, root.dir);
      job.outputs[i].done = true; job.files.push(path.relative(root.dir, final));
      setStage(job, 'ripping');
    }
  } finally { await fsp.rm(tmpBase, { recursive: true, force: true }).catch(() => {}); }

  if (plan.kind === 'tv' && plan.tv.showId) { const nx = { nextEp: built.start + built.outs.length, disc: (job.parsed && job.parsed.disc) || 1 }; memory[`${plan.tv.showId}:${built.season}`] = nx; memory[`last:${plan.tv.showId}`] = { season: built.season, nextEp: nx.nextEp }; saveJson(MEMORY_FILE, memory); }
  job.progress = 100;
  if (plan.kind === 'movies') {
    for (let i = built.outs.length - 1; i >= 0; i--) addHistory({ label: job.label, kind: 'movie', name: built.outs[i].movie, status: 'done', files: [job.files[i]].filter(Boolean), poster: cleanPoster((plan.movies[i] || {}).poster), note: i === 0 ? job.autoNote || '' : '' });
  } else addHistory({ label: job.label, kind: plan.kind, name: built.name, status: 'done', files: job.files, poster: cleanPoster((plan.kind === 'tv' ? plan.tv : plan.movie).poster), note: job.autoNote || '' });
  setStage(job, 'done', plan.kind === 'tv' ? `Saved ${job.files.length} episode${job.files.length === 1 ? '' : 's'} to your library.` : plan.kind === 'movies' ? `Saved ${job.files.length} movies to your library.` : 'Saved to your library.');
  if (settings.eject) { await ejectDisc(job); if (job.ejected) job.message += ' The disc is out.'; }
}

async function ripTitle(job, titleId, outDir, onPct, retried) {
  const msgs = [];
  const r = await runMakemkv(['-r', '--progress=-same', '--cache=128', 'mkv', `dev:${job.dev}`, String(titleId), outDir], {
    signal: job.ctl.signal, timeoutMs: 8 * 3600e3,
    onLine: (l) => { const p = MK.parseProgress(l); if (p !== null) onPct(p); else if (l.startsWith('PRGC:')) { const f = MK.fields(l.slice(5)); if (f[2]) job.phase = String(f[2]).slice(0, 80); } else if (l.startsWith('MSG:')) { const f = MK.fields(l.slice(4)); msgs.push({ code: +f[0], text: f[3] || '' }); } },
  });
  if (r.code === 0) return;
  const prob = MK.problemFrom(msgs);
  if (prob.keyProblem && settings.autoKey && !retried) { await refreshKey(); return ripTitle(job, titleId, outDir, onPct, true); }
  throw new Error(`MakeMKV could not finish the rip${prob.text ? ': ' + prob.text : ''}`);
}

// ---------- web server ----------
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const o = req.get('origin');
    if (req.get('x-ag') !== '1') return res.status(403).json({ error: 'Blocked.' });
    if (o) { try { if (new URL(o).host !== req.get('host')) return res.status(403).json({ error: 'Blocked.' }); } catch { return res.status(403).json({ error: 'Blocked.' }); } }
  }
  next();
});
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(400).json({ error: fmtErr(e) }));

const pubJob = (j) => j && ({
  id: j.id, dev: j.dev, label: j.label, stage: j.stage, message: j.message, kind: j.kind, name: j.name, progress: Math.round(j.progress || 0), titles: j.titles,
  suggested: j.suggested, discName: j.discName || '', rawLabel: j.rawLabel || '', outputs: j.outputs, files: j.files, error: j.error, startedAt: j.startedAt, ejected: !!j.ejected, autoNote: [j.autoNote, j.stall].filter(Boolean).join(' '), bytesDone: j.bytesDone || 0, bytesTotal: j.bytesTotal || 0, etaSec: j.stage === 'ripping' && j.etaSec ? Math.round(j.etaSec) : null, rate: j.stage === 'ripping' && j.rate ? Math.round(j.rate) : 0, phase: j.phase || '', currentIdx: j.currentIdx, parsed: j.parsed && { title: j.parsed.title, season: j.parsed.season, disc: j.parsed.disc },
});

app.get('/api/state', wrap(async (req, res) => {
  res.json({ version: VERSION, drives: driveStates.map((d) => { const t = trayView(d.dev, d.present); return { ...d, tray: t.open ? 'open' : 'closed', trayKnown: t.known }; }), current: pubJob(current), history: history.slice(0, 25), settings: pubSettings(), roots: await Promise.all(ROOTS.map(rootInfo)) });
}));

app.post('/api/confirm', wrap(async (req, res) => {
  if (!current || current.stage !== 'needs_confirm' || !current.waitConfirm) throw new Error('Nothing is waiting for a decision.');
  const b = req.body || {};
  const ids = Array.isArray(b.titleIds) ? b.titleIds.map(Number).filter((n) => current.titles.some((t) => t.id === n)) : [];
  if (!ids.length) throw new Error('Pick at least one title to rip.');
  let plan;
  if (b.kind === 'tv') {
    const t = b.tv || {};
    plan = { kind: 'tv', titleIds: ids, tv: { showId: t.showId ? String(t.showId) : null, showName: String(t.showName || '').slice(0, 120), year: String(t.year || '').slice(0, 4), season: parseInt(t.season, 10) || 1, startEp: parseInt(t.startEp, 10) || 1, poster: cleanPoster(t.poster) } };
  } else if (b.kind === 'movies') {
    const names = b.movies && typeof b.movies === 'object' ? b.movies : {};
    const posters = b.posters && typeof b.posters === 'object' ? b.posters : {};
    plan = { kind: 'movies', titleIds: ids, movies: ids.map((id) => ({ titleId: id, name: String(names[id] || '').slice(0, 150), poster: cleanPoster(posters[id]) })) };
  } else {
    plan = { kind: 'movie', titleIds: ids.slice(0, 1), movie: { name: String((b.movie || {}).name || '').slice(0, 150), poster: cleanPoster((b.movie || {}).poster) } };
  }
  await buildOutputs(plan); // validate names before ripping
  const f = current.waitConfirm; current.waitConfirm = null; f(plan);
  res.json({ ok: true });
}));

app.post('/api/history/rename', wrap(async (req, res) => {
  const b = req.body || {};
  const h = history.find((x) => x.id === b.id);
  if (!h || h.status !== 'done' || h.kind !== 'movie' || !h.files || h.files.length !== 1) throw new Error('Only a ripped movie can be renamed here.');
  const name = N.safeSegment(b.name);
  if (!name) throw new Error('Type a name first, like "Movie Name (2020)".');
  const root = rootById(settings.root) || ROOTS[0];
  const oldFile = path.join(root.dir, h.files[0]);
  const oldDir = path.dirname(oldFile), parent = path.dirname(oldDir);
  const inRoot = (p) => p === root.dir || p.startsWith(root.dir + path.sep);
  if (!inRoot(oldFile) || !inRoot(parent)) throw new Error('That file is outside your library.');
  if (!(await fsp.stat(oldFile).then(() => true, () => false))) throw new Error("That file isn't there any more. Maybe it was moved or deleted.");
  const newDir = path.join(parent, name), newFile = path.join(newDir, name + '.mkv');
  if (newDir !== oldDir && await fsp.stat(newDir).then(() => true, () => false)) throw new Error(`A folder named "${name}" already exists there.`);
  if (newDir !== oldDir) await fsp.rename(oldDir, newDir);
  const moved = path.join(newDir, path.basename(oldFile));
  if (moved !== newFile) await fsp.rename(moved, newFile);
  h.name = name; h.files = [path.relative(root.dir, newFile)]; saveJson(HISTORY_FILE, history);
  res.json({ ok: true, name });
}));
app.post('/api/history/clear', wrap(async (req, res) => { history = []; saveJson(HISTORY_FILE, history); res.json({ ok: true }); }));

app.post('/api/skip', wrap(async (req, res) => {
  if (!current) throw new Error('No disc to skip.');
  if (isActive(current)) current.ctl.abort(); else if (current.dev) await ejectDisc(current);
  res.json({ ok: true });
}));
app.post('/api/eject', wrap(async (req, res) => {
  const dev = (driveStates[0] && driveStates[0].dev) || (await DRV.listDrives())[0];
  if (!dev) throw new Error('No drive found.');
  if (isActive(current) && current.stage !== 'needs_confirm') throw new Error('A disc is being ripped right now. Use Stop first.');
  if (isActive(current)) current.ctl.abort();
  const r = await ejectDev(dev);
  if (!r.ok) throw new Error("Couldn't eject: " + (r.detail || 'unknown error'));
  res.json({ ok: true });
}));

app.get('/api/find/movie', wrap(async (req, res) => res.json({ results: await META.findMovies(req.query.q) })));
app.get('/api/find/tv', wrap(async (req, res) => res.json({ results: await META.findShows(req.query.q) })));
app.get('/api/tv/episodes', wrap(async (req, res) => {
  const sh = await META.showEpisodes(req.query.showId);
  const season = parseInt(req.query.season, 10) || 1;
  res.json({ name: sh.name, year: sh.year, episodes: sh.episodes.filter((e) => e.season === season).map((e) => ({ number: e.number, name: e.name })), seasons: [...new Set(sh.episodes.map((e) => e.season))].sort((a, b) => a - b) });
}));

app.post('/api/settings', wrap(async (req, res) => {
  const b = req.body || {};
  const s = { ...settings };
  if ('auto' in b) s.auto = !!b.auto;
  if ('eject' in b) s.eject = !!b.eject;
  if ('autoKey' in b) s.autoKey = !!b.autoKey;
  if ('root' in b) { if (!rootById(b.root)) throw new Error('Unknown library location.'); s.root = b.root; }
  for (const k of ['movieDir', 'tvDir']) if (k in b) { const v = relSegments(b[k]).map(N.safeSegment).filter(Boolean).join('/'); if (!v) throw new Error('Folder names can\'t be empty.'); s[k] = v; }
  if (typeof b.key === 'string' && b.key.trim()) {
    const k = b.key.trim();
    if (!/^[A-Za-z0-9@_-]{20,200}$/.test(k)) throw new Error("That doesn't look like a MakeMKV key.");
    s.key = k;
  }
  settings = s; saveSettings(); writeMkConf();
  res.json({ settings: pubSettings() });
}));
app.post('/api/key/fetch', wrap(async (req, res) => { await refreshKey(); res.json({ settings: pubSettings() }); }));

// drive check: helps when the drive isn't noticed
app.post('/api/check', wrap(async (req, res) => {
  if (isActive(current)) throw new Error('A disc is being processed right now. Try again when it finishes.');
  const sr = await DRV.listNodes(/^sr\d+$/), sg = await DRV.listNodes(/^sg\d+$/);
  const probes = [];
  for (const n of sr) probes.push({ dev: n, ...(await DRV.probe(path.join(DRV.DEV_DIR, n))) });
  let makemkv = { drives: [], note: '' };
  try {
    const r = await runMakemkv(['-r', 'info', 'disc:9999'], { timeoutMs: 60000 });
    for (const l of r.text.split('\n')) if (l.startsWith('DRV:')) { const f = MK.fields(l.slice(4)); if (+f[1] !== 256) makemkv.drives.push({ index: +f[0], name: f[4], disc: f[5], device: f[6] }); }
    const m = MK.parseInfo(r.text).msgs; makemkv.note = (m.find((x) => /key|expired|too old/i.test(x.text)) || {}).text || '';
    makemkv.version = (m.find((x) => /^MakeMKV v/.test(x.text)) || {}).text || '';
  } catch (e) { makemkv.note = fmtErr(e); }
  const root = rootById(settings.root) || ROOTS[0]; const ri = await rootInfo(root);
  let free = null; try { const s = await fsp.statfs(root.dir); free = s.bavail * s.bsize; } catch {}
  res.json({ opticalNodes: sr, scsiNodes: sg, probes, makemkv, library: { ...ri, free: free && N.fmtSize(free) }, keySet: !!settings.key });
}));

app.get('/api/poster', async (req, res) => {
  try {
    const u = new URL(String(req.query.u || ''));
    if (u.protocol !== 'https:' || !['static.tvmaze.com', 'm.media-amazon.com'].includes(u.hostname)) return res.status(404).end();
    const r = await fetch(u, { headers: { 'User-Agent': 'DiscRipper/' + VERSION }, signal: AbortSignal.timeout(15000) });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//.test(ct)) return res.status(404).end();
    res.set({ 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' });
    Readable.fromWeb(r.body).pipe(res);
  } catch { res.status(404).end(); }
});

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// leftovers from an interrupted rip
(async () => { for (const r of ROOTS) await fsp.rm(path.join(r.dir, '.disc-ripper-tmp'), { recursive: true, force: true }).catch(() => {}); })();

const server = app.listen(PORT, () => { console.log(`Disc Ripper ${VERSION} on :${PORT}`); poll(); setInterval(poll, POLL_MS); trayLoop(); });
process.on('SIGTERM', () => { if (current && isActive(current)) current.ctl.abort(); setTimeout(() => process.exit(0), 500); });
module.exports = server;
