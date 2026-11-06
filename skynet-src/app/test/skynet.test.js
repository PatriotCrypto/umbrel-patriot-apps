'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pb = require('../lib/pb');
const radio = require('../lib/radio');
const { frame, decodeFromRadio } = require('../lib/live');
const { Store } = require('../lib/store');
const { Mesh } = require('../lib/mesh');
const { createApp } = require('../server');

const f32 = (field, x) => { const b = Buffer.alloc(4); b.writeFloatLE(x); return Buffer.concat([pb.varint((field << 3) | 5), b]); };
const sf32 = (field, x) => { const b = Buffer.alloc(4); b.writeInt32LE(x); return Buffer.concat([pb.varint((field << 3) | 5), b]); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skynet-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const nodeInfoMsg = (num, long, short, lat, lon, batt) => pb.wBytes(4, Buffer.concat([
  pb.wVarint(1, num),
  pb.wBytes(2, Buffer.concat([pb.wBytes(2, Buffer.from(long)), pb.wBytes(3, Buffer.from(short))])),
  pb.wBytes(3, Buffer.concat([sf32(1, Math.round(lat * 1e7)), sf32(2, Math.round(lon * 1e7)), pb.wVarint(3, 250)])),
  pb.wBytes(6, pb.wVarint(1, batt)), pb.wFixed32(5, 1700000000), f32(4, 7.5)
]));
const textPacket = (from, to, text) => pb.wBytes(2, Buffer.concat([
  pb.wFixed32(1, from), pb.wFixed32(2, to),
  pb.wBytes(4, Buffer.concat([pb.wVarint(1, 1), pb.wBytes(2, Buffer.from(text))])), f32(8, 5.25), pb.wFixed32(7, 1700000100)
]));

test('protobuf reader/writer round trip', () => {
  const m = pb.decode(Buffer.concat([pb.wVarint(1, 300), pb.wBytes(2, Buffer.from('hi')), pb.wFixed32(3, 0xdeadbeef)]));
  assert.equal(pb.u32(m, 1), 300);
  assert.equal(pb.str(m, 2), 'hi');
  assert.equal(pb.u32(m, 3), 0xdeadbeef);
  assert.throws(() => pb.decode(Buffer.from([0x0a, 0x10, 1, 2])));
});

test('decodes node info and text packets', () => {
  const n = decodeFromRadio(nodeInfoMsg(0xa1b2c3d4, 'Ridge Cabin', 'RDGE', 39.123456, -98.654321, 77));
  assert.equal(n.type, 'node');
  assert.equal(n.node.id, '!a1b2c3d4');
  assert.equal(n.node.long, 'Ridge Cabin');
  assert.equal(n.node.battery, 77);
  assert.ok(Math.abs(n.node.lat - 39.123456) < 1e-6);
  assert.ok(Math.abs(n.node.lon + 98.654321) < 1e-6);
  const t = decodeFromRadio(textPacket(0xa1b2c3d4, 0xffffffff, 'hello mesh'));
  assert.equal(t.type, 'packet');
  assert.equal(t.packet.to, '^all');
  assert.equal(t.packet.payload.toString(), 'hello mesh');
  assert.equal(t.packet.snr, 5.25);
});

test('CHIRP export and import', () => {
  const freqs = [
    { id: '1', name: 'Local Repeater', freq: 146.94, mode: 'FM', duplex: '-', offset: 0.6, tone: 'Tone', rTone: 100.0, inRadio: true, slot: 1, listenOnly: false, notes: '' },
    { id: '2', name: 'WX 1', freq: 162.4, mode: 'FM', duplex: '', offset: 0, tone: '', rTone: 88.5, inRadio: true, slot: 2, listenOnly: true, notes: '' },
    { id: '3', name: 'Not Selected', freq: 146.52, mode: 'FM', duplex: '', offset: 0, tone: '', rTone: 88.5, inRadio: false, slot: 3 }
  ];
  const r = radio.toChirp(freqs);
  const lines = r.csv.trim().split(/\r?\n/);
  assert.equal(lines[0], 'Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,RxDtcsCode,CrossMode,Mode,TStep,Skip,Power,Comment');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^0,LOCAL R,146\.940000,-,0\.600000,Tone,100\.0,100\.0,023,NN,023,Tone->Tone,FM,5\.00,,,$/);
  assert.match(lines[2], /RX ONLY$/);
  assert.equal(r.warnings.length, 1); // name was shortened
  const back = radio.fromChirp(r.csv);
  assert.equal(back.items.length, 2);
  assert.equal(back.items[0].freq, 146.94);
  assert.equal(back.items[0].duplex, '-');
  assert.equal(back.items[0].tone, 'Tone');
  assert.ok(radio.fromChirp('nope,nothing\n1,2').error);
});

