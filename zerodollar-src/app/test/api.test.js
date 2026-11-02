import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

let server, base, dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-'));
  const { app } = createApp({ dataDir: dir });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
};
const get = (u) => call('GET', u);
const post = (u, b) => call('POST', u, b ?? {});
const patch = (u, b) => call('PATCH', u, b);
const put = (u, b) => call('PUT', u, b);
const del = (u) => call('DELETE', u);

let meta;
const cat = (n) => meta.categories.find((c) => c.name === n).id;

test('starter plan loads and health check answers', async () => {
  assert.equal((await get('/healthz')).status, 200);
  meta = (await get('/api/meta')).body;
  assert.ok(meta.categories.length > 10);
  assert.equal(meta.accounts.length, 1);
  assert.match((await get('/cw')).body, /--\.\./);
});

test('budget: start month, plan amounts, hit zero', async () => {
  let b = (await get('/api/budget/2026-03')).body;
  assert.equal(b.initialized, false);
  assert.equal((await post('/api/budget/2026-03/init', { mode: 'blank' })).status, 200);
  assert.equal((await post('/api/budget/2026-03/init', { mode: 'blank' })).status, 409);
  await put('/api/budget/2026-03/planned', { values: { [cat('Paycheck 1')]: 200000, [cat('Rent / mortgage')]: 120000, [cat('Groceries')]: 50000 } });
  b = (await get('/api/budget/2026-03')).body;
  assert.equal(b.totals.leftToBudget, 30000);
  await put('/api/budget/2026-03/planned', { catId: cat('Gas'), amount: 30000 });
  b = (await get('/api/budget/2026-03')).body;
  assert.equal(b.totals.leftToBudget, 0);
  assert.equal((await put('/api/budget/2026-03/planned', { catId: 'nope', amount: 1 })).status, 400);
  assert.equal((await put('/api/budget/2026-03/planned', { catId: cat('Gas'), amount: 1.5 })).status, 400);
  assert.equal((await get('/api/budget/March')).status, 400);
});

let acct;
test('transactions: validation, quick entry, edit, delete', async () => {
  acct = meta.accounts[0].id;
  const ok = await post('/api/transactions', { type: 'expense', date: '2026-03-05', amount: 5423, accountId: acct, payee: 'Kroger', catId: cat('Groceries') });
  assert.equal(ok.status, 201);
  assert.equal((await post('/api/transactions', { type: 'expense', date: '2026-02-31', amount: 100, accountId: acct })).status, 400);
  assert.equal((await post('/api/transactions', { type: 'expense', date: '2026-03-05', amount: -5, accountId: acct })).status, 400);
  assert.equal((await post('/api/transactions', { type: 'expense', date: '2026-03-05', amount: 0, accountId: acct })).status, 400);
  assert.equal((await post('/api/transactions', { type: 'expense', date: '2026-03-05', amount: 100, accountId: 'x' })).status, 400);
  assert.equal((await post('/api/transactions', { type: 'transfer', date: '2026-03-05', amount: 100, accountId: acct, toAccountId: acct })).status, 400);
  const split = await post('/api/transactions', { type: 'expense', date: '2026-03-06', amount: 3000, accountId: acct, payee: 'Target', splits: [{ catId: cat('Groceries'), amount: 1000 }, { catId: cat('Clothing'), amount: 2000 }] });
  assert.equal(split.status, 201);
  assert.equal((await post('/api/transactions', { type: 'expense', date: '2026-03-06', amount: 3000, accountId: acct, splits: [{ catId: cat('Groceries'), amount: 1000 }] })).status, 400);
  const b = (await get('/api/budget/2026-03')).body;
  const groceries = b.groups.flatMap((g) => g.cats).find((c) => c.name === 'Groceries');
  assert.equal(groceries.spent, 6423);
  assert.equal((await patch('/api/transactions/' + ok.body.id, { amount: 6000 })).body.amount, 6000);
  assert.equal((await del('/api/transactions/' + split.body.id)).status, 200);
  assert.equal((await del('/api/transactions/nope')).status, 404);
  const list = (await get('/api/transactions?month=2026-03&q=kroger')).body;
  assert.equal(list.total, 1);
});

