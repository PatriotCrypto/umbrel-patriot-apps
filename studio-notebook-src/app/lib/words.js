'use strict';
/*
 * Offline word tools: rhymes, word families, meanings, phrases, alliteration,
 * figures of speech and a searchable King James Bible.
 *
 * Each data set loads the first time it is used and is dropped again after it
 * has sat unused for a while, so the app stays light on memory when you are
 * only writing.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const P = require('./phon');

const DATA = process.env.WORD_DATA_DIR || path.join(__dirname, '..', 'data');
const SRC = path.join(__dirname, '..', 'data-src');
const IDLE_MS = 20 * 60 * 1000;

const cache = new Map();
function use(name, loader) {
  let e = cache.get(name);
  if (!e) { e = { value: loader() }; cache.set(name, e); }
  e.used = Date.now();
  return e.value;
}
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, e] of cache) if (now - e.used > IDLE_MS) cache.delete(k);
}, 5 * 60 * 1000);
sweep.unref();

const gunzip = (file) => zlib.gunzipSync(fs.readFileSync(path.join(DATA, file))).toString('utf8');
const available = () => fs.existsSync(path.join(DATA, 'pron.txt.gz'));

/* ------------------------------------------------------------------ pron */
function pron() {
  return use('pron', () => {
    const words = [], tiers = [], prons = [];
    const idx = new Map();
    for (const line of gunzip('pron.txt.gz').split('\n')) {
      const a = line.indexOf('\t'), b = line.indexOf('\t', a + 1);
      if (a < 0) continue;
      idx.set(line.slice(0, a), words.length);
      words.push(line.slice(0, a));
      tiers.push(+line.slice(a + 1, b));
      prons.push(line.slice(b + 1));
    }
    return { words, tiers, prons, idx };
  });
}

function rhymeIndex() {
  return use('rhymeIndex', () => {
    const { prons } = pron();
    const perfect = new Map();
    const tails = [null, new Map(), new Map(), new Map(), new Map()];
    const onset = new Map();
    const push = (m, k, id) => {
      if (!k) return;
      const a = m.get(k);
      if (!a) m.set(k, [id]);
      else if (a[a.length - 1] !== id) a.push(id);
    };
    for (let id = 0; id < prons.length; id++) {
      if (!prons[id]) continue;
      const alts = prons[id].split('|');
      for (let k = 0; k < alts.length; k++) {
        const ph = alts[k].split(' ');
        push(perfect, P.perfectKey(ph), id);
        for (let n = 1; n <= 4; n++) push(tails[n], P.tailKey(ph, n), id);
        if (k === 0) push(onset, P.onsetKey(ph), id);
      }
    }
    return { perfect, tails, onset };
  });
}

const norm = (s) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").trim();

