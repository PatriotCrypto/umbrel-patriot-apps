// The Bible engine: loads the data once and answers every question in the browser (no server needed).
// The same file runs on the Umbrel and on the Pi hotspot.
import { BOOKS, BOOK_BY_ID, findBook, parseRef } from './books.js';

export { BOOKS, BOOK_BY_ID, parseRef, findBook };

const STOP = new Set(('a an and are as at be but by for from had has have he her him his i in is it its me my no not of on or our she so than that the their them then there these they this to us was we were what when where which who whom why will with would you your thee thou thy thine ye unto shall hath doth do does did how can could should may might must about into over says say said bible tell mean means does').split(' '));

const SUFFIX = '(?:e|es|ed|d|eth|est|th|st|ing|s)?';
const WB_L = "(?<![a-z0-9'’])";
const WB_R = "(?:['’]s)?(?![a-z0-9'’])";
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Reduce a word to a rough root so "love", "loved", "loveth" all match. */
export function stemRoot(word) {
  let w = word.toLowerCase().replace(/[^a-z']/g, '').replace(/['’]s$/, '');
  if (w.length > 4) {
    for (const suf of ['eth', 'est', 'ing', 'ed', 'es', 's', 'th', 'st', 'e', 'd']) {
      if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, -suf.length);
    }
  }
  return w;
}

const normText = t => t.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']+/g, ' ').replace(/ +/g, ' ').trim();

function termRegex(term, exact) {
  if (term.kind === 'phrase') {
    const words = term.text.toLowerCase().replace(/[’‘]/g, "'").split(/[^a-z0-9']+/).filter(Boolean);
    return new RegExp(WB_L + words.map(esc).join("[^a-z0-9]+") + WB_R, 'i');
  }
  if (term.kind === 'prefix') return new RegExp(WB_L + esc(term.text.toLowerCase()) + "[a-z0-9']*" + "(?![a-z0-9'’])", 'i');
  const w = term.text.toLowerCase().replace(/[’‘]/g, "'");
  if (exact) return new RegExp(WB_L + esc(w) + WB_R, 'i');
  const root = stemRoot(w);
  const suf = w.length <= 3 ? '(?:s)?' : SUFFIX;
  return new RegExp(WB_L + esc(root) + suf + WB_R, 'i');
}

/** "faith hope" -> two words; "\"in the beginning\"" -> phrase; "lov*" -> prefix; "-word" excludes; "in:john" scopes */
export function parseQuery(q) {
  const terms = [];
  let scope = null;
  const re = /(-?)"([^"]+)"|(-?)(\S+)/g;
  let m;
  while ((m = re.exec(q))) {
    if (m[2]) { terms.push({ kind: 'phrase', neg: !!m[1], text: m[2] }); continue; }
    let w = m[4];
    const neg = !!m[3];
    const sc = w.match(/^(?:in|book):(.+)$/i);
    if (sc) {
      const v = sc[1].toLowerCase();
      if (v === 'ot' || v === 'nt') scope = { type: 't', value: v.toUpperCase() };
      else { const id = findBook(sc[1].replace(/_/g, ' ')); if (id) scope = { type: 'b', value: id }; }
      continue;
    }
    w = w.replace(/^["'(]+|[",.;:!?)]+$/g, '');
    if (!w) continue;
    if (w.endsWith('*') && w.length > 2) terms.push({ kind: 'prefix', neg, text: w.slice(0, -1) });
    else terms.push({ kind: 'word', neg, text: w });
  }
  return { terms, scope };
}

export class Engine {
  constructor(d) {
    this.kjv = d.kjv.books;
    this.web = d.web ? d.web.books : null;
    this.xref = d.xref || null;
    this.strongsData = d.strongs || null;
    this.timeline = d.timeline;
    this.plans = d.plans;
    this.manifest = d.manifest;
    this.onchain = d.onchain || null;

    this.starts = {};
    this.chapStart = {};
    let n = 0;
    for (const b of BOOKS) {
      this.starts[b.id] = n;
      this.chapStart[b.id] = [];
      for (const ch of this.kjv[b.id]) { this.chapStart[b.id].push(n); n += ch.length; }
    }
    this.total = n;
    this.flat = new Array(n);
    this.bi = new Uint8Array(n);
    this.ci = new Uint16Array(n);
    this.vi = new Uint16Array(n);
    let i = 0;
    for (const b of BOOKS) {
      this.kjv[b.id].forEach((ch, c) => ch.forEach((t, v) => {
        this.flat[i] = t; this.bi[i] = b.index; this.ci[i] = c + 1; this.vi[i] = v + 1; i++;
      }));
    }
    this._norm = {};
    this._inv = null;
  }

  get translations() { return this.web ? ['kjv', 'web'] : ['kjv']; }
  chapterCount(id) { return this.kjv[id].length; }
  verseCount(id, c) { return (this.kjv[id][c - 1] || []).length; }

