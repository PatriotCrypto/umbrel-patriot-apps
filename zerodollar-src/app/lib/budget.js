import { monthOf, monthEnd, addMonths, uid } from './util.js';

/* All money is integer cents. Expenses are stored positive with type "expense". */

export const byId = (arr) => new Map(arr.map((x) => [x.id, x]));

/** Signed effect of a transaction on one account's balance. */
export function signedFor(tx, accountId) {
  if (tx.type === 'income') return tx.accountId === accountId ? tx.amount : 0;
  if (tx.type === 'expense') return tx.accountId === accountId ? -tx.amount : 0;
  if (tx.type === 'transfer') {
    let v = 0;
    if (tx.accountId === accountId) v -= tx.amount;
    if (tx.toAccountId === accountId) v += tx.amount;
    return v;
  }
  return 0;
}

export function accountBalance(state, account, upToDate = null) {
  let bal = account.openingBalance || 0;
  for (const t of state.transactions) {
    if (upToDate && t.date > upToDate) continue;
    bal += signedFor(t, account.id);
  }
  return bal;
}

/** The category parts of a transaction: [{catId, amount}] (uncategorised = []) */
export function partsOf(tx) {
  if (tx.type === 'transfer') return [];
  if (Array.isArray(tx.splits) && tx.splits.length) return tx.splits;
  return tx.catId ? [{ catId: tx.catId, amount: tx.amount }] : [];
}

/**
 * Net amount per category for a date range. Expense categories count spending
 * (refunds entered as income reduce it); income categories count money received.
 */
export function activityByCategory(state, from, to, cats = byId(state.categories)) {
  const out = new Map();
  for (const t of state.transactions) {
    if (t.date < from || t.date > to) continue;
    for (const p of partsOf(t)) {
      const c = cats.get(p.catId);
      if (!c) continue;
      let delta;
      if (c.type === 'income') delta = t.type === 'income' ? p.amount : -p.amount;
      else delta = t.type === 'expense' ? p.amount : -p.amount;
      out.set(p.catId, (out.get(p.catId) || 0) + delta);
    }
  }
  return out;
}

export function fundBalance(state, cat, month) {
  const end = monthEnd(month);
  let planned = 0;
  for (const [m, rec] of Object.entries(state.months)) {
    if (m <= month) planned += rec.planned?.[cat.id] || 0;
  }
  let spent = 0;
  for (const t of state.transactions) {
    if (t.date > end) continue;
    for (const p of partsOf(t)) {
      if (p.catId === cat.id) spent += t.type === 'expense' ? p.amount : -p.amount;
    }
  }
  return (cat.fundStart || 0) + planned - spent;
}

export function debtBalance(state, debt, upToDate = null) {
  let paid = 0;
  const asOf = debt.asOf || '0000-00-00';
  for (const t of state.transactions) {
    if (!debt.catId || t.date < asOf || String(t.source || '').startsWith('everydollar:')) continue; // imported month totals are already inside the balance
    if (upToDate && t.date > upToDate) continue;
    for (const p of partsOf(t)) {
      if (p.catId === debt.catId) paid += t.type === 'expense' ? p.amount : -p.amount;
    }
  }
  return Math.max(0, (debt.baseBalance || 0) - paid);
}