test('CHIRP export caps at 128 channels', () => {
  const many = Array.from({ length: 140 }, (_, i) => ({ name: 'C' + i, freq: 146 + i / 1000, mode: 'FM', duplex: '', offset: 0, tone: '', rTone: 88.5, inRadio: true, slot: i }));
  const r = radio.toChirp(many);
  assert.equal(r.count, 128);
  assert.ok(r.warnings.some((w) => /128/.test(w)));
});

test('ADIF export', () => {
  const adi = radio.toAdif([{ ts: Date.UTC(2026, 10, 1, 14, 30, 5), call: 'N0CALL', freq: 146.52, mode: 'FM', rstSent: '59', rstRcvd: '57', name: 'Sam', qth: '', notes: '' }], 'K0TEST');
  assert.match(adi, /<CALL:6>N0CALL/);
  assert.match(adi, /<QSO_DATE:8>20261101/);
  assert.match(adi, /<TIME_ON:6>143005/);
  assert.match(adi, /<BAND:2>2m/);
  assert.match(adi, /<STATION_CALLSIGN:6>K0TEST/);
  assert.match(adi, /<EOR>/);
});

test('HTTP API: contacts, frequencies, log, settings, backup', async () => {
  const dir = tmp(), store = new Store(dir), mesh = new Mesh(store);
  const app = createApp(store, mesh); mesh.start();
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}/api/`;
  const j = async (p, m = 'GET', b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null), r }; };
  try {
    await wait(300);
    let st = await j('state');
    assert.equal(st.j.mode, 'demo');
    assert.ok(st.j.nodes.length >= 5, 'demo mesh has nodes');
    assert.equal((await j('contacts', 'POST', {})).s, 400);
    const c = await j('contacts', 'POST', { name: 'Dad <b>', callsign: 'n0call', nodeId: '!AABBCCDD' });
    assert.equal(c.s, 201); assert.equal(c.j.callsign, 'N0CALL'); assert.equal(c.j.nodeId, '!aabbccdd');
    const bad = await j('contacts', 'POST', { name: 'X', nodeId: 'nonsense' }); assert.equal(bad.j.nodeId, '');
    assert.equal((await j('freqs', 'POST', { name: 'bad', freq: 'abc' })).s, 400);
    const p = await j('freqs/presets', 'POST'); assert.ok(p.j.added > 30);
    assert.equal((await j('freqs/presets', 'POST')).j.added, 0);
    const fr = (await j('freqs')).j;
    const wx = fr.find((f) => f.name === 'WX 1'); assert.equal(wx.listenOnly, true);
    await j('freqs/' + wx.id, 'PUT', { ...wx, inRadio: true });
    const csv = await (await fetch(base + 'freqs.chirp.csv')).text();
    assert.match(csv, /WX 1,162\.400000/);
    const q = await j('log', 'POST', { call: 'w1aw', freq: 14.074, mode: 'ft8' }); assert.equal(q.j.call, 'W1AW');
    assert.equal((await j('log', 'POST', {})).s, 400);
    assert.match(await (await fetch(base + 'log.adi')).text(), /<CALL:4>W1AW/);
    assert.equal((await j('settings', 'PUT', { host: 'bad host!' })).s, 400);
    assert.equal((await j('settings', 'PUT', { staleMinutes: 2 })).s, 400);
    assert.equal((await j('settings', 'PUT', { callsign: 'kd9zzz', lowBattery: 25 })).j.callsign, 'KD9ZZZ');
    const sent = await j('messages', 'POST', { text: 'radio check' }); assert.equal(sent.s, 200);
    assert.equal((await j('messages', 'POST', { text: 'x', to: 'evil' })).s, 400);
    const bk = (await j('backup')).j; assert.equal(bk.skynet, 1);
    await j('contacts/' + c.j.id, 'DELETE');
    const rs = await j('restore', 'POST', bk); assert.equal(rs.j.contacts, bk.contacts.length);
    assert.equal((await j('restore', 'POST', { nope: 1 })).s, 400);
    await j('sample', 'POST'); assert.ok((await j('contacts')).j.some((x) => x.sample));
    await j('sample', 'DELETE'); assert.ok(!(await j('contacts')).j.some((x) => x.sample));
    const h = await fetch(`http://127.0.0.1:${srv.address().port}/`); assert.match(h.headers.get('content-security-policy'), /script-src 'self'/);
  } finally { mesh.stop(); srv.close(); store.flush(); }
});

