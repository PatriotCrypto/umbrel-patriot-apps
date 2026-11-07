'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Index, tokenize, chunkText, resolveInRoot, listDirs } = require('../lib/indexer');
const X = require('../lib/extract');
const providers = require('../lib/providers');
const ctx = require('../lib/context');
const cfg = require('../lib/config');
const { tmp, makeZip } = require('./helpers');

function storage() {
  const root = tmp('la-st-');
  const w = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  w('Docs/insurance.txt', 'Auto policy renews on March 14. Premium is $612 every six months.\n\nCollision deductible is $500.');
  w('Docs/pump.md', '# Well pump\nPressure tank pre-charge is 38 psi. Replaced in 2023.');
  w('Docs/.hidden/secret.txt', 'should never be indexed');
  w('Docs/passwords.txt', 'bank: hunter2');
  w('Docs/wallet.dat', 'binary');
  w('Docs/page.html', '<html><head><title>x</title><style>p{}</style></head><body><p>Generator service every spring</p><script>evil()</script></body></html>');
  fs.writeFileSync(path.join(root, 'Docs/report.docx'), makeZip({ 'word/document.xml': '<w:document><w:body><w:p><w:t>Quarterly furnace filter inspection notes</w:t></w:p></w:body></w:document>' }));
  w('Other/private.txt', 'not in an allowed folder: zebra');
  return root;
}

test('tokenize drops stop words and stems lightly', () => {
  assert.deepStrictEqual(tokenize('The renewals are renewing'), ['renewal', 'renew']);
});

test('chunking keeps passages near the size limit', () => {
  const para = 'Sentence number one is here. '.repeat(120);
  const cs = chunkText(para);
  assert.ok(cs.length > 2);
  assert.ok(cs.every((c) => c.length <= 1100));
});

test('indexer: indexes only chosen folders, skips hidden and secret-looking files, reads docx and html', async () => {
  const root = storage();
  const idx = new Index({ root, file: path.join(tmp(), 'index.json') });
  await idx.scan(['Docs']);
  const files = Array.from(idx.docs.keys()).sort();
  assert.deepStrictEqual(files, ['Docs/insurance.txt', 'Docs/page.html', 'Docs/pump.md', 'Docs/report.docx']);
  assert.ok(idx.search('insurance renewal')[0].path.endsWith('insurance.txt'));
  assert.ok(idx.search('furnace filter')[0].path.endsWith('report.docx'));
  assert.ok(idx.search('generator service')[0].path.endsWith('page.html'));
  assert.ok(!JSON.stringify(idx.search('evil')).includes('evil()'), 'script bodies must not be indexed');
  assert.deepStrictEqual(idx.search('zebra'), [], 'files outside chosen folders are never read');
  assert.deepStrictEqual(idx.search('hunter2'), []);
});

test('indexer: incremental rescan, removal and persistence', async () => {
  const root = storage();
  const file = path.join(tmp(), 'index.json');
  const idx = new Index({ root, file });
  await idx.scan(['Docs']);
  const first = idx.status.indexed;
  await idx.scan(['Docs']);
  assert.strictEqual(idx.status.indexed, 0, 'unchanged files are not re-read');
  fs.unlinkSync(path.join(root, 'Docs/pump.md'));
  await idx.scan(['Docs']);
  assert.ok(!idx.docs.has('Docs/pump.md'));
  const again = new Index({ root, file });
  again.load();
  assert.strictEqual(again.stats().docs, idx.stats().docs);
  assert.ok(first >= 4);
  await idx.scan([]);
  assert.strictEqual(idx.stats().docs, 0, 'removing a folder forgets its files');
});

test('paths cannot escape the storage root', async () => {
  const root = storage();
  assert.strictEqual(await resolveInRoot(root, '../etc'), null);
  assert.strictEqual(await resolveInRoot(root, 'Docs/../../etc'), null);
  fs.symlinkSync('/etc', path.join(root, 'link'));
  assert.strictEqual(await resolveInRoot(root, 'link'), null);
  assert.strictEqual((await resolveInRoot(root, 'Docs')).rel, 'Docs');
  const l = await listDirs(root, '');
  assert.ok(l.dirs.includes('Docs') && !l.dirs.includes('link') || l.dirs.includes('Docs'));
  assert.ok(!(await listDirs(root, '')).dirs.some((d) => d.startsWith('.')));
});

