'use strict';
/* JSON file store with atomic writes and a rolling daily backup. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATUSES = ['idea', 'writing', 'polishing', 'producing', 'scheduled', 'released', 'shelved'];

const COMMON = new Set(('a about after again ain all also am an and any are aren around as at back be because been before being but by can cant come could couldn did didn do does doesn don done dont down each else even ever every for from get gets go goes going gon gonna got gotta had has hasn have haven having he her here hers him his how i if ill im in into is isn it its ive just know let like made make me might more most much must my need never no nor not now of off oh on once one only or other our out over own really said same say see she should so some still such take than that thats the their them then there these they thing things this those though through til till to too up upon us very want wanna was wasn way we well went were what when where which while who whom why will with won would wouldn yeah yes yet you your yours youre').split(' '));

const DEFAULT_CHECKLIST = [
  'Lyrics final and proofread',
  'Lyrics fit the character limit',
  'Final audio exported',
  'Cover art ready (3000 x 3000)',
  'Uploaded to the distributor with a release date',
  'Lyrics submitted to streaming services',
  'Website updated: song page, lyrics, behind the lyrics',
  'Announced',
];

const id = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();
const str = (v, max) => String(v == null ? '' : v).slice(0, max);

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.filesDir = path.join(dir, 'files');
    this.versionsDir = path.join(dir, 'versions');
    this.backupDir = path.join(dir, 'backups');
    for (const d of [dir, this.filesDir, this.versionsDir, this.backupDir]) fs.mkdirSync(d, { recursive: true });
    this.db = { songs: [], ideas: [], collections: [], settings: {} };
    if (fs.existsSync(this.file)) {
      try { this.db = Object.assign(this.db, JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
      catch (e) {
        // keep the unreadable file for recovery instead of overwriting it
        fs.copyFileSync(this.file, this.file + '.corrupt-' + Date.now());
      }
    }
    this.db.settings = Object.assign({ charLimit: 3000, artist: '', checklist: DEFAULT_CHECKLIST.slice(), cadenceWeeks: 4, spotifyUrl: '', spotifyClientId: '', spotifyClientSecret: '', lastSync: '' }, this.db.settings);
    delete this.db.settings.appleUrl;
    this.timer = null;
  }

  /* ---- persistence ---- */
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 150);
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
    this.dailyBackup();
  }
  dailyBackup() {
    const name = 'db-' + now().slice(0, 10) + '.json';
    const target = path.join(this.backupDir, name);
    if (fs.existsSync(target)) return;
    try {
      fs.copyFileSync(this.file, target);
      const old = fs.readdirSync(this.backupDir).filter((f) => /^db-\d{4}-\d\d-\d\d\.json$/.test(f)).sort();
      while (old.length > 7) fs.unlinkSync(path.join(this.backupDir, old.shift()));
    } catch (e) { /* a failed backup must not block saving */ }
  }

  /* ---- songs ---- */
  summary(s) {
    const lines = s.lyrics.split('\n').filter((l) => l.trim() && !/^\s*\[.*\]\s*$/.test(l));
    return {
      id: s.id, title: s.title, status: s.status, project: s.project, tags: s.tags,
      releaseDate: s.releaseDate, cover: s.cover, created: s.created, updated: s.updated,
      words: (s.lyrics.match(/[A-Za-z][A-Za-z'’]*/g) || []).length,
      chars: s.lyrics.length, first: lines.slice(0, 2).join(' / ').slice(0, 140),
      checklistDone: s.checklist.filter((c) => c.done).length, checklistTotal: s.checklist.length,
      takes: s.audio.length, onSpotify: /^https:\/\/open\.spotify\.com\//.test(s.links.spotify),
    };
  }
  listSongs() { return this.db.songs.map((s) => this.summary(s)); }
  getSong(sid) { return this.db.songs.find((s) => s.id === sid) || null; }

  createSong(input = {}) {
    const t = now();
    const song = {
      id: id(), title: str(input.title, 200) || 'Untitled', lyrics: str(input.lyrics, 200000),
      status: STATUSES.includes(input.status) ? input.status : 'writing',
      project: str(input.project, 120), tags: [], releaseDate: '', notes: str(input.notes, 100000),
      production: { style: '', bpm: '', key: '', voice: '', notes: '' },
      links: { spotify: '', apple: '', distributor: '', site: '', other: '' },
      ids: { isrc: '', upc: '' },
      checklist: this.db.settings.checklist.map((text) => ({ id: id(), text, done: false })),
      collected: [], cover: '', audio: [], created: t, updated: t,
    };
    this.db.songs.unshift(song);
    this.save();
    return song;
  }

  updateSong(sid, patch) {
    const s = this.getSong(sid);
    if (!s) return null;
    if (typeof patch.lyrics === 'string' && patch.lyrics !== s.lyrics) {
      this.autoVersion(s);
      s.lyrics = patch.lyrics.slice(0, 200000);
    }
    if (typeof patch.title === 'string') s.title = patch.title.slice(0, 200) || 'Untitled';
    if (STATUSES.includes(patch.status)) s.status = patch.status;
    if (typeof patch.project === 'string') s.project = patch.project.slice(0, 120);
    if (typeof patch.notes === 'string') s.notes = patch.notes.slice(0, 100000);
    if (typeof patch.releaseDate === 'string' && /^(\d{4}-\d\d-\d\d)?$/.test(patch.releaseDate)) s.releaseDate = patch.releaseDate;
    if (Array.isArray(patch.tags)) s.tags = patch.tags.slice(0, 20).map((t) => str(t, 40)).filter(Boolean);
    for (const group of ['production', 'links', 'ids']) {
      if (patch[group] && typeof patch[group] === 'object') {
        for (const k of Object.keys(s[group])) {
          if (typeof patch[group][k] === 'string') s[group][k] = patch[group][k].slice(0, 4000);
        }
      }
    }
    if (Array.isArray(patch.checklist)) {
      s.checklist = patch.checklist.slice(0, 60).map((c) => ({ id: str(c.id, 20) || id(), text: str(c.text, 200), done: !!c.done })).filter((c) => c.text);
    }
    if (Array.isArray(patch.collected)) {
      s.collected = patch.collected.slice(0, 500).map((c) => str(c, 200)).filter(Boolean);
    }
    if (Array.isArray(patch.audioNotes)) {
      for (const n of patch.audioNotes) {
        const a = s.audio.find((x) => x.id === n.id);
        if (a) { if (typeof n.note === 'string') a.note = n.note.slice(0, 500); if (typeof n.name === 'string' && n.name.trim()) a.name = n.name.slice(0, 160); }
      }
    }
    s.updated = now();
    this.save();
    return s;
  }

  deleteSong(sid) {
    const i = this.db.songs.findIndex((s) => s.id === sid);
    if (i < 0) return false;
    this.db.songs.splice(i, 1);
    fs.rmSync(path.join(this.filesDir, sid), { recursive: true, force: true });
    fs.rmSync(path.join(this.versionsDir, sid + '.json'), { force: true });
    for (const idea of this.db.ideas) if (idea.songId === sid) idea.songId = '';
    this.save();
    return true;
  }

  /* ---- versions (one file per song, so the main file stays small) ---- */
  versionFile(sid) { return path.join(this.versionsDir, sid + '.json'); }
  readVersions(sid) {
    try { return JSON.parse(fs.readFileSync(this.versionFile(sid), 'utf8')); } catch (e) { return []; }
  }
  writeVersions(sid, list) {
    const tmp = this.versionFile(sid) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list));
    fs.renameSync(tmp, this.versionFile(sid));
  }
  addVersion(song, label, auto) {
    const list = this.readVersions(song.id);
    const v = { id: id(), label: str(label, 120), auto: !!auto, at: now(), title: song.title, lyrics: song.lyrics };
    list.unshift(v);
    // keep every named version; trim only the oldest automatic ones
    let autos = 0;
    const kept = list.filter((x) => !x.auto || ++autos <= 30);
    this.writeVersions(song.id, kept.slice(0, 200));
    return v;
  }
  /* Before the first edit of a day, keep what the lyrics looked like. */
  autoVersion(song) {
    if (!song.lyrics.trim()) return;
    const today = now().slice(0, 10);
    if (song.autoDay === today) return;
    song.autoDay = today;
    const list = this.readVersions(song.id);
    if (list.length && list[0].lyrics === song.lyrics) return;
    this.addVersion(song, 'Before edits on ' + today, true);
  }
  deleteVersion(sid, vid) {
    const list = this.readVersions(sid);
    const next = list.filter((v) => v.id !== vid);
    if (next.length === list.length) return false;
    this.writeVersions(sid, next);
    return true;
  }

  /* ---- ideas ---- */
  createIdea(input) {
    const idea = { id: id(), text: str(input.text, 4000).trim(), kind: ['line', 'title', 'hook', 'concept'].includes(input.kind) ? input.kind : 'line', songId: '', pinned: false, created: now() };
    if (!idea.text) return null;
    this.db.ideas.unshift(idea);
    this.save();
    return idea;
  }
  updateIdea(iid, patch) {
    const idea = this.db.ideas.find((x) => x.id === iid);
    if (!idea) return null;
    if (typeof patch.text === 'string' && patch.text.trim()) idea.text = patch.text.slice(0, 4000).trim();
    if (['line', 'title', 'hook', 'concept'].includes(patch.kind)) idea.kind = patch.kind;
    if (typeof patch.pinned === 'boolean') idea.pinned = patch.pinned;
    if (typeof patch.songId === 'string') idea.songId = this.getSong(patch.songId) ? patch.songId : '';
    this.save();
    return idea;
  }
  deleteIdea(iid) {
    const n = this.db.ideas.length;
    this.db.ideas = this.db.ideas.filter((x) => x.id !== iid);
    this.save();
    return this.db.ideas.length < n;
  }

  /* ---- collections ---- */
  createCollection(name) {
    const c = { id: id(), name: str(name, 80).trim() || 'New collection', items: [], created: now() };
    this.db.collections.push(c);
    this.save();
    return c;
  }
  updateCollection(cid, patch) {
    const c = this.db.collections.find((x) => x.id === cid);
    if (!c) return null;
    if (typeof patch.name === 'string' && patch.name.trim()) c.name = patch.name.slice(0, 80).trim();
    if (Array.isArray(patch.items)) c.items = [...new Set(patch.items.map((x) => str(x, 200).trim()).filter(Boolean))].slice(0, 2000);
    if (typeof patch.add === 'string' && patch.add.trim() && !c.items.includes(patch.add.trim())) c.items.push(patch.add.slice(0, 200).trim());
    this.save();
    return c;
  }
  deleteCollection(cid) {
    const n = this.db.collections.length;
    this.db.collections = this.db.collections.filter((x) => x.id !== cid);
    this.save();
    return this.db.collections.length < n;
  }

  /* ---- settings ---- */
  updateSettings(patch) {
    const s = this.db.settings;
    if (Number.isFinite(+patch.charLimit)) s.charLimit = Math.max(0, Math.min(100000, Math.round(+patch.charLimit)));
    if (typeof patch.artist === 'string') s.artist = patch.artist.slice(0, 120);
    if (Array.isArray(patch.checklist)) s.checklist = patch.checklist.map((t) => str(t, 200).trim()).filter(Boolean).slice(0, 60);
    if ([2, 3, 4, 6, 8].includes(+patch.cadenceWeeks)) s.cadenceWeeks = +patch.cadenceWeeks;
    for (const k of ['spotifyUrl', 'spotifyClientId', 'spotifyClientSecret']) if (typeof patch[k] === 'string') s[k] = patch[k].trim().slice(0, 300);
    this.save();
    return s;
  }

  /* Settings as the browser sees them: the Spotify key's secret never leaves the server. */
  publicSettings() {
    const s = Object.assign({}, this.db.settings);
    s.spotifyKeySaved = !!(s.spotifyClientId && s.spotifyClientSecret);
    delete s.spotifyClientSecret;
    return s;
  }

  /* The words used most across every song, leaving out the small connecting words. */
  topWords(n = 5) {
    const counts = new Map(), inSongs = new Map();
    for (const song of this.db.songs) {
      const seen = new Set();
      for (const line of song.lyrics.split('\n')) {
        if (/^\s*[\[(].*[\])]\s*$/.test(line)) continue;
        for (const raw of line.toLowerCase().replace(/[\u2018\u2019]/g, "'").match(/[a-z][a-z']*/g) || []) {
          const w = raw.replace(/'(s|m|re|ve|ll|d|t)$/, '').replace(/^'+|'+$/g, '');
          if (w.length < 3 || COMMON.has(w)) continue;
          counts.set(w, (counts.get(w) || 0) + 1);
          if (!seen.has(w)) { seen.add(w); inSongs.set(w, (inSongs.get(w) || 0) + 1); }
        }
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([word, count]) => ({ word, count, songs: inSongs.get(word) }));
  }

  /* Lines written more than once, the same or nearly the same. Lines shared by several songs come first. */
  topLines(n = 5) {
    const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'so', 'oh', 'yeah', 'uh', 'ooh', 'ah', 'hey', 'na', 'la']);
    const groups = new Map(); // exact key -> group
    for (const song of this.db.songs) {
      for (const raw of song.lyrics.split('\n')) {
        const text = raw.trim();
        if (!text || /^\s*[\[(].*[\])]\s*$/.test(text)) continue;
        const words = (text.toLowerCase().replace(/[\u2018\u2019]/g, "'").match(/[a-z0-9][a-z0-9']*/g) || []).map((w) => w.replace(/in'$/, 'ing'));
        const core = words.filter((w) => !SMALL.has(w));
        if (core.length < 3) continue;
        const key = core.join(' ');
        let g = groups.get(key);
        if (!g) { g = { key, set: new Set(core), len: core.length, count: 0, songs: new Map(), texts: new Map() }; groups.set(key, g); }
        g.count++;
        g.songs.set(song.id, song.title);
        const shown = text.replace(/[\s,;:.!?\u2014-]+$/, '');
        g.texts.set(shown, (g.texts.get(shown) || 0) + 1);
      }
    }
    /* Join lines that share nearly all of their words. */
    const list = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 4000);
    const merged = [];
    for (const g of list) {
      let home = null;
      if (g.len >= 4) {
        for (const m of merged) {
          if (m.len < 4 || Math.abs(m.len - g.len) > 2) continue;
          let same = 0;
          for (const w of g.set) if (m.set.has(w)) same++;
          if (same / (g.set.size + m.set.size - same) >= 0.75) { home = m; break; }
        }
      }
      if (!home) { merged.push({ set: g.set, len: g.len, count: g.count, songs: new Map(g.songs), texts: new Map(g.texts) }); continue; }
      home.count += g.count;
      for (const [id, t] of g.songs) home.songs.set(id, t);
      for (const [t, c] of g.texts) home.texts.set(t, (home.texts.get(t) || 0) + c);
    }
    return merged.filter((m) => m.count > 1)
      .sort((a, b) => b.songs.size - a.songs.size || b.count - a.count)
      .slice(0, n)
      .map((m) => {
        const texts = [...m.texts].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
        const lower = new Set();
        const variants = texts.filter((t) => { const k = t.toLowerCase(); if (lower.has(k)) return false; lower.add(k); return true; });
        const songs = [...m.songs].map(([id, title]) => ({ id, title }));
        return { line: variants[0], variants: variants.slice(1, 3), count: m.count, songCount: songs.length, songs: songs.slice(0, 4), more: Math.max(0, songs.length - 4) };
      });
  }

  /* Fill a song in from what a streaming service says about it. Existing details are kept. */
  applyTrack(sid, t, today) {
    const s = this.getSong(sid);
    if (!s) return null;
    const filled = [];
    if (/^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+$/.test(t.spotify || '') && s.links.spotify !== t.spotify) { s.links.spotify = t.spotify; filled.push('Spotify link'); }
    if (/^\d{4}-\d\d-\d\d$/.test(t.date || '') && !s.releaseDate) { s.releaseDate = t.date; filled.push('release date'); }
    if (t.album && !s.project && t.album.toLowerCase() !== s.title.toLowerCase()) { s.project = str(t.album, 120); filled.push('project'); }
    const out = !s.releaseDate || s.releaseDate <= today;
    if (s.links.spotify && out && s.status !== 'released') { s.status = 'released'; filled.push('status'); }
    if (filled.length) { s.updated = now(); this.save(); }
    return filled;
  }

  /* ---- backup ---- */
  exportAll() {
    const versions = {};
    for (const s of this.db.songs) { const v = this.readVersions(s.id); if (v.length) versions[s.id] = v; }
    const db = Object.assign({}, this.db, { settings: Object.assign({}, this.db.settings, { spotifyClientSecret: '' }) });
    return { app: 'studio-notebook', format: 1, exported: now(), db, versions };
  }
  importAll(data) {
    if (!data || data.app !== 'studio-notebook' || !data.db || !Array.isArray(data.db.songs)) throw new Error('This is not a Studio Notebook backup file.');
    this.flush();
    fs.copyFileSync(this.file, path.join(this.backupDir, 'before-restore-' + Date.now() + '.json'));
    const clean = { songs: [], ideas: [], collections: [], settings: this.db.settings };
    const old = this.db;
    this.db = clean;
    try {
      this.updateSettings(data.db.settings || {});
      for (const src of data.db.songs) {
        if (!src || !/^[a-f0-9]{6,24}$/.test(src.id || '')) continue;
        const s = this.createSong({ title: src.title, lyrics: src.lyrics, status: src.status, project: src.project, notes: src.notes });
        this.db.songs.shift();
        const keepFiles = old.songs.find((o) => o.id === src.id);
        s.id = src.id;
        s.created = str(src.created, 30) || s.created;
        this.db.songs.push(s);
        this.updateSong(s.id, { tags: src.tags || [], releaseDate: src.releaseDate || '', production: src.production, links: src.links, ids: src.ids, checklist: src.checklist || [], collected: src.collected || [] });
        s.updated = str(src.updated, 30) || s.updated;
        // audio and cover files are not part of a backup; keep the ones already here
        if (keepFiles) { s.cover = keepFiles.cover; s.audio = keepFiles.audio; }
        const v = data.versions && data.versions[src.id];
        if (Array.isArray(v)) this.writeVersions(s.id, v.slice(0, 200).map((x) => ({ id: str(x.id, 20) || id(), label: str(x.label, 120), auto: !!x.auto, at: str(x.at, 30), title: str(x.title, 200), lyrics: str(x.lyrics, 200000) })));
      }
      for (const i of data.db.ideas || []) { const idea = this.createIdea(i || {}); if (idea) { this.db.ideas.shift(); idea.created = str(i.created, 30) || idea.created; idea.pinned = !!i.pinned; idea.songId = this.getSong(i.songId) ? i.songId : ''; this.db.ideas.push(idea); } }
      for (const c of data.db.collections || []) { const col = this.createCollection(c && c.name); this.updateCollection(col.id, { items: (c && c.items) || [] }); }
    } catch (e) { this.db = old; throw e; }
    this.flush();
  }
}

module.exports = { Store, STATUSES, DEFAULT_CHECKLIST, id };
