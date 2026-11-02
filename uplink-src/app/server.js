'use strict';
// Uplink: a private, encrypted chat and file link between two Umbrels.
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const S = require('./lib/seal');

const VERSION = '0.3.1';
const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data');
const FILES_DIR = path.resolve(process.env.FILES_DIR || '/files');
const DEFAULT_PEER_PORT = parseInt(process.env.PEER_PORT || '3947', 10);
const CHUNK = parseInt(process.env.CHUNK_BYTES || String(4 * 1024 * 1024), 10);
const TICK_MS = parseInt(process.env.TICK_MS || '2000', 10);
const PING_MS = parseInt(process.env.PING_MS || '15000', 10);
const os = require('os');
const SKEW_MS = 10 * 60 * 1000;
const ANY_ADDR = process.env.UPLINK_ANY_ADDR === '1'; // tests only: allow non-Tailscale peer addresses
const MSG_KEEP = 3000;          // messages kept per station
const MSG_RATE = 120;           // incoming messages per station per minute
const MAX_RECEIVING = 3;        // files a station may be sending us at once
const STALE_PART_MS = 3 * 24 * 3600e3; // half-finished incoming files older than this are removed

// a bad request must never take the app down
process.on('unhandledRejection', (e) => console.error('unhandled', e && e.message ? e.message : e));
process.on('uncaughtException', (e) => console.error('uncaught', e && e.message ? e.message : e));

// Uplink starts as root only to make sure the Uplink folder in Umbrel Files exists and belongs to
// the umbrel user (Docker creates a missing folder as root), then drops to that user for good.
const RUN_UID = parseInt(process.env.RUN_UID || '1000', 10), RUN_GID = parseInt(process.env.RUN_GID || '1000', 10);
if (process.getuid && process.getuid() === 0) {
  for (const d of [FILES_DIR, DATA_DIR]) {
    try {
      fs.mkdirSync(d, { recursive: true });
      const st = fs.statSync(d);
      if (st.uid === 0) fs.chownSync(d, RUN_UID, RUN_GID);
      if (d === DATA_DIR) for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.lstatSync(p).uid === 0) fs.chownSync(p, RUN_UID, RUN_GID); }
    } catch (e) { console.error('folder setup', d, e.message); }
  }
  process.setgroups([RUN_GID]); process.setgid(RUN_GID); process.setuid(RUN_UID);
}
for (const d of ['', 'outgoing', 'incoming', 'received']) fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });

// ---------- storage ----------
const file = (n) => path.join(DATA_DIR, n);
const load = (n, def) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return def; } };
const timers = {};
function save(n, obj, now) {
  const w = () => { delete timers[n]; const tmp = file(n) + '.tmp'; try { fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 }); fs.renameSync(tmp, file(n)); } catch (e) { console.error('save', n, e.message); } };
  if (now) { clearTimeout(timers[n]); w(); } else if (!timers[n]) timers[n] = setTimeout(w, 400);
}

let me = load('identity.json', null);
if (!me || !S.validPub(me.x)) { const k = S.newIdentity(); me = { x: k.x, d: k.d, callsign: '', addr: '', port: DEFAULT_PEER_PORT, maxGB: 50 }; save('identity.json', me, true); }
me.fp = S.fingerprint(me.x);
let peers = load('peers.json', []);
let msgs = load('messages.json', []);
let transfers = load('transfers.json', []);
let invites = load('invites.json', []);
let stats = Object.assign({ bytesOut: 0, bytesIn: 0, msgsOut: 0, msgsIn: 0, filesOut: 0, filesIn: 0, fileBytesOut: 0, fileBytesIn: 0, since: Date.now() }, load('stats.json', {}));
const saveStats = () => save('stats.json', stats);
const traffic = []; // [t, bytesOut/s, bytesIn/s] every 2 s for the last 3 minutes
let lastTraffic = { t: Date.now(), o: stats.bytesOut, i: stats.bytesIn };
setInterval(() => {
  const now = Date.now(), dt = Math.max(0.5, (now - lastTraffic.t) / 1000);
  traffic.push([now, Math.round((stats.bytesOut - lastTraffic.o) / dt), Math.round((stats.bytesIn - lastTraffic.i) / dt)]);
  if (traffic.length > 90) traffic.shift();
  lastTraffic = { t: now, o: stats.bytesOut, i: stats.bytesIn };
}, 2000).unref();
let cpuPrev = os.cpus().map((c) => c.times);
let cpuPct = 0;
setInterval(() => {
  const cur = os.cpus().map((c) => c.times); let idle = 0, total = 0;
  cur.forEach((t, i) => { const p = cpuPrev[i] || t; const d = (k) => t[k] - p[k]; const tot = d('user') + d('nice') + d('sys') + d('idle') + d('irq'); idle += d('idle'); total += tot; });
  cpuPct = total > 0 ? Math.round(100 * (1 - idle / total)) : 0; cpuPrev = cur;
}, 3000).unref();
const saveMe = () => { const { fp, ...rest } = me; save('identity.json', rest); };
const savePeers = () => save('peers.json', peers.map(({ online, rtt, busy, nextTry, fails, lastErr, pending, lastPing, rtts, onlineSince, bootHiT, rate, ...p }) => p));
// after a restart, anything not newer than the last request seen before it is a replay
for (const p of peers) p.bootHiT = p.hiT || 0;
let hiDirty = false; setInterval(() => { if (hiDirty) { hiDirty = false; savePeers(); } }, 5000).unref();
function saveMsgs() { trimMsgs(); save('messages.json', msgs); }
function trimMsgs() {
  const per = new Map(); for (const m of msgs) per.set(m.peer, (per.get(m.peer) || 0) + 1);
  if ([...per.values()].some((n) => n > MSG_KEEP)) {
    const drop = new Map(); for (const [p, n] of per) if (n > MSG_KEEP) drop.set(p, n - MSG_KEEP);
    msgs = msgs.filter((m) => { const d = drop.get(m.peer); if (d && m.state !== 'queued') { drop.set(m.peer, d - 1); return d - 1 < 0; } return true; });
  }
}
const saveTransfers = (now) => { if (transfers.length > 2000) transfers = transfers.filter((t, i) => i >= transfers.length - 2000 || ['queued', 'sending', 'receiving'].includes(t.state)); save('transfers.json', transfers.map(({ rate, cancel, _w, ...t }) => t), now); };
const saveInvites = () => save('invites.json', invites);
// transfers that were mid-flight when the app stopped resume from where they were
for (const t of transfers) { if (t.state === 'sending') t.state = 'queued'; }

