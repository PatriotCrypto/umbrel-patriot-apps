import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveAddress } from '../lib/bitcoin.js';
import { addressToScripthash, normalizeElectrs, openElectrum, electrumLookup, scanXpubElectrum } from '../lib/electrum.js';
import { createApp } from '../server.js';

// Public BIP84 test-vector key (the well-known "abandon ... about" mnemonic). No real funds.
const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

test('script hashes match values computed independently (including the well-known Satoshi vector)', () => {
  assert.equal(addressToScripthash('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), '8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161');
  assert.equal(addressToScripthash('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'), 'abe51e78fc13a23889f49922cb5917b9c5f2a8f66122aea0d728524f1493d133');
  assert.equal(addressToScripthash('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'), '6e4f16236139f15046b38f399a683fb2aa8edf5fd128b3e5db017fb0ac74078a');
  assert.equal(addressToScripthash('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'), 'a4215acda4621d8290b4903f3e497d32a2559a85360eba3daf8a29f6e0a824d5');
});

test('normalizeElectrs', () => {
  assert.equal(normalizeElectrs(''), '');
  assert.equal(normalizeElectrs('  192.168.1.50  '), '192.168.1.50:50001');
  assert.equal(normalizeElectrs('tcp://192.168.1.50:50002/'), '192.168.1.50:50002');
  assert.throws(() => normalizeElectrs('http://x y'), /Electrs address/);
  assert.throws(() => normalizeElectrs('1.2.3.4:99999'), /port/);
});

// A tiny fake Electrs: answers server.version, get_history and get_balance from a table keyed by script hash.
function fakeElectrs(table, { silent = false } = {}) {
  const log = [];
  const server = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        const { id, method, params } = JSON.parse(line);
        log.push(method);
        const e = table[params?.[0]];
        let result;
        if (method === 'server.version') result = ['fake', '1.4'];
        else if (silent) continue;
        else if (method === 'blockchain.scripthash.get_history') result = e ? e.history : [];
        else if (method === 'blockchain.scripthash.get_balance') result = e ? e.balance : { confirmed: 0, unconfirmed: 0 };
        else { sock.write(JSON.stringify({ id, error: { code: 1, message: 'unknown method' } }) + '\n'); continue; }
        sock.write(JSON.stringify({ id, result }) + '\n');
      }
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ addr: `127.0.0.1:${server.address().port}`, log, close: () => server.close() })));
}

const tx = (n) => Array.from({ length: n }, (_, i) => ({ tx_hash: 'ab'.repeat(32), height: 900000 + i }));
const sh = (chain, i) => addressToScripthash(deriveAddress(ZPUB, 'wpkh', chain, i));
const wallet = () => ({
  [sh(0, 0)]: { history: tx(1), balance: { confirmed: 100000, unconfirmed: 0 } },
  [sh(0, 3)]: { history: tx(2), balance: { confirmed: 30000, unconfirmed: 0 } },
  [sh(1, 1)]: { history: tx(2), balance: { confirmed: 7000, unconfirmed: 1000 } },
});

test('direct Electrs: lookup, xpub scan with gap limit, progress', async () => {
  const f = await fakeElectrs(wallet());
  try {
    const c = await openElectrum(f.addr);
    const one = await electrumLookup(c, deriveAddress(ZPUB, 'wpkh', 0, 3));
    assert.deepEqual(one, { confirmed: 30000, pending: 0, txCount: 2 });
    const seen = [];
    const r = await scanXpubElectrum(c, ZPUB, 'wpkh', { gap: 5, onProgress: (p) => seen.push(p.checked) });
    assert.deepEqual(r, { confirmed: 137000, pending: 1000, txCount: 5, used: 3, checked: r.checked });
    assert.ok(r.checked >= 14 && r.checked <= 30, `checked ${r.checked}`);
    assert.ok(seen.length >= 2 && seen.at(-1) === r.checked);
    c.close();
  } finally { f.close(); }
});

test('direct Electrs: friendly errors for a closed port and a silent server', async () => {
  const dead = net.createServer(); await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const port = dead.address().port; await new Promise((r) => dead.close(r));
  await assert.rejects(openElectrum(`127.0.0.1:${port}`), /Could not use Electrs at 127\.0\.0\.1:\d+: the connection was refused.*Electrs app is running/);
  const f = await fakeElectrs({}, { silent: true });
  try {
    const c = await openElectrum(f.addr, { requestTimeoutMs: 150 });
    await assert.rejects(electrumLookup(c, '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), /no answer after/);
    c.close();
  } finally { f.close(); }
});

test('refresh through the app uses Electrs when an address is set, and the Mempool address for the price', async () => {
  const f = await fakeElectrs(wallet());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-el-'));
  const { app } = createApp({ dataDir: dir, publicDir: dir });
  app.locals.fetch = async (url) => {
    if (String(url).endsWith('/v1/prices')) return { ok: true, status: 200, json: async () => ({ USD: 50000 }) };
    throw new Error('Mempool address lookups must not be used when Electrs is set');
  };
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json() }; };
  try {
    assert.equal((await call('PUT', '/settings', { btcElectrs: 'not a host' })).status, 400);
    assert.equal((await call('PUT', '/settings', { btcElectrs: f.addr })).status, 200);
    assert.equal((await call('GET', '/btc')).body.electrs, f.addr);
    await call('POST', '/btc/wallets', { name: 'Trezor', input: ZPUB });
    const r = await call('POST', '/btc/refresh');
    assert.equal(r.status, 200);
    assert.equal(r.body.wallets[0].last.error, undefined);
    assert.equal(r.body.sats, 137000);
    assert.equal(r.body.price, 50000);
    // when Electrs cannot be reached the wallet shows a clear message and nothing is thrown
    f.close();
    const down = await call('POST', '/btc/refresh');
    assert.equal(down.status, 200);
    assert.match(down.body.wallets[0].last.error, /Could not use Electrs/);
  } finally { server.close(); f.close(); }
});
