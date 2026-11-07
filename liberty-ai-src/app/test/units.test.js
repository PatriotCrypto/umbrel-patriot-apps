'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { redact } = require('../lib/redact');
const { isAllowed, demux, Docker } = require('../lib/docker');
const { analyze, score, normContainer, parseStats, groupApps } = require('../lib/doctor');
const { isLocalUrl } = require('../lib/util');
const { widgetLines, matchApps } = require('../lib/connectors');
const { pickAlerts } = require('../lib/notify');
const cfg = require('../lib/config');
const { makeGuard } = require('../lib/guard');
const { tmp } = require('./helpers');

test('redact scrubs keys, passwords, bearer tokens and long hex', () => {
  const t = redact('api_key=abcd1234 password: "hunter2" Authorization: Bearer abcdefghijklmnop sk-ant-api03-ABCDEFGHIJKLMNOP1234 hash ' + 'a'.repeat(64) + ' url http://bob:secret@host/x');
  assert.ok(!/abcd1234|hunter2|abcdefghijklmnop|ABCDEFGHIJKLMNOP1234|secret@/.test(t), t);
  assert.ok(!/a{40}/.test(t));
  assert.match(redact('plain log line: container started on port 8080'), /container started on port 8080/);
});

test('docker client only allows read-only paths', () => {
  assert.ok(isAllowed('/containers/json?all=1'));
  assert.ok(isAllowed('/containers/patriot-x_web_1/logs?stdout=1&stderr=1&tail=50'));
  assert.ok(isAllowed('/containers/abc123/stats?stream=false'));
  assert.ok(isAllowed('/system/df'));
  for (const bad of ['/containers/abc/json', '/containers/abc/restart', '/containers/create', '/containers/abc/exec', '/images/json', '/containers/../x/logs?stdout=1&stderr=1&tail=5', '/containers/abc/logs?stdout=1&stderr=1&tail=5&follow=1', '/volumes/prune', '/containers/abc/stats?stream=true']) {
    assert.ok(!isAllowed(bad), bad);
  }
});

test('docker client refuses disallowed requests before touching the socket', async () => {
  const d = new Docker('/nonexistent.sock');
  await assert.rejects(() => d.impl('/nonexistent.sock', '/containers/abc/restart'), /not allowed/);
  assert.strictEqual(await d.available(), false);
});

test('docker log demux handles framed and plain output', () => {
  const frame = (t, s) => { const b = Buffer.from(s); const h = Buffer.alloc(8); h[0] = t; h.writeUInt32BE(b.length, 4); return Buffer.concat([h, b]); };
  assert.strictEqual(demux(Buffer.concat([frame(1, 'hello\n'), frame(2, 'err\n')])), 'hello\nerr\n');
  assert.strictEqual(demux(Buffer.from('plain tty output')), 'plain tty output');
});

const baseSnap = () => ({
  at: Date.now(),
  system: { cores: 4, load: [0.5, 0.5, 0.5], uptimeSec: 86400, mem: { total: 16e9, available: 8e9, used: 8e9, pct: 50 }, swap: { total: 0, pct: 0 }, temps: [], tempMax: 50, disks: [{ name: 'Storage', total: 1e12, free: 5e11, pct: 50 }] },
  docker: { ok: true }, containers: [], apps: [], reclaim: null,
});

test('doctor: healthy server has no findings and score 100', () => {
  const f = analyze(baseSnap());
  assert.strictEqual(f.length, 0);
  assert.strictEqual(score(f), 100);
});

test('doctor: disks, memory, load and heat raise findings with fixes', () => {
  const s = baseSnap();
  s.system.disks[0].pct = 96; s.system.disks[0].free = 4e10;
  s.system.mem.pct = 90; s.system.load = [9, 9, 9]; s.system.tempMax = 88;
  const f = analyze(s);
  const ids = f.map((x) => x.id);
  assert.ok(ids.includes('disk:Storage') && ids.includes('mem') && ids.includes('load') && ids.includes('temp'));
  assert.strictEqual(f[0].sev, 'crit');
  assert.ok(f.every((x) => x.fix.length > 0));
  assert.ok(score(f) < 50);
});

test('doctor: container problems are found and named', () => {
  const mk = (name, project, state, status) => normContainer({ Id: name + '0'.repeat(20), Names: ['/' + name], Image: 'ghcr.io/patriotcrypto/x:1.2.3@sha256:abc', State: state, Status: status, Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': 'web' } });
  const s = baseSnap();
  s.containers = [mk('a_web_1', 'a', 'restarting', 'Restarting (1) 5 seconds ago'), mk('b_web_1', 'b', 'exited', 'Exited (137) 2 hours ago'), mk('c_web_1', 'c', 'running', 'Up 3 days (unhealthy)'), mk('d_web_1', 'd', 'exited', 'Exited (0) 2 hours ago'), mk('e_web_1', 'e', 'running', 'Up 1 day')];
  s.apps = groupApps(s.containers);
  const f = analyze(s);
  assert.deepStrictEqual(f.map((x) => x.container).sort(), ['a_web_1', 'b_web_1', 'c_web_1']);
  assert.match(f.find((x) => x.container === 'b_web_1').detail, /137/);
  assert.strictEqual(s.apps.find((a) => a.id === 'a').state, 'restarting');
  assert.strictEqual(s.containers[0].version, '1.2.3');
});

test('doctor: stats parsing', () => {
  const p = parseStats({ memory_stats: { usage: 1000, stats: { inactive_file: 200 } }, cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 2000, online_cpus: 2 }, precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 } });
  assert.strictEqual(p.mem, 800);
  assert.strictEqual(p.cpu, 40);
});