const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');
const cleanName = (s, max = 40) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const cleanAddr = (s) => { const v = String(s || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); return /^[A-Za-z0-9.:\-\[\]]{1,120}$/.test(v) ? v.replace(/:\d+$/, (m) => (v.split(':').length > 2 ? m : '')) : ''; };
// Peer-supplied addresses must be Tailscale ones (100.64.0.0/10, fd7a:115c:a1e0::/48 or a *.ts.net name)
function tailscaleAddr(a) {
  if (ANY_ADDR) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (m) return +m[1] === 100 && +m[2] >= 64 && +m[2] <= 127 && +m[3] <= 255 && +m[4] <= 255;
  const v6 = a.replace(/^\[|\]$/g, '').toLowerCase();
  if (v6.startsWith('fd7a:115c:a1e0:')) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/i.test(a);
}
const cleanPort = (p) => { const n = parseInt(p, 10); return n >= 1 && n <= 65535 ? n : DEFAULT_PEER_PORT; };
function safeFileName(n) {
  let s = String(n || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '_').replace(/^\.+/, '').trim();
  if (!s) s = 'file';
  if (s.length > 180) { const ext = path.extname(s).slice(0, 12); s = s.slice(0, 180 - ext.length) + ext; }
  return s;
}
const TZ = process.env.TZ || (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } })();
const peerById = (id) => peers.find((p) => p.id === id);
const peerByX = (x) => peers.find((p) => p.x === x);
const hostOf = (p) => (p.addr.includes(':') && !p.addr.startsWith('[') ? `[${p.addr}]` : p.addr);

// ---------- talking to the other station ----------
const seen = new Map(); // nonce -> expiry
setInterval(() => { const now = Date.now(); for (const [k, v] of seen) if (v < now) seen.delete(k); }, 60000).unref();

