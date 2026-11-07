'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine, validateSettings, DEFAULT_SETTINGS } = require('../lib/engine');
const demo = require('../lib/demo');

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
const GW = { ip: '192.168.1.1', mac: '00:26:12:aa:bb:cc' };
const ME = { ip: '192.168.1.20', mac: 'a0:36:bc:12:34:56' };
const PHONE = { ip: '192.168.1.41', mac: 'da:4f:21:90:6b:17' };
const CTX = { gatewayIp: GW.ip, selfMac: ME.mac };

function fresh() {
  const e = new Engine(null, T0);
  e.applyScan([GW, ME], T0, CTX);
  return e;
}

test('first scan is a quiet baseline: everything known, roles detected', () => {
  const e = fresh();
  assert.equal(e.s.baselineDone, true);
  assert.equal(e.s.devices[GW.mac].role, 'gateway');
  assert.equal(e.s.devices[GW.mac].type, '');
  assert.equal(e.view(e.s.devices[GW.mac], T0).type, 'router');
  assert.equal(e.s.devices[ME.mac].role, 'self');
  assert.ok(Object.values(e.s.devices).every((d) => d.known));
  assert.equal(e.pending.length, 0);
});

test('a device that appears after the baseline is flagged new and queued for a notification', () => {
  const e = fresh();
  e.applyScan([GW, ME, PHONE], T0 + 60e3, CTX);
  const d = e.s.devices[PHONE.mac];
  assert.equal(d.known, false);
  assert.equal(d.random, true);
  assert.equal(e.pending.length, 1);
  assert.equal(e.s.events.filter((x) => x.kind === 'new').length, 1);
  assert.equal(e.summary(T0 + 60e3).unreviewed, 1);
  e.updateDevice(PHONE.mac, { name: "Alex's Phone" }, T0 + 70e3);
  assert.equal(e.s.devices[PHONE.mac].known, true); // naming it marks it reviewed
  assert.equal(e.view(e.s.devices[PHONE.mac], T0).label, "Alex's Phone");
});

test('a device stays online through a short gap and goes offline after the grace period', () => {
  const e = fresh();
  e.applyScan([GW, ME, PHONE], T0 + 60e3, CTX);
  e.applyScan([GW, ME], T0 + 120e3, CTX);
  assert.equal(e.s.devices[PHONE.mac].online, true); // 60 s of silence is within the 5 min grace
  e.applyScan([GW, ME], T0 + 60e3 + 301e3, CTX);
  const d = e.s.devices[PHONE.mac];
  assert.equal(d.online, false);
  assert.deepEqual(d.sessions[0], [T0 + 60e3, T0 + 60e3]); // closed at the last time it was actually seen
  assert.ok(e.s.events.some((x) => x.kind === 'left' && x.mac === PHONE.mac));
});

test('coming back opens a new session and logs a join', () => {
  const e = fresh();
  e.applyScan([GW, ME, PHONE], T0 + 60e3, CTX);
  e.applyScan([GW, ME], T0 + 400e3, CTX);
  e.applyScan([GW, ME, PHONE], T0 + 500e3, CTX);
  const d = e.s.devices[PHONE.mac];
  assert.equal(d.online, true);
  assert.equal(d.sessions.length, 2);
  assert.ok(e.s.events.some((x) => x.kind === 'joined' && x.mac === PHONE.mac));
});

test('uptime is measured against monitored time only', () => {
  const e = fresh();
  for (let i = 1; i <= 60; i++) e.applyScan([GW, ME, PHONE], T0 + i * 60e3, CTX); // phone online for an hour
  for (let i = 61; i <= 66; i++) e.applyScan([GW, ME], T0 + i * 60e3, CTX);       // then gone
  const now = T0 + 66 * 60e3;
  const up = e.uptime(e.s.devices[PHONE.mac], now, 24 * 3600e3);
  // monitored since the phone first appeared at minute 1
  assert.ok(up.pct > 0.9 && up.pct <= 1, 'pct ' + up.pct);
  const gateway = e.uptime(e.s.devices[GW.mac], now, 24 * 3600e3);
  assert.ok(gateway.pct > 0.99);
});

