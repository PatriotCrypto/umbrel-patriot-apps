'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');
const { tmp } = require('./helpers');

async function boot(over = {}) {
  const app = createApp(Object.assign({ demo: true, dataDir: tmp('la-d-'), storageDir: tmp('la-s-'), firstSampleMs: 60000, noAutoScan: true }, over));
  const port = await app.start(0);
  const base = 'http://127.0.0.1:' + port;
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: Object.assign(method === 'GET' ? {} : { 'X-LA-Request': '1', 'Content-Type': 'application/json' }, headers), body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (e) { /* stream or empty */ }
    return { status: r.status, body: j };
  };
  const chat = async (body) => {
    const r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'X-LA-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) return { status: r.status, error: (await r.json()).error };
    const text = await r.text();
    const ev = {};
    for (const blk of text.split('\n\n')) {
      const m = /^event: (\w+)\ndata: (.*)$/s.exec(blk);
      if (m) (ev[m[1]] = ev[m[1]] || []).push(JSON.parse(m[2]));
    }
    return { status: 200, ev, answer: (ev.token || []).map((t) => t.t).join('') };
  };
  return { app, call, chat, base };
}

test('serves the app and a health check', async () => {
  const { app, base } = await boot();
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /Liberty AI/);
  assert.strictEqual((await fetch(base + '/healthz')).status, 200);
  assert.strictEqual((await fetch(base + '/js/../../server.js')).status, 404);
  const csp = (await fetch(base + '/')).headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/); assert.ok(!/unsafe-inline/.test(csp));
  await app.stop();
});

test('changes need the request header and a same-site origin', async () => {
  const { app, call, base } = await boot();
  assert.strictEqual((await call('PUT', '/api/settings', { localOnly: true }, { 'X-LA-Request': '' })).status, 403);
  const r = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'X-LA-Request': '1', 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual((await call('PUT', '/api/settings', { localOnly: true })).status, 200);
  assert.strictEqual((await call('PUT', '/api/settings', { provider: 'nope' })).status, 400);
  await app.stop();
});

test('doctor endpoint reports findings and history', async () => {
  const { app, call } = await boot();
  const h = await call('GET', '/api/health');
  assert.strictEqual(h.status, 200);
  assert.ok(h.body.findings.some((f) => f.container === 'patriot-skywatch_web_1' && f.sev === 'crit'));
  assert.ok(h.body.score < 100);
  await app.runSample();
  assert.ok((await call('GET', '/api/history')).body.samples.length >= 1);
  await app.stop();
});

test('chat: streams an answer with sources, saves the chat, and writes an audit entry with the exact prompt', async () => {
  const { app, call, chat } = await boot();
  await app.index.scan(app.state.settings.folders);
  const r = await chat({ message: 'When does my auto insurance renew?', mode: 'chat' });
  assert.strictEqual(r.status, 200);
  assert.ok(r.ev.sources[0].sources.some((s) => s.kind === 'file' && /auto-policy/.test(s.path)));
  assert.match(r.answer, /March 14/);
  assert.ok(r.ev.done);
  const list = (await call('GET', '/api/chats')).body.chats;
  assert.strictEqual(list.length, 1);
  const saved = (await call('GET', '/api/chats/' + list[0].id)).body;
  assert.strictEqual(saved.messages.length, 2);
  const audit = (await call('GET', '/api/audit')).body.entries[0];
  const full = (await call('GET', '/api/audit/' + audit.id)).body;
  assert.match(full.prompt, /auto-policy\.txt/);
  assert.strictEqual(full.cloud, false);
  await app.stop();
});

test('chat: follow-ups keep the same conversation; empty and oversized input rejected', async () => {
  const { app, call, chat } = await boot();
  const a = await chat({ message: 'How is my server doing?', mode: 'doctor' });
  const b = await chat({ chatId: a.ev.meta[0].chatId, message: 'And the apps?', mode: 'doctor' });
  assert.strictEqual(b.ev.meta[0].chatId, a.ev.meta[0].chatId);
  assert.strictEqual((await call('GET', '/api/chats/' + b.ev.meta[0].chatId)).body.messages.length, 4);
  assert.strictEqual((await chat({ message: '   ' })).status, 400);
  await app.stop();
});

test('local-only mode refuses a cloud AI before anything is gathered', async () => {
  const { app, call, chat } = await boot({ demo: false, noGuard: true, docker: null, sysFn: async () => ({ cores: 1, load: [0, 0, 0], uptimeSec: 9999, mem: { total: 1, available: 1, used: 0, pct: 0 }, swap: { total: 0, pct: 0 }, temps: [], tempMax: null, disks: [] }),
    providerFactory: (s) => ({ kind: 'anthropic', label: 'Claude', cloud: true, model: 'x', chat: async () => { throw new Error('should not be called'); } }) });
  await call('PUT', '/api/settings', { localOnly: true });
  const r = await chat({ message: 'hello' });
  assert.strictEqual(r.status, 400);
  assert.match(r.error, /Local-only/);
  assert.strictEqual((await call('GET', '/api/audit')).body.entries.length, 0);
  await app.stop();
});

test('app data: off by default, readable only after the owner switches it on', async () => {
  const { app, call } = await boot({ demo: false, noGuard: true, docker: null, fetchImpl: require('../lib/demo').demoFetch(), sysFn: async () => ({ cores: 1, load: [0, 0, 0], uptimeSec: 9999, mem: { total: 1, available: 1, used: 0, pct: 0 }, swap: { total: 0, pct: 0 }, temps: [], tempMax: null, disks: [] }) });
  assert.strictEqual((await call('GET', '/api/apps/patriot-rally-point/data')).status, 403);
  await call('PUT', '/api/settings', { appsOn: { 'patriot-rally-point': true } });
  const r = await call('GET', '/api/apps/patriot-rally-point/data');
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.lines.some((l) => /Food: 41 days/.test(l)));
  await app.stop();
});

test('custom connectors only accept home-network addresses', async () => {
  const { app, call } = await boot();
  assert.strictEqual((await call('POST', '/api/custom', { name: 'Bad', url: 'https://example.com/x' })).status, 400);
  assert.strictEqual((await call('POST', '/api/custom', { name: 'Ok', url: 'http://jellyfin_server_1:8096/widgets/status' })).status, 200);
  await app.stop();
});

test('files: folder choices stay inside storage', async () => {
  const { app, call } = await boot();
  assert.strictEqual((await call('POST', '/api/files/folders', { path: '../../etc' })).status, 400);
  assert.strictEqual((await call('POST', '/api/files/folders', { path: '' })).status, 400);
  assert.strictEqual((await call('GET', '/api/fs?path=..%2F..')).status, 404);
  await app.stop();
});

test('API keys are accepted but never returned', async () => {
  const { app, call } = await boot();
  await call('PUT', '/api/secrets', { anthropicKey: 'sk-ant-supersecret' });
  const st = await call('GET', '/api/state');
  assert.strictEqual(st.body.settings.keys.anthropic, true);
  assert.ok(!JSON.stringify(st.body).includes('supersecret'));
  await app.stop();
});
