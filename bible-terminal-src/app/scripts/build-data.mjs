// Builds app/data/*.json from public sources. Run:  node scripts/build-data.mjs
// - KJV text is read straight from the 66 Ordinals inscriptions (via a mempool.space-compatible API).
// - WEB (World English Bible, public domain), openbible.info cross-references (CC BY),
//   and Open Scriptures' Strong's dictionaries (CC BY-SA) come from GitHub / openbible.info.
// Downloads are cached in app/.cache so re-runs are fast. Set MEMPOOL_API to use another explorer.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BOOKS, BOOK_BY_ID } from '../public/js/books.js';

const require = createRequire(import.meta.url);
const { extractInscription } = require('../server/lib/envelope.js');
const { parseInscribedBook, toChapters } = require('../server/lib/inscribed.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data');
const CACHE = path.join(ROOT, '.cache');
const API = (process.env.MEMPOOL_API || 'https://mempool.space/api').replace(/\/$/, '');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

async function getCached(name, url, { json = false, tries = 5 } = {}) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      return buf;
    } catch (e) { lastErr = e; await sleep(1500 * (i + 1)); }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- KJV from the chain
const txids = JSON.parse(fs.readFileSync(path.join(ROOT, 'data-src/txids.json'), 'utf8'));
delete txids._note;

console.log('KJV from the chain via', API);
const kjv = { id: 'kjv', name: 'King James Version', note: 'Text exactly as inscribed on the Bitcoin blockchain.', books: {} };
const onchain = [];
const problems = [];
for (const b of BOOKS) {
  const txid = txids[b.id];
  if (!txid) throw new Error('no txid for ' + b.id);
  const buf = await getCached(`onchain/${b.id}.json`, `${API}/tx/${txid}`);
  const tx = JSON.parse(buf.toString('utf8'));
  if (tx.txid !== txid) throw new Error(`${b.id}: explorer returned ${tx.txid}`);
  const insc = extractInscription(tx);
  if (!insc) throw new Error(`${b.id}: no inscription found in ${txid}`);
  const text = insc.content.toString('utf8');
  const { verses, header } = parseInscribedBook(text, b.id);
  if (!verses.length) throw new Error(`${b.id}: no verses parsed`);
  const { chapters, problems: p2 } = toChapters(verses, b.id);
  problems.push(...p2);
  kjv.books[b.id] = chapters;
  onchain.push({ id: b.id, name: b.name, txid, bytes: insc.content.length, sha256: sha256(insc.content), contentType: insc.contentType, headline: header.join(' | ') });
  process.stdout.write(`  ${b.id.padEnd(7)} ${String(chapters.length).padStart(3)} ch ${String(verses.length).padStart(5)} v  ${(insc.content.length / 1024).toFixed(1).padStart(7)} KB  "${header.join(' | ')}"\n`);
}

// verse index helpers
const bookStart = {}; // book id -> index of its first verse
const chapStart = {}; // book id -> [index of first verse of each chapter]
let total = 0;
for (const b of BOOKS) {
  bookStart[b.id] = total;
  chapStart[b.id] = [];
  for (const ch of kjv.books[b.id]) { chapStart[b.id].push(total); total += ch.length; }
}
console.log('KJV verses:', total, '(standard count is 31,102)');
if (problems.length) { console.log('KJV notes:'); for (const p of problems.slice(0, 40)) console.log('  -', p); if (problems.length > 40) console.log('  ...', problems.length - 40, 'more'); }
const idxOf = (id, c, v) => {
  const cs = chapStart[id]; if (!cs || c < 1 || c > cs.length) return -1;
  const n = (c < cs.length ? cs[c] : (BOOKS[BOOK_BY_ID[id].index + 1] ? bookStart[BOOKS[BOOK_BY_ID[id].index + 1].id] : total)) - cs[c - 1];
  if (v < 1 || v > n) return -1; return cs[c - 1] + v - 1;
};

