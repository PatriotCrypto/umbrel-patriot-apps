'use strict';
/*
 * Studio Notebook: a songwriter's notebook for Umbrel.
 * No runtime dependencies. Everything is stored under DATA_DIR.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store, STATUSES } = require('./lib/store');
const words = require('./lib/words');
const release = require('./lib/release');
const services = require('./lib/services');
const pkg = require('./package.json');

const PORT = +(process.env.PORT || 3983);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'devdata');
const PUBLIC = path.join(__dirname, 'public');
const MAX_JSON = 2 * 1024 * 1024;
const MAX_COVER = 25 * 1024 * 1024;
const MAX_AUDIO = 400 * 1024 * 1024;

const store = new Store(DATA_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aif': 'audio/aiff', '.aiff': 'audio/aiff',
};
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.aif', '.aiff'];

const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, Object.assign({ 'Content-Length': buf.length }, SECURITY, headers));
  res.end(buf);
}
const json = (res, data, status = 200) => send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(declared) || +declared > limit)) {
      req.resume();
      return reject(new HttpError(413, 'That is too large.'));
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'That is too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, MAX_JSON);
  if (!buf.length) return {};
  try {
    const v = JSON.parse(buf.toString('utf8'));
    if (!v || typeof v !== 'object') throw new Error();
    return v;
  } catch (e) { throw new HttpError(400, 'The request was not valid JSON.'); }
}

/* Stream an upload straight to disk so large audio never sits in memory. */
function saveUpload(req, target, limit) {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(declared) || +declared > limit)) {
      req.resume();
      return reject(new HttpError(413, 'That file is too large.'));
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.part';
    const out = fs.createWriteStream(tmp);
    let size = 0, failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rm(tmp, { force: true }, () => reject(err));
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { fail(new HttpError(413, 'That file is too large.')); req.destroy(); }
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new HttpError(400, 'The upload was interrupted.')));
    out.on('error', fail);
    out.on('finish', () => {
      if (failed) return;
      if (!size) return fail(new HttpError(400, 'The file was empty.'));
      fs.rename(tmp, target, (err) => (err ? fail(err) : resolve(size)));
    });
    req.pipe(out);
  });
}

function serveFile(req, res, file, extra = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = Object.assign({ 'Content-Type': type, 'Accept-Ranges': 'bytes' }, SECURITY, extra);
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = st.size - 1, status = 200;
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = +range[1]; if (range[2]) end = Math.min(+range[2], end); }
      else start = Math.max(0, st.size - +range[2]);
      if (start > end || start >= st.size) {
        res.writeHead(416, Object.assign({ 'Content-Range': `bytes */${st.size}` }, SECURITY));
        return res.end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
}

