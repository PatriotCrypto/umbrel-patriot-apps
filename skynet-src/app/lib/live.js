'use strict';
// Live connector: talks to a Meshtastic node over its TCP API (port 4403).
// Framing: 0x94 0xC3, 2-byte big-endian length, then a protobuf message.
const net = require('net');
const { EventEmitter } = require('events');
const pb = require('./pb');

const START1 = 0x94, START2 = 0xc3, MAX_FRAME = 512;
const PORT_TEXT = 1, PORT_POSITION = 3, PORT_NODEINFO = 4, PORT_TELEMETRY = 67;

const nodeId = (num) => '!' + (num >>> 0).toString(16).padStart(8, '0');

function frame(payload) {
  const h = Buffer.from([START1, START2, (payload.length >> 8) & 0xff, payload.length & 0xff]);
  return Buffer.concat([h, payload]);
}

// ---- decoders (exported for tests) ----
function decodeUser(buf) {
  const u = pb.decode(buf);
  return { long: pb.str(u, 2), short: pb.str(u, 3) };
}
function decodePosition(buf) {
  const p = pb.decode(buf);
  const lat = pb.i32(p, 1), lon = pb.i32(p, 2);
  if (lat === undefined || lon === undefined || (lat === 0 && lon === 0)) return null;
  return { lat: lat / 1e7, lon: lon / 1e7, alt: pb.i32(p, 3) };
}
function decodeDeviceMetrics(buf) {
  const d = pb.decode(buf);
  return { battery: pb.u32(d, 1), voltage: pb.f32(d, 2), chUtil: pb.f32(d, 3), airTx: pb.f32(d, 4), uptime: pb.u32(d, 5) };
}
function decodeNodeInfo(buf) {
  const n = pb.decode(buf);
  const num = pb.u32(n, 1);
  if (num === undefined) return null;
  const out = { id: nodeId(num), num, lastHeard: pb.u32(n, 5) || undefined, snr: pb.f32(n, 4), hops: pb.u32(n, 9) };
  const u = pb.bytes(n, 2); if (u) Object.assign(out, decodeUser(u));
  const p = pb.bytes(n, 3); if (p) { const pos = decodePosition(p); if (pos) Object.assign(out, pos); }
  const m = pb.bytes(n, 6); if (m) Object.assign(out, decodeDeviceMetrics(m));
  return out;
}
function decodePacket(buf) {
  const m = pb.decode(buf);
  const from = pb.u32(m, 1), to = pb.u32(m, 2);
  const data = pb.bytes(m, 4);
  if (from === undefined || !data) return null; // encrypted or malformed: ignore
  const d = pb.decode(data);
  const out = {
    from: nodeId(from), to: to === 0xffffffff ? '^all' : nodeId(to), channel: pb.u32(m, 3) || 0,
    portnum: pb.u32(d, 1), payload: pb.bytes(d, 2) || Buffer.alloc(0),
    snr: pb.f32(m, 8), rssi: pb.i32(m, 12), rxTime: pb.u32(m, 7) || 0,
    hops: (pb.u32(m, 15) !== undefined && pb.u32(m, 9) !== undefined) ? Math.max(0, pb.u32(m, 15) - pb.u32(m, 9)) : undefined
  };
  return out;
}
function decodeFromRadio(buf) {
  const r = pb.decode(buf);
  if (r[3]) return { type: 'myinfo', num: pb.u32(pb.decode(r[3][0]), 1) };
  if (r[4]) { const n = decodeNodeInfo(r[4][0]); return n ? { type: 'node', node: n } : null; }
  if (r[2]) { const p = decodePacket(r[2][0]); return p ? { type: 'packet', packet: p } : null; }
  if (r[7]) return { type: 'configdone' };
  return null;
}

