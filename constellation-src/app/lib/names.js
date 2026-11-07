'use strict';
// Find a friendly name for a device on the LAN: mDNS (Apple, Linux, many IoT),
// the router's DNS (reverse lookup), and NetBIOS (Windows, Samba, printers).
// Every lookup is best-effort and time-limited.
const dgram = require('dgram');
const dns = require('dns');

function encodeName(name) {
  const bufs = [];
  for (const p of name.split('.').filter(Boolean)) {
    const b = Buffer.from(p, 'ascii');
    bufs.push(Buffer.from([b.length]), b);
  }
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

function buildQuery(name, type) {
  const h = Buffer.alloc(12);
  h.writeUInt16BE(Math.floor(Math.random() * 65535), 0);
  h.writeUInt16BE(1, 4); // one question
  const q = Buffer.alloc(4);
  q.writeUInt16BE(type, 0);
  q.writeUInt16BE(1, 2); // class IN
  return Buffer.concat([h, encodeName(name), q]);
}

// Read a (possibly compressed) DNS name. Returns { name, next } or null.
function readName(buf, off) {
  const labels = [];
  let jumped = false;
  let ret = off;
  let guard = 0;
  for (;;) {
    if (off >= buf.length || guard++ > 40) return null;
    const len = buf[off];
    if (len === 0) { off++; break; }
    if ((len & 0xc0) === 0xc0) {
      if (off + 1 >= buf.length) return null;
      const ptr = ((len & 0x3f) << 8) | buf[off + 1];
      if (!jumped) { ret = off + 2; jumped = true; }
      off = ptr;
      continue;
    }
    off++;
    if (off + len > buf.length) return null;
    labels.push(buf.toString('latin1', off, off + len));
    off += len;
  }
  if (!jumped) ret = off;
  return { name: labels.join('.'), next: ret };
}

// First PTR answer in a DNS response, or null.
function parsePtrAnswer(buf) {
  if (buf.length < 12) return null;
  const qd = buf.readUInt16BE(4);
  const an = buf.readUInt16BE(6);
  let off = 12;
  for (let i = 0; i < qd; i++) {
    const r = readName(buf, off);
    if (!r) return null;
    off = r.next + 4;
  }
  for (let i = 0; i < an; i++) {
    const r = readName(buf, off);
    if (!r) return null;
    off = r.next;
    if (off + 10 > buf.length) return null;
    const type = buf.readUInt16BE(off);
    const rdlen = buf.readUInt16BE(off + 8);
    off += 10;
    if (type === 12) {
      const n = readName(buf, off);
      if (n) return n.name;
    }
    off += rdlen;
  }
  return null;
}

// NetBIOS node-status query: asks "what are your names?" (UDP 137).
function buildNbnsQuery() {
  const h = Buffer.alloc(12);
  h.writeUInt16BE(Math.floor(Math.random() * 65535), 0);
  h.writeUInt16BE(1, 4);
  let enc = '';
  const raw = Buffer.concat([Buffer.from('*'), Buffer.alloc(15)]);
  for (const b of raw) enc += String.fromCharCode(65 + (b >> 4), 65 + (b & 15));
  const q = Buffer.alloc(4);
  q.writeUInt16BE(0x21, 0);
  q.writeUInt16BE(1, 2);
  return Buffer.concat([h, Buffer.from([32]), Buffer.from(enc, 'ascii'), Buffer.from([0]), q]);
}

function parseNbnsAnswer(buf) {
  if (buf.length < 57) return null;
  const an = buf.readUInt16BE(6);
  if (an < 1) return null;
  const r = readName(buf, 12);
  if (!r) return null;
  let off = r.next;
  if (off + 10 > buf.length) return null;
  off += 10; // type, class, ttl, rdlength
  const count = buf[off++];
  let best = null;
  for (let i = 0; i < count; i++) {
    if (off + 18 > buf.length) break;
    const name = buf.toString('latin1', off, off + 15).replace(/[\s\0]+$/, '');
    const suffix = buf[off + 15];
    const flags = buf.readUInt16BE(off + 16);
    off += 18;
    const group = (flags & 0x8000) !== 0;
    if (suffix === 0 && !group && name) { best = name; break; }
  }
  return best;
}

function udpQuery(ip, port, packet, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const sock = dgram.createSocket('udp4');
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch (e) { /* already closed */ }
      resolve(v);
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    sock.on('error', () => finish(null));
    sock.on('message', (m) => finish(m));
    sock.send(packet, port, ip, (e) => { if (e) finish(null); });
  });
}

function cleanHostname(raw) {
  if (!raw) return null;
  let n = String(raw).trim().replace(/\.$/, '');
  n = n.replace(/\.(local|lan|home|localdomain|internal|home\.arpa|fritz\.box|router)$/i, '');
  n = n.replace(/\\(\d{3})/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
  n = n.replace(/[\u0000-\u001f\u007f<>]/g, '');
  if (!n || n.length > 63) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(n)) return null;
  if (/^(_gateway|localhost|unknown)$/i.test(n)) return null;
  return n;
}

function reverseArpa(ip) {
  return ip.split('.').reverse().join('.') + '.in-addr.arpa';
}

async function mdnsName(ip, timeoutMs) {
  const res = await udpQuery(ip, 5353, buildQuery(reverseArpa(ip), 12), timeoutMs);
  return res ? cleanHostname(parsePtrAnswer(res)) : null;
}

async function nbnsName(ip, timeoutMs) {
  const res = await udpQuery(ip, 137, buildNbnsQuery(), timeoutMs);
  return res ? cleanHostname(parseNbnsAnswer(res)) : null;
}

async function dnsName(ip, gateway, timeoutMs) {
  const tryServer = async (servers) => {
    try {
      const r = new dns.promises.Resolver({ timeout: timeoutMs, tries: 1 });
      if (servers) r.setServers(servers);
      const names = await r.reverse(ip);
      return cleanHostname(names && names[0]);
    } catch (e) {
      return null;
    }
  };
  return (gateway && (await tryServer([gateway]))) || (await tryServer(null));
}

// Best name we can find for one IP. Preference: mDNS, DNS, NetBIOS.
async function resolveName(ip, { gateway, timeoutMs = 1500 } = {}) {
  const [m, d, n] = await Promise.all([
    mdnsName(ip, timeoutMs).catch(() => null),
    dnsName(ip, gateway, timeoutMs).catch(() => null),
    nbnsName(ip, timeoutMs).catch(() => null),
  ]);
  return m || d || n || null;
}

module.exports = {
  resolveName, cleanHostname, buildQuery, parsePtrAnswer, buildNbnsQuery, parseNbnsAnswer,
  reverseArpa, readName, encodeName,
};