/* All known pronunciations of one word, trying a few spelling repairs. */
function pronsOf(raw) {
  const { idx, prons } = pron();
  const w = norm(raw).replace(/^[^a-z]+|[^a-z']+$/g, '');
  if (!w) return null;
  const get = (x) => {
    const id = idx.get(x);
    return id !== undefined && prons[id] ? prons[id].split('|').map((p) => p.split(' ')) : null;
  };
  let r;
  if (w.endsWith("in'") && (r = get(w.slice(0, -1) + 'g'))) return r;       // runnin' -> running
  if ((r = get(w))) return r;
  if (w.endsWith('in') && (r = get(w + 'g'))) return r;                      // runnin -> running
  const bare = w.replace(/'/g, '');
  if (bare !== w && (r = get(bare))) return r;
  if (/'s$/.test(w) && (r = get(w.slice(0, -2)))) return r.map((p) => p.concat('Z'));
  if (w.endsWith('s') && (r = get(w.slice(0, -1)))) return r.map((p) => p.concat('Z'));
  if (w.endsWith('ed') && (r = get(w.slice(0, -2)))) return r.map((p) => p.concat('D'));
  return null;
}

/* Phones for a word or a short phrase (first pronunciation of each word). */
function phonesOf(q) {
  const parts = norm(q).split(/[\s-]+/).filter(Boolean);
  if (!parts.length || parts.length > 8) return null;
  let out = [];
  for (const part of parts) {
    const p = pronsOf(part);
    if (!p) return null;
    out = out.concat(p[0]);
  }
  return out;
}

function syllables(word) {
  const p = pronsOf(word);
  return p ? P.vowels(p[0]).length : P.guessSyllables(word);
}

const trimFinal = (k) => k.replace(/ (S|T)$/, '');

function rhymes(q, type = 'perfect', opts = {}) {
  const query = norm(q);
  const words = query.split(/[\s-]+/).filter(Boolean);
  const last = words[words.length - 1];
  let variants = null;
  if (words.length === 1) variants = pronsOf(last);
  else { const ph = phonesOf(query); variants = ph ? [ph] : null; }
  if (!variants) return { known: false, items: [] };

  const { words: W, tiers, prons } = pron();
  const ix = rhymeIndex();
  const maxTier = opts.rare ? 99 : 70;
  const want = opts.syl ? +opts.syl : 0;
  const seen = new Set();
  const items = [];

  const add = (id) => {
    if (seen.has(id)) return;
    const w = W[id];
    if (w === last || w === query || tiers[id] > maxTier) return;
    const s = P.vowels(prons[id].split('|')[0].split(' ')).length;
    if (want && s !== want) return;
    seen.add(id);
    items.push({ w, s, t: tiers[id] });
  };

  if (type === 'phrases') return rhymedPhrases(variants, opts);

  for (const ph of variants) {
    const pk = P.perfectKey(ph);
    if (type === 'perfect') {
      for (const id of ix.perfect.get(pk) || []) add(id);
      continue;
    }
    const multi = /^multi([234])$/.exec(type);
    if (multi) {
      const n = +multi[1];
      for (const id of ix.tails[n].get(P.tailKey(ph, n)) || []) add(id);
      continue;
    }
    // close and wide: same vowels from the stressed syllable on
    const n = P.vowels(ph.slice(P.rhymeStart(ph))).length;
    if (n < 1 || n > 4) continue;
    const ck = P.classKey(ph);
    for (const id of ix.tails[n].get(P.tailKey(ph, n)) || []) {
      let isPerfect = false, isClose = false, aligned = false;
      for (const alt of prons[id].split('|')) {
        const cp = alt.split(' ');
        if (P.vowels(cp.slice(P.rhymeStart(cp))).length !== n) continue;
        aligned = true;
        if (P.perfectKey(cp) === pk) isPerfect = true;
        const c2 = P.classKey(cp);
        if (c2 === ck || trimFinal(c2) === trimFinal(ck)) isClose = true;
      }
      if (!aligned || isPerfect) continue;
      if (type === 'close' ? isClose : !isClose) add(id);
    }
  }
  items.sort((a, b) => a.t - b.t || a.s - b.s || (a.w < b.w ? -1 : 1));
  return { known: true, total: items.length, items: items.slice(0, 800) };
}

/* ------------------------------------------------------------- phrases */
function phraseData() {
  return use('phrases', () => {
    const list = gunzip('phrases.txt.gz').split('\n');
    const byWord = new Map();
    for (let i = 0; i < list.length; i++) {
      for (const w of new Set(list[i].split(/[\s-]+/))) {
        const a = byWord.get(w);
        if (a) a.push(i); else byWord.set(w, [i]);
      }
    }
    return { list, byWord };
  });
}

function phraseRhymeIndex() {
  return use('phraseRhymes', () => {
    const { list } = phraseData();
    const byKey = new Map();
    for (let i = 0; i < list.length; i++) {
      const words = list[i].split(/[\s-]+/);
      const p = pronsOf(words[words.length - 1]);
      if (!p) continue;
      const k = P.perfectKey(p[0]);
      const a = byKey.get(k);
      if (a) a.push(i); else byKey.set(k, [i]);
    }
    return byKey;
  });
}

function rhymedPhrases(variants, opts) {
  const { list } = phraseData();
  const ix = phraseRhymeIndex();
  const seen = new Set();
  const items = [];
  for (const ph of variants) {
    for (const i of ix.get(P.perfectKey(ph)) || []) {
      if (seen.has(i)) continue;
      seen.add(i);
      items.push({ w: list[i], s: list[i].split(/[\s-]+/).reduce((n, w) => n + syllables(w), 0) });
    }
  }
  const want = opts.syl ? +opts.syl : 0;
  const out = want ? items.filter((x) => x.s === want) : items;
  out.sort((a, b) => a.s - b.s || (a.w < b.w ? -1 : 1));
  return { known: true, total: out.length, items: out.slice(0, 800) };
}

function phrases(q) {
  const terms = norm(q).split(/[\s-]+/).filter(Boolean);
  if (!terms.length) return { items: [], total: 0 };
  const { list, byWord } = phraseData();
  let ids = null;
  for (const t of terms) {
    const set = new Set();
    for (const v of variantsOf(t)) for (const id of byWord.get(v) || []) set.add(id);
    ids = ids === null ? set : new Set([...ids].filter((x) => set.has(x)));
    if (!ids.size) break;
  }
  const query = terms.join(' ');
  const items = [...(ids || [])].map((i) => list[i]);
  const rank = (p) => (p.startsWith(query + ' ') ? 0 : p.endsWith(' ' + query) ? 1 : 2);
  items.sort((a, b) => rank(a) - rank(b) || a.length - b.length || (a < b ? -1 : 1));
  return { total: items.length, items: items.slice(0, 600) };
}

/* Simple inflection repairs: "burning" -> burn, "cities" -> city. */
function variantsOf(w) {
  const out = [w];
  const add = (x) => { if (x.length > 1 && !out.includes(x)) out.push(x); };
  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) add(w.slice(0, -2));
  if (w.endsWith('s')) add(w.slice(0, -1));
  if (w.endsWith('ed')) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (/(.)\1ed$/.test(w)) add(w.slice(0, -3)); }
  if (w.endsWith('ing')) { add(w.slice(0, -3)); add(w.slice(0, -3) + 'e'); if (/(.)\1ing$/.test(w)) add(w.slice(0, -4)); }
  if (w.endsWith("in'")) { add(w.slice(0, -3)); add(w.slice(0, -1) + 'g'); }
  if (w.endsWith('er')) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
  if (w.endsWith('est')) { add(w.slice(0, -3)); add(w.slice(0, -2)); }
  if (w.endsWith('ly')) add(w.slice(0, -2));
  return out;
}

/* ------------------------------------------------------------- meaning */
function thes() {
  return use('thes', () => {
    const lines = gunzip('thes.txt.gz').split('\n');
    const byWord = new Map();
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i].indexOf('\t'), b = lines[i].indexOf('\t', a + 1), c = lines[i].indexOf('\t', b + 1);
      for (const w of lines[i].slice(b + 1, c).split('|')) {
        const k = w.toLowerCase();
        const arr = byWord.get(k);
        if (arr) arr.push(i); else byWord.set(k, [i]);
      }
    }
    return { lines, byWord };
  });
}

