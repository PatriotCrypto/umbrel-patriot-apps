// Bitcoin address / extended-public-key lookups against a mempool.space-style API.
// Read-only: only public data is ever handled. Private keys and seed phrases are rejected.
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { bech32, createBase58check } from '@scure/base';

export const ADDR_RE = /^(bc1[ac-hj-np-z02-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/i;
export const XPUB_RE = /^[xyz]pub[1-9A-HJ-NP-Za-km-z]{100,112}$/;
const PRV_RE = /^[xyzt]prv[1-9A-HJ-NP-Za-km-z]{100,112}$/;
const WIF_RE = /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/;
const SCRIPT_BY_PREFIX = { zpub: 'wpkh', ypub: 'sh-wpkh', xpub: 'pkh' };
const XVERS = { zpub: 0x04b24746, ypub: 0x049d7cb2, xpub: 0x0488b21e };
const b58c = createBase58check(sha256);
const hash160 = (b) => ripemd160(sha256(b));

function httpError(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function normalizeApi(url) {
  const s = String(url ?? '').trim().replace(/\/+$/, '');
  let u;
  try { u = new URL(s); } catch { throw httpError('The API address must be a full web address starting with http:// or https://.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw httpError('The API address must start with http:// or https://.');
  // A bare address such as http://192.168.1.50:3006 is the Mempool website. Its data lives under /api.
  if (u.pathname === '/' || u.pathname === '') return s + '/api';
  return s;
}

export function classifyInput(text) {
  const value = String(text ?? '').trim();
  if (!value) throw httpError('Enter a Bitcoin address or an extended public key (xpub, ypub or zpub).');
  if (PRV_RE.test(value) || WIF_RE.test(value) || /^[xyzt]prv/.test(value)) {
    throw httpError('That looks like a PRIVATE key. Never enter private keys here (or anywhere online). Use only a public address or an xpub/ypub/zpub.');
  }
  const words = value.split(/\s+/);
  if (words.length >= 12 && words.length <= 24 && words.every((w) => /^[a-z]+$/.test(w))) {
    throw httpError('That looks like a seed phrase. Never enter a seed phrase here (or anywhere online). Use only a public address or an xpub/ypub/zpub.');
  }
  if (XPUB_RE.test(value)) {
    try { HDKey.fromExtendedKey(value, { private: 0, public: XVERS[value.slice(0, 4)] }); } // verifies the checksum
    catch { throw httpError('That extended public key is not valid (check for a typo or missing characters).'); }
    return { kind: 'xpub', value, script: SCRIPT_BY_PREFIX[value.slice(0, 4)] };
  }
  if (ADDR_RE.test(value)) return { kind: 'address', value };
  throw httpError('Not a valid Bitcoin address or extended public key (xpub, ypub or zpub).');
}

export function deriveAddress(xpub, script, chain, index) {
  const k = HDKey.fromExtendedKey(xpub, { private: 0, public: XVERS[xpub.slice(0, 4)] });
  const h = hash160(k.deriveChild(chain).deriveChild(index).publicKey);
  if (script === 'wpkh') return bech32.encode('bc', [0, ...bech32.toWords(h)]);
  if (script === 'sh-wpkh') return b58c.encode(new Uint8Array([0x05, ...hash160(new Uint8Array([0x00, 0x14, ...h]))]));
  return b58c.encode(new Uint8Array([0x00, ...h]));
}

const NET_HINT = {
  ENOTFOUND: 'that address could not be found. Names ending in .local usually do not work from inside Umbrel, so use your Umbrel\'s IP address instead (for example http://192.168.1.50:3006/api)',
  EAI_AGAIN: 'that address could not be found. Use your Umbrel\'s IP address instead of a name (for example http://192.168.1.50:3006/api)',
  ECONNREFUSED: 'the connection was refused. Check that the Mempool app is running and that the port number is right',
  EHOSTUNREACH: 'that address cannot be reached from ZeroDollar. Check the IP address',
  ENETUNREACH: 'that address cannot be reached from ZeroDollar. Check the IP address',
  ECONNRESET: 'the connection was reset. Try again in a moment'
};

// Mempool answers slowly right after it starts or while Electrs is catching up, so be patient.
const ADDRESS_TIMEOUT_MS = 45000;
const PRICE_TIMEOUT_MS = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, f = globalThis.fetch, timeoutMs = PRICE_TIMEOUT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await f(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) {
      const busy = r.status >= 500;
      const err = new Error(busy
        ? `Bitcoin API returned HTTP ${r.status}. Mempool is busy or still starting up (it can take several minutes after a restart, or while Electrs catches up). Wait a minute and try again`
        : `Bitcoin API returned HTTP ${r.status}. Check the address ends with /api`);
      err.retryable = busy;
      throw err;
    }
    if (typeof r.text !== 'function') return await r.json();
    const text = await r.text();
    try { return JSON.parse(text); } catch {
      if (/^\s*</.test(text)) throw new Error('Bitcoin API address returned a web page, not Mempool data. The address should end with /api, for example http://192.168.1.50:3006/api');
      throw new Error('Bitcoin API sent something that is not Mempool data. Check the address');
    }
  } catch (e) {
    if (ac.signal.aborted) {
      const err = new Error(`Bitcoin API request timed out after ${Math.round(timeoutMs / 1000)} seconds. Mempool may still be starting up or catching up with Electrs. Check that the Mempool app is running, then try again in a few minutes`);
      err.retryable = true;
      throw err;
    }
    if (/^Bitcoin API/.test(e.message)) throw e;
    const hint = NET_HINT[e.cause?.code];
    const err = new Error(`Bitcoin API request failed: ${hint || e.cause?.message || e.message}`);
    err.retryable = e.cause?.code === 'ECONNRESET';
    throw err;
  } finally { clearTimeout(timer); }
}

export async function lookupAddress(api, address, { fetch: f = globalThis.fetch, retryDelayMs = 1500 } = {}) {
  const url = `${api}/address/${encodeURIComponent(address)}`;
  let j;
  try {
    j = await getJson(url, f, ADDRESS_TIMEOUT_MS);
  } catch (e) {
    if (!e.retryable) throw e;
    // One more try: the first request often warms Mempool and Electrs up.
    await sleep(retryDelayMs);
    j = await getJson(url, f, ADDRESS_TIMEOUT_MS);
  }
  const c = j.chain_stats || {}, m = j.mempool_stats || {};
  return {
    confirmed: (c.funded_txo_sum || 0) - (c.spent_txo_sum || 0),
    pending: (m.funded_txo_sum || 0) - (m.spent_txo_sum || 0),
    txCount: (c.tx_count || 0) + (m.tx_count || 0),
  };
}

export async function scanXpub(api, xpub, script, { fetch: f = globalThis.fetch, gap = 20, maxPerChain = 400, batch = 2, retryDelayMs = 1500 } = {}) {
  let confirmed = 0, pending = 0, txCount = 0, used = 0, checked = 0;
  for (const chain of [0, 1]) {
    let i = 0, run = 0;
    while (run < gap && i < maxPerChain) {
      const n = Math.min(batch, maxPerChain - i);
      const addrs = Array.from({ length: n }, (_, k) => deriveAddress(xpub, script, chain, i + k));
      let res;
      try {
        res = await Promise.all(addrs.map((a) => lookupAddress(api, a, { fetch: f, retryDelayMs })));
      } catch (e) {
        const done = checked;
        e.message += done ? ` (${done} address${done === 1 ? '' : 'es'} were checked before this)` : '';
        throw e;
      }
      for (const r of res) {
        i++; checked++;
        if (r.txCount > 0) { run = 0; used++; confirmed += r.confirmed; pending += r.pending; txCount += r.txCount; } else run++;
      }
    }
  }
  return { confirmed, pending, txCount, used };
}

export async function fetchPrice(api, { fetch: f = globalThis.fetch } = {}) {
  return getJson(`${api}/v1/prices`, f);
}
