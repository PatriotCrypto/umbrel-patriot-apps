'use strict';
// Verify: for each of the 66 books, fetch the inscription's transaction from Bitcoin, decode the
// content ourselves, and compare it with the copy this app was built from (SHA-256 of the exact bytes),
// and with the text the reader shows.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractInscription } = require('./envelope');
const { parseInscribedBook, toChapters } = require('./inscribed');

const TIMEOUT_MS = 25000;

async function httpJson(url, { headers, body } = {}) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function fetchTx(cfg, txid) {
  if (cfg.mode === 'rpc') {
    const auth = Buffer.from(`${cfg.rpcUser}:${cfg.rpcPass}`).toString('base64');
    const r = await httpJson(cfg.rpcUrl, {
      headers: { authorization: 'Basic ' + auth },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'bt', method: 'getrawtransaction', params: [txid, true] }),
    });
    if (r.status === 401) throw new Error('your Bitcoin node rejected the username or password');
    if (r.json && r.json.error) {
      const msg = r.json.error.message || 'node error';
      if (/No such mempool or blockchain transaction/i.test(msg)) throw new Error('your node does not have this transaction indexed (it needs txindex=1)');
      throw new Error(msg);
    }
    if (!r.json || !r.json.result) throw new Error('unexpected reply from the Bitcoin node (HTTP ' + r.status + ')');
    return r.json.result;
  }
  const base = (cfg.mode === 'rest' ? cfg.restUrl : 'https://mempool.space/api').replace(/\/$/, '');
  const r = await httpJson(`${base}/tx/${txid}`);
  if (r.status === 404) throw new Error('transaction not found at that explorer');
  if (r.status !== 200 || !r.json) throw new Error('explorer replied HTTP ' + r.status);
  return r.json;
}

function describeSource(cfg) {
  if (cfg.mode === 'rpc') return 'your Bitcoin node (RPC)';
  if (cfg.mode === 'rest') return 'your explorer (' + new URL(cfg.restUrl).host + ')';
  return 'public explorer (mempool.space)';
}

class Verifier {
  constructor({ dataDir, appDataDir, getSettings }) {
    this.onchain = JSON.parse(fs.readFileSync(path.join(appDataDir, 'onchain.json'), 'utf8'));
    this.kjvPath = path.join(appDataDir, 'kjv.json');
    this.lastFile = path.join(dataDir, 'verify-last.json');
    this.getSettings = getSettings;
    this.job = null;
    try { this.last = JSON.parse(fs.readFileSync(this.lastFile, 'utf8')); } catch { this.last = null; }
  }

  status() {
    if (this.job) return this.snapshot(this.job);
    return this.last ? this.snapshot(this.last) : { state: 'never', total: this.onchain.books.length };
  }

  snapshot(j) {
    const results = Object.values(j.results);
    return {
      state: j.state, source: j.source, startedAt: j.startedAt, finishedAt: j.finishedAt || null,
      total: this.onchain.books.length, done: results.length,
      ok: results.filter(r => r.status === 'ok').length,
      mismatch: results.filter(r => r.status === 'mismatch').length,
      error: results.filter(r => r.status === 'error').length,
      results: j.results,
    };
  }

  start() {
    if (this.job && this.job.state === 'running') return this.snapshot(this.job);
    const cfg = { ...this.getSettings().verify };
    const kjv = JSON.parse(fs.readFileSync(this.kjvPath, 'utf8')).books;
    const job = this.job = { state: 'running', source: describeSource(cfg), startedAt: Date.now(), results: {} };
    const queue = [...this.onchain.books];
    const worker = async () => {
      while (queue.length) {
        const b = queue.shift();
        job.results[b.id] = await this.checkBook(cfg, b, kjv[b.id]);
      }
    };
    Promise.all([worker(), worker(), worker()]).then(() => {
      job.state = 'done'; job.finishedAt = Date.now();
      this.last = { ...job };
      try { fs.writeFileSync(this.lastFile, JSON.stringify(this.last)); } catch { /* ignore */ }
      this.job = null;
    }).catch(e => { job.state = 'failed'; job.error = e.message; this.job = null; });
    return this.snapshot(job);
  }

  async checkBook(cfg, b, bundled) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const tx = await fetchTx(cfg, b.txid);
        if (tx.txid && tx.txid !== b.txid) throw new Error('the source returned a different transaction');
        const insc = extractInscription(tx);
        if (!insc) return { status: 'error', note: 'no inscription found in that transaction' };
        const sha = crypto.createHash('sha256').update(insc.content).digest('hex');
        const bytesOk = sha === b.sha256 && insc.content.length === b.bytes;
        let textOk = false;
        try {
          const { verses } = parseInscribedBook(insc.content.toString('utf8'), b.id);
          const { chapters } = toChapters(verses, b.id);
          textOk = JSON.stringify(chapters) === JSON.stringify(bundled);
        } catch { textOk = false; }
        if (bytesOk && textOk) return { status: 'ok', bytes: insc.content.length };
        return {
          status: 'mismatch', bytes: insc.content.length,
          note: !bytesOk ? 'the inscription on the chain is not the same as the copy this app was built from' : 'the reader text does not match the inscription',
        };
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
    return { status: 'error', note: String(lastErr && lastErr.message || lastErr).slice(0, 200) };
  }
}

module.exports = { Verifier, fetchTx, describeSource };