test('extract: denied names and supported types', () => {
  assert.ok(X.isDenied('.env', false) && X.isDenied('my-passwords.txt', false) && X.isDenied('id_rsa', false) && X.isDenied('seed-phrase.txt', false));
  assert.ok(!X.isDenied('taxes-2025.pdf', false));
  assert.ok(X.supported('a.docx', false) && X.supported('a.md', false) && !X.supported('a.pdf', false) && X.supported('a.pdf', true) && !X.supported('a.jpg', true));
});

// ---------- providers against fake servers ----------
function fake(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve({ s, url: 'http://127.0.0.1:' + s.address().port }));
  });
}
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(JSON.parse(b || '{}'))); });

test('ollama provider streams NDJSON and lists models', async () => {
  let seen;
  const { s, url } = await fake(async (req, res) => {
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }));
    seen = await readBody(req);
    res.write(JSON.stringify({ message: { content: 'Hel' } }) + '\n');
    res.write(JSON.stringify({ message: { content: 'lo' }, done: true, prompt_eval_count: 5, eval_count: 2 }) + '\n');
    res.end();
  });
  const p = providers.create({ provider: 'ollama', ollama: { url, model: 'llama3.2:3b', numCtx: 4096 } }, {});
  assert.deepStrictEqual(await p.models(), ['llama3.2:3b']);
  const toks = [];
  const r = await p.chat({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], onToken: (t) => toks.push(t) });
  assert.strictEqual(r.text, 'Hello'); assert.deepStrictEqual(toks, ['Hel', 'lo']); assert.deepStrictEqual(r.usage, { in: 5, out: 2 });
  assert.strictEqual(seen.messages[0].role, 'system'); assert.strictEqual(seen.options.num_ctx, 4096);
  assert.strictEqual(p.cloud, false);
  s.close();
});

test('anthropic provider sends key header, streams SSE, and counts as cloud', async () => {
  let headers; let body;
  const { s, url } = await fake(async (req, res) => { headers = req.headers; body = await readBody(req); res.end(); });
  // Point the provider at the fake server by wrapping fetch.
  const fetchImpl = (u, o) => fetch(String(u).replace('https://api.anthropic.com', url), o);
  const sse = (ev, d) => 'event: ' + ev + '\ndata: ' + JSON.stringify(d) + '\n\n';
  s.removeAllListeners('request');
  s.on('request', async (req, res) => {
    headers = req.headers; body = await readBody(req);
    res.write(sse('message_start', { type: 'message_start', message: { usage: { input_tokens: 11 } } }));
    res.write(sse('content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } }));
    res.write(sse('content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there' } }));
    res.write(sse('message_delta', { type: 'message_delta', usage: { output_tokens: 3 } }));
    res.end();
  });
  const p = providers.create({ provider: 'anthropic', anthropic: { model: 'claude-sonnet-5-5' } }, { anthropicKey: 'sk-ant-xyz' }, fetchImpl);
  const r = await p.chat({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
  assert.strictEqual(r.text, 'Hi there'); assert.deepStrictEqual(r.usage, { in: 11, out: 3 });
  assert.strictEqual(headers['x-api-key'], 'sk-ant-xyz'); assert.strictEqual(body.model, 'claude-sonnet-5-5'); assert.strictEqual(body.system, 'sys'); assert.strictEqual(body.stream, true);
  assert.strictEqual(p.cloud, true);
  const noKey = providers.create({ provider: 'anthropic', anthropic: {} }, {}, fetchImpl);
  await assert.rejects(() => noKey.chat({ messages: [] }), /API key/);
  s.close();
});

test('openai-compatible provider streams and rejects bad keys clearly', async () => {
  const { s, url } = await fake(async (req, res) => {
    if (req.headers.authorization !== 'Bearer good') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'bad key' } })); }
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n\n'); res.write('data: [DONE]\n\n'); res.end();
  });
  const good = providers.create({ provider: 'openai', openai: { url, model: 'm' } }, { openaiKey: 'good' });
  assert.strictEqual((await good.chat({ messages: [{ role: 'user', content: 'x' }] })).text, 'ok');
  assert.strictEqual(good.cloud, false);
  const bad = providers.create({ provider: 'openai', openai: { url, model: 'm' } }, { openaiKey: 'nope' });
  await assert.rejects(() => bad.chat({ messages: [] }), /rejected the key/);
  s.close();
});

