'use strict';
// "Ask your files": a small full-text index (BM25) over folders YOU choose.
// Nothing is indexed until a folder is added. The mounted storage is read-only, hidden
// files and secret-looking names are always skipped, and symlinks are never followed.
const fs = require('fs');
const path = require('path');
const X = require('./extract');

const STOP = new Set(('a an and are as at be but by for from has have he her his i if in into is it its me my of on or our she so that the their ' +
  'them then there these they this to up us was we were what when where which who why will with you your do does did can could should would about ' +
  'how not no yes').split(' '));

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_CHUNKS = 60000;
const CHUNK = 900;
const OVERLAP = 120;

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('es') && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function tokenize(text) {
  const out = [];
  const m = String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!m) return out;
  for (const w of m) {
    if (w.length > 40) continue;
    if (w.length < 2 && !/\d/.test(w)) continue;
    if (STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

function chunkText(text) {
  const t = String(text).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!t) return [];
  const paras = t.split(/\n{2,}/).flatMap((p) => {
    if (p.length <= CHUNK) return [p];
    const out = [];
    let rest = p;
    while (rest.length > CHUNK) {
      let cut = rest.lastIndexOf('. ', CHUNK);
      if (cut < CHUNK * 0.5) cut = rest.lastIndexOf('\n', CHUNK);
      if (cut < CHUNK * 0.5) cut = rest.lastIndexOf(' ', CHUNK);
      if (cut < CHUNK * 0.3) cut = CHUNK;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(Math.max(1, cut + 1 - OVERLAP)).trim();
    }
    if (rest) out.push(rest);
    return out;
  });
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > CHUNK) {
      chunks.push(cur);
      cur = cur.slice(-OVERLAP).replace(/^\S*\s/, '') + '\n\n' + p;
    } else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

function cleanRel(rel) {
  const parts = String(rel || '').split('/').filter((s) => s && s !== '.');
  if (parts.some((p) => p === '..' || p.includes('\0'))) return null;
  return parts.join('/');
}

async function resolveInRoot(root, rel) {
  const clean = cleanRel(rel);
  if (clean === null) return null;
  const realRoot = await fs.promises.realpath(root);
  let real;
  try { real = await fs.promises.realpath(path.join(realRoot, clean)); } catch (e) { return null; }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  return { abs: real, rel: clean, root: realRoot };
}

class Index {
  constructor({ root, file }) {
    this.root = root;
    this.file = file;
    this.docs = new Map(); // rel -> { rel, folder, mtime, size, chunks: [] }
    this.status = { running: false, scanned: 0, indexed: 0, current: '', error: null, startedAt: null, finishedAt: null, skipped: 0, full: false };
    this._built = null;
    this._abort = false;
    this.hasPdf = false;
  }

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (j && j.v === 1 && Array.isArray(j.docs)) for (const d of j.docs) this.docs.set(d.rel, d);
    } catch (e) { /* no index yet */ }
    this._built = null;
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, docs: Array.from(this.docs.values()) }));
    fs.renameSync(tmp, this.file);
  }

  stats() {
    let chunks = 0;
    for (const d of this.docs.values()) chunks += d.chunks.length;
    return { docs: this.docs.size, chunks };
  }

  perFolder(folders) {
    return folders.map((f) => {
      let files = 0;
      let chunks = 0;
      for (const d of this.docs.values()) if (d.folder === f) { files++; chunks += d.chunks.length; }
      return { path: f, files, chunks };
    });
  }

  cancel() { this._abort = true; }

  // Re-scan the given folders (relative to the storage root). Drops files that vanished
  // and anything that belongs to a folder no longer on the list.
  async scan(folders) {
    if (this.status.running) return false;
    this._abort = false;
    this.hasPdf = await X.hasPdftotext();
    Object.assign(this.status, { running: true, scanned: 0, indexed: 0, current: '', error: null, skipped: 0, full: false, startedAt: Date.now(), finishedAt: null });
    const seen = new Set();
    try {
      let total = this.stats().chunks;
      for (const f of folders) {
        const r = await resolveInRoot(this.root, f);
        if (!r) { this.status.error = 'Folder not found: ' + f; continue; }
        const stack = [{ abs: r.abs, rel: r.rel }];
        while (stack.length && !this._abort) {
          const dir = stack.pop();
          let ents;
          try { ents = await fs.promises.readdir(dir.abs, { withFileTypes: true }); } catch (e) { continue; }
          for (const ent of ents) {
            if (this._abort) break;
            if (ent.isSymbolicLink()) continue;
            const rel = dir.rel ? dir.rel + '/' + ent.name : ent.name;
            if (ent.isDirectory()) {
              if (!X.isDenied(ent.name, true) && stack.length < 5000) stack.push({ abs: path.join(dir.abs, ent.name), rel });
              continue;
            }
            if (!ent.isFile()) continue;
            if (X.isDenied(ent.name, false) || !X.supported(ent.name, this.hasPdf)) { this.status.skipped++; continue; }
            this.status.scanned++;
            this.status.current = rel;
            seen.add(rel);
            let st;
            try { st = await fs.promises.stat(path.join(dir.abs, ent.name)); } catch (e) { continue; }
            if (st.size > MAX_FILE_BYTES || st.size === 0) { seen.delete(rel); continue; }
            const old = this.docs.get(rel);
            if (old && old.mtime === Math.floor(st.mtimeMs) && old.size === st.size && old.folder === r.rel) continue;
            if (total >= MAX_CHUNKS) { this.status.full = true; seen.delete(rel); continue; }
            try {
              const text = await X.extractFile(path.join(dir.abs, ent.name), ent.name);
              const chunks = chunkText(text).slice(0, 2000);
              if (old) total -= old.chunks.length;
              if (chunks.length) {
                total += chunks.length;
                this.docs.set(rel, { rel, folder: r.rel, mtime: Math.floor(st.mtimeMs), size: st.size, chunks });
                this.status.indexed++;
              } else this.docs.delete(rel);
            } catch (e) { this.status.skipped++; }
            await new Promise((res) => setImmediate(res));
          }
        }
      }
      if (!this._abort) {
        const want = new Set(folders.map(cleanRel));
        for (const rel of Array.from(this.docs.keys())) {
          const d = this.docs.get(rel);
          if (!want.has(d.folder) || !seen.has(rel)) this.docs.delete(rel);
        }
      }
      this._built = null;
      this.save();
    } catch (e) {
      this.status.error = String((e && e.message) || e);
    } finally {
      this.status.running = false;
      this.status.current = '';
      this.status.finishedAt = Date.now();
    }
    return true;
  }

  forgetFolder(folder) {
    for (const [rel, d] of Array.from(this.docs)) if (d.folder === folder) this.docs.delete(rel);
    this._built = null;
    try { this.save(); } catch (e) { /* ignore */ }
  }

  clear() { this.docs.clear(); this._built = null; try { this.save(); } catch (e) { /* ignore */ } }

  _build() {
    if (this._built) return this._built;
    const chunks = [];
    const post = new Map(); // term -> [chunkId, tf, chunkId, tf, ...]
    let totalLen = 0;
    for (const d of this.docs.values()) {
      const pathTokens = tokenize(d.rel.replace(/[\/._-]+/g, ' '));
      d.chunks.forEach((text, i) => {
        const toks = tokenize(text);
        if (i === 0) for (const t of pathTokens) toks.push(t, t);
        const id = chunks.length;
        chunks.push({ rel: d.rel, i, len: toks.length || 1 });
        totalLen += toks.length || 1;
        const tf = new Map();
        for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
        for (const [t, n] of tf) {
          let a = post.get(t);
          if (!a) post.set(t, (a = []));
          a.push(id, n);
        }
      });
    }
    this._built = { chunks, post, avg: chunks.length ? totalLen / chunks.length : 1 };
    return this._built;
  }

  search(query, { k = 6, perFile = 3 } = {}) {
    const b = this._build();
    const terms = Array.from(new Set(tokenize(query)));
    if (!terms.length || !b.chunks.length) return [];
    const N = b.chunks.length;
    const score = new Map();
    const hits = new Map();
    for (const t of terms) {
      const a = b.post.get(t);
      if (!a) continue;
      const df = a.length / 2;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (let j = 0; j < a.length; j += 2) {
        const id = a[j];
        const tf = a[j + 1];
        const len = b.chunks[id].len;
        const s = idf * ((tf * 2.4) / (tf + 1.4 * (0.25 + 0.75 * (len / b.avg))));
        score.set(id, (score.get(id) || 0) + s);
        hits.set(id, (hits.get(id) || 0) + 1);
      }
    }
    const q = String(query).toLowerCase().replace(/\s+/g, ' ').trim();
    const ranked = [];
    for (const [id, s] of score) {
      const c = b.chunks[id];
      const text = this.docs.get(c.rel).chunks[c.i];
      let v = s * Math.pow(hits.get(id) / terms.length, 1.3);
      if (q.length > 6 && text.toLowerCase().includes(q)) v *= 1.4;
      ranked.push({ id, score: v });
    }
    ranked.sort((a, b2) => b2.score - a.score);
    const out = [];
    const per = new Map();
    for (const r of ranked) {
      const c = b.chunks[r.id];
      const n = per.get(c.rel) || 0;
      if (n >= perFile) continue;
      per.set(c.rel, n + 1);
      out.push({ path: c.rel, chunk: c.i, of: this.docs.get(c.rel).chunks.length, score: Math.round(r.score * 100) / 100, text: this.docs.get(c.rel).chunks[c.i] });
      if (out.length >= k) break;
    }
    return out;
  }
}

// One level of subfolders, for the folder picker.
async function listDirs(root, rel) {
  const r = await resolveInRoot(root, rel || '');
  if (!r) return null;
  let ents = [];
  try { ents = await fs.promises.readdir(r.abs, { withFileTypes: true }); } catch (e) { return null; }
  const dirs = ents.filter((e) => e.isDirectory() && !e.isSymbolicLink() && !X.isDenied(e.name, true)).map((e) => e.name).sort((a, b) => a.localeCompare(b)).slice(0, 500);
  return { path: r.rel, dirs };
}

module.exports = { Index, tokenize, chunkText, resolveInRoot, listDirs, cleanRel };