const POS = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' };

function meaning(q) {
  const query = norm(q);
  if (!query) return { word: '', senses: [] };
  const { lines, byWord } = thes();
  let word = query, ids = byWord.get(query);
  if (!ids) for (const v of variantsOf(query)) { if ((ids = byWord.get(v))) { word = v; break; } }
  if (!ids) return { word: query, senses: [] };
  const senses = ids.slice(0, 40).map((i) => {
    const [pos, gloss, words, ants, rel] = lines[i].split('\t');
    const cut = gloss.indexOf('; "');
    const list = (s) => (s ? s.split('|') : []);
    return {
      pos: POS[pos] || pos,
      def: cut > -1 ? gloss.slice(0, cut) : gloss,
      ex: cut > -1 ? gloss.slice(cut + 2).replace(/^"|"$/g, '') : '',
      syns: list(words).filter((w) => w.toLowerCase() !== word),
      ants: list(ants),
      rel: list(rel),
    };
  });
  return { word, senses };
}

/* -------------------------------------------------------------- family */
function moby() {
  return use('moby', () => {
    const map = new Map();
    for (const line of gunzip('moby.txt.gz').split('\n')) {
      const i = line.indexOf(',');
      if (i > 0) map.set(line.slice(0, i), line);
    }
    return map;
  });
}

function family(q) {
  const query = norm(q);
  if (!query) return { root: '', words: [], phrases: [] };
  const map = moby();
  let root = null;
  for (const v of variantsOf(query)) if (map.has(v)) { root = v; break; }
  if (!root) {
    // fall back to the closest synonym that has a family of its own
    for (const s of meaning(query).senses) {
      const hit = s.syns.find((w) => map.has(w.toLowerCase()));
      if (hit) { root = hit.toLowerCase(); break; }
    }
  }
  if (!root) return { root: '', words: [], phrases: [] };
  const { idx, tiers } = pron();
  const words = [], phr = [];
  for (const w of map.get(root).split(',').slice(1)) {
    if (w.includes(' ')) phr.push(w);
    else { const id = idx.get(w.toLowerCase()); words.push({ w, t: id === undefined ? 99 : tiers[id] }); }
  }
  words.sort((a, b) => a.t - b.t || (a.w < b.w ? -1 : 1));
  return { root, words, phrases: phr };
}

