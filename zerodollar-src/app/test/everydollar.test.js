import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { parseEveryDollar, monthFromFileName } from '../lib/everydollar.js';

// Fictional household, same column layout EveryDollar exports.
const CSV = `"Group","Item","Planned","Spent","Remaining"
"Income","Paycheck A","3000.00","3000.00","0.00"
"Income","Side gig","500.00","450.00","-50.00"
"Savings","Emergency Fund","200.00","-200.00","0.00"
"Housing","Rent","1200.00","-1200.00","0.00"
"Food","Groceries","600.00","-450.25","149.75"
"Debt","Old Card","100.00","-100.00","1500.00"
"Debt","Paid Off Loan","0.00","0.00","0.00"
`;

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-ed-'));
  const { app } = createApp({ dataDir: dir, publicDir: dir });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (m, p, b) => {
    const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { call, close: () => server.close() };
}

test('file name gives the month', () => {
  assert.equal(monthFromFileName('10-2026-EveryDollar-BudgetItems.csv'), '2026-10');
  assert.equal(monthFromFileName('budget.csv'), null);
  assert.equal(monthFromFileName('13-2026.csv'), null);
});

test('parser reads rows and rejects other files', () => {
  const { rows } = parseEveryDollar(CSV);
  assert.equal(rows.length, 7);
  assert.equal(rows[4].remaining, 14975);
  assert.throws(() => parseEveryDollar('Date,Merchant,Amount\n1/1/2026,X,5'), /transactions export/);
  assert.throws(() => parseEveryDollar('a,b\n1,2'), /Budget Items/);
  assert.throws(() => parseEveryDollar(''), /empty/);
});

test('preview then import, twice, changes nothing the second time', async () => {
  const { call, close } = await boot();
  try {
    const pv = await call('POST', '/import/everydollar/preview', { csv: CSV, fileName: '10-2026-EveryDollar-BudgetItems.csv' });
    assert.equal(pv.status, 200);
    assert.equal(pv.body.month, '2026-10');
    assert.equal(pv.body.counts.debtsNew, 1);
    const none = await call('POST', '/import/everydollar/preview', { csv: CSV });
    assert.equal(none.status, 400);

    const a1 = await call('POST', '/import/everydollar/apply', { csv: CSV, month: '2026-10', spent: true });
    assert.equal(a1.status, 200);
    const meta1 = (await call('GET', '/meta')).body;
    const a2 = await call('POST', '/import/everydollar/apply', { csv: CSV, month: '2026-10', spent: true });
    assert.equal(a2.status, 200);
    const meta2 = (await call('GET', '/meta')).body;
    assert.equal(meta2.categories.length, meta1.categories.length);
    assert.equal(meta2.debts.length, 1);
    assert.equal(meta2.debts[0].balance, 150000); // imported spending never lowers a balance

    const b = (await call('GET', '/budget/2026-10')).body;
    const rent = b.groups.find((g) => g.name === 'Housing').cats.find((c) => c.name === 'Rent');
    assert.equal(rent.planned, 120000);
    assert.equal(rent.spent, 120000);
    const txs = (await call('GET', '/transactions?month=2026-10&limit=200')).body.transactions;
    assert.equal(txs.filter((t) => t.payee === 'EveryDollar import').length, 5); // 2 income + rent + groceries + debt; fund skipped
    assert.equal(b.income.cats.find((c) => c.name === 'Paycheck A').planned, 300000);
  } finally { close(); }
});
