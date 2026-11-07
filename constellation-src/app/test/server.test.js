'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');
const { Auth } = require('../lib/auth');
const U = require('../lib/util');

const NET = { ok: true, iface: 'eth0', ip: '192.168.1.20', mac: 'a0:36:bc:12:34:56', gateway: '192.168.1.1', cidrs: ['192.168.1.0/24'], parsed: [U.parseCidr('192.168.1.0/24')], source: 'auto' };
const HOSTS = [
  { ip: '192.168.1.1', mac: '00:26:12:aa:bb:cc' },
  { ip: '192.168.1.20', mac: 'a0:36:bc:12:34:56' },
  { ip: '192.168.1.41', mac: 'da:4f:21:90:6b:17' },
];

async function boot(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
  const sent = [];
  const app = createApp(Object.assign({
    dataDir: dir, noAuth: false, noDrop: true, netFn: () => NET,
    scanFn: async () => ({ hosts: HOSTS, durationMs: 3 }),
    probeFn: async () => ({ wan: 31.5, lan: 1.2 }),
    nameFn: async (ip) => (ip === '192.168.1.41' ? 'Alexs-iPhone' : null),
    fetchFn: async (url, init) => { sent.push({ url, init }); return { ok: true }; },
    firstScanMs: 3600e3, firstProbeMs: 3600e3,
  }, extra));
  const port = await app.start(0);
  const base = 'http://127.0.0.1:' + port;
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const h = Object.assign({ cookie }, headers);
    if (method !== 'GET') h['x-cs-request'] = '1';
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  return { app, call, base, dir, sent, clearCookie: () => { cookie = ''; } };
}

test('API requires sign-in; first run sets a password and shows a recovery code once', async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('GET', '/api/state')).status, 401);
    const st = await t.call('GET', '/api/auth/status');
    assert.deepEqual([st.json.configured, st.json.authed], [false, false]);

    const noHeader = await fetch(t.base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"longenough1"}' });
    assert.equal(noHeader.status, 403); // CSRF header missing

    assert.equal((await t.call('POST', '/api/auth/setup', { password: 'short' })).status, 400);
    const setup = await t.call('POST', '/api/auth/setup', { password: 'correct horse battery' });
    assert.equal(setup.status, 200);
    assert.match(setup.json.recoveryCode, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
    assert.equal((await t.call('POST', '/api/auth/setup', { password: 'another password' })).status, 409);
    assert.equal((await t.call('GET', '/api/state')).status, 200);

    // the secret is never stored in plain text
    const raw = fs.readFileSync(path.join(t.dir, 'auth.json'), 'utf8');
    assert.ok(!raw.includes('correct horse') && !raw.includes(setup.json.recoveryCode));

    t.clearCookie();
    assert.equal((await t.call('GET', '/api/state')).status, 401);
    assert.equal((await t.call('POST', '/api/auth/login', { password: 'nope nope nope' })).status, 401);
    assert.equal((await t.call('POST', '/api/auth/login', { password: 'correct horse battery' })).status, 200);
    assert.equal((await t.call('GET', '/api/state')).status, 200);

    // forgot password: recovery code works once, and issues a fresh code
    t.clearCookie();
    const reset = await t.call('POST', '/api/auth/reset', { recoveryCode: setup.json.recoveryCode.toLowerCase(), newPassword: 'a brand new password' });
    assert.equal(reset.status, 200);
    assert.notEqual(reset.json.recoveryCode, setup.json.recoveryCode);
    t.clearCookie();
    assert.equal((await t.call('POST', '/api/auth/reset', { recoveryCode: setup.json.recoveryCode, newPassword: 'whatever123' })).status, 401);
  } finally { await t.app.stop(); }
});

