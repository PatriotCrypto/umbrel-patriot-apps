'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { extractInscription } = require('../server/lib/envelope');
const { parseInscribedBook, toChapters } = require('../server/lib/inscribed');
const { sanitize, empty } = require('../server/lib/userdoc');
const { createZip } = require('../server/lib/zip');
const site = require('../server/lib/site');
const { fakeTx } = require('./helpers');

test('books: references parse', async () => {
  const { parseRef, findBook } = await import('../public/js/books.js');
  assert.deepStrictEqual(parseRef('John 3:16'), { book: 'John', chapter: 3, verse: 16 });
  assert.deepStrictEqual(parseRef('ps 23:1-4'), { book: 'Ps', chapter: 23, verse: 1, verseEnd: 4 });
  assert.strictEqual(parseRef('1 Jn 4').book, '1John');
  assert.strictEqual(parseRef('II Kings 2').book, '2Kgs');
  assert.strictEqual(findBook('song of songs'), 'Song');
  assert.strictEqual(findBook('nonsense'), null);
});

test('envelope: plain and gzip inscriptions are read back exactly', () => {
  const text = Buffer.from('x'.repeat(2000) + ' hello', 'utf8');
  assert.deepStrictEqual(extractInscription(fakeTx('a', text)).content, text);
  assert.deepStrictEqual(extractInscription(fakeTx('b', text, { gz: true })).content, text);
  const core = { vin: [{ txinwitness: fakeTx('c', text).vin[0].witness }] };
  assert.deepStrictEqual(extractInscription(core).content, text);
  assert.strictEqual(extractInscription({ vin: [{ witness: ['00', '00'] }] }), null);
});

test('inscribed: verses sharing a paragraph are split in strict order', () => {
  const t = 'The Book Title\n\n1:1 In the beginning. 1:2 And the earth. 1:3 Let there be light.\n\n2:1 Thus the heavens. 2:2 And on the seventh day.';
  const { verses } = parseInscribedBook(t, 'T');
  assert.deepStrictEqual(verses.map(v => `${v.c}:${v.v}`), ['1:1', '1:2', '1:3', '2:1', '2:2']);
  const { chapters, problems } = toChapters(verses, 'T');
  assert.strictEqual(chapters[1][1], 'And on the seventh day.');
  assert.deepStrictEqual(problems, []);
  assert.throws(() => parseInscribedBook('no markers here', 'T'));
});

test('bundled data is complete', () => {
  const d = path.join(__dirname, '..', 'data');
  const kjv = JSON.parse(fs.readFileSync(path.join(d, 'kjv.json'), 'utf8'));
  let n = 0; for (const b of Object.values(kjv.books)) for (const c of b) n += c.length;
  assert.strictEqual(n, 31102);
  assert.strictEqual(Object.keys(kjv.books).length, 66);
  assert.strictEqual(kjv.books.John[2][15].startsWith('For God so loved the world'), true);
  const onchain = JSON.parse(fs.readFileSync(path.join(d, 'onchain.json'), 'utf8'));
  assert.strictEqual(onchain.books.length, 66);
  assert.strictEqual(new Set(onchain.books.map(b => b.txid)).size, 66);
});

test('userdoc: junk is dropped, good data is kept', () => {
  const d = sanitize({ rev: 3, bookmarks: [{ ref: 'John.3.16', label: 'x', at: 1 }, { ref: '../../etc', label: 'bad' }], highlights: { 'Gen.1.1': 'y', 'Gen.1.2': 'zzz', evil: 'y' }, notes: { 'John.3.16-17': { text: 'hi', at: 2 }, 'x': { text: 'no' } }, plans: { year: { start: 5, done: [3, 1, 1, 999, 'a'] } }, cards: { 'Ps.23.1': { box: 99, due: 1, added: 1 } }, prefs: { skin: 'amber', size: 9, compare: 'x' } });
  assert.strictEqual(d.rev, 3);
  assert.strictEqual(d.bookmarks.length, 1);
  assert.deepStrictEqual(Object.keys(d.highlights), ['Gen.1.1']);
  assert.deepStrictEqual(Object.keys(d.notes), ['John.3.16-17']);
  assert.deepStrictEqual(d.plans.year.done, [1, 3]);
  assert.strictEqual(d.cards['Ps.23.1'].box, 5);
  assert.deepStrictEqual(d.prefs, { skin: 'amber' });
  assert.deepStrictEqual(sanitize(null), empty());
});

test('zip: produces a valid archive', () => {
  const dir = fs.mkdtempSync('/tmp/bt-zip-');
  const f = path.join(dir, 't.zip');
  fs.writeFileSync(f, createZip([{ name: 'a/b.txt', data: 'hello' }, { name: 'c.bin', data: Buffer.alloc(100000, 7) }]));
  const out = execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(z.read("a/b.txt").decode(), len(z.read("c.bin")))', f]).toString();
  assert.strictEqual(out.trim(), 'hello 100000');
});

