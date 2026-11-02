import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick } from '../public/js/quick.js';
import { parseMoney, makeFormatter } from '../public/js/money.js';

const cats = [
  { id: 'g', name: 'Groceries', type: 'expense' },
  { id: 'r', name: 'Restaurants', type: 'expense' },
  { id: 'gas', name: 'Gas', type: 'expense' },
  { id: 'p', name: 'Paycheck 1', type: 'income' },
  { id: 'o', name: 'Other income', type: 'income' }
];
const ctx = { categories: cats, rules: { chipotle: 'r' }, today: '2026-03-27' };

test('amount, payee and category from one line', () => {
  const q = parseQuick('45.20 kroger groceries', ctx);
  assert.deepEqual(q, { amount: 4520, type: 'expense', payee: 'Kroger', catId: 'g', date: null });
});
test('remembered payee supplies the category', () => {
  const q = parseQuick('12 chipotle', ctx);
  assert.equal(q.catId, 'r');
  assert.equal(q.amount, 1200);
  assert.equal(q.payee, 'Chipotle');
});
test('dates: yesterday and m/d', () => {
  assert.equal(parseQuick('yesterday 40 shell gas', ctx).date, '2026-03-26');
  assert.equal(parseQuick('3/15 20 target', ctx).date, '2026-03-15');
  assert.equal(parseQuick('13/45 20 target', ctx).date, null);
});
test('income words and leading plus', () => {
  const a = parseQuick('+2400 acme paycheck', ctx);
  assert.equal(a.type, 'income');
  assert.equal(a.amount, 240000);
  assert.equal(a.catId, null); // "Paycheck 1" is a different name, user picks
  assert.equal(parseQuick('refund 15.50 amazon', ctx).type, 'income');
});
test('thousands separators, dollar signs and empty input', () => {
  assert.equal(parseQuick('$1,200 rent', ctx).amount, 120000);
  assert.deepEqual(parseQuick('', ctx), { amount: null, type: 'expense', payee: '', catId: null, date: null });
  assert.equal(parseQuick('coffee shop', ctx).amount, null);
});
test('parseMoney and formatter', () => {
  assert.equal(parseMoney('$1,234.56'), 123456);
  assert.equal(parseMoney('(5)'), -500);
  assert.equal(parseMoney('abc'), null);
  const f = makeFormatter('USD', 'en-US');
  assert.equal(f.fmt(123456), '$1,234.56');
  assert.equal(f.plain(123456), '1234.56');
  assert.equal(f.plain(0), '');
});