async function rpc(peer, meta, data, timeoutMs = 20000) {
  const key = S.sharedKey(me, peer.x);
  const n = rid(12);
  const body = S.seal(key, `${me.x}>${peer.x}`, { ...meta, t: Date.now(), n }, data);
  const t0 = Date.now();
  const r = await fetch(`http://${hostOf(peer)}:${peer.port}/peer/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Uplink-From': me.x }, body, signal: AbortSignal.timeout(timeoutMs) });
  const buf = Buffer.from(await r.arrayBuffer());
  stats.bytesOut += body.length; stats.bytesIn += buf.length; saveStats();
  if (!r.ok) {
    let msg = `the other station answered ${r.status}`;
    if (r.status === 403) msg = 'the other station does not recognise this one (it may have unlinked you)';
    else if (r.status === 401 || /<html/i.test(buf.toString('utf8', 0, 200))) msg = "the other Umbrel's login page answered instead of Uplink (is Uplink installed and up to date there?)";
    throw Object.assign(new Error(msg), { status: r.status });
  }
  const { meta: reply } = S.open(key, `${peer.x}>${me.x}`, buf);
  if (reply.re !== n) throw new Error('reply did not match the request');
  if (!peer.pending) { peer.rtt = Date.now() - t0; if (meta.type === 'ping') { (peer.rtts = peer.rtts || []).push([Date.now(), peer.rtt]); if (peer.rtts.length > 80) peer.rtts.shift(); } }
  if (reply.err) throw Object.assign(new Error(reply.err), { remote: true, reply });
  return reply;
}

function markOnline(p, ok, err) {
  const was = p.online;
  if (ok && !was) p.onlineSince = Date.now(); if (!ok) p.onlineSince = 0;
  p.online = ok; if (ok) { p.lastSeen = Date.now(); p.fails = 0; p.lastErr = ''; p.nextTry = 0; }
  else { p.fails = (p.fails || 0) + 1; p.lastErr = err ? String(err.message || err).slice(0, 200) : ''; p.nextTry = Date.now() + Math.min(60000, 5000 * p.fails); }
  if (was !== ok) savePeers();
}
const netErr = (e) => (e.name === 'TimeoutError' ? new Error('no answer (timed out)') : e.cause && e.cause.code ? new Error({ ECONNREFUSED: 'connection refused', EHOSTUNREACH: 'station unreachable', ENOTFOUND: 'address not found', ETIMEDOUT: 'no answer (timed out)', ECONNRESET: 'connection dropped', UND_ERR_SOCKET: 'connection dropped', EPIPE: 'connection dropped', UND_ERR_CONNECT_TIMEOUT: 'no answer (timed out)' }[e.cause.code] || e.cause.code) : e);

// ---------- incoming requests from the other station ----------
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" });
  next();
});

// Unknown senders may only send a small pairing request; everything else is read only after the
// sender's key is recognised, and repeated failures from one device get it turned away for a while.
const ipState = new Map(); // ip -> { n, at, bad, blockUntil, inflight }
setInterval(() => { const now = Date.now(); for (const [k, v] of ipState) if (now - v.at > 600000 && v.blockUntil < now && !v.inflight) ipState.delete(k); }, 60000).unref();
const ipOf = (req) => String(req.get('x-forwarded-for') || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
function ipEntry(ip) { let e = ipState.get(ip); if (!e) { e = { n: 0, at: Date.now(), bad: 0, blockUntil: 0, inflight: 0 }; ipState.set(ip, e); } return e; }
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = parseInt(req.get('content-length') || '-1', 10);
    if (len > limit) return reject(Object.assign(new Error('too large'), { status: 413 }));
    const parts = []; let size = 0, done = false;
    req.on('data', (c) => { if (done) return; size += c.length; if (size > limit) { done = true; reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; } parts.push(c); });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(parts)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}
app.post('/peer/rpc', async (req, res) => {
  const ip = ipOf(req), e = ipEntry(ip), now = Date.now();
  if (e.blockUntil > now) return res.status(429).end();
  if (now - e.at > 60000) { e.at = now; e.n = 0; e.bad = 0; }
  const from = String(req.get('X-Uplink-From') || '');
  if (!S.validPub(from) || from === me.x) { e.bad++; if (e.bad > 20) e.blockUntil = now + 300000; return res.status(400).end(); }
  const peer = peerByX(from);
  if (!peer && ++e.n > 10) return res.status(429).end();        // pairing attempts per device per minute
  if (e.inflight >= (peer ? 8 : 2)) return res.status(429).end();
  e.inflight++;
  let body;
  try { body = await readBody(req, peer ? CHUNK + 64 * 1024 : 8 * 1024); }
  catch (err) { e.inflight--; e.bad++; if (e.bad > 20) e.blockUntil = now + 300000; return res.status(err.status || 400).end(); }
  e.inflight--;
  let key, env;
  try { key = S.sharedKey(me, from); env = S.open(key, `${from}>${me.x}`, body); }
  catch { e.bad++; if (e.bad > 20) e.blockUntil = now + 300000; return res.status(403).end(); }
  const m = env.meta;
  if (typeof m.n !== 'string' || m.n.length > 40 || typeof m.t !== 'number' || Math.abs(Date.now() - m.t) > SKEW_MS) return res.status(403).end();
  if (peer && peer.bootHiT && m.t <= peer.bootHiT) return res.status(403).end(); // replay from before a restart
  const nk = from + m.n; if (seen.has(nk)) return res.status(403).end(); seen.set(nk, Date.now() + 2 * SKEW_MS);
  if (peer && m.t > (peer.hiT || 0)) { peer.hiT = m.t; hiDirty = true; }
  const reply = (obj) => { const out = S.seal(key, `${me.x}>${from}`, { ...obj, re: m.n }); stats.bytesIn += body.length; stats.bytesOut += out.length; saveStats(); res.type('application/octet-stream').send(out); };
  if (!peer && m.type !== 'pair') return res.status(403).end();
  try {
    if (peer) { if (!peer.online) peer.onlineSince = Date.now(); peer.online = true; peer.lastSeen = Date.now(); peer.nextTry = 0; peer.fails = 0; }
    reply(await handle(peer, m, env.data, req, from));
  } catch (err) { try { reply({ err: String(err.message || err).slice(0, 300) }); } catch { if (!res.headersSent) res.status(500).end(); } }
});

async function handle(peer, m, data, req, from) {
  switch (m.type) {
    case 'pair': {
      const inv = invites.find((i) => i.token === m.token && i.expires > Date.now());
      if (!inv) throw new Error('That invite code has expired or was already used. Ask for a new one.');
      const fwd = String(req.get('x-forwarded-for') || '').split(',')[0].trim() || req.socket.remoteAddress || '';
      const cand = [cleanAddr(m.addr), cleanAddr(fwd.replace(/^::ffff:/, ''))].filter(Boolean);
      const addr = cand.find(tailscaleAddr) || '';
      if (!addr) throw new Error('This station only links over Tailscale. Set a 100.x Tailscale address in Uplink settings on your side and try again.');
      invites = invites.filter((i) => i !== inv); saveInvites();
      let p = peerByX(from);
      if (!p) { p = { id: S.fingerprint(from), x: from, pairedAt: Date.now() }; peers.push(p); }
      if (!p.online) p.onlineSince = Date.now();
      Object.assign(p, { name: cleanName(m.name) || 'Station ' + p.id.slice(0, 4), addr, port: cleanPort(m.port), online: true, lastSeen: Date.now() });
      savePeers();
      sysNote(p, `${p.name} linked to this station.`);
      return { ok: true, name: me.callsign || 'Station ' + me.fp.slice(0, 4) };
    }
    case 'ping':
      if (m.name && cleanName(m.name) !== peer.name) { peer.name = cleanName(m.name); savePeers(); }
      if (m.addr && cleanAddr(m.addr) && tailscaleAddr(cleanAddr(m.addr)) && (cleanAddr(m.addr) !== peer.addr || cleanPort(m.port) !== peer.port)) {
        const was = `${peer.addr}:${peer.port}`; peer.addr = cleanAddr(m.addr); peer.port = cleanPort(m.port); savePeers();
        sysNote(peer, `${peer.name} moved from ${was} to ${peer.addr}:${peer.port}.`);
      }
      if (typeof m.tz === 'string' && m.tz.length < 60) peer.tz = m.tz;
      return { pong: true, name: me.callsign, v: VERSION, tz: me.tz || TZ };
    case 'msg': {
      if (typeof m.id !== 'string' || m.id.length > 40) throw new Error('bad message');
      const nowR = Date.now(); peer.rate = (peer.rate || []).filter((t) => nowR - t < 60000);
      if (peer.rate.length >= MSG_RATE) throw new Error('Too many messages at once. Wait a minute and they will go through.');
      peer.rate.push(nowR);
      if (!msgs.some((x) => x.id === m.id && x.peer === peer.id)) {
        msgs.push({ id: m.id, peer: peer.id, dir: 'in', kind: 'text', text: String(m.text || '').slice(0, 8000), ts: Date.now(), sentAt: m.ts });
        peer.unread = (peer.unread || 0) + 1; stats.msgsIn++; saveMsgs(); savePeers();
      }
      return { ok: true };
    }
    case 'offer': {
      const size = Number(m.size);
      if (typeof m.fid !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(m.fid) || !(size >= 0) || !/^[a-f0-9]{64}$/.test(String(m.sha))) throw new Error('bad offer');
      let t = transfers.find((x) => x.dir === 'in' && x.peer === peer.id && x.fid === m.fid);
      if (t && t.state === 'done') return { have: t.size, done: true };
      if (t && t.state === 'cancelled') throw new Error('This transfer was cancelled on the receiving end.');
      if (size > me.maxGB * 1e9) throw new Error(`This file is bigger than the ${me.maxGB} GB limit set on ${me.callsign || 'the other station'}.`);
      if (!t) {
        const active = transfers.filter((x) => x.dir === 'in' && x.peer === peer.id && x.state === 'receiving');
        if (active.length >= MAX_RECEIVING) throw new Error('Too many files arriving at once. This one will start when one finishes.');
        if (active.reduce((a, x) => a + x.size, 0) + size > me.maxGB * 1e9) throw new Error(`Files in flight would go over the ${me.maxGB} GB limit on ${me.callsign || 'the other station'}. This one will start when space frees up.`);
        for (const dir of [DATA_DIR, (await filesDirOk()) ? FILES_DIR : null].filter(Boolean)) {
          const free = await freeBytes(dir);
          if (free != null && free < size + 2e9) throw new Error(`Not enough free space on ${me.callsign || 'the other station'}.`);
        }
        t = { id: rid(9), fid: m.fid, peer: peer.id, dir: 'in', name: safeFileName(m.name), size, sha: m.sha, done: 0, state: 'receiving', at: Date.now() };
        transfers.push(t);
        msgs.push({ id: 'f' + t.id, peer: peer.id, dir: 'in', kind: 'file', tid: t.id, ts: Date.now() }); peer.unread = (peer.unread || 0) + 1; saveMsgs();
      }
      t.state = 'receiving'; t.part = path.join(DATA_DIR, 'incoming', `${peer.id}-${t.fid}.part`);
      t.done = await fsp.stat(t.part).then((s) => s.size).catch(() => 0);
      if (t.done > t.size) { await fsp.rm(t.part, { force: true }); t.done = 0; }
      saveTransfers();
      return { have: t.done };
    }
    case 'chunk': {
      const t = transfers.find((x) => x.dir === 'in' && x.peer === peer.id && x.fid === m.fid);
      if (!t || t.state !== 'receiving') throw new Error('no such transfer');
      if (m.off !== t.done) return { have: t.done };
      if (t.done + data.length > t.size) throw new Error('more data than offered');
      await fsp.appendFile(t.part, data);
      t.done += data.length; tick(t, data.length); saveTransfers();
      return { have: t.done };
    }
    case 'done': {
      const t = transfers.find((x) => x.dir === 'in' && x.peer === peer.id && x.fid === m.fid);
      if (!t) throw new Error('no such transfer');
      if (t.state === 'done') return { ok: true, saved: t.savedAs };
      if (t.done !== t.size) return { have: t.done };
      const sha = await hashFile(t.part);
      if (sha !== t.sha) { await fsp.rm(t.part, { force: true }); t.done = 0; saveTransfers(); throw new Error('The file arrived damaged; it will be sent again.'); }
      const dest = await placeReceived(peer, t.name);
      await moveFile(t.part, dest.full);
      Object.assign(t, { state: 'done', path: dest.full, savedAs: dest.shown, finishedAt: Date.now() }); delete t.part; stats.filesIn++; stats.fileBytesIn += t.size; saveTransfers(true); saveMsgs();
      return { ok: true, saved: dest.shown };
    }
    case 'cancel': {
      const t = transfers.find((x) => x.dir === 'in' && x.peer === peer.id && x.fid === m.fid);
      if (t && t.state !== 'done') { t.state = 'cancelled'; if (t.part) await fsp.rm(t.part, { force: true }); saveTransfers(); }
      return { ok: true };
    }
    case 'unlink':
      sysNote(peer, `${peer.name} unlinked from this station.`);
      peers = peers.filter((p) => p !== peer); savePeers();
      return { ok: true };
    default: throw new Error('unknown request');
  }
}

function sysNote(peer, text) { msgs.push({ id: 's' + rid(8), peer: peer.id, dir: 'sys', kind: 'text', text, ts: Date.now() }); saveMsgs(); }
async function freeBytes(dir) { try { const s = await fsp.statfs(dir); return s.bavail * s.bsize; } catch { return null; } }
async function hashFile(p) { const h = crypto.createHash('sha256'); await pipeline(fs.createReadStream(p), h); return h.digest('hex'); }
async function moveFile(a, b) { try { await fsp.rename(a, b); } catch (e) { if (e.code !== 'EXDEV') throw e; await pipeline(fs.createReadStream(a), fs.createWriteStream(b, { flags: 'wx' })); await fsp.rm(a, { force: true }); } }
async function filesDirOk() { try { await fsp.access(FILES_DIR, fs.constants.W_OK); const s = await fsp.stat(FILES_DIR); return s.isDirectory(); } catch { return false; } }
async function placeReceived(peer, name) {
  const useFiles = await filesDirOk();
  const base = useFiles ? FILES_DIR : path.join(DATA_DIR, 'received', peer.id);
  await fsp.mkdir(base, { recursive: true });
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const n = i === 1 ? name : `${stem} (${i})${ext}`;
    const full = path.join(base, n);
    if (!fs.existsSync(full)) return { full, shown: useFiles ? path.posix.join('Uplink', n) : n };
  }
  throw new Error('Too many files with that name.');
}
function tick(t, n) { // transfer rate, smoothed
  const now = Date.now(); t._w = t._w || []; t._w.push([now, n]); while (t._w.length && now - t._w[0][0] > 8000) t._w.shift();
  const span = Math.max(1, now - t._w[0][0]); const sum = t._w.reduce((a, b) => a + b[1], 0); t.rate = t._w.length > 1 ? Math.round(sum / (span / 1000)) : 0;
}

// ---------- the delivery loop ----------
async function deliver(peer) {
  if (peer.busy || (peer.nextTry && Date.now() < peer.nextTry) || !peer.addr) return;
  peer.busy = true;
  try {
    for (const m of msgs.filter((x) => x.peer === peer.id && x.dir === 'out' && x.kind === 'text' && x.state === 'queued')) {
      await rpc(peer, { type: 'msg', id: m.id, text: m.text, ts: m.ts });
      m.state = 'sent'; m.deliveredAt = Date.now(); stats.msgsOut++; saveMsgs();
    }
    const t = transfers.find((x) => x.peer === peer.id && x.dir === 'out' && x.state === 'queued');
    if (t) await sendFile(peer, t);
    if (!peer.lastPing || Date.now() - peer.lastPing > PING_MS) { peer.lastPing = Date.now(); const pr = await rpc(peer, { type: 'ping', name: me.callsign, addr: me.addr, port: me.port, tz: me.tz || TZ }, null, 10000); if (pr.tz && typeof pr.tz === 'string' && pr.tz.length < 60) peer.tz = pr.tz; if (pr.v) peer.v = String(pr.v).slice(0, 12); }
    markOnline(peer, true);
  } catch (e) {
    if (e.remote) { markOnline(peer, true); }
    else markOnline(peer, false, netErr(e));
  } finally { peer.busy = false; }
}

async function sendFile(peer, t) {
  t.state = 'sending'; t.err = ''; saveTransfers();
  try {
    let r = await rpc(peer, { type: 'offer', fid: t.fid, name: t.name, size: t.size, sha: t.sha });
    let have = r.have || 0;
    if (!r.done && have < t.size && !(t.path && fs.existsSync(t.path))) { t.state = 'failed'; t.err = 'The copy waiting to be sent is gone. Send the file again.'; saveTransfers(true); rpc(peer, { type: 'cancel', fid: t.fid }).catch(() => {}); return; }
    const fh = r.done || have >= t.size ? null : await fsp.open(t.path, 'r');
    try {
      const buf = Buffer.alloc(Math.min(CHUNK, Math.max(1, t.size)));
      while (have < t.size && !r.done) {
        if (t.cancel) throw Object.assign(new Error('cancelled'), { cancelled: true });
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, t.size - have), have);
        r = await rpc(peer, { type: 'chunk', fid: t.fid, off: have }, buf.subarray(0, bytesRead), 120000);
        const before = have; have = r.have; t.done = have; if (have > before) tick(t, have - before); saveTransfers();
      }
    } finally { if (fh) await fh.close(); }
    r = await rpc(peer, { type: 'done', fid: t.fid }, null, 300000);
    if (r.have != null && !r.ok) { t.state = 'queued'; return; }
    Object.assign(t, { state: 'done', done: t.size, savedAs: r.saved || '', finishedAt: Date.now(), rate: 0 }); stats.filesOut++; stats.fileBytesOut += t.size;
    if (t.path) await fsp.rm(t.path, { force: true }); delete t.path; saveTransfers(true);
  } catch (e) {
    if (e.cancelled) { t.state = 'cancelled'; await fsp.rm(t.path, { force: true }).catch(() => {}); saveTransfers(); rpc(peer, { type: 'cancel', fid: t.fid }).catch(() => {}); return; }
    if (e.remote && /bigger than the|Not enough free space|cancelled/i.test(e.message)) { t.state = 'failed'; t.err = e.message; await fsp.rm(t.path, { force: true }).catch(() => {}); saveTransfers(); return; }
    t.state = 'queued'; t.err = e.remote ? e.message : 'Waiting for the other station: ' + netErr(e).message; saveTransfers();
    throw e;
  }
}
setInterval(() => { for (const p of peers) deliver(p); }, TICK_MS).unref();

// ---------- the page's own API (behind the Umbrel login) ----------
app.use('/api', (req, res, next) => { if (req.method !== 'GET' && req.get('X-AG') !== '1') return res.status(403).json({ error: 'Missing header.' }); next(); });
app.use('/api', express.json({ limit: '64kb' }));
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

const pubPeer = (p) => ({ id: p.id, name: p.name, addr: p.addr, port: p.port, online: !!p.online, rtt: p.rtt || null, lastSeen: p.lastSeen || null, unread: p.unread || 0, err: p.online ? '' : p.lastErr || '', queued: msgs.filter((m) => m.peer === p.id && m.state === 'queued').length });
const pubTransfer = (t) => ({ id: t.id, peer: t.peer, dir: t.dir, name: t.name, size: t.size, done: t.done, state: t.state, rate: ['sending', 'receiving'].includes(t.state) ? t.rate || 0 : 0, err: t.err || '', savedAs: t.savedAs || '', canOpen: t.dir === 'in' && t.state === 'done' && !!t.path });

app.get('/api/state', async (req, res) => {
  const pid = String(req.query.peer || '');
  const p = peerById(pid);
  const list = p ? msgs.filter((m) => m.peer === p.id).slice(-400) : [];
  const tids = new Set(list.filter((m) => m.tid).map((m) => m.tid));
  res.json({
    version: VERSION,
    me: { callsign: me.callsign, addr: me.addr, port: me.port, fp: me.fp, maxGB: me.maxGB, ready: !!(me.callsign && me.addr) },
    peers: peers.map(pubPeer),
    messages: list.map(({ peer, ...m }) => m),
    transfers: transfers.filter((t) => tids.has(t.id) || (p && t.peer === p.id && ['queued', 'sending', 'receiving'].includes(t.state))).map(pubTransfer),
    filesFolder: await filesDirOk(),
    console: await consoleData(p),
    invite: invites.filter((i) => i.expires > Date.now()).map((i) => ({ code: i.code, expires: i.expires })).pop() || null,
  });
});

async function readMem() { try { const t = await fsp.readFile('/proc/meminfo', 'utf8'); const g = (k) => { const m = t.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')); return m ? +m[1] * 1024 : null; }; return { total: g('MemTotal'), avail: g('MemAvailable') }; } catch { return { total: os.totalmem(), avail: os.freemem() }; } }
async function diskOf(dir) { try { const s = await fsp.statfs(dir); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return null; } }
async function consoleData(p) {
  const filesOk = await filesDirOk();
  const mem = await readMem();
  return {
    now: Date.now(), tz: me.tz || TZ,
    host: { cpu: cpuPct, cores: os.cpus().length, load: os.loadavg().map((x) => Math.round(x * 100) / 100), mem, uptime: Math.round(os.uptime()), disk: await diskOf(filesOk ? FILES_DIR : DATA_DIR) },
    traffic: traffic.slice(-60).map(([, o, i]) => [o, i]),
    stats: { ...stats },
    queue: { msgs: msgs.filter((m) => m.state === 'queued').length, files: transfers.filter((t) => t.dir === 'out' && ['queued', 'sending'].includes(t.state)).length, bytes: transfers.filter((t) => t.dir === 'out' && ['queued', 'sending'].includes(t.state)).reduce((a, t) => a + (t.size - (t.done || 0)), 0) },
    peer: p ? { tz: p.tz || '', v: p.v || '', rtts: (p.rtts || []).map((x) => x[1]), onlineSince: p.onlineSince || 0, pairedAt: p.pairedAt || 0, fp: p.id, safety: S.safetyNumber(me.x, p.x) } : null,
    crypto: 'X25519 · AES-256-GCM over WireGuard',
  };
}

app.post('/api/read', (req, res) => { const p = peerById(String((req.body || {}).peer || '')); if (p && p.unread) { p.unread = 0; savePeers(); } res.json({ ok: true }); });

app.post('/api/settings', (req, res) => {
  const b = req.body || {};
  if (b.callsign != null) { const c = cleanName(b.callsign, 24); if (!c) return bad(res, 'Give your station a name or callsign.'); me.callsign = c; }
  if (b.addr != null) { const a = cleanAddr(b.addr); if (!a) return bad(res, 'That address does not look right. Use the 100.x.x.x address or the name shown in your Tailscale app.'); me.addr = a; }
  if (b.port != null) me.port = cleanPort(b.port);
  if (b.tz != null) { try { new Intl.DateTimeFormat('en-US', { timeZone: String(b.tz) }); me.tz = String(b.tz).slice(0, 60); } catch { return bad(res, 'Unknown time zone.'); } }
  if (b.maxGB != null) { const g = Number(b.maxGB); if (!(g >= 1 && g <= 10000)) return bad(res, 'The size limit must be between 1 and 10000 GB.'); me.maxGB = Math.round(g); }
  saveMe(); for (const p of peers) p.lastPing = 0;
  res.json({ ok: true });
});

app.post('/api/invite', (req, res) => {
  if (!me.callsign || !me.addr) return bad(res, 'Set your station name and Tailscale address first.');
  const token = rid(18);
  const code = 'UPLINK1.' + Buffer.from(JSON.stringify({ a: me.addr, p: me.port, k: me.x, t: token, n: me.callsign })).toString('base64url');
  invites = invites.filter((i) => i.expires > Date.now()).slice(-4);
  invites.push({ token, code, expires: Date.now() + 48 * 3600e3 }); saveInvites();
  res.json({ code, expires: Date.now() + 48 * 3600e3 });
});

app.post('/api/link', async (req, res) => {
  if (!me.callsign || !me.addr) return bad(res, 'Set your station name and Tailscale address first.');
  const raw = String((req.body || {}).code || '').trim().replace(/\s+/g, '');
  let inv;
  try { if (!raw.startsWith('UPLINK1.')) throw 0; inv = JSON.parse(Buffer.from(raw.slice(8), 'base64url').toString()); } catch { return bad(res, 'That is not an Uplink invite code. Copy the whole code, starting with UPLINK1.'); }
  if (!S.validPub(inv.k) || !cleanAddr(inv.a)) return bad(res, 'That invite code is damaged. Ask for a new one.');
  if (inv.k === me.x) return bad(res, 'That is this station\'s own invite code. Send it to the other station instead.');
  const existing = peerByX(inv.k);
  const p = existing || { id: S.fingerprint(inv.k), x: inv.k, pairedAt: Date.now() };
  p.addr = cleanAddr(inv.a); p.port = cleanPort(inv.p); p.name = cleanName(inv.n) || 'Station ' + p.id.slice(0, 4);
  p.pending = true;
  try {
    const r = await rpc(p, { type: 'pair', token: String(inv.t || ''), name: me.callsign, addr: me.addr, port: me.port }, null, 20000);
    delete p.pending;
    p.name = cleanName(r.name) || p.name;
    if (!existing) peers.push(p);
    markOnline(p, true); savePeers();
    sysNote(p, `Linked with ${p.name}.`);
    res.json({ ok: true, peer: p.id });
  } catch (e) {
    delete p.pending;
    const n = netErr(e);
    bad(res, e.remote ? e.message : `Could not reach ${p.name} at ${p.addr}: ${n.message}. Check that both Umbrels are on Tailscale and that Uplink is running on theirs.`);
  }
});

app.post('/api/send', (req, res) => {
  const p = peerById(String((req.body || {}).peer || '')); if (!p) return bad(res, 'Pick a station first.');
  const text = String((req.body || {}).text || '').slice(0, 8000);
  if (!text.trim()) return bad(res, 'Type a message first.');
  const m = { id: rid(12), peer: p.id, dir: 'out', kind: 'text', text, ts: Date.now(), state: 'queued' };
  msgs.push(m); saveMsgs(); p.nextTry = 0; deliver(p);
  res.json({ ok: true, id: m.id });
});

app.put('/api/upload', async (req, res) => {
  if (req.get('X-AG') !== '1') return bad(res, 'Missing header.', 403);
  const p = peerById(String(req.query.peer || '')); if (!p) return bad(res, 'Pick a station first.');
  const name = safeFileName(decodeURIComponent(String(req.query.name || 'file')));
  const len = parseInt(req.get('content-length') || '-1', 10);
  const free = await freeBytes(DATA_DIR);
  if (len > 0 && free != null && free < len + 2e9) return bad(res, 'Not enough free space on this Umbrel to stage that file.');
  const id = rid(9), fid = rid(12), dest = path.join(DATA_DIR, 'outgoing', fid);
  const h = crypto.createHash('sha256'); let size = 0;
  try {
    const ws = fs.createWriteStream(dest + '.part');
    req.on('data', (c) => { h.update(c); size += c.length; });
    await pipeline(req, ws);
    await fsp.rename(dest + '.part', dest);
  } catch (e) { await fsp.rm(dest + '.part', { force: true }); return bad(res, 'The upload was interrupted.'); }
  const t = { id, fid, peer: p.id, dir: 'out', name, size, sha: h.digest('hex'), done: 0, state: 'queued', path: dest, at: Date.now() };
  transfers.push(t); saveTransfers();
  msgs.push({ id: 'f' + id, peer: p.id, dir: 'out', kind: 'file', tid: id, ts: Date.now() }); saveMsgs();
  p.nextTry = 0; deliver(p);
  res.json({ ok: true, id });
});

app.post('/api/transfer/cancel', async (req, res) => {
  const t = transfers.find((x) => x.id === String((req.body || {}).id || '')); if (!t) return bad(res, 'No such transfer.');
  if (t.dir === 'out') {
    if (t.state === 'sending') t.cancel = true;
    else if (t.state === 'queued') { t.state = 'cancelled'; await fsp.rm(t.path || '', { force: true }).catch(() => {}); const p = peerById(t.peer); if (p) rpc(p, { type: 'cancel', fid: t.fid }).catch(() => {}); }
  } else if (t.state === 'receiving') { t.state = 'cancelled'; if (t.part) await fsp.rm(t.part, { force: true }); }
  saveTransfers(); res.json({ ok: true });
});

app.post('/api/peer/update', (req, res) => {
  const b = req.body || {}; const p = peerById(String(b.id || '')); if (!p) return bad(res, 'No such station.');
  if (b.addr != null) { const a = cleanAddr(b.addr); if (!a) return bad(res, 'That address does not look right.'); p.addr = a; }
  if (b.port != null) p.port = cleanPort(b.port);
  p.nextTry = 0; p.lastPing = 0; savePeers(); res.json({ ok: true });
});

app.post('/api/peer/remove', async (req, res) => {
  const p = peerById(String((req.body || {}).id || '')); if (!p) return bad(res, 'No such station.');
  await rpc(p, { type: 'unlink' }, null, 8000).catch(() => {});
  peers = peers.filter((x) => x !== p); savePeers();
  for (const t of transfers.filter((x) => x.peer === p.id && ['queued', 'sending'].includes(x.state))) { t.state = 'cancelled'; if (t.path) fsp.rm(t.path, { force: true }).catch(() => {}); }
  saveTransfers(); res.json({ ok: true });
});

app.post('/api/messages/clear', (req, res) => {
  const p = peerById(String((req.body || {}).peer || '')); if (!p) return bad(res, 'No such station.');
  msgs = msgs.filter((m) => m.peer !== p.id || m.state === 'queued'); saveMsgs(); res.json({ ok: true });
});

app.get('/api/file/:id', (req, res) => {
  const t = transfers.find((x) => x.id === req.params.id && x.dir === 'in' && x.state === 'done' && x.path);
  if (!t || !fs.existsSync(t.path)) return res.status(404).json({ error: 'That file is no longer there.' });
  res.download(t.path, t.name);
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));
async function reapStale() {
  const now = Date.now();
  for (const t of transfers.filter((x) => x.dir === 'in' && x.state === 'receiving' && x.part)) {
    const st = await fsp.stat(t.part).catch(() => null);
    if (!st || now - st.mtimeMs > STALE_PART_MS) { if (st) await fsp.rm(t.part, { force: true }); t.state = 'failed'; t.err = 'Stopped arriving, so the partial copy was removed.'; delete t.part; }
  }
  const known = new Set(transfers.filter((x) => x.part).map((x) => path.basename(x.part)));
  for (const n of await fsp.readdir(path.join(DATA_DIR, 'incoming')).catch(() => [])) {
    if (known.has(n)) continue;
    const p = path.join(DATA_DIR, 'incoming', n); const st = await fsp.stat(p).catch(() => null);
    if (st && now - st.mtimeMs > STALE_PART_MS) await fsp.rm(p, { force: true });
  }
  saveTransfers();
}
setTimeout(reapStale, 30000).unref(); setInterval(reapStale, 6 * 3600e3).unref();

function flush() { for (const n of Object.keys(timers)) { clearTimeout(timers[n]); delete timers[n]; } save('identity.json', (({ fp, ...r }) => r)(me), true); save('peers.json', peers.map(({ online, rtt, busy, nextTry, fails, lastErr, pending, lastPing, rtts, onlineSince, bootHiT, rate, ...p }) => p), true); trimMsgs(); save('messages.json', msgs, true); saveTransfers(true); save('invites.json', invites, true); }
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { flush(); process.exit(0); });
app.listen(PORT, () => console.log(`Uplink ${VERSION} on :${PORT} (station ${me.fp})`));
