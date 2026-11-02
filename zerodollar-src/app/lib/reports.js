import { addMonths, monthEnd, monthOf } from './util.js';
import { accountBalance, activityByCategory, byId, debtBalance, partsOf } from './budget.js';

export function spendingByCategory(state, from, to) {
  const cats = byId(state.categories);
  const groups = byId(state.groups);
  const act = activityByCategory(state, from, to, cats);
  const rows = [];
  for (const [id, amount] of act) {
    const c = cats.get(id);
    if (!c || c.type === 'income' || amount <= 0) continue;
    rows.push({ catId: id, name: c.name, group: groups.get(c.groupId)?.name || '', amount });
  }
  let uncategorized = 0;
  for (const t of state.transactions) {
    if (t.date < from || t.date > to || t.type !== 'expense' || partsOf(t).length) continue;
    uncategorized += t.amount;
  }
  if (uncategorized) rows.push({ catId: null, name: 'Uncategorized', group: '', amount: uncategorized });
  return rows.sort((a, b) => b.amount - a.amount);
}

export function monthlyTrend(state, endMonth, n = 12) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = addMonths(endMonth, -i);
    out.push({ month: m, income: 0, spending: 0 });
  }
  const idx = new Map(out.map((o, i) => [o.month, i]));
  const cats = byId(state.categories);
  for (const t of state.transactions) {
    const i = idx.get(monthOf(t.date));
    if (i == null || t.type === 'transfer') continue;
    const parts = partsOf(t);
    const incomeCat = parts.length && parts.every((p) => cats.get(p.catId)?.type === 'income');
    if (t.type === 'income') {
      if (!parts.length || incomeCat) out[i].income += t.amount;
      else out[i].spending -= t.amount; // refund into an expense category
    } else if (incomeCat) out[i].income -= t.amount;
    else out[i].spending += t.amount;
  }
  return out;
}

export function topPayees(state, from, to, n = 10) {
  const m = new Map();
  for (const t of state.transactions) {
    if (t.type !== 'expense' || t.date < from || t.date > to || !t.payee) continue;
    const k = t.payee.trim();
    const cur = m.get(k) || { payee: k, amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}

export function netWorthSeries(state, endMonth, n = 12) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = addMonths(endMonth, -i);
    const end = monthEnd(m);
    let assets = 0;
    let liabilities = 0;
    for (const a of state.accounts) {
      if (a.archived) continue;
      const b = accountBalance(state, a, end);
      if (a.type === 'credit') liabilities += Math.max(0, -b);
      else assets += b;
    }
    let debts = 0;
    for (const d of state.debts) debts += debtBalance(state, d, end);
    out.push({ month: m, assets, liabilities: liabilities + debts, netWorth: assets - liabilities - debts });
  }
  return out;
}