test('time the app was not running does not count against uptime', () => {
  const e = fresh();
  for (let i = 1; i <= 10; i++) e.applyScan([GW, ME], T0 + i * 60e3, CTX);
  // app stopped for 10 hours, then resumes
  const later = T0 + 10 * 3600e3;
  e.repair(later);
  assert.equal(e.s.devices[GW.mac].online, false);
  for (let i = 0; i < 10; i++) e.applyScan([GW, ME], later + i * 60e3, CTX);
  const up = e.uptime(e.s.devices[GW.mac], later + 10 * 60e3, 24 * 3600e3);
  assert.ok(up.pct > 0.95, 'pct ' + up.pct);
  assert.equal(e.s.watch.length, 2);
});

test('settings validation', () => {
  assert.equal(validateSettings({ scanIntervalSec: 5 }, DEFAULT_SETTINGS).ok, false);
  assert.equal(validateSettings({ offlineAfterSec: 99999 }, DEFAULT_SETTINGS).ok, false);
  assert.equal(validateSettings({ subnets: ['8.8.8.0/24'] }, DEFAULT_SETTINGS).ok, false);
  assert.equal(validateSettings({ subnets: ['10.0.0.0/16'] }, DEFAULT_SETTINGS).ok, false);
  assert.equal(validateSettings({ ntfy: { enabled: true, topic: '' } }, DEFAULT_SETTINGS).ok, false);
  assert.equal(validateSettings({ ntfy: { topic: 'has spaces' } }, DEFAULT_SETTINGS).ok, false);
  assert.equal(validateSettings({ ntfy: { server: 'ftp://x' } }, DEFAULT_SETTINGS).ok, false);
  const ok = validateSettings({ scanIntervalSec: 60, subnets: ['192.168.1.0/24'], ntfy: { enabled: true, topic: 'my-net_1', server: 'https://ntfy.example.com/' } }, DEFAULT_SETTINGS);
  assert.equal(ok.ok, true);
  assert.equal(ok.settings.ntfy.server, 'https://ntfy.example.com');
});

test('device edits are sanitised and bad types rejected', () => {
  const e = fresh();
  e.updateDevice(GW.mac, { name: '  <b>Router</b>\n', notes: 'x'.repeat(500) }, T0);
  assert.equal(e.s.devices[GW.mac].name, 'bRouter/b');
  assert.equal(e.s.devices[GW.mac].notes.length, 300);
  assert.throws(() => e.updateDevice(GW.mac, { type: 'toaster' }, T0), /Unknown device type/);
  assert.equal(e.forget(GW.mac), true);
  assert.equal(e.s.devices[GW.mac], undefined);
});

test('demo network produces a believable week of history', () => {
  const now = Date.UTC(2026, 10, 6, 18, 0, 0);
  const e = new Engine(null, now);
  demo.seed(e, now);
  const s = e.summary(now);
  assert.equal(s.total, demo.DEVICES.length);
  assert.ok(s.online > 8 && s.online < s.total, 'online ' + s.online);
  assert.equal(s.unreviewed, 1); // the unknown device that just arrived
  const h = e.history('7d', now);
  assert.ok(h.online.length > 100 && h.online.length <= 400);
  assert.ok(h.wanStats.avg > 20 && h.wanStats.avg < 70, 'avg ' + h.wanStats.avg);
  assert.ok(h.wanStats.lossPct >= 0 && h.wanStats.lossPct < 5);
  const router = h.devices.find((d) => d.role === 'gateway');
  assert.ok(router.pct > 0.98);
  const desktop = h.devices.find((d) => d.label === 'Office Desktop');
  assert.ok(desktop.pct > 0.15 && desktop.pct < 0.6, 'desktop ' + desktop.pct);
});

