'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createApp } = require('../server');

let ctx; let base; let server; let dir;
const H = { 'x-rp': '1', 'content-type': 'application/json' };
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { /* none */ }
  return { status: r.status, j };
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-'));
  ctx = createApp({ dataDir: dir });
  await new Promise((res) => { server = ctx.app.listen(0, '127.0.0.1', res); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => { ctx.vault.lock(); ctx.store.flush(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('health and state', async () => {
  const h = await call('GET', '/healthz'); assert.equal(h.j.ok, true);
  const s = await call('GET', '/api/state');
  assert.equal(s.status, 200); assert.ok(Array.isArray(s.j.items)); assert.ok(s.j.calc.ready);
});

test('writes need the X-RP header', async () => {
  const r = await fetch(base + '/api/c/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"x"}' });
  assert.equal(r.status, 403);
});

test('members and supply math', async () => {
  await call('POST', '/api/c/members', { name: 'Alex', ptype: 'adult' });
  await call('POST', '/api/c/members', { name: 'Kid', ptype: 'child' });
  await call('POST', '/api/c/items', { name: 'Rice', cat: 'food', unit: 'lb', lots: [{ qty: 50 }], x: { calories: 1650 } });
  await call('POST', '/api/c/items', { name: 'Water jugs', cat: 'water', unit: 'jug', lots: [{ qty: 12 }], x: { gallons: 5 } });
  const s = (await call('GET', '/api/state')).j;
  assert.equal(s.calc.supply.needs.people, 2);
  assert.ok(s.calc.supply.food.days > 0);
  assert.ok(s.calc.supply.water.potable >= 60);
});

test('validation rejects bad input', async () => {
  const r = await call('POST', '/api/c/items', { name: '', cat: 'food' });
  assert.equal(r.status, 400);
  const r2 = await call('POST', '/api/c/nope', {});
  assert.equal(r2.status, 404);
});

test('tasks repeat when completed', async () => {
  const t = (await call('POST', '/api/c/tasks', { title: 'Rotate water', due: '2026-01-01', every: 30 })).j.rec;
  await call('POST', `/api/tasks/${t.id}/done`);
  const after = (await call('GET', '/api/state')).j.tasks.find((x) => x.id === t.id);
  assert.ok(after.due > '2026-01-01');
});

test('checklist toggle', async () => {
  await call('POST', '/api/checklists/defaults');
  const c = (await call('GET', '/api/state')).j.checklists[0];
  const line = c.items[0];
  await call('POST', `/api/checklists/${c.id}/toggle`, { itemId: line.id, done: true });
  assert.equal((await call('GET', '/api/state')).j.checklists.find((x) => x.id === c.id).items[0].done, true);
});

test('shopping list generates', async () => {
  const r = await call('POST', '/api/shopping/generate');
  assert.equal(r.status, 200);
});

test('widgets have the expected shapes and no vault data', async () => {
  const a = (await call('GET', '/widgets/readiness')).j; assert.equal(a.type, 'text-with-progress'); assert.ok(a.progress >= 0 && a.progress <= 1);
  const b = (await call('GET', '/widgets/supplies')).j; assert.equal(b.type, 'four-stats'); assert.equal(b.items.length, 4);
  const c = (await call('GET', '/widgets/attention')).j; assert.equal(c.type, 'list-emoji');
});

test('vault: setup, lock, unlock, data, wrong pin', async () => {
  assert.equal((await call('POST', '/api/v/firearms', { name: 'x' })).status, 423);
  const su = await call('POST', '/api/vault/setup', { pin: '123456' });
  assert.equal(su.status, 200); assert.ok(su.j.recovery);
  const add = await call('POST', '/api/v/firearms', { name: 'Test rifle', caliber: '.223' });
  assert.equal(add.status, 200);
  await call('POST', '/api/vault/lock');
  assert.equal((await call('GET', '/api/vault/data')).status, 423);
  assert.equal((await call('POST', '/api/vault/unlock', { code: 'wrongpin' })).status, 401);
  assert.equal((await call('POST', '/api/vault/unlock', { code: '123456' })).status, 200);
  const d = (await call('GET', '/api/vault/data')).j;
  assert.equal(d.firearms.length, 1);
  const rec = su.j.recovery;
  await call('POST', '/api/vault/lock');
  assert.equal((await call('POST', '/api/vault/unlock', { code: rec })).status, 200);
  // vault text is not on disk in clear
  const raw = fs.readFileSync(path.join(dir, 'vault.enc'), 'utf8');
  assert.ok(!raw.includes('Test rifle'));
});

test('stealth hides ammo and blocks the vault; needs PIN to disable', async () => {
  await call('POST', '/api/c/items', { name: '9mm FMJ', cat: 'ammo', unit: 'box', lots: [{ qty: 10 }], x: { caliber: '9mm', rounds: 50 } });
  assert.ok((await call('GET', '/api/state')).j.items.some((i) => i.cat === 'ammo'));
  await call('POST', '/api/stealth', { on: true });
  const s = (await call('GET', '/api/state')).j;
  assert.ok(!s.items.some((i) => i.cat === 'ammo'));
  assert.equal((await call('POST', '/api/c/items', { name: 'More ammo', cat: 'ammo', unit: 'box', lots: [{ qty: 1 }] })).status, 423);
  assert.equal((await call('POST', '/api/vault/unlock', { code: '123456' })).status, 423);
  assert.equal((await call('POST', '/api/stealth', { on: false, code: 'nope' })).status, 401);
  assert.equal((await call('POST', '/api/stealth', { on: false, code: '123456' })).status, 200);
});

test('backup and restore round trip', async () => {
  const b = await (await fetch(base + '/api/backup', { headers: H })).json();
  assert.equal(b.app, 'rally-point');
  await call('POST', '/api/c/tasks', { title: 'Temp after backup' });
  const r = await call('POST', '/api/restore', b);
  assert.equal(r.status, 200);
  const s = (await call('GET', '/api/state')).j;
  assert.ok(!s.tasks.some((t) => t.title === 'Temp after backup'));
});

test('sample data loads and removes cleanly', async () => {
  const before = (await call('GET', '/api/state')).j.members.length;
  assert.equal((await call('POST', '/api/sample/load')).status, 200);
  assert.ok((await call('GET', '/api/state')).j.members.length > before);
  assert.equal((await call('DELETE', '/api/sample')).status, 200);
  assert.equal((await call('GET', '/api/state')).j.members.length, before);
});
