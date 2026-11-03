process.env.ZD_NO_TIMER = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { localParts } from '../lib/ntfy.js';

async function boot(fakeFetch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-sec-'));
  const made = createApp({ dataDir: dir, publicDir: dir });
  if (fakeFetch) made.app.locals.fetch = fakeFetch;
  const server = await new Promise((r) => { const s = made.app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  const call = async (m, p, b) => {
    const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: b ? JSON.stringify(b) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null), setCookie: sc };
  };
  return { call, dir, made, close: () => server.close(), clearCookie: () => { cookie = ''; } };
}

test('password: setup, lock, login, wrong password, change, remove', async () => {
  const { call, close, clearCookie, dir } = await boot();
  try {
    assert.deepEqual((await call('GET', '/auth/status')).body, { required: false, authed: true });
    assert.equal((await call('POST', '/auth/password', { password: 'short' })).status, 400);
    const set = await call('POST', '/auth/password', { password: 'correct horse 42' });
    assert.equal(set.status, 200);
    assert.match(set.setCookie, /HttpOnly/);
    assert.match(set.setCookie, /SameSite=Strict/);
    assert.equal((await call('GET', '/meta')).status, 200); // signed in by setting it
    // the hash lives outside the backup
    assert.ok(!JSON.stringify((await call('GET', '/export')).body).includes('scrypt'));
    assert.ok(fs.existsSync(path.join(dir, 'private.json')));
    clearCookie();
    const locked = await call('GET', '/meta');
    assert.equal(locked.status, 401);
    assert.equal(locked.body.auth, true);
    assert.equal((await call('GET', '/auth/status')).body.authed, false);
    assert.equal((await call('POST', '/auth/login', { password: 'nope nope nope' })).status, 401);
    assert.equal((await call('POST', '/auth/login', { password: 'correct horse 42' })).status, 200);
    assert.equal((await call('GET', '/meta')).status, 200);
    // change needs the current password
    assert.equal((await call('POST', '/auth/password', { current: 'wrong', password: 'another long one' })).status, 403);
    assert.equal((await call('POST', '/auth/password', { current: 'correct horse 42', password: 'another long one' })).status, 200);
    await call('POST', '/auth/logout');
    assert.equal((await call('GET', '/meta')).status, 401);
    await call('POST', '/auth/login', { password: 'another long one' });
    assert.equal((await call('POST', '/auth/remove', { current: 'bad' })).status, 403);
    assert.equal((await call('POST', '/auth/remove', { current: 'another long one' })).status, 200);
    assert.equal((await call('GET', '/meta')).status, 200);
  } finally { close(); }
});

test('password: five wrong tries slow you down', async () => {
  const { call, close, clearCookie } = await boot();
  try {
    await call('POST', '/auth/password', { password: 'correct horse 42' });
    clearCookie();
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/login', { password: 'wrong wrong' + i })).status, 401);
    assert.equal((await call('POST', '/auth/login', { password: 'correct horse 42' })).status, 429);
  } finally { close(); }
});

test('ntfy: validation, test message, weekly and monthly reminders once each', async () => {
  const sent = [];
  const fake = async (url, init) => { sent.push({ url, headers: init.headers, body: init.body }); return { ok: true, status: 200 }; };
  const { call, close, made } = await boot(fake);
  try {
    assert.equal((await call('PUT', '/ntfy', { enabled: true })).status, 400); // no topic
    assert.equal((await call('PUT', '/ntfy', { topic: 'bad topic!' })).status, 400);
    assert.equal((await call('PUT', '/ntfy', { server: 'ftp://x' })).status, 400);
    assert.equal((await call('PUT', '/ntfy', { weekly: { time: '25:00' } })).status, 400);
    const ok = await call('PUT', '/ntfy', { enabled: true, topic: 'zd-test-topic', token: 'tk_secret', weekly: { enabled: true, day: 1, time: '09:00' }, monthly: { enabled: true, day: 2, time: '09:00' }, timezone: 'America/New_York' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.hasToken, true);
    assert.ok(!JSON.stringify(ok.body).includes('tk_secret'));
    assert.ok(!JSON.stringify((await call('GET', '/export')).body).includes('tk_secret'));
    assert.equal((await call('POST', '/ntfy/test')).status, 200);
    assert.equal(sent[0].url, 'https://ntfy.sh/zd-test-topic');
    assert.equal(sent[0].headers.Authorization, 'Bearer tk_secret');
    sent.length = 0;
    // Monday 2026-11-02 08:30 New York: too early
    assert.deepEqual(await made.checkReminders(new Date('2026-11-02T13:30:00Z')), []);
    // 09:30 New York: both are due
    const out = await made.checkReminders(new Date('2026-11-02T14:30:00Z'));
    assert.deepEqual(out, ['weekly', 'monthly']);
    assert.match(sent[0].body, /transaction|category/);
    assert.match(sent[1].body, /Reconcile/);
    assert.match(sent[1].body, /December 2026/);
    // once only
    assert.deepEqual(await made.checkReminders(new Date('2026-11-02T20:00:00Z')), []);
    // next Monday: weekly again, monthly not
    assert.deepEqual(await made.checkReminders(new Date('2026-11-09T14:30:00Z')), ['weekly']);
    // time zone maths
    assert.equal(localParts(new Date('2026-11-02T03:30:00Z'), 'America/New_York').date, '2026-11-01');
  } finally { close(); }
});

test('ntfy failure is reported, not thrown, and retried next minute', async () => {
  let fail = true;
  const fake = async () => (fail ? { ok: false, status: 500 } : { ok: true, status: 200 });
  const { call, close, made } = await boot(fake);
  try {
    await call('PUT', '/ntfy', { enabled: true, topic: 'abc', weekly: { enabled: true, day: 1, time: '09:00' }, monthly: { enabled: false } });
    const t = new Date('2026-11-02T14:30:00Z');
    const r1 = await made.checkReminders(t);
    assert.match(r1[0], /weekly failed/);
    fail = false;
    assert.deepEqual(await made.checkReminders(t), ['weekly']);
    assert.equal((await call('POST', '/ntfy/test')).status, 200);
  } finally { close(); }
});

test('group colour and pay days validation', async () => {
  const { call, close } = await boot();
  try {
    const meta = (await call('GET', '/meta')).body;
    const g = meta.groups.find((x) => x.name === 'Housing');
    assert.equal((await call('PATCH', '/groups/' + g.id, { color: '#2f9e6b' })).body.color, '#2f9e6b');
    assert.equal((await call('PATCH', '/groups/' + g.id, { color: 'red' })).status, 400);
    assert.equal((await call('PATCH', '/groups/' + g.id, { color: null })).body.color, undefined);
  } finally { close(); }
});
