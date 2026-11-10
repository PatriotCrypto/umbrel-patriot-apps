'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-notebook-'));
process.env.DATA_DIR = dir;
const { server, store } = require('../server');
let base;
const H = { 'X-Studio-Notebook': '1', 'Content-Type': 'application/json' };
const call = async (method, url, body, headers = H) => {
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: res.status, data, headers: res.headers };
};

test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + server.address().port; r(); })));
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('pages, health and security headers', async () => {
  assert.strictEqual((await call('GET', '/healthz')).data, 'ok');
  const page = await call('GET', '/');
  assert.strictEqual(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.strictEqual(page.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual((await call('GET', '/..%2f..%2fpackage.json')).status, 404);
  assert.strictEqual((await call('GET', '/%00')).status, 400);
  assert.strictEqual((await call('GET', '/files/abcdef123456/../../db.json')).status, 404);
});

test('changes need the request header', async () => {
  const r = await call('POST', '/api/songs', {}, { 'Content-Type': 'application/json' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual((await call('PUT', '/api/songs/zzz', {})).status, 404);
  const bad = await fetch(base + '/api/songs', { method: 'POST', headers: H, body: '{nope' });
  assert.strictEqual(bad.status, 400);
});

test('song life cycle, versions and search', async () => {
  const made = await call('POST', '/api/songs', { title: 'Test Song', lyrics: 'first draft line' });
  assert.strictEqual(made.status, 201);
  const id = made.data.id;
  assert.strictEqual(made.data.checklist.length, 8);
  const put = await call('PUT', `/api/songs/${id}`, { lyrics: 'second draft line\nwith a quarry road', status: 'polishing', releaseDate: '2026-12-01', status2: 'x', production: { bpm: '90', evil: 'x' }, collected: ['ember', 'ember2'] });
  assert.strictEqual(put.data.summary.status, 'polishing');
  const song = (await call('GET', `/api/songs/${id}`)).data;
  assert.strictEqual(song.production.bpm, '90');
  assert.strictEqual(song.production.evil, undefined);
  assert.strictEqual((await call('PUT', `/api/songs/${id}`, { releaseDate: 'tomorrow', status: 'nonsense' })).status, 200);
  assert.strictEqual((await call('GET', `/api/songs/${id}`)).data.releaseDate, '2026-12-01');
  // the first edit of the day kept the earlier draft automatically
  let versions = (await call('GET', `/api/songs/${id}/versions`)).data;
  assert.strictEqual(versions.length, 1);
  assert.strictEqual(versions[0].auto, true);
  assert.strictEqual((await call('GET', `/api/songs/${id}/versions/${versions[0].id}`)).data.lyrics, 'first draft line');
  await call('POST', `/api/songs/${id}/versions`, { label: 'Before the rewrite' });
  versions = (await call('GET', `/api/songs/${id}/versions`)).data;
  assert.strictEqual(versions[0].label, 'Before the rewrite');
  assert.strictEqual((await call('DELETE', `/api/songs/${id}/versions/${versions[0].id}`)).data.ok, true);
  const hits = (await call('GET', '/api/search?q=quarry')).data;
  assert.strictEqual(hits[0].id, id);
  const txt = await call('GET', `/api/songs/${id}/export.txt`);
  assert.match(txt.data, /^Test Song\n\nsecond draft line/);
  assert.match(txt.headers.get('content-disposition'), /Test-Song\.txt/);
});

test('cover art and audio uploads', async () => {
  const id = (await call('POST', '/api/songs', { title: 'Files' })).data.id;
  const raw = { 'X-Studio-Notebook': '1' };
  assert.strictEqual((await call('POST', `/api/songs/${id}/cover?name=evil.svg`, Buffer.from('<svg/>'), raw)).status, 400);
  assert.strictEqual((await call('POST', `/api/songs/${id}/audio?name=run.sh`, Buffer.from('x'), raw)).status, 400);
  assert.strictEqual((await call('POST', `/api/songs/${id}/audio?name=empty.mp3`, Buffer.alloc(0), raw)).status, 400);
  const cover = await call('POST', `/api/songs/${id}/cover?name=art.PNG`, Buffer.from('fakepng'), raw);
  assert.match(cover.data.cover, /^cover-[a-z0-9]+\.png$/);
  const img = await call('GET', `/files/${id}/${cover.data.cover}`);
  assert.strictEqual(img.headers.get('content-type'), 'image/png');
  const take = await call('POST', `/api/songs/${id}/audio?name=${encodeURIComponent('../../My Demo.mp3')}`, Buffer.from('0123456789'), raw);
  assert.strictEqual(take.status, 201);
  assert.match(take.data.file, /^take-[a-f0-9]+\.mp3$/);
  assert.ok(!take.data.name.includes('/'));
  const part = await fetch(`${base}/files/${id}/${take.data.file}`, { headers: { Range: 'bytes=2-5' } });
  assert.strictEqual(part.status, 206);
  assert.strictEqual(await part.text(), '2345');
  assert.strictEqual((await fetch(`${base}/files/${id}/${take.data.file}`, { headers: { Range: 'bytes=50-60' } })).status, 416);
  await call('PUT', `/api/songs/${id}`, { audioNotes: [{ id: take.data.id, note: 'rough mix' }] });
  assert.strictEqual((await call('GET', `/api/songs/${id}`)).data.audio[0].note, 'rough mix');
  assert.strictEqual((await call('DELETE', `/api/songs/${id}/audio/${take.data.id}`)).data.ok, true);
  assert.strictEqual((await call('DELETE', `/api/songs/${id}`)).data.ok, true);
  assert.strictEqual(fs.existsSync(path.join(dir, 'files', id)), false);
});

test('ideas, collections, settings and import', async () => {
  assert.strictEqual((await call('POST', '/api/ideas', { text: '   ' })).status, 400);
  const idea = (await call('POST', '/api/ideas', { text: 'Grace is a floor', kind: 'hook' })).data;
  assert.strictEqual(idea.kind, 'hook');
  assert.strictEqual((await call('PUT', `/api/ideas/${idea.id}`, { pinned: true, kind: 'bogus' })).data.kind, 'hook');
  assert.strictEqual((await call('DELETE', `/api/ideas/${idea.id}`)).data.ok, true);
  const col = (await call('POST', '/api/collections', { name: 'Home' })).data;
  await call('PUT', `/api/collections/${col.id}`, { add: 'porch light' });
  const again = (await call('PUT', `/api/collections/${col.id}`, { add: 'porch light' })).data;
  assert.deepStrictEqual(again.items, ['porch light']);
  const s = (await call('PUT', '/api/settings', { charLimit: 2500, checklist: ['One', '', 'Two'] })).data;
  assert.strictEqual(s.charLimit, 2500);
  assert.deepStrictEqual(s.checklist, ['One', 'Two']);
  const imp = (await call('POST', '/api/import', { items: [{ title: 'From a file', lyrics: 'a\r\nb' }, { title: 'Empty', lyrics: '  ' }] })).data;
  assert.strictEqual(imp.imported, 1);
  const song = (await call('GET', `/api/songs/${imp.ids[0]}`)).data;
  assert.strictEqual(song.lyrics, 'a\nb');
  assert.strictEqual(song.checklist.length, 2);
});

test('backup and restore round trip', async () => {
  const before = (await call('GET', '/api/state')).data;
  const backup = await call('GET', '/api/backup');
  assert.strictEqual(backup.data.app, 'studio-notebook');
  await call('POST', '/api/songs', { title: 'Made after the backup' });
  assert.strictEqual((await call('POST', '/api/restore', { app: 'something-else' })).status, 400);
  const r = await call('POST', '/api/restore', backup.data);
  assert.strictEqual(r.data.songs, before.songs.length);
  const after = (await call('GET', '/api/state')).data;
  assert.deepStrictEqual(after.songs.map((x) => x.title).sort(), before.songs.map((x) => x.title).sort());
  assert.strictEqual(after.collections.length, before.collections.length);
  assert.strictEqual(after.settings.charLimit, 2500);
  const kept = after.songs.find((x) => x.title === 'Test Song');
  assert.ok((await call('GET', `/api/songs/${kept.id}/versions`)).data.length >= 1);
  store.flush();
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).songs.length);
});

test('word tools over http', async (t) => {
  const state = (await call('GET', '/api/state')).data;
  if (!state.words) return t.skip('word data not built');
  assert.ok((await call('GET', '/api/w/rhymes?q=fire&type=perfect')).data.items.length > 10);
  assert.strictEqual((await call('GET', '/api/w/rhymes?q=fire&type=bogus')).status, 400);
  assert.strictEqual((await call('GET', '/api/w/nothing?q=fire')).status, 404);
  const a = (await call('POST', '/api/analyze', { text: 'hello world' })).data;
  assert.strictEqual(a.lines[0].syl, 3);
});
