import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

const ADDR = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'; // public BIP84 test-vector address

async function boot(fakeFetch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-nw-'));
  const { app } = createApp({ dataDir: dir, publicDir: dir });
  if (fakeFetch) app.locals.fetch = fakeFetch;
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (m, p, b) => {
    const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    const t = await r.text();
    let body; try { body = JSON.parse(t); } catch { body = t; }
    return { status: r.status, body };
  };
  return { call, close: () => server.close() };
}

const fakeFetch = async (url) => {
  const ok = (j) => ({ ok: true, status: 200, json: async () => j });
  if (String(url).endsWith('/v1/prices')) return ok({ time: 1, USD: 50000, EUR: 46000 });
  if (String(url).includes('/address/')) return ok({ chain_stats: { funded_txo_sum: 200000, spent_txo_sum: 50000, tx_count: 2 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } });
  return { ok: false, status: 404, json: async () => ({}) };
};

test('bitcoin wallets: validation, refresh, value', async () => {
  const { call, close } = await boot(fakeFetch);
  try {
    assert.equal((await call('POST', '/btc/wallets', { name: 'Bad', input: 'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi' })).status, 400);
    assert.equal((await call('POST', '/btc/wallets', { name: 'Seed', input: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' })).status, 400);
    const add = await call('POST', '/btc/wallets', { name: 'Cold storage', input: ADDR });
    assert.equal(add.status, 201);
    assert.equal((await call('POST', '/btc/wallets', { name: 'Dup', input: ADDR })).status, 409);
    await call('POST', '/btc/wallets', { name: 'Hardware, entered by hand', manualSats: 50000 });
    assert.equal((await call('GET', '/btc')).body.hasPrice, false);
    const r = await call('POST', '/btc/refresh');
    assert.equal(r.body.sats, 150000 + 50000);
    assert.equal(r.body.price, 50000);
    assert.equal(r.body.cents, 10000);
    // lookups can be switched off
    await call('PUT', '/settings', { btcLookups: false });
    assert.equal((await call('POST', '/btc/refresh')).status, 400);
    assert.equal((await call('PUT', '/settings', { btcApi: 'ftp://x' })).status, 400);
    assert.equal((await call('PUT', '/settings', { btcApi: 'http://192.168.1.5:3006/api/' })).body.btcApi, 'http://192.168.1.5:3006/api');
  } finally { close(); }
});

test('bitcoin errors are reported per wallet, not thrown', async () => {
  const { call, close } = await boot(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  try {
    await call('POST', '/btc/wallets', { name: 'A', input: ADDR });
    const r = await call('POST', '/btc/refresh');
    assert.equal(r.status, 200);
    assert.match(r.body.wallets[0].last.error, /500/);
    assert.ok(r.body.priceError);
  } finally { close(); }
});

test('net worth composes manual lines with accounts, bitcoin and debts without double counting', async () => {
  const { call, close } = await boot(fakeFetch);
  try {
    const meta = (await call('GET', '/meta')).body;
    await call('PATCH', '/accounts/' + meta.accounts[0].id, { openingBalance: 250000 });
    await call('POST', '/debts', { name: 'Car loan', balance: 800000, minPayment: 30000, apr: 5 });
    await call('POST', '/btc/wallets', { name: 'Stack', manualSats: 100000000 });
    await call('PUT', '/settings', { btcLookups: true });
    await call('POST', '/btc/refresh'); // price only; manual wallet has no lookup
    let nw = (await call('POST', '/networth/assets', { name: 'House', category: 'Real estate', value: 30000000 })).body;
    nw = (await call('POST', '/networth/liabilities', { name: 'Mortgage', category: 'Mortgage', owed: 20000000, rate: 3.5, payoff: '2050-01' })).body;
    // 3000000 house + 2500 checking + 1 BTC at 50k = 5,000,000 ; liabilities 200000.00 + 8000.00
    assert.equal(nw.totals.assets, 30000000 + 250000 + 5000000);
    assert.equal(nw.totals.liabilities, 20000000 + 800000);
    assert.equal(nw.totals.net, nw.totals.assets - nw.totals.liabilities);
    // toggles remove auto lines
    nw = (await call('PUT', '/networth/include', { accounts: false, bitcoin: false, debts: false })).body;
    assert.equal(nw.totals.assets, 30000000);
    assert.equal(nw.totals.liabilities, 20000000);
    // history auto snapshots current month, manual months are kept
    const month = new Date().toISOString().slice(0, 7);
    assert.ok(nw.history.some((h) => h.month === month && !h.manual));
    nw = (await call('PUT', '/networth/history/2025-01', { assets: 100000, liabilities: 5000 })).body;
    assert.ok(nw.history.find((h) => h.month === '2025-01').manual);
    // goals
    nw = (await call('POST', '/networth/goals', { name: '$500k', metric: 'net', target: 50000000, start: 0 })).body;
    assert.equal(nw.goals[0].pct, Math.round((10000000 / 50000000) * 100));
    assert.equal((await call('POST', '/networth/assets', { name: '', value: 1 })).status, 400);
    assert.equal((await call('POST', '/networth/liabilities', { name: 'x', owed: -5 })).status, 400);
    const csv = (await call('GET', '/networth.csv')).body;
    assert.match(csv, /House/);
    assert.match(csv, /Net worth/);
  } finally { close(); }
});

test('bitcoin refresh reports live progress while it runs', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = async (url) => {
    if (String(url).endsWith('/v1/prices')) return { ok: true, status: 200, json: async () => ({ USD: 1 }) };
    await gate;
    return { ok: true, status: 200, json: async () => ({ chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } }) };
  };
  const { call, close } = await boot(slow);
  try {
    assert.deepEqual((await call('GET', '/btc/progress')).body, { running: false });
    await call('POST', '/btc/wallets', { name: 'Trezor', input: ADDR });
    const pending = call('POST', '/btc/refresh');
    await new Promise((r) => setTimeout(r, 100));
    const mid = (await call('GET', '/btc/progress')).body;
    assert.equal(mid.running, true);
    assert.equal(mid.wallets[0].name, 'Trezor');
    assert.equal(mid.wallets[0].done, false);
    assert.ok(mid.now >= mid.startedAt);
    release();
    assert.equal((await pending).status, 200);
    assert.deepEqual((await call('GET', '/btc/progress')).body, { running: false });
  } finally { close(); }
});
