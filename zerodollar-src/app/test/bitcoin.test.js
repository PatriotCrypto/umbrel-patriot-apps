import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { pbkdf2Sync } from 'node:crypto';
import { HDKey } from '@scure/bip32';
import { classifyInput, deriveAddress, lookupAddress, scanXpub, fetchPrice, normalizeApi } from '../lib/bitcoin.js';

// Public BIP39/BIP84/BIP49 test vectors (the well-known "abandon ... about" mnemonic). No real funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const YPUB = 'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP';
const R0 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const C0 = 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el';
const Y0 = '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf';

function independentXpub(purpose, versionPublic) {
  const seed = pbkdf2Sync(MNEMONIC, 'mnemonic', 2048, 64, 'sha512');
  const a = HDKey.fromMasterSeed(seed).derive(`m/${purpose}'/0'/0'`);
  return new HDKey({ versions: { private: 0, public: versionPublic }, depth: a.depth, parentFingerprint: a.parentFingerprint, index: a.index, chainCode: a.chainCode, publicKey: a.publicKey }).publicExtendedKey;
}

test('vectors: zpub/ypub match keys derived independently from the mnemonic', () => {
  assert.equal(independentXpub(84, 0x04b24746), ZPUB);
  assert.equal(independentXpub(49, 0x049d7cb2), YPUB);
});

test('deriveAddress matches BIP84 and BIP49 vectors', () => {
  assert.equal(deriveAddress(ZPUB, 'wpkh', 0, 0), R0);
  assert.equal(deriveAddress(ZPUB, 'wpkh', 1, 0), C0);
  assert.equal(deriveAddress(YPUB, 'sh-wpkh', 0, 0), Y0);
});

test('deriveAddress pkh produces a 1... address', () => {
  assert.match(deriveAddress(independentXpub(44, 0x0488b21e), 'pkh', 0, 0), /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/);
});

// ---- mock mempool API ----
const stat = (funded, spent, txs, mf = 0, ms = 0, mtx = 0) => ({
  chain_stats: { funded_txo_sum: funded, spent_txo_sum: spent, tx_count: txs },
  mempool_stats: { funded_txo_sum: mf, spent_txo_sum: ms, tx_count: mtx },
});
async function startMock(table, { status = 200, delayMs = 0 } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const go = () => {
      if (status !== 200) { res.writeHead(status); return res.end('nope'); }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/prices') return res.end(JSON.stringify({ time: 1700000000, USD: 65000, EUR: 60000 }));
      const m = req.url.match(/^\/address\/([^/?]+)$/);
      if (m) return res.end(JSON.stringify(table[m[1]] || stat(0, 0, 0)));
      res.writeHead(404); res.end('{}');
    };
    delayMs ? setTimeout(go, delayMs) : go();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { api: `http://127.0.0.1:${server.address().port}`, hits, close: () => { server.closeAllConnections?.(); return new Promise((r) => server.close(r)); } };
}
const addrHits = (m) => m.hits.filter((u) => u.startsWith('/address/'));

const table = () => ({
  [deriveAddress(ZPUB, 'wpkh', 0, 0)]: stat(100000, 0, 1),
  [deriveAddress(ZPUB, 'wpkh', 0, 3)]: stat(50000, 20000, 2),
  [deriveAddress(ZPUB, 'wpkh', 1, 1)]: stat(7000, 0, 1, 1000, 0, 1),
});

test('scanXpub totals and used', async () => {
  const m = await startMock(table());
  try {
    const r = await scanXpub(m.api, ZPUB, 'wpkh');
    assert.deepEqual(r, { confirmed: 100000 + 30000 + 7000, pending: 1000, txCount: 1 + 2 + 2, used: 3, checked: 46 });
  } finally { await m.close(); }
});

test('scanXpub gap limit stops scanning', async () => {
  const m = await startMock(table());
  try {
    await scanXpub(m.api, ZPUB, 'wpkh', { gap: 5 });
    const urls = addrHits(m);
    // chain 0: last used index 3, gap 5 -> stops after index 8 (9 addrs, batches of 2 => 10 requests)
    // chain 1: last used index 1 -> stops after index 6 (7 addrs => 8 requests)
    assert.equal(urls.length, 18);
    const never = deriveAddress(ZPUB, 'wpkh', 0, 40);
    assert.ok(!urls.some((u) => u.endsWith(never)));
  } finally { await m.close(); }
});

