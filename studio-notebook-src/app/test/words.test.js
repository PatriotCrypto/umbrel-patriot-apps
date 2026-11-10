'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/phon');
const words = require('../lib/words');

const has = (r, w) => r.items.some((x) => x.w === w);
const skip = words.available() ? false : 'word data not built (run npm run build-data)';

test('phoneme helpers', () => {
  const singer = 'S IH1 NG ER0'.split(' ');
  assert.strictEqual(P.perfectKey(singer), 'IH NG ER');
  assert.strictEqual(P.tailKey(singer, 2), 'IH ER');
  assert.strictEqual(P.classKey('T AY1 M'.split(' ')), P.classKey('M AY1 N'.split(' ')));
  assert.strictEqual(P.onsetKey('G OW1 S T'.split(' ')), 'G');
  assert.strictEqual(P.guessSyllables('zzyzx'), 1);
  assert.ok(P.guessSyllables('umbrella') >= 3);
});

test('perfect, close and wide rhymes', { skip }, () => {
  const perfect = words.rhymes('fire');
  assert.ok(has(perfect, 'desire') && has(perfect, 'higher'));
  assert.ok(!has(perfect, 'fire'));
  const close = words.rhymes('time', 'close');
  assert.ok(has(close, 'mine') && !has(close, 'rhyme'));
  const wide = words.rhymes('time', 'wide');
  assert.ok(has(wide, 'light') && !has(wide, 'mine'));
});

test('syllable filter, dropped g, unknown words, phrases', { skip }, () => {
  assert.ok(words.rhymes('fire', 'perfect', { syl: 2 }).items.every((x) => x.s === 2));
  assert.ok(has(words.rhymes("runnin'"), 'cunning'));
  assert.strictEqual(words.rhymes('zzyzxq').known, false);
  assert.ok(has(words.rhymes('night', 'phrases'), 'at first sight') || words.rhymes('night', 'phrases').items.length > 20);
  assert.ok(has(words.rhymes('ghost singer', 'multi2'), 'finger'));
  assert.ok(words.rhymes('home', 'perfect', { rare: true }).total >= words.rhymes('home').total);
});

test('meaning, family, phrases, sounds, figures', { skip }, () => {
  const m = words.meaning('burning');
  assert.ok(m.senses.length > 0 && m.senses[0].def);
  assert.ok(words.meaning('hot').senses.some((s) => s.ants.includes('cold')));
  const f = words.family('pretty');
  assert.strictEqual(f.root, 'pretty');
  assert.ok(f.words.some((x) => x.w === 'beautiful'));
  assert.ok(words.phrases('bucket').items.includes('kick the bucket'));
  assert.ok(words.alliteration('ghost').items.some((x) => x.w === 'gold'));
  assert.ok(words.figures('ice').similes.includes('as cold as ice'));
  assert.ok(words.figures('', 'oxymorons').oxymorons.length > 20);
});

test('bible search', { skip }, () => {
  assert.deepStrictEqual(words.bible('"valley of the shadow"').items.map((v) => v.ref), ['Psalms 23:4']);
  const john = words.bible('"For God so loved the world"');
  assert.strictEqual(john.items[0].ref, 'John 3:16');
  assert.strictEqual(words.bible('x').total, 0);
});

test('line analysis', { skip }, () => {
  const a = words.analyze('[Verse 1]\nI kept the letters that I never sent\n\nzzyzx road');
  assert.strictEqual(a[0].tag, true);
  assert.strictEqual(a[1].syl, 10);
  assert.strictEqual(a[1].toks[a[1].toks.length - 1][2], 'EH');
  assert.strictEqual(a[2].tag, true);
  assert.strictEqual(a[3].toks[0][2], '');
});