class Live extends EventEmitter {
  constructor({ host, port, quietMs, tickMs }) {
    super();
    this.host = host; this.port = port || 4403;
    this.quietMs = quietMs || 90000; this.tickMs = tickMs || 10000; // silence this long = node is gone
    this.lastRx = 0; this.lastBeat = 0; this.lastProbe = 0;
    this.sock = null; this.buf = Buffer.alloc(0);
    this.stopped = false; this.retry = 2000; this.connected = false;
    this.myNum = null; this.hb = null; this.pktId = (Math.random() * 0xffffffff) >>> 0;
  }
  start() { this.stopped = false; this._connect(); }
  stop() {
    this.stopped = true; clearInterval(this.hb); clearTimeout(this.rt);
    if (this.sock) { try { this.sock.destroy(); } catch (_) {} }
    this.connected = false;
  }
  _connect() {
    if (this.stopped || !this.host) return;
    const s = net.createConnection({ host: this.host, port: this.port });
    this.sock = s; this.buf = Buffer.alloc(0);
    s.setTimeout(30000);
    s.on('connect', () => {
      this.connected = true; this.retry = 2000;
      this.lastRx = this.lastBeat = this.lastProbe = Date.now();
      this.emit('status', { connected: true, synced: false, error: undefined });
      s.write(frame(pb.wVarint(3, (Math.random() * 0xfffffff + 1) >>> 0))); // want_config_id
      clearInterval(this.hb);
      // Watchdog. A node that loses power or Wi-Fi never closes the socket, so silence is the signal.
      this.hb = setInterval(() => {
        const now = Date.now(), quiet = now - this.lastRx;
        try {
          if (quiet > this.quietMs) { this.connected = false; this.emit('status', { connected: false, error: 'no response from node' }); s.destroy(); return; }
          if (quiet > this.quietMs * 0.45 && now - this.lastProbe > this.quietMs * 0.2) { // ask for a config dump: a live node always answers
            this.lastProbe = now; s.write(frame(pb.wVarint(3, (Math.random() * 0xfffffff + 1) >>> 0)));
          } else if (now - this.lastBeat > 60000) { this.lastBeat = now; s.write(frame(pb.wBytes(7, Buffer.alloc(0)))); }
        } catch (_) {}
      }, this.tickMs);
    });
    s.on('timeout', () => { if (!this.connected) s.destroy(); }); // never got through (node off): give up and retry
    s.on('data', (d) => this._data(d));
    s.on('error', (e) => this.emit('status', { connected: false, error: e.code || String(e.message) }));
    s.on('close', () => {
      this.connected = false; clearInterval(this.hb);
      this.emit('status', { connected: false });
      if (!this.stopped) { this.rt = setTimeout(() => this._connect(), this.retry); this.retry = Math.min(this.retry * 2, 60000); }
    });
  }
  _data(d) {
    this.lastRx = Date.now();
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      // resync to the start bytes
      let i = 0;
      while (i + 1 < this.buf.length && !(this.buf[i] === START1 && this.buf[i + 1] === START2)) i++;
      if (i > 0) this.buf = this.buf.subarray(i);
      if (this.buf.length < 4) return;
      const len = (this.buf[2] << 8) | this.buf[3];
      if (len > MAX_FRAME) { this.buf = this.buf.subarray(2); continue; }
      if (this.buf.length < 4 + len) return;
      const payload = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      let ev = null;
      try { ev = decodeFromRadio(payload); } catch (_) { ev = null; }
      if (ev) this._handle(ev);
    }
  }
  _handle(ev) {
    if (ev.type === 'myinfo') { this.myNum = ev.num; this.emit('myinfo', nodeId(ev.num)); }
    else if (ev.type === 'node') this.emit('node', ev.node);
    else if (ev.type === 'configdone') this.emit('status', { connected: true, synced: true });
    else if (ev.type === 'packet') {
      const p = ev.packet;
      this.emit('packet', { from: p.from, to: p.to, portnum: p.portnum, snr: p.snr });
      const base = { id: p.from, snr: p.snr, rssi: p.rssi, hops: p.hops, lastHeard: p.rxTime || Math.floor(Date.now() / 1000) };
      try {
        if (p.portnum === PORT_TEXT) {
          this.emit('text', { from: p.from, to: p.to, channel: p.channel, text: p.payload.toString('utf8').slice(0, 500), ts: (p.rxTime || Math.floor(Date.now() / 1000)) * 1000, snr: p.snr });
          this.emit('node', base);
        } else if (p.portnum === PORT_POSITION) {
          const pos = decodePosition(p.payload); this.emit('node', pos ? { ...base, ...pos } : base);
        } else if (p.portnum === PORT_NODEINFO) {
          this.emit('node', { ...base, ...decodeUser(p.payload) });
        } else if (p.portnum === PORT_TELEMETRY) {
          const t = pb.decode(p.payload); const dm = pb.bytes(t, 2);
          this.emit('node', dm ? { ...base, ...decodeDeviceMetrics(dm) } : base);
        } else this.emit('node', base);
      } catch (_) { /* ignore malformed packet */ }
    }
  }
  // Send a text message into the mesh. Returns true if written.
  sendText(text, to = '^all', channel = 0) {
    if (!this.connected || !this.sock) return false;
    const dest = to === '^all' ? 0xffffffff : parseInt(String(to).replace('!', ''), 16) >>> 0;
    this.pktId = (this.pktId + 1) >>> 0;
    const data = Buffer.concat([pb.wVarint(1, PORT_TEXT), pb.wBytes(2, Buffer.from(text, 'utf8'))]);
    const mp = Buffer.concat([pb.wFixed32(2, dest), pb.wVarint(3, channel), pb.wBytes(4, data), pb.wFixed32(6, this.pktId)]);
    this.sock.write(frame(pb.wBytes(1, mp)));
    return true;
  }
}

module.exports = { Live, nodeId, frame, decodeFromRadio, decodePacket, decodeNodeInfo, decodePosition };
