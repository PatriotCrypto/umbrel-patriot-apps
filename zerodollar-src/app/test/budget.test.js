import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/schema.js';
import { computeBudget, initMonth, accountBalance, fundBalance, debtBalance } from '../lib/budget.js';
import { simulate } from '../lib/debt.js';
import { similarity, addMonths, monthEnd, normPayee } from '../lib/util.js';
import { spendingByCategory, monthlyTrend } from '../lib/reports.js';

function setup() {
  const s = defaultState();
  const cat = (n) => s.categories.find((c) => c.name === n);
  initMonth(s, '2026-03', 'blank');
  const p = s.months['2026-03'].planned;
  p[cat('Paycheck 1').id] = 300000;
  p[cat('Groceries').id] = 40000;
  p[cat('Rent / mortgage').id] = 150000;
  p[cat('Emergency fund').id] = 20000;
  return { s, cat, acct: s.accounts[0] };
}
const tx = (s, o) => s.transactions.push({ id: 't' + s.transactions.length, payee: '', memo: '', reconciled: false, createdAt: 'x', ...o });

test('left to budget is income minus everything planned', () => {
  const { s } = setup();
  const b = computeBudget(s, '2026-03');
  assert.equal(b.totals.plannedIncome, 300000);
  assert.equal(b.totals.plannedOut, 210000);
  assert.equal(b.totals.leftToBudget, 90000);
});

test('spending, income and refunds roll into categories', () => {
  const { s, cat, acct } = setup();
  tx(s, { date: '2026-03-05', type: 'expense', amount: 5000, accountId: acct.id, catId: cat('Groceries').id });
  tx(s, { date: '2026-03-06', type: 'income', amount: 1000, accountId: acct.id, catId: cat('Groceries').id }); // refund
  tx(s, { date: '2026-03-07', type: 'income', amount: 300000, accountId: acct.id, catId: cat('Paycheck 1').id });
  tx(s, { date: '2026-03-08', type: 'expense', amount: 7000, accountId: acct.id, splits: [{ catId: cat('Groceries').id, amount: 2000 }, { catId: cat('Gas').id, amount: 5000 }] });
  const b = computeBudget(s, '2026-03');
  const find = (n) => b.groups.flatMap((g) => g.cats).find((c) => c.name === n);
  assert.equal(find('Groceries').spent, 6000); // 5000 - 1000 + 2000
  assert.equal(find('Gas').spent, 5000);
  assert.equal(b.income.cats.find((c) => c.name === 'Paycheck 1').spent, 300000);
  assert.equal(b.totals.receivedIncome, 300000);
});

test('transfers touch balances but never the budget', () => {
  const { s, acct } = setup();
  s.accounts.push({ id: 'sav', name: 'Savings', type: 'savings', openingBalance: 1000 });
  tx(s, { date: '2026-03-09', type: 'transfer', amount: 500, accountId: acct.id, toAccountId: 'sav' });
  assert.equal(accountBalance(s, acct), -500);
  assert.equal(accountBalance(s, s.accounts[1]), 1500);
  assert.equal(computeBudget(s, '2026-03').totals.spentOut, 0);
  assert.equal(computeBudget(s, '2026-03').totals.uncategorized, 0);
});

test('funds accumulate across months and shrink when spent', () => {
  const { s, cat, acct } = setup();
  const f = cat('Emergency fund');
  initMonth(s, '2026-04', 'previous');
  assert.equal(s.months['2026-04'].planned[f.id], 20000);
  assert.equal(fundBalance(s, f, '2026-03'), 20000);
  assert.equal(fundBalance(s, f, '2026-04'), 40000);
  tx(s, { date: '2026-04-10', type: 'expense', amount: 15000, accountId: acct.id, catId: f.id });
  assert.equal(fundBalance(s, f, '2026-04'), 25000);
  f.fundStart = 5000;
  assert.equal(fundBalance(s, f, '2026-04'), 30000);
});

test('debt balance drops with payments after the as-of date', () => {
  const { s, acct } = setup();
  const c = { id: 'cdebt', groupId: s.groups[1].id, name: 'Card', type: 'debt', sort: 9, debtId: 'd1' };
  s.categories.push(c);
  const d = { id: 'd1', name: 'Card', baseBalance: 100000, asOf: '2026-03-01', minPayment: 5000, apr: 20, catId: 'cdebt' };
  s.debts.push(d);
  tx(s, { date: '2026-02-20', type: 'expense', amount: 9999, accountId: acct.id, catId: 'cdebt' }); // before as-of, ignored
  tx(s, { date: '2026-03-15', type: 'expense', amount: 30000, accountId: acct.id, catId: 'cdebt' });
  assert.equal(debtBalance(s, d), 70000);
});

test('snowball pays smallest first and rolls freed minimums forward', () => {
  const debts = [
    { id: 'big', name: 'Big', balance: 500000, apr: 6, minPayment: 10000 },
    { id: 'small', name: 'Small', balance: 50000, apr: 20, minPayment: 5000 }
  ];
  const r = simulate(debts, 20000);
  assert.deepEqual(r.order, ['small', 'big']);
  const small = r.payoff.find((p) => p.id === 'small').month;
  const big = r.payoff.find((p) => p.id === 'big').month;
  assert.ok(small < big);
  assert.ok(small <= 3);
  const slow = simulate(debts, 0);
  assert.ok(r.months < slow.months);
  assert.ok(r.totalInterest < slow.totalInterest);
  assert.equal(simulate([{ id: 'x', name: 'x', balance: 100000, apr: 30, minPayment: 0 }], 0).neverPaysOff, true);
});

test('month helpers and payee similarity', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(monthEnd('2024-02'), '2024-02-29');
  assert.equal(normPayee('STARBUCKS #1234 SEATTLE'), 'starbucks seattle');
  assert.ok(similarity('STARBUCKS #1234 SEATTLE WA', 'Starbucks') > 0.7);
  assert.ok(similarity('SHELL OIL 5551', 'Kroger') < 0.2);
});

test('reports: category totals and monthly trend', () => {
  const { s, cat, acct } = setup();
  tx(s, { date: '2026-03-05', type: 'expense', amount: 5000, accountId: acct.id, catId: cat('Groceries').id });
  tx(s, { date: '2026-03-06', type: 'expense', amount: 700, accountId: acct.id });
  tx(s, { date: '2026-03-07', type: 'income', amount: 9000, accountId: acct.id, catId: cat('Paycheck 1').id });
  const r = spendingByCategory(s, '2026-03-01', '2026-03-31');
  assert.equal(r[0].name, 'Groceries');
  assert.equal(r.at(-1).name, 'Uncategorized');
  const t = monthlyTrend(s, '2026-03', 3);
  assert.equal(t.at(-1).income, 9000);
  assert.equal(t.at(-1).spending, 5700);
});
