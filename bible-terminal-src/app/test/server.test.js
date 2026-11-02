'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createApp } = require('../server/index');
const { fakeTx, sha } = require('./helpers');

const APP = path.join(__dirname, '..');
const listen = app => new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = s => `http://127.0.0.1:${s.address().port}`;
const J = (url, method = 'GET', body, hdr = {}) => fetch(url, { method, headers: { 'content-type': 'application/json', ...hdr }, body: body ? JSON.stringify(body) : undefined });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bt-t-'));

test('api: security headers, CSRF header, user doc with conflicts', async () => {
  const { app } = createApp({ dataDir: tmp(), publicDir: path.join(APP, 'public'), appDataDir: path.join(APP, 'data') });
  const s = await listen(app), u = base(s);
  try {
    const home = await fetch(u + '/');
    assert.match(home.headers.get('content-security-policy'), /default-src 'none'/);
    assert.strictEqual((await fetch(u + '/api/health')).status, 200);
    assert.strictEqual((await J(u + '/api/user', 'PUT', { rev: 0 })).status, 403);   // no X-BT header
    const H = { 'x-bt': '1' };
    const put1 = await (await J(u + '/api/user', 'PUT', { rev: 0, notes: { 'John.3.16': { text: 'hi', at: 1 } } }, H)).json();
    assert.strictEqual(put1.rev, 1);
    const stale = await J(u + '/api/user', 'PUT', { rev: 0 }, H);
    assert.strictEqual(stale.status, 409);
    assert.strictEqual((await stale.json()).doc.notes['John.3.16'].text, 'hi');
    assert.strictEqual((await (await fetch(u + '/api/user')).json()).rev, 1);
    // data files: whitelist and gzip
    assert.strictEqual((await fetch(u + '/data/kjv.json')).status, 200);
    assert.strictEqual((await fetch(u + '/data/settings.json')).status, 404);
    assert.strictEqual((await fetch(u + '/data/../package.json')).status, 404);
    assert.strictEqual((await fetch(u + '/%2e%2e/package.json')).status, 404);
    assert.strictEqual((await J(u + '/api/hotspot/zip', 'POST', { ssid: "a'b" }, H)).status, 400);
  } finally { s.close(); }
});

test('settings: validation, and the RPC password never comes back', async () => {
  const dir = tmp();
  const { app } = createApp({ dataDir: dir, publicDir: path.join(APP, 'public'), appDataDir: path.join(APP, 'data') });
  const s = await listen(app), u = base(s), H = { 'x-bt': '1' };
  try {
    assert.strictEqual((await J(u + '/api/settings', 'PUT', { ollama: { baseUrl: 'ftp://x' } }, H)).status, 400);
    assert.strictEqual((await J(u + '/api/settings', 'PUT', { ollama: { baseUrl: 'http://u:p@x:1' } }, H)).status, 400);
    const ok = await J(u + '/api/settings', 'PUT', { verify: { mode: 'rpc', rpcUrl: 'http://node:8332', rpcUser: 'me', rpcPass: 'SECRET123' } }, H);
    const txt = await ok.text();
    assert.ok(!txt.includes('SECRET123'));
    assert.ok(!(await (await fetch(u + '/api/settings')).text()).includes('SECRET123'));
    assert.strictEqual(fs.statSync(path.join(dir, 'settings.json')).mode & 0o077, 0);
  } finally { s.close(); }
});

// A stand-in "Bitcoin explorer" serving synthetic inscriptions, to test Verify without the network.
function mockChain(books, tamper) {
  const txs = {};
  for (const b of books) txs[b.txid] = fakeTx(b.txid, Buffer.from(tamper === b.id ? b.text.replace('earth', 'Earth') : b.text), { gz: b.id === 'B' });
  return http.createServer((req, res) => {
    const m = req.url.match(/^\/api\/tx\/([0-9a-f]{64})$/);
    if (m && txs[m[1]]) return res.end(JSON.stringify(txs[m[1]]));
    res.statusCode = 404; res.end('nope');
  });
}