/* -------------------------------------------------------- alliteration */
function alliteration(q, opts = {}) {
  const ph = pronsOf(norm(q).split(/[\s-]+/)[0] || '');
  if (!ph) return { known: false, items: [] };
  const { words: W, tiers, prons } = pron();
  const ids = rhymeIndex().onset.get(P.onsetKey(ph[0])) || [];
  const maxTier = opts.rare ? 99 : 50;
  const want = opts.syl ? +opts.syl : 0;
  const items = [];
  for (const id of ids) {
    if (tiers[id] > maxTier) continue;
    const s = P.vowels(prons[id].split('|')[0].split(' ')).length;
    if (want && s !== want) continue;
    items.push({ w: W[id], s, t: tiers[id] });
  }
  items.sort((a, b) => a.t - b.t || a.s - b.s || (a.w < b.w ? -1 : 1));
  return { known: true, total: items.length, items: items.slice(0, 800) };
}

/* ------------------------------------------------------------- figures */
function figures(q, kind) {
  const all = use('figures', () => JSON.parse(fs.readFileSync(path.join(SRC, 'figures.json'), 'utf8')));
  const query = norm(q);
  const out = {};
  for (const k of Object.keys(all)) {
    if (kind && kind !== k) continue;
    out[k] = query ? all[k].filter((x) => x.toLowerCase().includes(query)) : all[k];
  }
  return out;
}

/* --------------------------------------------------------------- bible */
const BOOKS = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'];

function kjv() {
  return use('kjv', () => {
    const books = JSON.parse(gunzip('kjv.json.gz')).books;
    const verses = [];
    Object.keys(books).forEach((key, b) => {
      books[key].forEach((chapter, c) => chapter.forEach((text, v) => {
        verses.push({ ref: `${BOOKS[b] || key} ${c + 1}:${v + 1}`, text, low: text.toLowerCase() });
      }));
    });
    return verses;
  });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function bible(q) {
  const raw = norm(q);
  if (raw.length < 2) return { total: 0, items: [] };
  const quoted = /^".*"$/.test(raw);
  const text = raw.replace(/"/g, '').trim();
  const terms = quoted ? [text] : text.split(/\s+/).filter(Boolean).slice(0, 6);
  const tests = terms.map((t) => new RegExp('(^|[^a-z])' + escapeRe(t) + '($|[^a-z])'));
  const items = [];
  let total = 0;
  for (const v of kjv()) {
    if (!tests.every((re) => re.test(v.low))) continue;
    total++;
    if (items.length < 250) items.push({ ref: v.ref, text: v.text });
  }
  return { total, items };
}

/* ------------------------------------------------------------- analyze */
const TOKEN = /[A-Za-z][A-Za-z'’]*/g;

/* The ways a word can rhyme inside a verse, loosest last:
   v: the vowels from the stressed syllable on (bubbling, stumbling; confusion, illusion)
   t: the last two syllables exactly, for long words (particular, molecular, muscular)
   h: the first two vowels of a long tail (articulate, particular)
   Two words rhyme when they share any one of these. */
function rhymeSounds(prons) {
  const out = new Set();
  for (const ph of prons.slice(0, 2)) {
    const tail = P.vowels(ph.slice(P.rhymeStart(ph)));
    if (tail.length) out.add('v:' + tail.join(' '));
    if (tail.length >= 3) out.add('h:' + tail.slice(0, 2).join(' '));
    const idx = [];
    ph.forEach((x, i) => { if (P.isVowel(x)) idx.push(i); });
    if (idx.length >= 3) out.add('t:' + ph.slice(idx[idx.length - 2]).map((x) => (P.isVowel(x) ? P.normVowel(x) : x)).join(' '));
  }
  return [...out];
}

/* Per-line syllable counts and a rhyme sound for every word, used by the
   editor to show bar lengths and colour words that rhyme. */
function analyze(text) {
  const lines = String(text || '').slice(0, 60000).split('\n');
  return lines.map((line) => {
    const tag = /^\s*[\[(].*[\])]\s*$/.test(line) || !line.trim();
    if (tag) return { syl: 0, tag: true, toks: [] };
    let syl = 0;
    const toks = [];
    TOKEN.lastIndex = 0;
    let m;
    while ((m = TOKEN.exec(line))) {
      const p = pronsOf(m[0]);
      let s, key = [];
      if (p) {
        s = P.vowels(p[0]).length;
        key = rhymeSounds(p);
      } else s = P.guessSyllables(m[0]);
      syl += s;
      toks.push([m.index, m.index + m[0].length, key]);
    }
    return { syl, tag: false, toks };
  });
}

module.exports = { available, rhymes, phrases, meaning, family, alliteration, figures, bible, analyze, syllables, pronsOf, _cache: cache };