const safeName = (s) => String(s || '').replace(/[\\/\0-\x1f"<>|:*?]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
const fileSlug = (s) => (String(s || 'song').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'song').slice(0, 80);
const needId = (v) => { if (!/^[a-f0-9]{6,24}$/.test(v || '')) throw new HttpError(404, 'Not found.'); return v; };
const needSong = (sid) => { const s = store.getSong(needId(sid)); if (!s) throw new HttpError(404, 'That song no longer exists.'); return s; };

function lyricsText(song) {
  const artist = store.db.settings.artist;
  return `${song.title}${artist ? '\n' + artist : ''}\n\n${song.lyrics.trim()}\n`;
}

const localDay = (v) => (/^\d{4}-\d\d-\d\d$/.test(v || '') ? v : new Date().toISOString().slice(0, 10));

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);   // after "api"
  const m = req.method;
  const q = url.searchParams;

  if (m !== 'GET' && m !== 'HEAD' && req.headers['x-studio-notebook'] !== '1') {
    throw new HttpError(403, 'Missing request header.');
  }

  /* ---- overview ---- */
  if (parts[0] === 'state' && m === 'GET') {
    return json(res, {
      version: pkg.version, statuses: STATUSES, settings: store.publicSettings(), songs: store.listSongs(),
      ideas: store.db.ideas, collections: store.db.collections, words: words.available(),
      topWords: store.topWords(5), today: localDay(q.get('today')),
      suggest: release.suggest(store.db.songs, store.db.settings.cadenceWeeks, localDay(q.get('today'))),
    });
  }

  /* ---- songs ---- */
  if (parts[0] === 'songs') {
    if (parts.length === 1 && m === 'POST') return json(res, store.createSong(await readJson(req)), 201);
    if (parts.length === 1 && m === 'GET') return json(res, store.listSongs());
    const song = needSong(parts[1]);
    if (parts.length === 2) {
      if (m === 'GET') return json(res, song);
      if (m === 'PUT') { store.updateSong(song.id, await readJson(req)); return json(res, { ok: true, updated: song.updated, summary: store.summary(song) }); }
      if (m === 'DELETE') { store.deleteSong(song.id); return json(res, { ok: true }); }
    }
    if (parts[2] === 'export.txt' && m === 'GET') {
      return send(res, 200, lyricsText(song), { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileSlug(song.title)}.txt"` });
    }
    if (parts[2] === 'versions') {
      if (parts.length === 3 && m === 'GET') return json(res, store.readVersions(song.id).map((v) => ({ id: v.id, label: v.label, auto: v.auto, at: v.at, chars: v.lyrics.length })));
      if (parts.length === 3 && m === 'POST') { const b = await readJson(req); const v = store.addVersion(song, b.label || 'Saved version', false); return json(res, { id: v.id }, 201); }
      const vid = needId(parts[3]);
      if (m === 'GET') { const v = store.readVersions(song.id).find((x) => x.id === vid); if (!v) throw new HttpError(404, 'That version no longer exists.'); return json(res, v); }
      if (m === 'DELETE') return json(res, { ok: store.deleteVersion(song.id, vid) });
    }
    if (parts[2] === 'cover') {
      if (m === 'POST') {
        const ext = path.extname(safeName(q.get('name'))).toLowerCase();
        if (!IMAGE_EXT.includes(ext)) throw new HttpError(400, 'Cover art must be a PNG, JPG, WEBP or GIF image.');
        const name = 'cover-' + Date.now().toString(36) + ext;
        await saveUpload(req, path.join(store.filesDir, song.id, name), MAX_COVER);
        if (song.cover) fs.rm(path.join(store.filesDir, song.id, song.cover), { force: true }, () => {});
        song.cover = name; song.updated = new Date().toISOString(); store.save();
        return json(res, { cover: name });
      }
      if (m === 'DELETE') {
        if (song.cover) fs.rm(path.join(store.filesDir, song.id, song.cover), { force: true }, () => {});
        song.cover = ''; store.save();
        return json(res, { ok: true });
      }
    }
    if (parts[2] === 'audio') {
      if (parts.length === 3 && m === 'POST') {
        const original = safeName(q.get('name')) || 'take';
        const ext = path.extname(original).toLowerCase();
        if (!AUDIO_EXT.includes(ext)) throw new HttpError(400, 'Audio must be MP3, WAV, M4A, AAC, FLAC, OGG, OPUS or AIFF.');
        if (song.audio.length >= 60) throw new HttpError(400, 'This song already has 60 takes. Delete one first.');
        const aid = require('./lib/store').id();
        const file = 'take-' + aid + ext;
        const size = await saveUpload(req, path.join(store.filesDir, song.id, file), MAX_AUDIO);
        const take = { id: aid, name: original.slice(0, -ext.length) || 'Take', file, size, note: '', added: new Date().toISOString() };
        song.audio.unshift(take); song.updated = take.added; store.save();
        return json(res, take, 201);
      }
      if (parts.length === 4 && m === 'DELETE') {
        const aid = needId(parts[3]);
        const take = song.audio.find((a) => a.id === aid);
        if (!take) throw new HttpError(404, 'That take no longer exists.');
        fs.rm(path.join(store.filesDir, song.id, take.file), { force: true }, () => {});
        song.audio = song.audio.filter((a) => a.id !== aid); store.save();
        return json(res, { ok: true });
      }
    }
    throw new HttpError(404, 'Not found.');
  }

  /* ---- ideas ---- */
  if (parts[0] === 'ideas') {
    if (parts.length === 1 && m === 'POST') {
      const idea = store.createIdea(await readJson(req));
      if (!idea) throw new HttpError(400, 'Write something first.');
      return json(res, idea, 201);
    }
    if (parts.length === 2) {
      const iid = needId(parts[1]);
      if (m === 'PUT') { const idea = store.updateIdea(iid, await readJson(req)); if (!idea) throw new HttpError(404, 'That idea no longer exists.'); return json(res, idea); }
      if (m === 'DELETE') return json(res, { ok: store.deleteIdea(iid) });
    }
    throw new HttpError(404, 'Not found.');
  }

  /* ---- collections ---- */
  if (parts[0] === 'collections') {
    if (parts.length === 1 && m === 'POST') return json(res, store.createCollection((await readJson(req)).name), 201);
    if (parts.length === 2) {
      const cid = needId(parts[1]);
      if (m === 'PUT') { const c = store.updateCollection(cid, await readJson(req)); if (!c) throw new HttpError(404, 'That collection no longer exists.'); return json(res, c); }
      if (m === 'DELETE') return json(res, { ok: store.deleteCollection(cid) });
    }
    throw new HttpError(404, 'Not found.');
  }

  /* ---- settings, import, export ---- */
  if (parts[0] === 'settings' && m === 'PUT') { store.updateSettings(await readJson(req)); return json(res, store.publicSettings()); }

  /* ---- release planning and the streaming services ---- */
  if (parts[0] === 'calendar' && m === 'GET') {
    const from = localDay(q.get('from')), to = localDay(q.get('to'));
    return json(res, { events: release.events(from, to < from ? from : to).slice(0, 80) });
  }
  if (parts[0] === 'streams' && parts[1] === 'sync' && m === 'POST') {
    const body = await readJson(req);
    const set = store.db.settings;
    if (!services.spotifyArtistId(set.spotifyUrl)) throw new HttpError(400, 'Add your Spotify artist link in Settings first.');
    const cat = await services.catalogue(set);
    const today = localDay(body.today);
    const matched = [], unmatched = [];
    for (const t of cat.tracks) {
      const song = store.db.songs.find((s) => services.sameTitle(s.title, t.title));
      if (!song) { unmatched.push(t); continue; }
      const filled = store.applyTrack(song.id, t, today);
      matched.push({ id: song.id, title: song.title, filled });
    }
    set.lastSync = new Date().toISOString(); store.save();
    return json(res, { matched, unmatched, notes: cat.notes, counts: cat.counts, spotifyFull: cat.spotifyFull, haveSpotify: cat.haveSpotify });
  }
  if (parts[0] === 'streams' && parts[1] === 'link' && m === 'POST') {
    // tie a track from the services to a song the titles did not match, or add it as a new song
    const body = await readJson(req);
    const t = body.track && typeof body.track === 'object' ? body.track : {};
    const track = { title: String(t.title || '').slice(0, 200), spotify: String(t.spotify || ''), date: String(t.date || '') };
    const today = localDay(body.today);
    let song = body.song === 'new' ? store.createSong({ title: track.title || 'Untitled', status: 'released' }) : store.getSong(String(body.song || ''));
    if (!song) throw new HttpError(404, 'That song is gone.');
    const filled = store.applyTrack(song.id, track, today);
    return json(res, { id: song.id, filled });
  }
  if (parts[0] === 'import' && m === 'POST') {
    const body = await readJson(req);
    const items = Array.isArray(body.items) ? body.items.slice(0, 300) : [];
    const made = [];
    for (const it of items) {
      if (!it || typeof it.lyrics !== 'string' || !it.lyrics.trim()) continue;
      made.push(store.createSong({ title: it.title, lyrics: it.lyrics.replace(/\r\n?/g, '\n'), status: 'writing' }).id);
    }
    return json(res, { imported: made.length, ids: made });
  }
  if (parts[0] === 'export' && parts[1] === 'lyrics.txt' && m === 'GET') {
    const text = store.db.songs.map((s) => lyricsText(s)).join('\n' + '-'.repeat(40) + '\n\n');
    return send(res, 200, text || 'No songs yet.\n', { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="all-lyrics.txt"' });
  }
  if (parts[0] === 'backup' && m === 'GET') {
    store.flush();
    return send(res, 200, JSON.stringify(store.exportAll()), { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="studio-notebook-backup-${new Date().toISOString().slice(0, 10)}.json"` });
  }
  if (parts[0] === 'restore' && m === 'POST') {
    const buf = await readBody(req, 80 * 1024 * 1024);
    let data;
    try { data = JSON.parse(buf.toString('utf8')); } catch (e) { throw new HttpError(400, 'That file is not valid JSON.'); }
    try { store.importAll(data); } catch (e) { throw new HttpError(400, e.message); }
    return json(res, { ok: true, songs: store.db.songs.length });
  }
  if (parts[0] === 'search' && m === 'GET') {
    const term = (q.get('q') || '').toLowerCase().trim();
    if (term.length < 2) return json(res, []);
    const hits = [];
    for (const s of store.db.songs) {
      const lines = s.lyrics.split('\n');
      const found = lines.filter((l) => l.toLowerCase().includes(term)).slice(0, 3);
      if (found.length || s.title.toLowerCase().includes(term) || s.notes.toLowerCase().includes(term)) hits.push({ id: s.id, title: s.title, lines: found });
    }
    return json(res, hits.slice(0, 60));
  }

  /* ---- word tools ---- */
  if (parts[0] === 'analyze' && m === 'POST') {
    const body = await readJson(req);
    if (!words.available()) return json(res, { lines: null });
    return json(res, { lines: words.analyze(body.text) });
  }
  if (parts[0] === 'w' && m === 'GET') {
    if (!words.available()) throw new HttpError(503, 'The word data is missing from this build.');
    const term = (q.get('q') || '').slice(0, 120);
    const opts = { syl: q.get('syl') || 0, rare: q.get('rare') === '1' };
    switch (parts[1]) {
      case 'rhymes': {
        const type = q.get('type') || 'perfect';
        if (!/^(perfect|close|wide|multi[234]|phrases)$/.test(type)) throw new HttpError(400, 'Unknown rhyme type.');
        return json(res, words.rhymes(term, type, opts));
      }
      case 'family': return json(res, words.family(term));
      case 'meaning': return json(res, words.meaning(term));
      case 'phrases': return json(res, words.phrases(term));
      case 'sounds': return json(res, words.alliteration(term, opts));
      case 'figures': return json(res, words.figures(term, q.get('kind') || ''));
      case 'bible': return json(res, words.bible(term));
      default: throw new HttpError(404, 'Not found.');
    }
  }
  throw new HttpError(404, 'Not found.');
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' }); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' }); }
  if (pathname.includes('\0')) return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' });

  if (pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });

  if (pathname.startsWith('/api/')) {
    return api(req, res, url).catch((err) => {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.destroy();
      json(res, { error: status === 500 ? 'Something went wrong on the server.' : err.message }, status);
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });

  /* uploaded cover art and audio: /files/<songId>/<file> */
  const fm = /^\/files\/([a-f0-9]{6,24})\/((?:cover|take)-[a-z0-9]+\.[a-z0-9]{2,5})$/.exec(pathname);
  if (fm) {
    const disp = url.searchParams.get('download') ? { 'Content-Disposition': `attachment; filename="${fileSlug(url.searchParams.get('download'))}${path.extname(fm[2])}"` } : {};
    return serveFile(req, res, path.join(store.filesDir, fm[1], fm[2]), Object.assign({ 'Cache-Control': 'private, max-age=31536000, immutable' }, disp));
  }

  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  const cache = rel.startsWith('fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  serveFile(req, res, file, { 'Cache-Control': cache });
});

server.requestTimeout = 0;          // long audio uploads over slow Wi-Fi
server.headersTimeout = 30000;

function shutdown() {
  try { store.flush(); } catch (e) { console.error(e); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (e) => console.error('uncaught', e));
process.on('unhandledRejection', (e) => console.error('unhandled', e));

if (require.main === module) {
  server.listen(PORT, () => console.log(`Studio Notebook ${pkg.version} on port ${PORT}, data in ${DATA_DIR}`));
}

module.exports = { server, store };