test('backup import rebuilds a clean state and rejects junk', () => {
  const e = fresh();
  e.applyScan([GW, ME, PHONE], T0 + 60e3, CTX);
  const copy = JSON.parse(JSON.stringify(e.s));
  copy.devices['de:ad:be:ef:00:01'] = { ip: '<script>', name: '<img onerror=x>', sessions: [[1, 2], 'bad', [3]] };
  copy.devices['not-a-mac'] = { name: 'evil' };
  const st = Engine.sanitizeImport(copy, T0);
  assert.equal(Object.keys(st.devices).length, 4);
  assert.equal(st.devices['de:ad:be:ef:00:01'].ip, '');
  assert.equal(st.devices['de:ad:be:ef:00:01'].name, 'img onerror=x');
  assert.deepEqual(st.devices['de:ad:be:ef:00:01'].sessions, [[1, 2]]);
  assert.throws(() => Engine.sanitizeImport({ hello: 1 }, T0), /Constellation backup/);
});

test('pruning thins old samples to five minutes', () => {
  const e = fresh();
  const now = T0 + 20 * 86400e3;
  for (let i = 0; i < 300; i++) e.s.samples.push({ t: T0 + i * 60e3, n: 3 });
  e.prune(now);
  assert.ok(e.s.samples.length < 80, 'kept ' + e.s.samples.length);
});

test('constellation order and tags: set, sanitize, forget, import', () => {
  const e = new Engine(null, 1000);
  const a = 'aa:bb:cc:dd:ee:01', b = 'aa:bb:cc:dd:ee:02';
  e.applyScan([{ ip: '192.168.1.5', mac: a }, { ip: '192.168.1.6', mac: b }], 1000, { gatewayIp: '192.168.1.1', selfMac: null });
  const out = e.setOrder([b, 'zz', a, b, 'aa:bb:cc:dd:ee:99'], { [a]: ' Kitchen <i> ' });
  assert.deepEqual(out, [b, a]);
  assert.equal(e.view(e.s.devices[a], 1000).group, 'Kitchen i');
  assert.throws(() => e.setOrder('nope'), /Bad order/);
  const back = Engine.sanitizeImport(JSON.parse(JSON.stringify(e.s)), 2000);
  assert.deepEqual(back.order, [b, a]);
  assert.equal(back.devices[a].group, 'Kitchen i');
  e.forget(b);
  assert.deepEqual(e.s.order, [a]);
});

test('speed test: measures with a fake network and stores results', async () => {
  const { runSpeedTest } = require('../lib/speedtest');
  const { Readable } = require('node:stream');
  const fakeFetch = async (url, o = {}) => {
    if (url.includes('__up')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    if (url.includes('bytes=0')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    const stream = Readable.toWeb(Readable.from((async function* () {
      for (let i = 0; i < 1e6; i++) { if (o.signal && o.signal.aborted) return; yield new Uint8Array(262144); await new Promise((r) => setTimeout(r, 5)); }
    })()));
    return { ok: true, body: stream };
  };
  const seen = [];
  const r = await runSpeedTest({ fetchFn: fakeFetch, downMs: 900, upMs: 600, onProgress: (p) => seen.push(p.phase) });
  assert.equal(r.error, null);
  assert.ok(r.down > 10, 'download measured ' + r.down);
  assert.ok(r.up > 1, 'upload measured ' + r.up);
  assert.ok(r.ping !== null);
  assert.deepEqual([...new Set(seen)], ['ping', 'download', 'upload']);
  const bad = await runSpeedTest({ fetchFn: async () => { throw new Error('offline'); }, downMs: 300, upMs: 300 });
  assert.match(bad.error, /Could not reach/);
  const e = new Engine(null, 1000);
  e.addSpeed(r);
  assert.equal(e.history('24h', Date.now()).speed.length, 1);
  assert.equal(validateSettings({ speedEveryHours: 5 }, DEFAULT_SETTINGS).ok, false);
  assert.equal(validateSettings({ speedEveryHours: 6 }, DEFAULT_SETTINGS).ok, true);
});
