import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { splitEvenly } from '../lib/paycheck.js';
import { resolveRange } from '../lib/insights.js';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-pc-'));
  const { app } = createApp({ dataDir: dir, publicDir: dir });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (m, p, b) => {
    const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { call, close: () => server.close() };
}

test('splitEvenly keeps every cent', () => {
  assert.deepEqual(splitEvenly(10000, 3), [3333, 3333, 3334]);
  assert.equal(splitEvenly(599619, 5).reduce((a, b) => a + b), 599619);
});

test('insight ranges', () => {
  assert.deepEqual(resolveRange('ytd', '2026-11-02'), { from: '2026-01', to: '2026-11' });
  assert.deepEqual(resolveRange('3', '2026-11-02'), { from: '2026-09', to: '2026-11' });
  assert.deepEqual(resolveRange('2025', '2026-11-02'), { from: '2025-01', to: '2025-12' });
  assert.equal(resolveRange('7', '2026-11-02'), null);
});

test('paycheck plan: schedule, risk, buffer, due override, due this week', async () => {
  const { call, close } = await boot();
  try {
    const meta = (await call('GET', '/meta')).body;
    const inc = meta.categories.find((c) => c.name === 'Paycheck 1');
    const rent = meta.categories.find((c) => c.name === 'Rent / mortgage');
    const gas = meta.categories.find((c) => c.name === 'Gas');
    await call('POST', '/budget/2026-11/init', { mode: 'blank' });
    await call('PUT', '/budget/2026-11/planned', { catId: inc.id, amount: 200000 });
    await call('PUT', '/budget/2026-11/planned', { catId: rent.id, amount: 150000 });
    await call('PUT', '/budget/2026-11/planned', { catId: gas.id, amount: 20000 });
    // rent is due on the 1st (template). Income not yet placed.
    let p = (await call('GET', '/paycheck/2026-11?today=2026-11-02')).body;
    assert.equal(p.unscheduledIncome.length, 1);
    assert.equal(p.risk.level, 'high'); // rent due before any paycheck
    assert.equal(p.risk.neededBuffer, 150000);
    // pay days split it
    p = (await call('POST', '/paycheck/2026-11/split', { catId: inc.id, days: [1, 15], remember: true })).body;
    assert.deepEqual(p.events.filter((e) => e.kind === 'income').map((e) => e.amount), [100000, 100000]);
    assert.equal(p.risk.level, 'high'); // 1000 in, 1500 out on the 1st
    // move rent to the 20th for this month only
    p = (await call('PUT', '/paycheck/2026-11/due', { catId: rent.id, day: 20 })).body;
    assert.equal(p.events.find((e) => e.catId === rent.id).date, '2026-11-20');
    assert.equal(p.risk.level, 'low'); // 2000 in, 1500 rent + 200 undated gas
    // a bigger undated plan tips it to medium
    await call('PUT', '/budget/2026-11/planned', { catId: gas.id, amount: 80000 });
    p = (await call('GET', '/paycheck/2026-11?today=2026-11-02')).body;
    assert.equal(p.risk.level, 'medium');
    // buffer fixes the early shortfall when rent goes back to the 1st
    await call('PUT', '/paycheck/2026-11/due', { catId: rent.id, day: null });
    p = (await call('PUT', '/paycheck/2026-11/buffer', { amount: 50000 })).body;
    assert.equal(p.risk.level, 'low'); // 500 + 1000 - 1500 = 0, and 2500 - 1500 - 800 still covers the gas
    assert.equal(p.buffer, 50000);
    // due this week: rent (1st) is overdue on the 2nd; gas has no day
    const dw = (await call('GET', '/due-week?today=2026-11-02')).body;
    assert.equal(dw.items.length, 1);
    assert.equal(dw.items[0].overdue, true);
    await call('PATCH', '/categories/' + gas.id, { dueDay: 4 });
    const dw2 = (await call('GET', '/due-week?today=2026-11-02')).body;
    assert.deepEqual(dw2.items.map((i) => i.name), ['Rent / mortgage', 'Gas']);
    assert.equal(dw2.total, 150000 + 80000);
    // insights see spending
    await call('POST', '/transactions', { type: 'expense', date: '2026-11-03', amount: 4500, accountId: meta.accounts[0].id, catId: gas.id });
    await call('POST', '/transactions', { type: 'income', date: '2026-11-01', amount: 100000, accountId: meta.accounts[0].id, catId: inc.id });
    const ins = (await call('GET', '/insights?range=3&today=2026-11-20')).body;
    assert.deepEqual(ins.months, ['2026-09', '2026-10', '2026-11']);
    assert.equal(ins.series.find((x) => x.name === 'Gas').values[2], 4500);
    assert.equal(ins.income.find((x) => x.name === 'Paycheck 1').values[2], 100000);
    // pay days must be valid
    assert.equal((await call('PATCH', '/categories/' + inc.id, { payDays: [0] })).status, 400);
    assert.equal((await call('PATCH', '/categories/' + gas.id, { payDays: [1] })).status, 400);
  } finally { close(); }
});