test('site: option validation and boot line', () => {
  assert.throws(() => site.validateOptions({ ssid: 'bad;name\'' }));
  assert.throws(() => site.validateOptions({ password: 'short' }));
  assert.throws(() => site.validateOptions({ country: 'USA' }));
  const o = site.validateOptions({});
  assert.strictEqual(o.ssid, 'Bible Terminal');
  assert.match(site.cmdlineAddition(o), /^systemd\.run=\S+ systemd\.run_success_action=reboot systemd\.unit=kernel-command-line\.target cfg80211\.ieee80211_regdom=US$/);
  assert.ok(!site.cmdlineAddition(o).includes('\n'));
});

test('engine: search, stems, phrases, scope, ask retrieval', async () => {
  const { Engine } = await import('../public/js/engine.js');
  const d = path.join(__dirname, '..', 'data');
  const r = f => JSON.parse(fs.readFileSync(path.join(d, f + '.json'), 'utf8'));
  const E = new Engine({ kjv: r('kjv'), web: r('web'), xref: r('xref'), strongs: r('strongs'), timeline: r('timeline'), plans: r('plans'), manifest: r('manifest') });
  assert.strictEqual(E.search('"in the beginning God created"').total, 1);
  assert.ok(E.search('love').total > E.search('love', { exact: true }).total);
  assert.strictEqual(E.search('lov*').total >= E.search('love').total, true);
  const s = E.search('faith', { scope: { type: 'b', value: 'Heb' } });
  assert.ok(s.total > 20 && s.hits.every(i => E.at(i).id === 'Heb'));
  assert.ok(E.search('grace -works').total < E.search('grace').total);
  assert.strictEqual(E.strongs('G26').translit.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().startsWith('agap'), true);
  const rel = E.related('what does Romans 8:28 mean?', 6);
  assert.ok(rel[0].label.startsWith('Romans 8:28'));
  assert.ok(E.xrefs(E.idx('John', 3, 16)).length > 5);
  assert.deepStrictEqual(E.fromKey('John.3.16-18'), { idx: E.idx('John', 3, 16), len: 2 });
});

test('hotspot chat: post, poll, limits, reset, host check', async () => {
  const { spawn } = require('child_process');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const srv = spawn('python3', [path.join(__dirname, '..', 'hotspot', 'serve.py')], { env: { ...process.env, BT_ROOT: __dirname, BT_PORT: String(port), BT_IP: '127.0.0.1' }, stdio: 'ignore' });
  try {
    await new Promise(r => setTimeout(r, 700));
    const base = `http://127.0.0.1:${port}/api/chat`;
    const post = (body, h = { 'x-bt': '1' }) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
    assert.strictEqual((await post({ cid: 'a', nick: 'Ann', text: 'hello <b>' })).status, 200);
    assert.strictEqual((await post({ cid: 'a', nick: 'Ann', text: 'x' }, {})).status, 405, 'needs the x-bt header');
    assert.strictEqual((await post({ cid: 'a', nick: 'Ann', text: '  ' })).status, 400);
    const ok = await post({ cid: 'b', nick: 'Bob', text: 'verse', ref: 'John.3.16' });
    assert.strictEqual(ok.status, 200);
    await post({ cid: 'c', text: 'bad ref', ref: '../../etc' });
    let d = await (await fetch(base + '?after=0&cid=a')).json();
    assert.strictEqual(d.msgs.length, 3);
    assert.strictEqual(d.msgs[0].text, 'hello <b>');
    assert.ok(d.msgs.every(m => !('cid' in m)), 'chat ids are never sent to other phones');
    assert.strictEqual(d.msgs[0].mine, true);
    assert.strictEqual(d.msgs[1].mine, false);
    assert.strictEqual(d.msgs[1].ref, 'John.3.16');
    assert.strictEqual(d.msgs[2].ref, '', 'invalid verse refs are dropped');
    assert.ok(d.online >= 1);
    // long poll wakes up when someone posts
    const waiting = fetch(base + `?after=${d.last}&cid=a&wait=10`).then(r => r.json());
    await new Promise(r => setTimeout(r, 200));
    await post({ cid: 'b', nick: 'Bob', text: 'wake' });
    const w = await waiting; assert.strictEqual(w.msgs[0].text, 'wake');
    // a phone that is ahead of the Pi (the Pi restarted) is told to start over
    d = await (await fetch(base + '?after=9999&cid=a')).json(); assert.strictEqual(d.reset, true);
    // too many messages in a row are refused
    let limited = false; for (let i = 0; i < 15; i++) if ((await post({ cid: 'spam', text: 'x' + i })).status === 429) limited = true;
    assert.ok(limited);
    // another host name is redirected to the reader, and nothing outside the web folder is served
    const status = await new Promise((res, rej) => require('http').get({ host: '127.0.0.1', port, path: '/x', headers: { host: 'example.com' } }, r => { r.resume(); res(r.statusCode); }).on('error', rej));
    assert.strictEqual(status, 302);
    assert.strictEqual((await fetch(`http://127.0.0.1:${port}/api/other`)).status, 404);
    const hdr = await fetch(`http://127.0.0.1:${port}/api/chat?after=0`);
    assert.match(hdr.headers.get('content-security-policy'), /default-src 'self'/);
    assert.strictEqual(hdr.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual((await fetch(`http://127.0.0.1:${port}/%00x`)).status, 400);
  } finally { srv.kill(); }
});