test('scanXpub with default gap scans a bounded number of addresses and honors maxPerChain', async () => {
  const m = await startMock({});
  try {
    const r = await scanXpub(m.api, ZPUB, 'wpkh');
    assert.deepEqual(r, { confirmed: 0, pending: 0, txCount: 0, used: 0, checked: 40 });
    assert.equal(addrHits(m).length, 40);
    m.hits.length = 0;
    await scanXpub(m.api, ZPUB, 'wpkh', { gap: 1000, maxPerChain: 7 });
    assert.equal(addrHits(m).length, 14);
  } finally { await m.close(); }
});

test('lookupAddress numbers', async () => {
  const t = table();
  const m = await startMock(t);
  try {
    assert.deepEqual(await lookupAddress(m.api, deriveAddress(ZPUB, 'wpkh', 0, 3)), { confirmed: 30000, pending: 0, txCount: 2 });
    assert.deepEqual(await lookupAddress(m.api, deriveAddress(ZPUB, 'wpkh', 1, 1)), { confirmed: 7000, pending: 1000, txCount: 2 });
    assert.deepEqual(await lookupAddress(m.api, R0), { confirmed: 100000, pending: 0, txCount: 1 });
    assert.deepEqual(await lookupAddress(m.api, C0), { confirmed: 0, pending: 0, txCount: 0 });
  } finally { await m.close(); }
});

test('fetchPrice returns the price object', async () => {
  const m = await startMock({});
  try {
    assert.deepEqual(await fetchPrice(m.api), { time: 1700000000, USD: 65000, EUR: 60000 });
  } finally { await m.close(); }
});

test('opts.fetch is used when injected', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push([url, init]);
    return { ok: true, json: async () => (url.endsWith('/v1/prices') ? { USD: 1 } : stat(5, 1, 1)) };
  };
  assert.deepEqual(await lookupAddress('http://x.test', R0, { fetch: fake }), { confirmed: 4, pending: 0, txCount: 1 });
  assert.deepEqual(await fetchPrice('http://x.test', { fetch: fake }), { USD: 1 });
  assert.equal(calls[0][0], `http://x.test/address/${R0}`);
  assert.ok(calls[0][1].signal);
});

test('HTTP 500 and network errors throw plain errors', async () => {
  const m = await startMock({}, { status: 500 });
  try {
    await assert.rejects(lookupAddress(m.api, R0, { retryDelayMs: 0 }), /HTTP 500/);
    await assert.rejects(fetchPrice(m.api), /HTTP 500/);
    await assert.rejects(scanXpub(m.api, ZPUB, 'wpkh', { retryDelayMs: 0 }), /HTTP 500/);
  } finally { await m.close(); }
  await assert.rejects(lookupAddress(m.api, R0, { retryDelayMs: 0 }), /Bitcoin API request failed/);
});

test('timeout aborts a hung request', async () => {
  const hanging = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const p = assert.rejects(fetchPrice('http://x.test', { fetch: hanging }), /timed out/);
    mock.timers.tick(15000);
    await p;
  } finally { mock.timers.reset(); }
});

test('address lookups retry once after a timeout or a 5xx, then give up', async () => {
  let n = 0;
  const flaky = async () => { n++; if (n === 1) return { ok: false, status: 504, json: async () => ({}) }; return { ok: true, json: async () => ({ chain_stats: { funded_txo_sum: 9, spent_txo_sum: 2, tx_count: 1 } }) }; };
  assert.equal((await lookupAddress('http://x/api', R0, { fetch: flaky, retryDelayMs: 0 })).confirmed, 7);
  assert.equal(n, 2);
  let k = 0;
  const down = async () => { k++; return { ok: false, status: 504, json: async () => ({}) }; };
  await assert.rejects(lookupAddress('http://x/api', R0, { fetch: down, retryDelayMs: 0 }), /HTTP 504.*busy or still starting/);
  assert.equal(k, 2);
  let q = 0;
  const notFound = async () => { q++; return { ok: false, status: 404, json: async () => ({}) }; };
  await assert.rejects(lookupAddress('http://x/api', R0, { fetch: notFound, retryDelayMs: 0 }), /HTTP 404.*\/api/);
  assert.equal(q, 1);
});