test('verify: passes on an honest chain and flags a changed book', async () => {
  const mk = (id, name, ch) => { const text = `${name}\n\n1:1 In the beginning God created the heaven and the earth. 1:2 And the earth was without form.\n\n2:1 Thus the heavens were finished.`; return { id, name, txid: ch.repeat(64), text }; };
  const books = [mk('A', 'The First Book', 'a'), mk('B', 'The Second Book', 'b')];
  const appData = tmp();
  const { parseInscribedBook, toChapters } = require('../server/lib/inscribed');
  const kjv = { books: {} };
  for (const b of books) kjv.books[b.id] = toChapters(parseInscribedBook(b.text, b.id).verses, b.id).chapters;
  fs.writeFileSync(path.join(appData, 'kjv.json'), JSON.stringify(kjv));
  fs.writeFileSync(path.join(appData, 'onchain.json'), JSON.stringify({ books: books.map(b => ({ id: b.id, name: b.name, txid: b.txid, bytes: Buffer.byteLength(b.text), sha256: sha(Buffer.from(b.text)) })) }));

  for (const tamper of [null, 'A']) {
    const chain = mockChain(books, tamper); await new Promise(r => chain.listen(0, '127.0.0.1', r));
    const { app, settings } = createApp({ dataDir: tmp(), publicDir: path.join(APP, 'public'), appDataDir: appData });
    settings.update({ verify: { mode: 'rest', restUrl: `http://127.0.0.1:${chain.address().port}/api` } });
    const s = await listen(app), u = base(s);
    try {
      await J(u + '/api/verify/start', 'POST', {}, { 'x-bt': '1' });
      let st; for (let i = 0; i < 80; i++) { st = await (await fetch(u + '/api/verify')).json(); if (st.state === 'done') break; await new Promise(r => setTimeout(r, 250)); }
      assert.strictEqual(st.state, 'done');
      if (!tamper) assert.deepStrictEqual([st.ok, st.mismatch, st.error], [2, 0, 0]);
      else { assert.strictEqual(st.results.A.status, 'mismatch'); assert.strictEqual(st.results.B.status, 'ok'); }
    } finally { s.close(); chain.close(); }
  }
});

test('ask: streams an answer from a mock Ollama and passes only the given passages', async () => {
  let seen = null;
  const ollama = http.createServer((req, res) => {
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'mock:1b' }] }));
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      seen = JSON.parse(b);
      res.write(JSON.stringify({ message: { content: 'Love is patient [1].' } }) + '\n');
      res.end(JSON.stringify({ done: true }) + '\n');
    });
  });
  await new Promise(r => ollama.listen(0, '127.0.0.1', r));
  const { app, settings } = createApp({ dataDir: tmp(), publicDir: path.join(APP, 'public'), appDataDir: path.join(APP, 'data') });
  const s = await listen(app), u = base(s), H = { 'x-bt': '1' };
  try {
    assert.strictEqual((await J(u + '/api/ask', 'POST', { question: 'q' }, H)).status, 400); // not set up
    settings.update({ ollama: { baseUrl: `http://127.0.0.1:${ollama.address().port}`, model: 'mock:1b' } });
    assert.deepStrictEqual((await (await fetch(u + '/api/ask/models')).json()).models, ['mock:1b']);
    const r = await J(u + '/api/ask', 'POST', { question: 'What is love?', passages: [{ ref: '1 Corinthians 13:4', text: 'Charity suffereth long' }] }, H);
    const body = await r.text();
    assert.match(body, /Love is patient/);
    assert.match(seen.messages[1].content, /\[1\] 1 Corinthians 13:4: Charity suffereth long/);
    assert.match(seen.messages[0].content, /ONLY/);
    assert.strictEqual((await J(u + '/api/ask', 'POST', { question: '' }, H)).status, 400);
  } finally { s.close(); ollama.close(); }
});
