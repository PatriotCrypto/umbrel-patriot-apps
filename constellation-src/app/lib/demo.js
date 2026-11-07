'use strict';
// A pretend home network with a week of believable history. Used for tests,
// README screenshots and CONSTELLATION_DEMO=1. Never touches the real LAN.
const U = require('./util');

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const TZ_OFFSET = -5 * HOUR; // pretend Eastern time so the daily rhythm looks natural

const DEMO_NET = {
  ok: true, iface: 'demo0', ip: '192.168.1.20', mac: 'a0:36:bc:12:34:56', gateway: '192.168.1.1',
  cidrs: ['192.168.1.0/24'], parsed: [U.parseCidr('192.168.1.0/24')], source: 'demo',
};

// pat: how the device behaves over the day. `late` means it only appears at the end.
const DEVICES = [
  { mac: '00:26:12:a1:b2:c3', ip: '192.168.1.1', name: 'Router', pat: 'always', hostname: 'router' },
  { mac: 'a0:36:bc:12:34:56', ip: '192.168.1.20', name: 'Umbrel', pat: 'always', hostname: 'umbrel' },
  { mac: '00:12:f0:55:10:21', ip: '192.168.1.31', name: 'Office Desktop', pat: 'office', hostname: 'office-desktop' },
  { mac: '00:13:02:7a:0c:44', ip: '192.168.1.32', name: 'Work Laptop', pat: 'office', hostname: 'work-laptop' },
  { mac: '00:0d:3a:20:99:08', ip: '192.168.1.33', name: 'Family Laptop', pat: 'evening', hostname: 'family-laptop' },
  { mac: 'da:4f:21:90:6b:17', ip: '192.168.1.41', name: "Alex's Phone", pat: 'home', hostname: 'Alexs-iPhone', type: 'phone' },
  { mac: 'ea:19:7c:42:d3:5e', ip: '192.168.1.42', name: "Sam's Phone", pat: 'home', hostname: 'Sams-Pixel', type: 'phone' },
  { mac: '5c:92:5e:0a:41:c2', ip: '192.168.1.22', name: 'Bitcoin Node', pat: 'always', hostname: 'bitcoin-node' },
  { mac: '9c:6b:00:2d:77:e1', ip: '192.168.1.23', name: 'Spare Box', pat: 'always', hostname: 'minipc', btc: true },
  { mac: '00:07:ab:66:31:90', ip: '192.168.1.43', name: 'Kitchen Tablet', pat: 'home', hostname: 'galaxy-tab', type: 'tablet' },
  { mac: '00:0d:4b:12:ee:07', ip: '192.168.1.50', name: 'Living Room TV', pat: 'evening', hostname: 'roku-livingroom' },
  { mac: '00:04:1f:c4:08:3a', ip: '192.168.1.51', name: 'Game Console', pat: 'weekend', hostname: 'PS5-1234' },
  { mac: '00:71:47:3b:55:aa', ip: '192.168.1.60', name: 'Kitchen Speaker', pat: 'always', hostname: 'echo-kitchen' },
  { mac: '00:04:3c:18:71:2d', ip: '192.168.1.61', name: 'Bedroom Speaker', pat: 'always', hostname: 'Sonos-Bedroom' },
  { mac: '2c:aa:8e:a0:14:90', ip: '192.168.1.70', name: 'Front Door Camera', pat: 'always', hostname: 'wyze-cam-front' },
  { mac: '7c:78:b2:40:ce:11', ip: '192.168.1.71', name: 'Garage Camera', pat: 'always', hostname: 'wyze-cam-garage' },
  { mac: 'f4:f5:d8:09:6d:52', ip: '192.168.1.72', name: 'Thermostat', pat: 'always', hostname: 'thermostat' },
  { mac: '00:4b:12:77:03:be', ip: '192.168.1.73', name: 'Weather Station', pat: 'flaky', hostname: 'esp32-weather' },
  { mac: '00:70:07:b1:42:0f', ip: '192.168.1.74', name: 'Mesh Node', pat: 'always', hostname: 'meshtastic-3f2a' },
  { mac: '00:31:92:5c:a8:73', ip: '192.168.1.75', name: 'Shop Heater Plug', pat: 'flaky', hostname: 'plug-shop' },
  { mac: '00:17:87:2e:90:f4', ip: '192.168.1.80', name: 'Shop Printer', pat: 'always', hostname: 'BRW0017872E90F4' },
  { mac: 'f2:5a:03:c8:11:6d', ip: '192.168.1.101', name: '', pat: 'guest', hostname: null, keepKnown: true },
  { mac: 'ba:c0:7e:19:a4:82', ip: '192.168.1.102', name: '', pat: 'late', hostname: null },
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rnd(seed) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function present(dev, t, endT) {
  const d = new Date(t + TZ_OFFSET);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const dow = d.getUTCDay();
  const weekend = dow === 0 || dow === 6;
  const r = rnd(hash(dev.mac) + Math.floor(t / (20 * 60e3)) * 7919);
  switch (dev.pat) {
    case 'always': return r > 0.004;
    case 'flaky': return r > 0.12;
    case 'home': {
      const p = weekend ? (h >= 8 && h < 23.5 ? 0.93 : 0.12)
        : h >= 6 && h < 8.5 ? 0.9 : h >= 17 && h < 23.5 ? 0.95 : h >= 8.5 && h < 17 ? 0.06 : 0.1;
      return r < p;
    }
    case 'office': return !weekend && h >= 7.75 && h < 17.75 ? r < 0.97 : r < 0.02;
    case 'evening': return h >= 18 && h < 23 ? r < 0.9 : (weekend && h >= 10 && h < 18 ? r < 0.35 : r < 0.01);
    case 'weekend': return (weekend && h >= 12 && h < 22) || (dow === 5 && h >= 19 && h < 23) ? r < 0.8 : r < 0.01;
    case 'guest': return t > endT - 50 * HOUR && t < endT - 38 * HOUR ? r < 0.92 : false;
    case 'late': return t > endT - 3 * HOUR;
    default: return false;
  }
}

function probeAt(t) {
  const d = new Date(t + TZ_OFFSET);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const evening = h >= 18 && h < 23 ? 9 : 0;
  const r1 = rnd(hash('wan') + Math.floor(t / 60e3));
  const r2 = rnd(hash('lan') + Math.floor(t / 60e3));
  const r3 = rnd(hash('spike') + Math.floor(t / 600e3));
  let wan = 28 + evening + r1 * 16;
  if (r3 > 0.985) wan += 120 + r1 * 260;
  if (r1 > 0.992) wan = null; // a dropped probe
  return { wan: wan === null ? null : Math.round(wan * 10) / 10, lan: Math.round((0.8 + r2 * 1.7) * 10) / 10 };
}

function createDemo(endT) {
  return {
    net: DEMO_NET,
    devices: DEVICES,
    scan(t) {
      return DEVICES.filter((d) => present(d, t, endT)).map((d) => ({ ip: d.ip, mac: d.mac }));
    },
    probe: probeAt,
  };
}

// Fill an engine with a week of history, ending at `now`.
function seed(engine, now) {
  const start = now - 7 * DAY;
  const demo = createDemo(now);
  const ctx = { gatewayIp: DEMO_NET.gateway, selfMac: DEMO_NET.mac };
  const step = 5 * 60e3;
  // The backfill steps in 5-minute jumps, so tell the engine that is the scan rhythm
  // (otherwise every step would look like a monitoring gap). Restored below.
  const keepInterval = engine.s.settings.scanIntervalSec;
  engine.s.settings.scanIntervalSec = 300;
  let first = true;
  for (let t = start; t <= now; t += step) {
    let hosts = demo.scan(t);
    if (first) {
      // The first scan sees every long-term device, so only truly new arrivals raise alerts.
      hosts = DEVICES.filter((d) => d.pat !== 'guest' && d.pat !== 'late').map((d) => ({ ip: d.ip, mac: d.mac }));
      first = false;
    }
    engine.applyScan(hosts, t, ctx);
    engine.addProbe(t, probeAt(t));
  }
  for (const d of DEVICES) {
    if (d.hostname) engine.setHostname(d.mac, d.hostname, now);
    if (d.btc) engine.setBtc(d.mac, true, now);
    if (d.name) engine.updateDevice(d.mac, { name: d.name }, now);
    if (d.type) engine.updateDevice(d.mac, { type: d.type }, now);
    if (d.keepKnown) engine.updateDevice(d.mac, { known: true }, now);
  }
  // tag devices by room/owner and sit each tag's devices next to each other on the ring
  const TAGS = {
    Shop: ['Shop Printer', 'Shop Heater Plug', 'Garage Camera', 'Weather Station'],
    Kitchen: ['Kitchen Tablet', 'Kitchen Speaker', 'Thermostat'],
    'Living Room': ['Living Room TV', 'Game Console', 'Family Laptop'],
    Alex: ["Alex's Phone"], Sam: ["Sam's Phone"],
  };
  const order = [];
  for (const [tag, names] of Object.entries(TAGS)) {
    for (const n of names) { const d = DEVICES.find((x) => x.name === n); if (d) { engine.updateDevice(d.mac, { group: tag }, now); order.push(d.mac); } }
  }
  for (const d of DEVICES) if (!order.includes(d.mac) && d.mac !== DEMO_NET.mac) order.push(d.mac);
  engine.setOrder(order);
  // a week of speed tests, a few a day, with an evening dip like a busy satellite cell
  for (let t = start + 3 * 3600e3; t < now - 3600e3; t += 6 * 3600e3) {
    const hr = new Date(t).getHours();
    const dip = hr >= 19 && hr <= 23 ? 0.62 : 1;
    const j = Math.sin(t / 7e5) * 0.12;
    engine.addSpeed({ t, down: Math.round(182 * dip * (1 + j) * 10) / 10, up: Math.round(21 * (0.9 + j) * 10) / 10, ping: Math.round((31 + 12 * (1 - dip) + Math.abs(j) * 30) * 10) / 10, jitter: Math.round((4 + Math.abs(j) * 20) * 10) / 10, server: 'Cloudflare', error: null });
  }
  engine.pending.length = 0;
  engine.heartbeat(now);
  engine.s.settings.scanIntervalSec = keepInterval;
  engine.touch();
  return demo;
}

async function fakeSpeed(speed, broadcast) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  speed.phase = 'ping'; broadcast(); await wait(700);
  const down = 150 + Math.random() * 60;
  speed.phase = 'download';
  for (let i = 1; i <= 12; i++) { speed.mbps = Math.round(down * Math.min(1, i / 4) * (0.94 + Math.random() * 0.12) * 10) / 10; broadcast(); await wait(250); }
  const up = 17 + Math.random() * 8;
  speed.phase = 'upload';
  for (let i = 1; i <= 8; i++) { speed.mbps = Math.round(up * Math.min(1, i / 3) * (0.94 + Math.random() * 0.12) * 10) / 10; broadcast(); await wait(250); }
  return { t: Date.now(), down: Math.round(down * 10) / 10, up: Math.round(up * 10) / 10, ping: Math.round((30 + Math.random() * 10) * 10) / 10, jitter: Math.round((3 + Math.random() * 4) * 10) / 10, server: 'Cloudflare (demo)', error: null };
}

module.exports = { fakeSpeed, DEMO_NET, DEVICES, createDemo, seed, present, probeAt };