test('isLocalUrl: container names and private addresses are local, public hosts are not', () => {
  for (const u of ['http://ollama_ollama_1:11434', 'http://localhost:1', 'http://192.168.1.5:80', 'http://10.0.0.2', 'http://umbrel.local', 'http://[::1]:5']) assert.ok(isLocalUrl(u), u);
  for (const u of ['https://api.anthropic.com', 'http://8.8.8.8', 'http://example.com', 'ftp://x', 'nonsense']) assert.ok(!isLocalUrl(u), u);
});

test('widgets convert to plain lines and app matching works', () => {
  assert.deepStrictEqual(widgetLines({ type: 'four-stats', items: [{ title: 'Food', text: '41', subtext: 'days' }] }), ['Food: 41 days']);
  assert.deepStrictEqual(widgetLines({ type: 'list-emoji', items: [], noItemsText: 'All clear' }), ['All clear']);
  const apps = [{ name: 'Rally Point', keywords: ['food', 'supplies'] }, { name: 'ZeroDollar', keywords: ['budget'] }];
  assert.deepStrictEqual(matchApps('how much food do we have', apps).map((a) => a.name), ['Rally Point']);
  assert.deepStrictEqual(matchApps('hello', apps), []);
});

test('alerts: urgent only by default, once per day per finding, cleared when resolved', () => {
  const sent = {};
  const fs1 = [{ id: 'a', sev: 'crit' }, { id: 'b', sev: 'warn' }];
  assert.deepStrictEqual(pickAlerts(fs1, sent, 'crit', 1000).map((f) => f.id), ['a']);
  assert.deepStrictEqual(pickAlerts(fs1, sent, 'crit', 2000), []);
  assert.deepStrictEqual(pickAlerts([], sent, 'crit', 3000), []);
  assert.deepStrictEqual(pickAlerts(fs1, sent, 'warn', 4000).map((f) => f.id), ['a', 'b']);
});

test('settings validation', () => {
  const cur = cfg.defaults();
  const ids = ['patriot-rally-point'];
  assert.throws(() => cfg.validate({ provider: 'evil' }, cur, ids), /Unknown/);
  assert.throws(() => cfg.validate({ ollama: { url: 'javascript:alert(1)' } }, cur, ids), /http/);
  assert.throws(() => cfg.validate({ ollama: { url: 'http://u:p@host' } }, cur, ids), /password/);
  assert.throws(() => cfg.validate({ ntfy: { topic: 'bad topic!' } }, cur, ids), /topic/);
  const s = cfg.validate({ provider: 'anthropic', localOnly: true, sources: { files: { cloud: true } }, appsOn: { 'patriot-rally-point': true, 'unknown-app': true }, checkIntervalMin: 1 }, cur, ids);
  assert.strictEqual(s.provider, 'anthropic'); assert.strictEqual(s.localOnly, true); assert.strictEqual(s.sources.files.cloud, true);
  assert.deepStrictEqual(s.appsOn, { 'patriot-rally-point': true }); assert.strictEqual(s.checkIntervalMin, 5);
  assert.strictEqual(cur.sources.files.cloud, false, 'input must not mutate current settings');
});

test('secrets file is private and never echoes the key', () => {
  const dir = tmp();
  const sec = new cfg.Secrets(dir);
  sec.set({ anthropicKey: 'sk-ant-test-123' });
  assert.deepStrictEqual(sec.has(), { anthropic: true, openai: false });
  assert.strictEqual(fs.statSync(path.join(dir, 'secrets.json')).mode & 0o077, 0);
  assert.throws(() => sec.set({ openaiKey: 'two words' }), /spaces/);
  sec.set({ anthropicKey: '' });
  assert.strictEqual(sec.has().anthropic, false);
});

test('guard: only the proxy and localhost get through', async () => {
  const g = makeGuard({ proxyHost: 'proxy', lookup: async () => [{ address: '172.18.0.5' }] });
  const req = (ip) => ({ socket: { remoteAddress: ip } });
  assert.ok(await g.check(req('172.18.0.5')));
  assert.ok(await g.check(req('::ffff:172.18.0.5')));
  assert.ok(await g.check(req('127.0.0.1')));
  assert.ok(!(await g.check(req('172.18.0.9'))));
  const unresolved = makeGuard({ proxyHost: 'nope', lookup: async () => { throw new Error('ENOTFOUND'); } });
  assert.ok(await unresolved.check(req('172.18.0.9')));
  assert.strictEqual(await unresolved.status(), 'unresolved');
  const unconfigured = makeGuard({});
  assert.ok(!(await unconfigured.check(req('172.18.0.9'))));
});
