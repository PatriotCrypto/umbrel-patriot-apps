#!/usr/bin/env node
'use strict';
/*
 * Builds the offline word data in ./data from freely licensed sources.
 *
 *   pron.txt.gz     CMU Pronouncing Dictionary + a commonness tier from SCOWL
 *   thes.txt.gz     WordNet 3.1 synsets (definitions, synonyms, antonyms, related)
 *   moby.txt.gz     Moby Thesaurus II (public domain), used for Word Families
 *   phrases.txt.gz  multi-word phrases from WordNet and Moby
 *   kjv.json.gz     King James Bible (public domain), from data-src/
 *
 * Usage: node scripts/build-data.js --moby /path/to/moby/words.txt
 * The Dockerfile runs this in its build stage. See NOTICE.md for licenses.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const out = path.join(root, 'data');
const nm = path.join(root, 'node_modules');
fs.mkdirSync(out, { recursive: true });

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};
const mobyPath = arg('--moby') || process.env.MOBY_WORDS || path.join(root, 'data-src', 'moby-words.txt');
if (!fs.existsSync(mobyPath)) {
  console.error('Moby words.txt not found. Pass --moby <path> (see the Dockerfile).');
  process.exit(1);
}

const write = (name, text) => {
  const buf = zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
  fs.writeFileSync(path.join(out, name), buf);
  console.log(name.padEnd(16), (buf.length / 1048576).toFixed(2) + ' MB');
};

const plainWord = /^[a-z][a-z'-]*$/;

/* ---------- commonness tiers (SCOWL) ---------- */
const tier = new Map();
for (const n of [10, 20, 35, 40, 50, 55, 60, 70]) {
  for (const region of ['english', 'american']) {
    const f = path.join(nm, 'wordlist-english', `${region}-words-${n}.json`);
    if (!fs.existsSync(f)) continue;
    for (const w of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      const k = w.toLowerCase();
      if (!tier.has(k)) tier.set(k, n);
    }
  }
}

/* ---------- pronunciations (CMUdict) ---------- */
{
  const cmu = require(path.join(nm, 'cmu-pronouncing-dictionary'));
  const dict = cmu.dictionary || cmu;
  const prons = new Map();
  for (const key of Object.keys(dict)) {
    const word = key.replace(/\(\d+\)$/, '');
    if (!plainWord.test(word)) continue;
    if (!prons.has(word)) prons.set(word, []);
    const list = prons.get(word);
    if (!list.includes(dict[key]) && list.length < 3) list.push(dict[key]);
  }
  const lines = [];
  for (const [word, list] of prons) {
    lines.push(`${word}\t${tier.get(word) || 99}\t${list.join('|')}`);
  }
  // common words CMUdict lacks still get a tier, so thesaurus results can be ranked
  for (const [word, n] of tier) {
    if (n <= 60 && !prons.has(word) && plainWord.test(word)) lines.push(`${word}\t${n}\t`);
  }
  lines.sort();
  write('pron.txt.gz', lines.join('\n'));
  console.log('  words:', lines.length);
}

/* ---------- WordNet ---------- */
const phraseSet = new Set();
{
  const dictDir = path.join(nm, 'wordnet-db', 'dict');
  const posFiles = { n: 'noun', v: 'verb', a: 'adj', r: 'adv' };
  const synsets = [];
  const byOffset = new Map();
  const clean = (w) => w.replace(/\((p|a|ip)\)$/, '').replace(/_/g, ' ');

  for (const [pos, file] of Object.entries(posFiles)) {
    const text = fs.readFileSync(path.join(dictDir, 'data.' + file), 'utf8');
    for (const line of text.split('\n')) {
      if (!line || line.startsWith('  ')) continue;
      const bar = line.indexOf(' | ');
      const head = (bar > -1 ? line.slice(0, bar) : line).split(' ');
      const gloss = bar > -1 ? line.slice(bar + 3).trim() : '';
      const offset = head[0];
      const wcnt = parseInt(head[3], 16);
      const words = [];
      let i = 4;
      for (let k = 0; k < wcnt; k++, i += 2) words.push(clean(head[i]));
      const pcnt = parseInt(head[i], 10);
      i++;
      const ptrs = [];
      for (let k = 0; k < pcnt; k++, i += 4) {
        ptrs.push({ sym: head[i], off: head[i + 1], pos: head[i + 2] === 's' ? 'a' : head[i + 2], st: head[i + 3] });
      }
      const s = { pos, gloss, words, ptrs, ants: new Set(), rel: new Set() };
      byOffset.set(pos + offset, s);
      synsets.push(s);
    }
  }
  for (const s of synsets) {
    for (const p of s.ptrs) {
      const t = byOffset.get(p.pos + p.off);
      if (!t) continue;
      if (p.sym === '!') {
        const tgt = parseInt(p.st.slice(2), 16);
        const w = tgt > 0 ? t.words[tgt - 1] : null;
        if (w) s.ants.add(w);
      } else if (p.sym === '&' || p.sym === '^' || p.sym === '@' || p.sym === '$') {
        for (const w of t.words.slice(0, 4)) s.rel.add(w);
      }
    }
  }
  const lines = [];
  const tidy = (g) => {
    // keep the definition and at most one example
    const parts = g.split(/;\s*(?=")/);
    return (parts.length > 1 ? parts[0] + '; ' + parts[1] : parts[0]).replace(/\t/g, ' ');
  };
  for (const s of synsets) {
    const words = s.words.filter((w) => !/\t|\|/.test(w));
    for (const w of s.words) s.rel.delete(w);
    lines.push([s.pos, tidy(s.gloss), words.join('|'), [...s.ants].join('|'), [...s.rel].slice(0, 12).join('|')].join('\t'));
    for (const w of words) {
      // phrases: lower-case multi-word entries only (skips names and taxonomy)
      if (w.includes(' ') && /^[a-z][a-z' -]*$/.test(w)) phraseSet.add(w);
    }
  }
  write('thes.txt.gz', lines.join('\n'));
  console.log('  synsets:', lines.length);
}

/* ---------- Moby thesaurus ---------- */
{
  const text = fs.readFileSync(mobyPath, 'utf8').replace(/\r/g, '');
  const lines = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const parts = line.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    lines.push(parts.join(','));
    for (const p of parts) {
      const n = p.split(' ').length;
      if (n >= 2 && n <= 7 && /^[a-z][a-z' -]*$/.test(p)) phraseSet.add(p);
    }
  }
  write('moby.txt.gz', lines.join('\n'));
  console.log('  roots:', lines.length);
}

/* ---------- phrases ---------- */
{
  const phrases = [...phraseSet].sort();
  write('phrases.txt.gz', phrases.join('\n'));
  console.log('  phrases:', phrases.length);
}

/* ---------- KJV ---------- */
{
  const src = path.join(root, 'data-src', 'kjv.json.gz');
  fs.copyFileSync(src, path.join(out, 'kjv.json.gz'));
  console.log('kjv.json.gz'.padEnd(16), (fs.statSync(src).size / 1048576).toFixed(2) + ' MB');
}