test('scanXpub looks up addresses in small batches and says how far it got when it fails', async () => {
  let inflight = 0, peak = 0, calls = 0;
  const f = async () => {
    calls++; inflight++; peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 2));
    inflight--;
    if (calls > 4) return { ok: false, status: 504, json: async () => ({}) };
    return { ok: true, json: async () => ({ chain_stats: { tx_count: 0 } }) };
  };
  await assert.rejects(scanXpub('http://x/api', ZPUB, 'wpkh', { fetch: f, retryDelayMs: 0 }), /4 addresses were checked/);
  assert.ok(peak <= 2, `peak concurrency ${peak}`);
});

test('normalizeApi', () => {
  assert.equal(normalizeApi('  https://mempool.space/api/// '), 'https://mempool.space/api');
  assert.equal(normalizeApi('http://umbrel.local:3006/api'), 'http://umbrel.local:3006/api');
  for (const bad of ['', 'ftp://x.test', 'javascript:alert(1)', 'mempool.space', null]) {
    assert.throws(() => normalizeApi(bad), (e) => e.status === 400);
  }
});

test('classifyInput accepts addresses and public keys', () => {
  assert.deepEqual(classifyInput(`  ${R0}\n`), { kind: 'address', value: R0 });
  assert.deepEqual(classifyInput(Y0), { kind: 'address', value: Y0 });
  assert.equal(classifyInput('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').kind, 'address');
  assert.deepEqual(classifyInput(ZPUB), { kind: 'xpub', value: ZPUB, script: 'wpkh' });
  assert.equal(classifyInput(` ${YPUB} `).script, 'sh-wpkh');
  assert.equal(classifyInput(independentXpub(44, 0x0488b21e)).script, 'pkh');
});

test('classifyInput rejects private keys, seeds, and garbage with status 400', () => {
  const xprv = 'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi';
  const zprv = 'zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5';
  const wif = '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ';
  const wifC = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn';
  for (const bad of [xprv, zprv, 'yprv' + 'a'.repeat(107), wif, wifC]) {
    assert.throws(() => classifyInput(bad), (e) => e.status === 400 && /private key/i.test(e.message) && /never/i.test(e.message), bad);
  }
  assert.throws(() => classifyInput(MNEMONIC), (e) => e.status === 400 && /seed phrase/i.test(e.message) && /never/i.test(e.message));
  assert.throws(() => classifyInput(MNEMONIC + ' ' + MNEMONIC), (e) => e.status === 400); // 24 words
  for (const bad of ['', '   ', 'hello', 'bc1qzzzz', ZPUB.slice(0, -3), '1234', null, undefined]) {
    assert.throws(() => classifyInput(bad), (e) => e.status === 400 && e.message.length > 5, String(bad));
  }
});

test('api address: a bare address gets /api added, a full one is kept', () => {
  assert.equal(normalizeApi('http://192.168.1.50:3006'), 'http://192.168.1.50:3006/api');
  assert.equal(normalizeApi('http://192.168.1.50:3006/'), 'http://192.168.1.50:3006/api');
  assert.equal(normalizeApi('http://192.168.1.50:3006/api'), 'http://192.168.1.50:3006/api');
  assert.equal(normalizeApi('https://mempool.space/api/'), 'https://mempool.space/api');
});

test('lookup errors say what to fix', async () => {
  const html = async () => ({ ok: true, text: async () => '<!doctype html><html></html>' });
  await assert.rejects(() => lookupAddress('http://x:3006', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', { fetch: html }), /web page.*\/api/);
  const dns = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; };
  await assert.rejects(() => lookupAddress('http://umbrel.local:3006/api', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', { fetch: dns }), /\.local.*IP address/);
  const refused = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; };
  await assert.rejects(() => lookupAddress('http://1.2.3.4:3006/api', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', { fetch: refused }), /refused.*port/);
  const good = async () => ({ ok: true, text: async () => JSON.stringify({ chain_stats: { funded_txo_sum: 5, spent_txo_sum: 1, tx_count: 1 }, mempool_stats: {} }) });
  assert.equal((await lookupAddress('http://x/api', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', { fetch: good })).confirmed, 4);
});