// ---------------------------------------------------------------- WEB
console.log('WEB from GitHub');
const webName = n => n.toLowerCase().replace(/\s+/g, '');
const web = { id: 'web', name: 'World English Bible', note: 'Public domain.', books: {} };
let webGaps = 0;
for (const b of BOOKS) {
  const buf = await getCached(`web/${b.id}.json`, `https://raw.githubusercontent.com/TehShrike/world-english-bible/master/json/${webName(b.name)}.json`);
  const items = JSON.parse(buf.toString('utf8'));
  const chapters = [];
  for (const it of items) {
    if (!it.chapterNumber || !it.verseNumber || typeof it.value !== 'string') continue;
    const ch = (chapters[it.chapterNumber - 1] ||= []);
    ch[it.verseNumber - 1] = ((ch[it.verseNumber - 1] || '') + ' ' + it.value).replace(/\s+/g, ' ').trim();
  }
  for (let i = 0; i < chapters.length; i++) {
    chapters[i] ||= [];
    for (let j = 0; j < chapters[i].length; j++) if (chapters[i][j] === undefined) { chapters[i][j] = ''; webGaps++; }
  }
  web.books[b.id] = chapters;
}
const webVerses = Object.values(web.books).reduce((n, b) => n + b.reduce((m, c) => m + c.length, 0), 0);
console.log('WEB verses:', webVerses, 'gaps:', webGaps);

// ---------------------------------------------------------------- cross references
console.log('Cross references from openbible.info');
const zipBuf = await getCached('xref/cross-references.zip', 'https://a.openbible.info/data/cross-references.zip');
const xrefText = await (async () => {
  // minimal zip reader: first file, deflate
  const eocd = zipBuf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cdOff = zipBuf.readUInt32LE(eocd + 16);
  const compSize = zipBuf.readUInt32LE(cdOff + 20);
  const method = zipBuf.readUInt16LE(cdOff + 10);
  const lho = zipBuf.readUInt32LE(cdOff + 42);
  const nlen = zipBuf.readUInt16LE(lho + 26), elen = zipBuf.readUInt16LE(lho + 28);
  const data = zipBuf.subarray(lho + 30 + nlen + elen, lho + 30 + nlen + elen + compSize);
  return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
})();
const refIdx = s => { const m = s.match(/^([0-9A-Za-z]+)\.(\d+)\.(\d+)$/); return m ? idxOf(m[1], +m[2], +m[3]) : -1; };
const xr = new Map();
let xrRows = 0, xrKept = 0;
for (const line of xrefText.split('\n')) {
  if (!line || line.startsWith('From Verse')) continue;
  const [from, to, votesS] = line.split('\t');
  const votes = parseInt(votesS, 10);
  xrRows++;
  if (!(votes > 0)) continue;
  const f = refIdx(from);
  const [t1, t2] = to.split('-');
  const a = refIdx(t1), z = t2 ? refIdx(t2) : a;
  if (f < 0 || a < 0 || z < a) continue;
  const len = Math.min(z - a, 30);
  let list = xr.get(f); if (!list) xr.set(f, list = []);
  list.push([a, len, votes]);
}
const xref = {};
for (const [f, list] of xr) {
  list.sort((x, y) => y[2] - x[2]);
  const seen = new Set(); const flat = [];
  for (const [a, len] of list) { if (a === f || seen.has(a)) continue; seen.add(a); flat.push(a, len); if (flat.length >= 24) break; }
  if (flat.length) { xref[f] = flat; xrKept += flat.length / 2; }
}
console.log(`xref rows: ${xrRows}, verses with refs: ${Object.keys(xref).length}, refs kept: ${xrKept}`);

// ---------------------------------------------------------------- Strong's
console.log("Strong's dictionaries from Open Scriptures");
const loadDict = async (name, url) => {
  const s = (await getCached(`strongs/${name}.js`, url)).toString('utf8');
  return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
};
const clean = x => (x == null ? '' : String(x).replace(/\s+/g, ' ').trim());
const heb = await loadDict('hebrew', 'https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js');
const grk = await loadDict('greek', 'https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js');
const strongs = { H: {}, G: {} };
// [lemma, transliteration, pronunciation, derivation, definition, KJV renderings]
for (const [k, e] of Object.entries(heb)) strongs.H[k.slice(1)] = [clean(e.lemma), clean(e.xlit), clean(e.pron), clean(e.derivation), clean(e.strongs_def), clean(e.kjv_def)];
for (const [k, e] of Object.entries(grk)) strongs.G[k.slice(1)] = [clean(e.lemma), clean(e.translit), '', clean(e.derivation), clean(e.strongs_def), clean(e.kjv_def)];
console.log(`Strong's: ${Object.keys(strongs.H).length} Hebrew, ${Object.keys(strongs.G).length} Greek`);

// ---------------------------------------------------------------- timeline
const tl = JSON.parse(fs.readFileSync(path.join(ROOT, 'data-src/timeline.json'), 'utf8'));
const eraIds = new Set(tl.eras.map(e => e.id));
for (const ev of tl.events) {
  if (!eraIds.has(ev.era)) throw new Error('bad era ' + ev.era);
  for (const r of ev.refs) {
    const m = r.match(/^([0-9A-Za-z]+) (\d+)/);
    if (!m || !BOOK_BY_ID[m[1]] || +m[2] < 1 || +m[2] > kjv.books[m[1]].length) throw new Error('bad timeline ref ' + r);
  }
}
delete tl._note;