let stmtId;
test('statement upload auto-matches by amount, date and payee', async () => {
  // existing entries
  await post('/api/transactions', { type: 'expense', date: '2026-03-10', amount: 4500, accountId: acct, payee: 'Shell', catId: cat('Gas') });
  await post('/api/transactions', { type: 'expense', date: '2026-03-12', amount: 4500, accountId: acct, payee: 'Chevron', catId: cat('Gas') });
  await post('/api/transactions', { type: 'expense', date: '2026-03-15', amount: 5000, accountId: acct, payee: 'Olive Garden', catId: cat('Restaurants') });
  await post('/api/transactions', { type: 'expense', date: '2026-03-20', amount: 999, accountId: acct, payee: 'Never Posted' });
  const csv = [
    'Date,Description,Amount,Balance',
    '03/05/2026,KROGER #123 SEATTLE,-60.00,940.00',
    '03/11/2026,SHELL OIL 5551,-45.00,895.00',
    '03/13/2026,CHEVRON 0077,-45.00,850.00',
    '03/16/2026,OLIVE GARDEN #44,-61.50,788.50', // tip added: suggestion
    '03/18/2026,NETFLIX.COM,-15.49,773.01', // not entered yet
    '03/25/2026,PAYROLL ACME,2000.00,2773.01'
  ].join('\n');
  const r = await post('/api/statements', { accountId: acct, fileName: 'march.csv', content: csv });
  assert.equal(r.status, 201);
  stmtId = r.body.id;
  const rows = Object.fromEntries(r.body.rows.map((x) => [x.desc.split(/[ .]/)[0], x]));
  assert.equal(rows.KROGER.status, 'matched');
  assert.equal(rows.SHELL.status, 'matched');
  assert.equal(rows.CHEVRON.status, 'matched');
  assert.notEqual(rows.SHELL.txId, rows.CHEVRON.txId); // same amount, payee decides
  assert.equal(rows.OLIVE.status, 'suggested');
  assert.equal(rows.NETFLIX.status, 'new');
  assert.equal(rows.PAYROLL.status, 'new');
  assert.equal(r.body.endBalance, 277301);
  assert.equal(r.body.summary.leftover.length, 1); // "Never Posted"
});

test('statement: re-uploading the same file sets every row aside', async () => {
  const csv = 'Date,Description,Amount\n03/05/2026,KROGER #123 SEATTLE,-60.00\n';
  const r = await post('/api/statements', { accountId: acct, fileName: 'again.csv', content: csv });
  assert.equal(r.body.rows[0].status, 'ignored');
  assert.match(r.body.warnings.join(' '), /already in an earlier upload/);
  await del('/api/statements/' + r.body.id);
});

test('statement: accept, add, remember payee, finalize', async () => {
  let s = (await get('/api/statements/' + stmtId)).body;
  const row = (n) => s.rows.find((r) => r.desc.startsWith(n));
  assert.equal((await post(`/api/statements/${stmtId}/finalize`, {})).status, 400); // undecided rows
  s = (await post(`/api/statements/${stmtId}/rows/${row('OLIVE').id}/accept`)).body;
  assert.equal(row('OLIVE').status, 'matched');
  s = (await post(`/api/statements/${stmtId}/rows/${row('NETFLIX').id}/add`, { catId: cat('Subscriptions') })).body;
  assert.equal(row('NETFLIX').status, 'added');
  const added = (await get('/api/transactions?q=netflix')).body.transactions[0];
  assert.equal(added.amount, 1549);
  assert.equal(added.type, 'expense');
  assert.equal(added.catId, cat('Subscriptions'));
  await post(`/api/statements/${stmtId}/rows/${row('PAYROLL').id}/add`, { catId: cat('Paycheck 1') });
  s = (await get('/api/statements/' + stmtId)).body;
  assert.equal(s.summary.unresolved, 0);
  const fin = await post(`/api/statements/${stmtId}/finalize`, {});
  assert.equal(fin.status, 200);
  assert.equal(fin.body.reconciled, 6);
  const txs = (await get('/api/transactions?q=kroger')).body.transactions;
  assert.equal(txs[0].reconciled, true);
  // locked once reconciled
  assert.equal((await post(`/api/statements/${stmtId}/rows/${row('KROGER').id}/unlink`)).status, 409);
  // editing a reconciled amount clears the flag
  const edited = await patch('/api/transactions/' + txs[0].id, { amount: 6001 });
  assert.equal(edited.body.reconciled, false);
});

test('payee memory: a later upload suggests the category for known payees', async () => {
  const csv = 'Date,Description,Amount\n04/18/2026,NETFLIX.COM,-15.49\n04/19/2026,SOME NEW PLACE,-9.00\n';
  const r = await post('/api/statements', { accountId: acct, fileName: 'april.csv', content: csv });
  const all = await post(`/api/statements/${r.body.id}/add-all`, {});
  assert.equal(all.body.added, 1); // only Netflix is known
  const n = (await get('/api/transactions?q=netflix&month=2026-04')).body.transactions[0];
  assert.equal(n.catId, cat('Subscriptions'));
  const unknown = all.body.statement.rows.find((x) => x.desc.startsWith('SOME'));
  assert.equal(unknown.status, 'new');
});