export function computeBudget(state, month, todayDate = null) {
  const rec = state.months[month];
  const initialized = !!rec;
  const planned = rec?.planned || {};
  const cats = byId(state.categories);
  const activity = activityByCategory(state, `${month}-01`, monthEnd(month), cats);
  const debts = byId(state.debts);

  const shape = (c) => {
    const p = planned[c.id] || 0;
    const spent = activity.get(c.id) || 0;
    const out = { id: c.id, name: c.name, type: c.type, planned: p, spent, remaining: c.type === 'income' ? spent - p : p - spent };
    if (c.dueDay) out.dueDay = c.dueDay;
    if (c.type === 'fund') {
      out.balance = fundBalance(state, c, month);
      if (c.target) out.target = c.target;
    }
    if (c.type === 'debt' && c.debtId && debts.has(c.debtId)) {
      const d = debts.get(c.debtId);
      out.debt = { id: d.id, balance: debtBalance(state, d, monthEnd(month)), minPayment: d.minPayment || 0 };
    }
    if (c.type === 'expense' && c.dueDay && todayDate && month === monthOf(todayDate)) {
      out.dueDate = `${month}-${String(c.dueDay).padStart(2, '0')}`;
    }
    return out;
  };

  const groups = [];
  let incomeGroup = null;
  let plannedOut = 0;
  let spentOut = 0;
  let plannedIncome = 0;
  let receivedIncome = 0;
  for (const g of state.groups.filter((x) => !x.archived).sort((a, b) => a.sort - b.sort)) {
    const gc = state.categories.filter((c) => c.groupId === g.id && !c.archived).sort((a, b) => a.sort - b.sort).map(shape);
    const row = { id: g.id, name: g.name, kind: g.kind, cats: gc, planned: 0, spent: 0 };
    for (const c of gc) {
      if (c.type === 'income') {
        plannedIncome += c.planned;
        receivedIncome += c.spent;
      } else {
        plannedOut += c.planned;
        spentOut += c.spent;
      }
      row.planned += c.planned;
      row.spent += c.spent;
    }
    if (g.kind === 'income') incomeGroup = row;
    else groups.push(row);
  }

  let uncategorized = 0;
  for (const t of state.transactions) {
    if (monthOf(t.date) === month && t.type !== 'transfer' && !partsOf(t).length) uncategorized++;
  }
  const previousMonths = Object.keys(state.months).filter((m) => m < month).sort();

  return {
    month,
    initialized,
    previousMonth: previousMonths.length ? previousMonths[previousMonths.length - 1] : null,
    note: rec?.note || '',
    income: incomeGroup,
    groups,
    totals: {
      plannedIncome,
      receivedIncome,
      plannedOut,
      spentOut,
      leftToBudget: plannedIncome - plannedOut,
      leftOver: receivedIncome - spentOut,
      uncategorized
    }
  };
}

/** Make a month exist, copying planned amounts from the latest earlier month or starting blank. */
export function initMonth(state, month, mode = 'previous') {
  if (state.months[month]) return state.months[month];
  let planned = {};
  if (mode === 'previous') {
    const prev = Object.keys(state.months).filter((m) => m < month).sort().pop();
    if (prev) planned = { ...state.months[prev].planned };
  }
  state.months[month] = { planned, note: '' };
  return state.months[month];
}

/** Upcoming bills: expense categories with a due day, not yet covered by a transaction this month. */
export function upcomingBills(state, month, todayDate) {
  const cats = byId(state.categories);
  const activity = activityByCategory(state, `${month}-01`, monthEnd(month), cats);
  const planned = state.months[month]?.planned || {};
  const out = [];
  for (const c of state.categories) {
    if (!c.dueDay || c.archived || c.type !== 'expense') continue;
    const plan = planned[c.id] || 0;
    if (!plan) continue;
    const paid = activity.get(c.id) || 0;
    out.push({
      id: c.id,
      name: c.name,
      amount: plan,
      paid,
      due: `${month}-${String(Math.min(28, c.dueDay)).padStart(2, '0')}`,
      settled: paid >= plan
    });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

export { addMonths };


/** The group that holds debt categories (created on demand). */
export function ensureDebtGroup(state, name = 'Debt') {
  let g = state.groups.find((x) => x.name.toLowerCase() === String(name).toLowerCase() && x.kind !== 'income' && !x.archived);
  if (!g) g = state.groups.find((x) => x.name === 'Debt' && x.kind !== 'income' && !x.archived);
  if (!g) {
    g = { id: uid('g_'), name, kind: 'expense', sort: Math.max(-1, ...state.groups.map((x) => x.sort)) + 1 };
    state.groups.push(g);
  }
  return g;
}
