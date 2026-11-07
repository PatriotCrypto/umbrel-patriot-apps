'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp, DAYS } = require('../server');
const santa = require('../lib/santa');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'advent-'));
async function boot() {
  const app = createApp({ dataDir: tmp() });
  const addr = await app.start(0, '127.0.0.1');
  const base = 'http://127.0.0.1:' + addr.port;
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, { method, headers: Object.assign({ 'X-Advent': '1', 'Content-Type': 'application/json' }, headers), body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { app, call };
}

test('days: 25 verses in order, each with a scene and a note', () => {
  assert.equal(DAYS.length, 25);
  DAYS.forEach((d, i) => { assert.equal(d.n, i + 1); assert.ok(d.verse.length > 20); assert.ok(d.ref); assert.ok(d.scene); assert.ok(d.note); });
  assert.equal(DAYS[24].ref, 'Luke 2:11');
});

test('setup, pin, children and the nice list', async () => {
  const { app, call } = await boot();
  let r = await call('GET', '/api/state?d=2026-12-05');
  assert.equal(r.body.setup, false);
  r = await call('POST', '/api/setup', { children: ['Ava', 'Ben'], pin: '1234', hometown: 'Sunman', bedtime: '20:30', theme: 'candy' });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/state?d=2026-12-05');
  assert.equal(r.body.setup, true); assert.equal(r.body.day, 5); assert.equal(r.body.children.length, 2); assert.equal(r.body.settings.theme, 'candy');
  const ava = r.body.children[0];
  // pin
  r = await call('POST', '/api/pin', { pin: '0000' }); assert.equal(r.status, 401);
  r = await call('POST', '/api/pin', { pin: '1234' }); assert.equal(r.status, 200);
  const tok = { 'X-Parent-Token': r.body.token };
  r = await call('GET', '/api/parent'); assert.equal(r.status, 401);
  r = await call('GET', '/api/parent', null, tok); assert.equal(r.status, 200); assert.equal(r.body.children[0].name, 'Ava');
  // naughty on the 5th only
  r = await call('PUT', '/api/parent/children/' + ava.id, { list: { days: { '12-05': 'naughty' } } }, tok); assert.equal(r.status, 200);
  r = await call('GET', '/api/list?child=' + ava.id + '&d=2026-12-05'); assert.equal(r.body.status, 'naughty');
  r = await call('GET', '/api/list?child=' + ava.id + '&d=2026-12-06'); assert.equal(r.body.status, 'nice');
  // preview date overrides the browser date
  r = await call('PUT', '/api/parent/settings', { previewDate: '2026-12-24' }, tok);
  r = await call('GET', '/api/state?d=2026-11-07'); assert.equal(r.body.day, 24); assert.equal(r.body.preview, true);
  await app.stop();
});

test('doors only open on or after their day; santa writes back and keeps wishes', async () => {
  const { app, call } = await boot();
  await call('POST', '/api/setup', { children: ['Ava'], pin: '2468' });
  const st = (await call('GET', '/api/state?d=2026-12-03')).body;
  const id = st.children[0].id;
  let r = await call('GET', '/api/day/4?d=2026-12-03'); assert.equal(r.status, 403);
  r = await call('GET', '/api/day/3?d=2026-12-03'); assert.equal(r.status, 200); assert.equal(r.body.ref, 'Micah 5:2');
  r = await call('POST', '/api/open?d=2026-12-03', { child: id, day: 3 }); assert.equal(r.status, 200); assert.ok(r.body.opened[3]);
  r = await call('POST', '/api/open?d=2026-12-03', { child: id, day: 9 }); assert.equal(r.status, 403);
  r = await call('GET', '/api/state?d=2026-11-20'); assert.equal(r.body.day, 0);
  r = await call('GET', '/api/state?d=2027-01-02'); assert.equal(r.body.day, 26);
  // santa
  r = await call('POST', '/api/santa?d=2026-12-03', { child: id, text: 'I would like a red bicycle please' });
  assert.equal(r.status, 200); assert.equal(r.body.wish, 'red bicycle'); assert.equal(r.body.wishes.length, 1);
  r = await call('POST', '/api/santa?d=2026-12-03', { child: id, text: 'am I on the nice list?' }); assert.match(r.body.reply, /NICE list/);
  r = await call('GET', '/api/santa?child=' + id); assert.equal(r.body.letters.length, 4);
  // csrf header required
  const res = await fetch('http://127.0.0.1:' + app.server.address().port + '/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  await app.stop();
});

test('santa replies stay kind and on topic', () => {
  const child = { name: 'Ava' };
  const base = { child, listStatus: 'nice', daysLeft: 10, wishesCount: 0 };
  assert.match(santa.reply(Object.assign({ text: 'hello' }, base)).text, /Ava/);
  assert.match(santa.reply(Object.assign({ text: 'why do we celebrate christmas' }, base)).text, /Jesus/);
  assert.match(santa.reply(Object.assign({ text: 'am i on the naughty list' }, base, { listStatus: 'naughty' })).text, /Naughty/);
  assert.match(santa.reply(Object.assign({ text: 'tell me a joke' }, base)).text, /Ho ho ho/);
  assert.equal(santa.reply(Object.assign({ text: 'can i have a puppy' }, base)).wish, 'puppy');
  assert.equal(santa.reply(Object.assign({ text: 'what is a puppy' }, base)).wish, null);
});