test('repeated wrong passwords are throttled', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/auth/setup', { password: 'correct horse battery' });
    t.clearCookie();
    let last;
    for (let i = 0; i < 6; i++) last = await t.call('POST', '/api/auth/login', { password: 'wrong wrong ' + i });
    assert.equal(last.status, 429);
    assert.equal((await t.call('POST', '/api/auth/login', { password: 'correct horse battery' })).status, 429);
  } finally { await t.app.stop(); }
});

test('session cookies cannot be forged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-auth-'));
  const a = new Auth(dir);
  a.setup('long enough password');
  const token = a.issue();
  assert.equal(a.isAuthed({ headers: { cookie: 'cs_session=' + token } }), true);
  const [payload] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 1e12 })).toString('base64url');
  assert.equal(a.isAuthed({ headers: { cookie: 'cs_session=' + forged + '.' + token.split('.')[1] } }), false);
  assert.equal(a.isAuthed({ headers: { cookie: 'cs_session=' + payload + '.' } }), false);
  assert.equal(a.isAuthed({ headers: { cookie: 'cs_session=' + a.issue(Date.now() - 40 * 86400e3) } }), false); // expired
  a.change('another long password'); // rotates the signing secret
  assert.equal(a.isAuthed({ headers: { cookie: 'cs_session=' + token } }), false);
});

test('scanning, names, renaming, alerts and history through the API', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/auth/setup', { password: 'correct horse battery' });
    await t.app.doScan();
    let s = (await t.call('GET', '/api/state')).json;
    assert.equal(s.devices.length, 3);
    assert.equal(s.summary.online, 3);
    assert.equal(s.network.gateway, '192.168.1.1');
    assert.equal(s.scanner.lastError, null);
    // the self device picks up this machine's hostname; the phone gets its mDNS name
    await new Promise((r) => setTimeout(r, 100));
    s = (await t.call('GET', '/api/state')).json;
    const phone = s.devices.find((d) => d.ip === '192.168.1.41');
    assert.equal(phone.hostname, 'Alexs-iPhone');
    assert.equal(phone.type, 'phone');
    assert.equal(s.devices.find((d) => d.role === 'gateway').type, 'router');

    // rename
    const mac = encodeURIComponent(phone.mac);
    const r = await t.call('PATCH', '/api/devices/' + mac, { name: "Alex's Phone", notes: 'Black case' });
    assert.equal(r.status, 200);
    assert.equal(r.json.device.label, "Alex's Phone");
    assert.equal((await t.call('PATCH', '/api/devices/' + mac, { type: 'toaster' })).status, 400);
    assert.equal((await t.call('PATCH', '/api/devices/00:00:00:00:00:99', { name: 'x' })).status, 404);

    const detail = await t.call('GET', '/api/devices/' + mac);
    assert.equal(detail.json.sessions.length, 1);

    // history shape
    await t.app.doProbe();
    const h = (await t.call('GET', '/api/history?range=24h')).json;
    assert.equal(h.devices.length, 3);
    assert.equal(h.wanStats.avg, 31.5);
    assert.equal((await t.call('GET', '/api/history?range=bogus')).json.range, '24h');

    // settings
    assert.equal((await t.call('PUT', '/api/settings', { scanIntervalSec: 2 })).status, 400);
    const ps = await t.call('PUT', '/api/settings', { scanIntervalSec: 60, offlineAfterSec: 600 });
    assert.equal(ps.json.settings.scanIntervalSec, 60);

    // export -> import round trip
    const exp = await t.call('GET', '/api/export');
    assert.match(exp.headers.get('content-disposition'), /attachment/);
    assert.equal((await t.call('POST', '/api/import', exp.json)).json.devices, 3);
    assert.equal((await t.call('POST', '/api/import', { junk: true })).status, 400);
  } finally { await t.app.stop(); }
});

