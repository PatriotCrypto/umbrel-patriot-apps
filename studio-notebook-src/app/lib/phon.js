'use strict';
/* Phoneme helpers for ARPAbet pronunciations (CMUdict). */

const CLASS = {
  M: 'N', N: 'N', NG: 'N',
  P: 'T', B: 'T', T: 'T', D: 'T', K: 'T', G: 'T',
  F: 'S', V: 'S', TH: 'S', DH: 'S', S: 'S', Z: 'S', SH: 'S', ZH: 'S', HH: 'S',
  CH: 'C', JH: 'C', L: 'L', R: 'L', W: 'W', Y: 'W',
};

const isVowel = (p) => /\d$/.test(p);
const strip = (p) => p.replace(/\d$/, '');

/* Vowel as heard in a rhyme: cot/caught merge, unstressed "ih" is a schwa. */
function normVowel(p) {
  const base = strip(p);
  if (base === 'AO') return 'AA';
  if (base === 'IH' && p.endsWith('0')) return 'AH';
  return base;
}

/* Index of the vowel a rhyme starts on: the last primary stress, else
   secondary, else simply the last vowel. */
function rhymeStart(ph) {
  let last = -1, sec = -1, prim = -1;
  for (let i = 0; i < ph.length; i++) {
    if (!isVowel(ph[i])) continue;
    last = i;
    if (ph[i].endsWith('1')) prim = i;
    else if (ph[i].endsWith('2')) sec = i;
  }
  return prim > -1 ? prim : sec > -1 ? sec : last;
}

function perfectKey(ph) {
  const i = rhymeStart(ph);
  return i < 0 ? '' : ph.slice(i).map(strip).join(' ');
}

function vowels(ph) {
  const out = [];
  for (const p of ph) if (isVowel(p)) out.push(normVowel(p));
  return out;
}

function tailKey(ph, n) {
  const v = vowels(ph);
  return v.length < n ? '' : v.slice(-n).join(' ');
}

/* Vowels kept, consonants reduced to a class: "AY N" for time, mine, rhyme. */
function classKey(ph) {
  const i = rhymeStart(ph);
  if (i < 0) return '';
  return ph.slice(i).map((p) => (isVowel(p) ? normVowel(p) : CLASS[p] || p)).join(' ');
}

/* The sound a word opens with, for alliteration. */
function onsetKey(ph) {
  const out = [];
  for (const p of ph) {
    if (isVowel(p)) { if (!out.length) out.push('~' + normVowel(p)); break; }
    out.push(p);
  }
  return out.join(' ');
}

/* Rough syllable count for words the dictionary does not know. */
function guessSyllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^aeiouytd]ed|[^aeiouyl]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

module.exports = { isVowel, strip, normVowel, rhymeStart, perfectKey, vowels, tailKey, classKey, onsetKey, guessSyllables };