test('manual reconcile: link a row to a chosen transaction, and undo a finalized statement', async () => {
  const t = await post('/api/transactions', { type: 'expense', date: '2026-05-02', amount: 1234, accountId: acct, payee: 'Local Hardware' });
  const r = await post('/api/statements', { accountId: acct, fileName: 'may.csv', content: 'Date,Description,Amount\n05/09/2026,ACE HDWE 9911,-12.34\n' });
  assert.equal(r.body.rows[0].status, 'new'); // 7 days apart: outside the 5-day window
  const linked = await post(`/api/statements/${r.body.id}/rows/r1/link`, { txId: t.body.id });
  assert.equal(linked.body.rows[0].status, 'matched');
  assert.equal((await post(`/api/statements/${r.body.id}/finalize`, { endBalance: 0 })).status, 200);
  assert.equal((await post(`/api/statements/${r.body.id}/reopen`)).body.finalizedAt, null);
  assert.equal((await get('/api/transactions?q=hardware')).body.transactions[0].reconciled, false);
  await del('/api/statements/' + r.body.id);
});

test('credit card CSV with positive charges is flipped automatically', async () => {
  const card = (await post('/api/accounts', { name: 'Visa', type: 'credit' })).body;
  await post('/api/transactions', { type: 'expense', date: '2026-05-03', amount: 2500, accountId: card.id, payee: 'Chipotle', catId: cat('Restaurants') });
  const csv = 'Date,Description,Amount\n05/03/2026,CHIPOTLE 1234,25.00\n05/04/2026,AMAZON,10.00\n05/05/2026,TARGET,12.00\n05/06/2026,SHELL,30.00\n';
  const r = await post('/api/statements', { accountId: card.id, fileName: 'visa.csv', content: csv });
  assert.equal(r.body.flip, true);
  assert.equal(r.body.rows[0].status, 'matched');
  const back = await post(`/api/statements/${r.body.id}/flip`, { flip: false });
  assert.equal(back.body.rows[0].status, 'new');
});

test('categories, groups, accounts and debts behave', async () => {
  const g = (await post('/api/groups', { name: 'Pets' })).body;
  const c = (await post('/api/categories', { groupId: g.id, name: 'Vet', dueDay: 15 })).body;
  assert.equal(c.dueDay, 15);
  assert.equal((await patch('/api/categories/' + c.id, { target: 50000, type: 'fund' })).body.type, 'fund');
  assert.equal((await del('/api/groups/' + g.id)).status, 409);
  assert.equal((await del('/api/categories/' + c.id)).body.archived, false);
  assert.equal((await del('/api/groups/' + g.id)).status, 200);

  const d = (await post('/api/debts', { name: 'Car loan', balance: 800000, minPayment: 25000, apr: 6.5 })).body;
  await post('/api/debts', { name: 'Store card', balance: 50000, minPayment: 2500, apr: 24 });
  meta = (await get('/api/meta')).body;
  assert.equal(meta.debts.length, 2);
  const dc = meta.categories.find((x) => x.debtId === d.id);
  assert.equal(dc.type, 'debt');
  const plan = (await get('/api/debts/plan?extra=10000')).body;
  assert.equal(plan.plan.order[0], meta.debts.find((x) => x.name === 'Store card').id);
  assert.ok(plan.plan.months < plan.minimumsOnly.months);
  assert.equal((await del('/api/debts/' + d.id)).status, 200);

  // account with history is archived, not deleted
  assert.equal((await del('/api/accounts/' + acct)).body.archived, true);
  assert.equal((await patch('/api/accounts/' + acct, { archived: false })).body.archived, false);
});

test('reports, settings, widget and CSV export', async () => {
  const sp = (await get('/api/reports/spending?month=2026-03')).body;
  assert.ok(sp.categories.length > 0);
  const tr = (await get('/api/reports/trend?month=2026-05')).body;
  assert.equal(tr.trend.length, 12);
  assert.equal(tr.netWorth.length, 12);
  assert.equal((await put('/api/settings', { currency: 'usd' })).status, 400);
  assert.equal((await put('/api/settings', { currency: 'EUR', locale: 'de-DE', matchWindowDays: 3 })).body.currency, 'EUR');
  await put('/api/settings', { currency: 'USD', locale: 'en-US', matchWindowDays: 5 });
  const w = (await get('/widgets/left')).body;
  assert.equal(w.type, 'text-with-progress');
  const csv = (await get('/api/export/transactions.csv')).body;
  assert.match(csv, /^Date,Type,Amount/);
  assert.match(csv, /Kroger/);
});

test('backup export and import round-trip; reset needs confirmation', async () => {
  const backup = (await get('/api/export')).body;
  assert.ok(backup.transactions.length > 5);
  assert.equal((await post('/api/import', { nope: 1 })).status, 400);
  assert.equal((await post('/api/reset', {})).status, 400);
  assert.equal((await post('/api/reset', { confirm: 'ERASE' })).status, 200);
  assert.equal((await get('/api/meta')).body.counts.transactions, 0);
  assert.equal((await post('/api/import', backup)).status, 200);
  assert.equal((await get('/api/meta')).body.counts.transactions, backup.transactions.length);
});

test('data survives a restart and bad JSON gets a clean error', async () => {
  const { store } = createApp({ dataDir: dir });
  assert.equal(store.state.transactions.length > 5, true);
  const res = await fetch(base + '/api/transactions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).length >= 1);
});