test('a device that joins later raises one alert; notifications are optional', async () => {
  let hosts = HOSTS.slice(0, 2);
  const t = await boot({ scanFn: async () => ({ hosts, durationMs: 1 }) });
  try {
    await t.call('POST', '/api/auth/setup', { password: 'correct horse battery' });
    await t.call('PUT', '/api/settings', { ntfy: { enabled: true, topic: 'my-net', server: 'https://ntfy.example.com' } });
    await t.app.doScan();
    hosts = HOSTS;
    await t.app.doScan();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].url, 'https://ntfy.example.com/my-net');
    assert.match(t.sent[0].init.body, /192\.168\.1\.41/);
    const s = (await t.call('GET', '/api/state')).json;
    assert.equal(s.summary.unreviewed, 1);
    assert.equal((await t.call('POST', '/api/ack-all', {})).json.acknowledged, 1);
    assert.equal((await t.call('GET', '/api/state')).json.summary.unreviewed, 0);
  } finally { await t.app.stop(); }
});

test('data survives a restart', async () => {
  const t = await boot();
  const dir = t.dir;
  await t.call('POST', '/api/auth/setup', { password: 'correct horse battery' });
  await t.app.doScan();
  const mac = encodeURIComponent('da:4f:21:90:6b:17');
  await t.call('PATCH', '/api/devices/' + mac, { name: 'Persistent Phone' });
  await t.app.stop();
  const t2 = await boot({ dataDir: dir });
  try {
    t2.clearCookie();
    assert.equal((await t2.call('POST', '/api/auth/login', { password: 'correct horse battery' })).status, 200);
    const s = (await t2.call('GET', '/api/state')).json;
    assert.equal(s.devices.find((d) => d.name === 'Persistent Phone').mac, 'da:4f:21:90:6b:17');
  } finally { await t2.app.stop(); }
});

test('a scan that fails reports the error instead of wiping devices', async () => {
  let fail = false;
  const t = await boot({ scanFn: async () => (fail ? { hosts: [], durationMs: 1, error: 'Cannot read the ARP table' } : { hosts: HOSTS, durationMs: 1 }) });
  try {
    await t.call('POST', '/api/auth/setup', { password: 'correct horse battery' });
    await t.app.doScan();
    fail = true;
    await t.app.doScan();
    const s = (await t.call('GET', '/api/state')).json;
    assert.equal(s.scanner.lastError, 'Cannot read the ARP table');
    assert.equal(s.summary.online, 3);
  } finally { await t.app.stop(); }
});

test('static files are served safely with security headers', async () => {
  const t = await boot();
  try {
    const idx = await t.call('GET', '/');
    assert.equal(idx.status, 200);
    assert.match(idx.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(idx.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await t.call('GET', '/..%2f..%2fetc%2fpasswd')).status === 200 && /root:/.test((await t.call('GET', '/..%2f..%2fetc%2fpasswd')).text), false);
    assert.equal((await t.call('GET', '/js/nope.js')).status, 404);
    assert.equal((await t.call('GET', '/api/nope')).status, 404);
    assert.equal((await t.call('POST', '/api/state', {})).status, 405);
    const cross = await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cs-request': '1', origin: 'http://evil.example' }, body: '{}' });
    assert.equal(cross.status, 403);
  } finally { await t.app.stop(); }
});

test('oversized bodies are refused', async () => {
  const t = await boot();
  try {
    const r = await fetch(t.base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cs-request': '1' }, body: JSON.stringify({ password: 'x'.repeat(200000) }) });
    assert.equal(r.status, 413);
  } finally { await t.app.stop(); }
});

test('demo mode serves a full network without auth or disk writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-demo-'));
  const app = createApp({ dataDir: dir, demo: true, noAuth: true, noDrop: true, firstScanMs: 3600e3, firstProbeMs: 3600e3 });
  const port = await app.start(0);
  try {
    const s = await (await fetch('http://127.0.0.1:' + port + '/api/state')).json();
    assert.equal(s.demo, true);
    assert.ok(s.devices.length >= 20);
    assert.ok(!fs.existsSync(path.join(dir, 'data.json')));
  } finally { await app.stop(); }
});