test('live mode: reads a (mock) Meshtastic node over TCP and sends text', async () => {
  const received = [];
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf[0] === 0x94 && buf[1] === 0xc3) {
        const len = (buf[2] << 8) | buf[3]; if (buf.length < 4 + len) break;
        const payload = buf.subarray(4, 4 + len); buf = buf.subarray(4 + len);
        const m = pb.decode(payload);
        if (m[3]) { // want_config_id: reply with our config dump, split awkwardly across writes
          const all = Buffer.concat([
            frame(pb.wBytes(3, pb.wVarint(1, 0x11111111))),
            frame(nodeInfoMsg(0x11111111, 'Roof Base', 'ROOF', 39.0, -98.0, 101)),
            frame(nodeInfoMsg(0x22222222, 'Rover', 'RVR', 39.01, -98.01, 55)),
            frame(textPacket(0x22222222, 0xffffffff, 'copy from the road')),
            frame(pb.wVarint(7, 99))
          ]);
          sock.write(Buffer.from([0x00, 0xff])); // line noise before the first frame
          sock.write(all.subarray(0, 17)); setTimeout(() => sock.write(all.subarray(17)), 30);
        } else if (m[1]) received.push(pb.str(pb.decode(pb.decode(m[1][0])[4][0]), 2));
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = tmp(), store = new Store(dir);
  store.data.settings.mode = 'live'; store.data.settings.host = '127.0.0.1'; store.data.settings.port = server.address().port;
  const mesh = new Mesh(store); mesh.start();
  try {
    for (let i = 0; i < 40 && !(mesh.messages.length && mesh.status.synced); i++) await wait(50);
    assert.equal(mesh.me, '!11111111');
    assert.equal(mesh.nodes['!22222222'].long, 'Rover');
    assert.equal(mesh.nodes['!22222222'].battery, 55);
    assert.equal(mesh.messages[0].text, 'copy from the road');
    assert.equal(mesh.status.connected, true);
    assert.equal(mesh.send('hello roof').ok, true);
    for (let i = 0; i < 20 && !received.length; i++) await wait(50);
    assert.deepEqual(received, ['hello roof']);
    assert.ok(mesh.activity.some((a) => a.dir === 'rx' && a.from === '!22222222'), 'rx packet logged');
    assert.ok(mesh.activity.some((a) => a.dir === 'tx' && a.kind === 'text'), 'tx logged');
    assert.ok(mesh.coverage().length >= 1, 'coverage recorded from rover position');
    store.flush();
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'skynet.json'), 'utf8')).nodes['!22222222']);
  } finally { mesh.stop(); server.close(); }
});