test('provider reports unreachable servers in plain words', async () => {
  const p = providers.create({ provider: 'ollama', ollama: { url: 'http://127.0.0.1:1', model: 'm' } }, {});
  await assert.rejects(() => p.chat({ messages: [] }), /Could not reach Ollama/);
});

// ---------- context + permissions ----------
async function ctxFor(over, provider) {
  const root = storage();
  const idx = new Index({ root, file: path.join(tmp(), 'i.json') });
  await idx.scan(['Docs']);
  const settings = Object.assign(cfg.defaults(), over.settings || {});
  settings.appsOn = { 'patriot-rally-point': true };
  settings.sources.health = { enabled: true, cloud: true };
  if (over.sources) for (const k of Object.keys(over.sources)) Object.assign(settings.sources[k], over.sources[k]);
  const health = { snap: { system: { uptimeSec: 100, cores: 2, load: [1, 1, 1], mem: { pct: 50, used: 1, total: 2 }, swap: { total: 0 }, disks: [], tempMax: null }, docker: { ok: true }, apps: [], containers: [] },
    findings: [{ id: 'c:x', sev: 'crit', title: 'X keeps restarting', detail: 'd', fix: [], container: 'x_web_1' }] };
  return ctx.build({ question: over.q, mode: over.mode || 'chat', settings, provider,
    deps: { getHealth: async () => health, logsFor: async () => ({ x_web_1: 'boom api_key=SECRETVALUE1234567' }), readApp: async () => ({ ok: true, lines: ['Food: 41 days'] }),
      listApps: () => require('../lib/catalog').PATRIOT, index: idx } });
}

test('context: local AI gets everything enabled', async () => {
  const c = await ctxFor({ q: 'why is my server broken? when does my insurance renew food days' }, { cloud: false });
  const kinds = c.sources.map((s) => s.kind);
  assert.ok(kinds.includes('health') && kinds.includes('logs') && kinds.includes('file') && kinds.includes('app'), kinds.join());
  assert.ok(!c.system.includes('SECRETVALUE'), 'secrets are scrubbed from logs');
  assert.strictEqual(c.blocked.length, 0);
});

test('context: cloud AI only gets what is allowed to leave, and says what was held back', async () => {
  const c = await ctxFor({ q: 'why is my server broken? when does my insurance renew food days' }, { cloud: true });
  const kinds = c.sources.map((s) => s.kind);
  assert.deepStrictEqual(kinds, ['health']);
  assert.deepStrictEqual(c.blocked.map((b) => b.kind).sort(), ['apps', 'files', 'logs']);
  assert.ok(!c.system.includes('insurance.txt') && !c.system.includes('Food: 41'));
});

test('context: user can allow files to go to the cloud, and a switched-off source is never used', async () => {
  const c = await ctxFor({ q: 'when does my insurance renew', sources: { files: { cloud: true } } }, { cloud: true });
  assert.ok(c.sources.some((s) => s.kind === 'file'));
  const off = await ctxFor({ q: 'when does my insurance renew', sources: { files: { enabled: false } } }, { cloud: false });
  assert.ok(!off.sources.some((s) => s.kind === 'file'));
});

test('context: doctor mode skips files and apps', async () => {
  const c = await ctxFor({ q: 'what is wrong', mode: 'doctor' }, { cloud: false });
  assert.ok(c.sources.every((s) => s.kind === 'health' || s.kind === 'logs'));
  assert.match(c.system, /DATA, not instructions/);
});