  idx(id, c, v) {
    const cs = this.chapStart[id];
    if (!cs || c < 1 || c > cs.length || v < 1 || v > this.verseCount(id, c)) return -1;
    return cs[c - 1] + v - 1;
  }
  at(i) { return { id: BOOKS[this.bi[i]].id, c: this.ci[i], v: this.vi[i] }; }
  label(i) { return `${BOOKS[this.bi[i]].name} ${this.ci[i]}:${this.vi[i]}`; }
  labelRange(i, len = 0) {
    if (!len) return this.label(i);
    const j = Math.min(i + len, this.total - 1);
    if (this.bi[i] === this.bi[j] && this.ci[i] === this.ci[j]) return `${BOOKS[this.bi[i]].name} ${this.ci[i]}:${this.vi[i]}-${this.vi[j]}`;
    return `${this.label(i)}–${this.ci[j]}:${this.vi[j]}`;
  }
  /** key like "John.3.16" or "John.3.16-18" */
  key(i, len = 0) {
    const a = this.at(i);
    if (!len) return `${a.id}.${a.c}.${a.v}`;
    const z = this.at(Math.min(i + len, this.total - 1));
    return z.id === a.id && z.c === a.c ? `${a.id}.${a.c}.${a.v}-${z.v}` : `${a.id}.${a.c}.${a.v}`;
  }
  /** key -> { idx, len } */
  fromKey(key) {
    const m = String(key).match(/^([0-9A-Za-z]+)\.(\d+)\.(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const i = this.idx(m[1], +m[2], +m[3]);
    if (i < 0) return null;
    return { idx: i, len: m[4] ? Math.max(0, +m[4] - +m[3]) : 0 };
  }

  text(i, tr = 'kjv') {
    if (tr === 'kjv' || !this.web) return this.flat[i];
    const a = this.at(i);
    const t = (this.web[a.id][a.c - 1] || [])[a.v - 1];
    return t || '';
  }
  rangeText(i, len, tr = 'kjv') {
    const out = [];
    for (let k = 0; k <= len; k++) if (i + k < this.total) out.push(this.text(i + k, tr));
    return out.join(' ');
  }
  /** index of the first verse of a chapter, and its verse count */
  chapter(id, c) { return { start: this.chapStart[id][c - 1], count: this.verseCount(id, c) }; }

  // ------------------------------------------------------------------ search
  _normFor(tr) {
    if (this._norm[tr]) return this._norm[tr];
    const arr = new Array(this.total);
    for (let i = 0; i < this.total; i++) arr[i] = ' ' + normText(this.text(i, tr)) + ' ';
    return (this._norm[tr] = arr);
  }

  search(q, { tr = 'kjv', exact = false, scope = null } = {}) {
    const parsed = parseQuery(q);
    const sc = scope || parsed.scope;
    const terms = parsed.terms;
    const pos = terms.filter(t => !t.neg);
    const neg = terms.filter(t => t.neg);
    const res = { total: 0, hits: [], byBook: new Array(BOOKS.length).fill(0), highlight: null, terms: pos.map(t => t.text), empty: !pos.length };
    if (!pos.length) return res;
    const norm = this._normFor(tr);
    const posRe = pos.map(t => termRegex(t, exact));
    const negRe = neg.map(t => termRegex(t, exact));
    res.highlight = new RegExp(posRe.map(r => r.source).join('|'), 'gi');
    const inScope = i => {
      if (!sc) return true;
      const b = BOOKS[this.bi[i]];
      return sc.type === 't' ? b.testament === sc.value : b.id === sc.value;
    };
    const countScopeless = [];
    for (let i = 0; i < this.total; i++) {
      const s = norm[i];
      let ok = true;
      for (const r of posRe) if (!r.test(s)) { ok = false; break; }
      if (!ok) continue;
      for (const r of negRe) if (r.test(s)) { ok = false; break; }
      if (!ok) continue;
      res.byBook[this.bi[i]]++;
      if (inScope(i)) res.hits.push(i);
    }
    res.total = res.hits.length;
    res.scope = sc;
    void countScopeless;
    return res;
  }

  // ------------------------------------------------------------------ cross references
  xrefs(i) {
    if (!this.xref) return [];
    const flat = this.xref[i];
    if (!flat) return [];
    const out = [];
    for (let k = 0; k < flat.length; k += 2) out.push({ idx: flat[k], len: flat[k + 1] });
    return out;
  }

  // ------------------------------------------------------------------ Strong's
  strongs(code) {
    if (!this.strongsData) return null;
    const m = String(code).trim().match(/^([HG])0*(\d{1,4})$/i);
    if (!m) return null;
    const e = this.strongsData[m[1].toUpperCase()][m[2]];
    if (!e) return null;
    return { code: m[1].toUpperCase() + m[2], lemma: e[0], translit: e[1], pron: e[2], derivation: e[3], def: e[4], kjv: e[5] };
  }

  strongsSearch(q, limit = 60) {
    if (!this.strongsData) return [];
    const direct = this.strongs(q);
    if (direct) return [direct];
    const s = q.toLowerCase().trim();
    if (!s) return [];
    const words = s.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const lang of ['H', 'G']) {
      const table = this.strongsData[lang];
      for (const k in table) {
        const e = table[k];
        const translit = e[1].toLowerCase(), lemma = e[0], def = e[4].toLowerCase(), kjv = e[5].toLowerCase();
        let score = 0;
        if (translit === s || lemma === q.trim()) score = 100;
        else if (translit.startsWith(s)) score = 60;
        else {
          const wordHit = txt => words.every(w => new RegExp("(?<![a-z])" + esc(w), 'i').test(txt));
          if (wordHit(kjv)) score = 40;
          else if (wordHit(def)) score = 25;
        }
        if (score) scored.push({ score, lang, k });
      }
    }
    scored.sort((a, b) => b.score - a.score || (a.lang === b.lang ? +a.k - +b.k : a.lang < b.lang ? 1 : -1));
    return scored.slice(0, limit).map(x => this.strongs(x.lang + x.k));
  }

  // ------------------------------------------------------------------ finding passages for a question (used by Ask)
  _buildInverted() {
    const inv = new Map();
    for (let i = 0; i < this.total; i++) {
      const seen = new Set();
      for (const w of normText(this.flat[i]).split(' ')) {
        if (w.length < 3 || STOP.has(w)) continue;
        const s = stemRoot(w);
        if (s.length < 3 || seen.has(s)) continue;
        seen.add(s);
        let a = inv.get(s); if (!a) inv.set(s, a = []);
        a.push(i);
      }
    }
    this._inv = inv;
  }

  /** Best passages for a free-text question: returns [{ idx, len, label, text }] */
  related(question, k = 8) {
    const out = [];
    // an explicit reference in the question comes first ("what does Romans 8:28 mean")
    const refRe = /((?:[1-3]|i{1,3}|first|second|third)?\s?[A-Za-z]+(?:\s+of\s+[A-Za-z]+)?\.?\s+\d{1,3}(?::\d{1,3}(?:\s*[-–]\s*\d{1,3})?)?)/g;
    let m;
    const used = new Set();
    while ((m = refRe.exec(question))) {
      const r = parseRef(m[1]);
      if (!r || !r.chapter) continue;
      const verseCount = this.kjv[r.book] && this.verseCount(r.book, r.chapter);
      if (!verseCount) continue;
      let i, len;
      if (r.verse) { i = this.idx(r.book, r.chapter, r.verse); len = r.verseEnd ? Math.min(r.verseEnd - r.verse, 14) : 0; }
      else { i = this.idx(r.book, r.chapter, 1); len = Math.min(verseCount - 1, 14); }
      if (i < 0 || used.has(i)) continue;
      used.add(i);
      out.push(this._passage(i, Math.max(0, len)));
      if (out.length >= 2) break;
    }
    if (!this._inv) this._buildInverted();
    const qs = [...new Set(normText(question).split(' ').filter(w => w.length >= 3 && !STOP.has(w)).map(stemRoot))].filter(s => s.length >= 3);
    const score = new Map();
    for (const s of qs) {
      const post = this._inv.get(s);
      if (!post) continue;
      const idf = Math.log(1 + this.total / post.length);
      for (const i of post) score.set(i, (score.get(i) || 0) + idf);
    }
    const ranked = [...score.entries()]
      .map(([i, s]) => [i, s / (1 + this.flat[i].length / 400)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(0, k - out.length) + 6);
    const picked = ranked.slice(0, Math.max(0, k - out.length)).map(x => x[0]).sort((a, b) => a - b);
    // merge verses that sit next to each other into one passage
    let run = null;
    for (const i of picked) {
      if (used.has(i)) continue;
      if (run && i === run.end + 1 && this.bi[i] === this.bi[run.start] && this.ci[i] === this.ci[run.start]) run.end = i;
      else { if (run) out.push(this._passage(run.start, run.end - run.start)); run = { start: i, end: i }; }
    }
    if (run) out.push(this._passage(run.start, run.end - run.start));
    return out;
  }

  _passage(i, len) {
    return { idx: i, len, label: this.labelRange(i, len), key: this.key(i, len), text: this.rangeText(i, len) };
  }
}

/** Fetch all data files. cfg = window.BT. onProgress(doneCount, total, name) */
export async function loadEngine(cfg, onProgress = () => {}) {
  const v = cfg && cfg.version ? '?v=' + encodeURIComponent(cfg.version) : '';
  const inc = (cfg && cfg.include) || { web: true, xref: true, strongs: true };
  const names = ['kjv', 'timeline', 'plans', 'manifest'];
  if (inc.web) names.push('web');
  if (inc.xref) names.push('xref');
  if (inc.strongs) names.push('strongs');
  if (!cfg || !cfg.static) names.push('onchain');
  const d = {};
  let done = 0;
  await Promise.all(names.map(async n => {
    const res = await fetch(`data/${n}.json${v}`);
    if (!res.ok) throw new Error(`Could not load ${n} (HTTP ${res.status})`);
    d[n] = await res.json();
    onProgress(++done, names.length, n);
  }));
  return new Engine(d);
}