test('live mode: a node that goes silent without closing is detected and retried', async () => {
  const net = require('net');
  let conns = 0, probes = 0;
  const server = net.createServer((sock) => {
    conns++;
    sock.on('data', (d) => { if (d.includes(0x18) || d.length) probes++; }); // never answers, never closes
    sock.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { Live } = require('../lib/live');
  const live = new Live({ host: '127.0.0.1', port: server.address().port, quietMs: 600, tickMs: 100 });
  const states = []; live.on('status', (st) => states.push(st));
  live.start();
  try {
    for (let i = 0; i < 40 && !states.some((x) => x.error === 'no response from node'); i++) await wait(100);
    assert.ok(states.some((x) => x.connected === true), 'connected first');
    assert.ok(states.some((x) => x.error === 'no response from node'), 'silence detected');
    assert.equal(live.connected, false);
    for (let i = 0; i < 40 && conns < 2; i++) await wait(100);
    assert.ok(conns >= 2, 'tried to reconnect');
    assert.ok(probes >= 2, 'probed before giving up');
  } finally { live.stop(); server.close(); }
});

test('alerts: silent and low-battery nodes', () => {
  const store = new Store(tmp()), mesh = new Mesh(store);
  mesh.me = '!me';
  mesh.nodes = {
    '!me': { id: '!me', lastHeard: 1 },
    '!a': { id: '!a', long: 'Quiet', lastHeard: Math.floor(Date.now() / 1000) - 7200 },
    '!b': { id: '!b', long: 'Weak', lastHeard: Math.floor(Date.now() / 1000), battery: 12 },
    '!c': { id: '!c', long: 'Plugged', lastHeard: Math.floor(Date.now() / 1000), battery: 101 }
  };
  const a = mesh.alerts();
  assert.deepEqual(a.map((x) => x.type).sort(), ['lowbat', 'silent']);
});

test('presets: unique per service, listen-only outside ham, AM warns on export', () => {
  const radio = require('../lib/radio');
  const p = radio.presets();
  const keys = p.map((x) => x.service + '|' + x.name);
  assert.equal(new Set(keys).size, keys.length, 'duplicate preset names');
  for (const x of p) {
    assert.ok(radio.sanitizeFreq(x).value, 'preset invalid: ' + x.name);
    assert.equal(x.listenOnly, x.service !== 'ham');
  }
  assert.ok(p.some((x) => x.service === 'MARINE') && p.some((x) => x.service === 'AIR') && p.some((x) => x.service === 'PUBLIC'));
  const out = radio.toChirp(p.filter((x) => x.name === 'GUARD').map((x) => ({ ...x, inRadio: true })));
  assert.ok(out.warnings.some((w) => /AM/.test(w)));
  assert.ok(/NFM|FM/.test(out.csv.split('\r\n')[1]));
});

test('contacts: new fields are sanitised, grid squares normalised', () => {
  const radio = require('../lib/radio');
  assert.equal(radio.normGrid('em79'), 'EM79');
  assert.equal(radio.normGrid('em79AB'), 'EM79ab');
  assert.equal(radio.normGrid('ZZ99'), '');
  assert.equal(radio.normGrid('EM7'), '');
  const v = radio.sanitizeContact({ name: 'Dad', phone: '(812) 555-0100 <b>', email: 'dad@example.com', location: 'Sunman', grid: 'em79', freqIds: ['a', 'b'] }).value;
  assert.equal(v.phone, '(812) 555-0100');
  assert.equal(v.email, 'dad@example.com'); assert.equal(v.grid, 'EM79'); assert.deepEqual(v.freqIds, ['a', 'b']);
  assert.equal(radio.sanitizeContact({ name: 'X', email: 'not an email' }).value.email, '');
  // editing keeps existing favorites when the field is not sent
  assert.deepEqual(radio.sanitizeContact({ name: 'Dad' }, { freqIds: ['z'] }).value.freqIds, ['z']);
});