// ---------------------------------------------------------------- reading plans
const chapterList = BOOKS.map(b => kjv.books[b.id].map((ch, i) => ({ b: b.id, c: i + 1, vc: ch.length }))).flat();
const slice = (from, to) => chapterList.filter(x => BOOK_BY_ID[x.b].index >= BOOK_BY_ID[from].index && BOOK_BY_ID[x.b].index <= BOOK_BY_ID[to].index);

function splitDays(chs, N) {
  const days = Array.from({ length: N }, () => []);
  let total = chs.reduce((n, x) => n + x.vc, 0), i = 0;
  for (let d = 0; d < N && i < chs.length; d++) {
    const daysLeft = N - d, target = total / daysLeft;
    let cur = 0; days[d].push(chs[i]); cur += chs[i].vc; total -= chs[i].vc; i++;
    while (i < chs.length && chs.length - i > daysLeft - 1) {
      const next = chs[i];
      if (Math.abs(cur + next.vc - target) < Math.abs(cur - target)) { days[d].push(next); cur += next.vc; total -= next.vc; i++; } else break;
    }
  }
  return days;
}
const toRanges = chs => {
  const out = [];
  for (const x of chs) {
    const last = out[out.length - 1];
    if (last && last[0] === x.b && last[2] + 1 === x.c) last[2] = x.c; else out.push([x.b, x.c, x.c]);
  }
  return out;
};
const plan = (id, name, description, days) => ({ id, name, description, days: days.map(toRanges) });
const yearDays = splitDays(chapterList, 365);
const otDays = splitDays(slice('Gen', 'Mal'), 365);
const ntDays = splitDays(slice('Matt', 'Rev'), 365);
const plans = [
  plan('year', 'The Bible in a year', 'All 1,189 chapters in order, Genesis to Revelation, about 85 verses a day.', yearDays),
  { ...plan('year-ot-nt', 'Old and New Testament together', 'Every day has an Old Testament reading and most days add a New Testament chapter. One year.', otDays.map((d, i) => [...d, ...ntDays[i]])) },
  plan('nt-90', 'New Testament in 90 days', 'Matthew to Revelation, about three chapters a day.', splitDays(slice('Matt', 'Rev'), 90)),
  plan('gospels-30', 'The four Gospels in 30 days', 'Matthew, Mark, Luke and John in a month.', splitDays(slice('Matt', 'John'), 30)),
  plan('psalms-30', 'Psalms in a month', 'All 150 psalms over 30 days, five a day.', splitDays(slice('Ps', 'Ps'), 30)),
  plan('proverbs-31', 'Proverbs in a month', 'One chapter of Proverbs for each day of the month.', splitDays(slice('Prov', 'Prov'), 31)),
];
for (const p of plans) {
  // every chapter must be covered exactly once per track
  const n = p.days.flat().reduce((s, [, a, z]) => s + (z - a + 1), 0);
  console.log(`plan ${p.id}: ${p.days.length} days, ${n} chapters, ${p.days.filter(d => !d.length).length} empty days`);
}

// ---------------------------------------------------------------- write
const now = new Date().toISOString();
const write = (name, obj) => { const f = path.join(OUT, name); fs.writeFileSync(f, JSON.stringify(obj)); console.log('wrote', name, (fs.statSync(f).size / 1024 / 1024).toFixed(2) + ' MB'); };
write('kjv.json', kjv);
write('web.json', web);
write('xref.json', xref);
write('strongs.json', strongs);
write('timeline.json', tl);
write('plans.json', plans);
write('onchain.json', { builtAt: now, source: API, books: onchain });
write('manifest.json', {
  builtAt: now,
  kjvVerses: total,
  webVerses,
  strongs: { hebrew: Object.keys(strongs.H).length, greek: Object.keys(strongs.G).length },
  sources: {
    kjv: 'Ordinals inscriptions on Bitcoin (see onchain.json for each transaction id); text of the King James Version is in the public domain',
    web: 'World English Bible, https://github.com/TehShrike/world-english-bible (public domain)',
    xref: 'Cross references from OpenBible.info, CC BY (https://www.openbible.info/labs/cross-references/)',
    strongs: "Strong's dictionaries from Open Scriptures, CC BY-SA (https://github.com/openscriptures/strongs)",
  },
});
