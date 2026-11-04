// Direct Electrum-protocol lookups against the Electrs app (the standard wallet backend on Umbrel).
// Read-only and plain: newline-delimited JSON-RPC over TCP. Only public data (script hashes) is sent.
import net from 'node:net';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { bech32, bech32m, createBase58check } from '@scure/base';
import { deriveAddress } from './bitcoin.js';

const b58c = createBase58check(sha256);

function bad(message) { const e = new Error(message); e.status = 400; return e; }

// "192.168.1.50:50001", "192.168.1.50" (port defaults to 50001) or "" (off).
export function normalizeElectrs(text) {
  let s = String(text ?? '').trim().replace(/^(tcp|ssl|electrum):\/\//i, '').replace(/\/+$/, '');
  if (!s) return '';
  const m = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(s);
  if (!m) throw bad('The Electrs address should look like 192.168.1.50:50001 (the IP address of your Umbrel, then the port shown in the Electrs app).');
  const port = m[2] === undefined ? 50001 : Number(m[2]);
  if (port < 1 || port > 65535) throw bad('That port number is not valid. The Electrs app shows its port (usually 50001).');
  return `${m[1]}:${port}`;
}

export function scriptFromAddress(address) {
  const a = String(address ?? '').trim();
  if (/^bc1/i.test(a)) {
    const lower = a.toLowerCase();
    let d;
    try { d = bech32.decode(lower, 120); if (d.words[0] !== 0) d = null; } catch { d = null; }
    if (!d) { d = bech32m.decode(lower, 120); if (d.words[0] === 0) throw new Error('Invalid address'); }
    const ver = d.words[0];
    const prog = bech32.fromWords(d.words.slice(1));
    return new Uint8Array([ver === 0 ? 0 : 0x50 + ver, prog.length, ...prog]);
  }
  const p = b58c.decode(a);
  if (p.length !== 21) throw new Error('Invalid address');
  if (p[0] === 0x00) return new Uint8Array([0x76, 0xa9, 0x14, ...p.slice(1), 0x88, 0xac]);
  if (p[0] === 0x05) return new Uint8Array([0xa9, 0x14, ...p.slice(1), 0x87]);
  throw new Error('Unsupported address type');
}

export const addressToScripthash = (address) => bytesToHex(sha256(scriptFromAddress(address)).reverse());

const NET_HINT = {
  ECONNREFUSED: 'the connection was refused. Check that the Electrs app is running and the port is right (the Electrs app shows it, usually 50001)',
  ENOTFOUND: 'that address could not be found. Use the IP address of your Umbrel instead of a name like umbrel.local',
  EAI_AGAIN: 'that address could not be found. Use the IP address of your Umbrel instead of a name like umbrel.local',
  EHOSTUNREACH: 'that address cannot be reached. Check the IP address',
  ENETUNREACH: 'that address cannot be reached. Check the IP address',
  ECONNRESET: 'the connection was reset. Try again in a moment',
  ETIMEDOUT: 'the connection timed out. Check the IP address and that the Electrs app is running',
};

export class ElectrumClient {
  constructor(hostPort, { connectTimeoutMs = 10000, requestTimeoutMs = 30000, connect = net.connect } = {}) {
    const [host, port] = normalizeElectrs(hostPort).split(':');
    this.host = host; this.port = Number(port);
    this.connectTimeoutMs = connectTimeoutMs; this.requestTimeoutMs = requestTimeoutMs;
    this._connect = connect;
    this.id = 0; this.pending = new Map(); this.buf = ''; this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const sock = this._connect({ host: this.host, port: this.port });
      this.sock = sock;
      const timer = setTimeout(() => { sock.destroy(); reject(this._err('the connection timed out. Check the IP address and that the Electrs app is running')); }, this.connectTimeoutMs);
      sock.setEncoding('utf8');
      sock.once('connect', () => { clearTimeout(timer); resolve(); });
      sock.once('error', (e) => { clearTimeout(timer); reject(this._err(NET_HINT[e.code] || e.message)); });
    });
    this.sock.on('data', (chunk) => this._data(chunk));
    this.sock.on('error', (e) => this._fail(this._err(NET_HINT[e.code] || e.message)));
    this.sock.on('close', () => this._fail(this._err('the connection was closed by Electrs')));
    await this.request('server.version', ['ZeroDollar', '1.4']);
  }

  _err(msg) { return new Error(`Could not use Electrs at ${this.host}:${this.port}: ${msg}`); }

  _data(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(this._err(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }

  _fail(err) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
    this.closed = true;
  }

  request(method, params = []) {
    if (this.closed) return Promise.reject(this._err('the connection is closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const e = this._err(`no answer after ${Math.round(this.requestTimeoutMs / 1000)} seconds. Electrs may still be catching up. Try again in a few minutes`);
        reject(e);
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.sock.write(JSON.stringify({ id, jsonrpc: '2.0', method, params }) + '\n');
    });
  }

  close() { this.closed = true; try { this.sock?.destroy(); } catch { /* already closed */ } }
}

export async function openElectrum(hostPort, opts) {
  const c = new ElectrumClient(hostPort, opts);
  await c.open();
  return c;
}

export async function electrumLookup(client, address) {
  const sh = addressToScripthash(address);
  const [hist, bal] = await Promise.all([
    client.request('blockchain.scripthash.get_history', [sh]),
    client.request('blockchain.scripthash.get_balance', [sh]),
  ]);
  return { confirmed: bal.confirmed || 0, pending: bal.unconfirmed || 0, txCount: Array.isArray(hist) ? hist.length : 0 };
}

export async function scanXpubElectrum(client, xpub, script, { gap = 20, maxPerChain = 400, batch = 10, onProgress } = {}) {
  let confirmed = 0, pending = 0, txCount = 0, used = 0, checked = 0;
  for (const chain of [0, 1]) {
    let i = 0, run = 0;
    while (run < gap && i < maxPerChain) {
      const n = Math.min(batch, maxPerChain - i);
      const addrs = Array.from({ length: n }, (_, k) => deriveAddress(xpub, script, chain, i + k));
      let res;
      try {
        res = await Promise.all(addrs.map((a) => electrumLookup(client, a)));
      } catch (e) {
        if (checked) e.message += ` (${checked} address${checked === 1 ? '' : 'es'} were checked before this)`;
        throw e;
      }
      for (const r of res) {
        i++; checked++;
        if (r.txCount > 0) { run = 0; used++; confirmed += r.confirmed; pending += r.pending; txCount += r.txCount; } else run++;
      }
      if (onProgress) onProgress({ checked, used });
    }
  }
  return { confirmed, pending, txCount, used, checked };
}
