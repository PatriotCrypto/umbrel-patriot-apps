import { parseCSVText, parseAmount } from './parsers.js';
import { bad, uid, isMonth, monthEnd, todayStr, clampStr, MAX_CENTS } from './util.js';
import { initMonth, ensureDebtGroup } from './budget.js';

/**
 * Import for the "Budget Items" CSV that EveryDollar exports:
 *   "Group","Item","Planned","Spent","Remaining"
 * It carries one month of planned amounts and month totals, not individual transactions.
 *
 * Groups map like this: "Income" -> income categories, "Savings" -> funds, "Debt" -> debts
 * (the Remaining column is the debt's balance there), everything else -> ordinary expense categories.
 * Nothing is ever deleted; importing again just updates the planned amounts it finds.
 */

export const GROUP_TYPES = ['income', 'expense', 'fund', 'debt'];

const lc = (s) => String(s || '').trim().toLowerCase();

export function guessGroupType(name) {
  const n = lc(name);
  if (n === 'income') return 'income';
  if (n === 'savings' || n === 'saving') return 'fund';
  if (n === 'debt' || n === 'debts') return 'debt';
  return 'expense';
}

/** "10-2026-EveryDollar-BudgetItems.csv" -> "2026-10" */
export function monthFromFileName(name) {
  const m = /(?:^|[^\d])(\d{1,2})-(\d{4})(?:[^\d]|$)/.exec(String(name || ''));
  if (!m) return null;
  const mo = Number(m[1]);
  return mo >= 1 && mo <= 12 ? `${m[2]}-${String(mo).padStart(2, '0')}` : null;
}

/** Text of the file -> { rows, warnings }. Throws a friendly error for anything that is not the Budget Items export. */
export function parseEveryDollar(text) {
  if (typeof text !== 'string' || !text.trim()) throw bad('That file is empty.');
  const t = text.replace(/^﻿/, '');
  if (/^%PDF/.test(t)) throw bad('That is a PDF. Export the Budget Items CSV from EveryDollar instead.');
  const grid = parseCSVText(t, ',');
  if (!grid.length) throw bad('That file is empty.');
  const head = grid[0].map((c) => lc(c));
  const col = (n) => head.indexOf(n);
  if (head.includes('date') && (head.includes('merchant') || head.includes('amount'))) {
    throw bad('That looks like an EveryDollar transactions export. Import the Budget Items export (columns Group, Item, Planned, Spent, Remaining). For transactions, use Reconcile with your bank statement.');
  }
  const gi = col('group');
  const ii = col('item');
  const pi = col('planned');
  if (gi < 0 || ii < 0 || pi < 0) throw bad('This does not look like EveryDollar\'s Budget Items export. It should have the columns Group, Item, Planned, Spent and Remaining.');
  const si = col('spent');
  const ri = col('remaining');
  const warnings = [];
  const rows = [];
  const seen = new Map();
  const money = (raw, what, where) => {
    if (raw == null || String(raw).trim() === '') return 0;
    const c = parseAmount(raw);
    if (c == null || Math.abs(c) > MAX_CENTS) {
      warnings.push(`${where}: could not read ${what} "${String(raw).slice(0, 20)}", used 0.`);
      return 0;
    }
    return c;
  };
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    const group = clampStr(line[gi], 40);
    const item = clampStr(line[ii], 40);
    if (!group && !item) continue;
    if (!group || !item) {
      warnings.push(`Row ${r + 1} skipped: it needs both a group and an item.`);
      continue;
    }
    const where = `${group} / ${item}`;
    const rec = {
      group,
      item,
      planned: money(line[pi], 'Planned', where),
      spent: si >= 0 ? money(line[si], 'Spent', where) : 0,
      remaining: ri >= 0 ? money(line[ri], 'Remaining', where) : 0
    };
    if (rec.planned < 0) {
      warnings.push(`${where}: negative planned amount, used its absolute value.`);
      rec.planned = -rec.planned;
    }
    const key = `${lc(group)}\u0000${lc(item)}`;
    if (seen.has(key)) {
      const first = seen.get(key);
      first.planned += rec.planned;
      first.spent += rec.spent;
      first.remaining += rec.remaining;
      warnings.push(`${where} appears more than once. The amounts were added together.`);
      continue;
    }
    seen.set(key, rec);
    rows.push(rec);
  }
  if (!rows.length) throw bad('No budget items were found in that file.');
  return { rows, warnings };
}

/** Group the parsed rows in file order. */
function groupRows(rows, groupTypes = {}) {
  const groups = [];
  const idx = new Map();
  for (const r of rows) {
    const k = lc(r.group);
    if (!idx.has(k)) {
      const asked = groupTypes[r.group] ?? groupTypes[k];
      const type = GROUP_TYPES.includes(asked) ? asked : guessGroupType(r.group);
      idx.set(k, groups.length);
      groups.push({ name: r.group, type, items: [] });
    }
    groups[idx.get(k)].items.push(r);
  }
  return groups;
}

function findGroup(state, name, type) {
  const byName = state.groups.find((g) => lc(g.name) === lc(name) && (type === 'income' ? g.kind === 'income' : g.kind !== 'income'));
  if (byName) return byName;
  if (type === 'income') return state.groups.find((g) => g.kind === 'income' && !g.archived) || null;
  return null;
}

const importMonth = (opts, inferred) => {
  const m = opts.month || inferred;
  if (!isMonth(m)) throw bad('Choose the month this budget is for.');
  return m;
};

/** What an import would do, without changing anything. */
export function planImport(state, parsed, opts = {}) {
  const month = importMonth(opts, opts.inferredMonth);
  const wantDebts = opts.debts !== false;
  const planned = state.months[month]?.planned || {};
  const groups = groupRows(parsed.rows, opts.groupTypes);
  let plannedIncome = 0;
  let plannedOut = 0;
  const counts = { groups: groups.length, newGroups: 0, items: 0, newItems: 0, debtsNew: 0, debtsUpdated: 0, overwritten: 0 };
  const out = groups.map((g) => {
    const existing = findGroup(state, g.name, g.type === 'income' ? 'income' : 'expense');
    if (!existing) counts.newGroups++;
    const items = g.items.map((r) => {
      counts.items++;
      const cat = existing ? state.categories.find((c) => c.groupId === existing.id && lc(c.name) === lc(r.item)) : null;
      if (!cat) counts.newItems++;
      const current = cat ? planned[cat.id] || 0 : 0;
      if (cat && current && current !== r.planned) counts.overwritten++;
      const item = { name: r.item, planned: r.planned, spent: r.spent, remaining: r.remaining, exists: !!cat, current: cat ? current : null };
      if (g.type === 'income') plannedIncome += r.planned;
      else plannedOut += r.planned;
      if (g.type === 'debt' && wantDebts) {
        const d = state.debts.find((x) => lc(x.name) === lc(r.item));
        if (r.remaining > 0) {
          item.debt = d ? 'update' : 'new';
          item.balance = r.remaining;
          if (d) counts.debtsUpdated++;
          else counts.debtsNew++;
        } else item.debt = 'none';
      }
      return item;
    });
    return { name: g.name, type: g.type, exists: !!existing, items };
  });
  const warnings = [...parsed.warnings];
  if (counts.debtsNew || counts.debtsUpdated) warnings.push('Debt balances come from EveryDollar\'s Remaining column and interest rates are not in the file. Set each rate on the Debt page for accurate payoff dates.');
  if (opts.spent && groups.some((g) => g.type === 'fund')) warnings.push('Savings items are not recorded as spending. Their Spent amounts are money moved into savings, so only the planned amounts are imported.');
  return {
    month,
    monthExists: !!state.months[month],
    groups: out,
    counts,
    totals: { plannedIncome, plannedOut, leftToBudget: plannedIncome - plannedOut },
    warnings
  };
}

/** Make the import happen. Call inside store.update so a failure rolls everything back. */
export function applyImport(state, parsed, opts = {}) {
  const month = importMonth(opts, opts.inferredMonth);
  const wantDebts = opts.debts !== false;
  const wantSpent = !!opts.spent;
  const groups = groupRows(parsed.rows, opts.groupTypes);
  const rec = initMonth(state, month, 'blank');
  const today = todayStr();
  const txDate = month < today.slice(0, 7) ? monthEnd(month) : today < monthEnd(month) ? today : monthEnd(month);
  const account = state.accounts.find((a) => a.id === opts.accountId && !a.archived) || state.accounts.find((a) => !a.archived && a.type !== 'credit') || state.accounts.find((a) => !a.archived);
  const source = `everydollar:${month}`;
  if (wantSpent) {
    if (!account) throw bad('Add an account before importing spending.');
    state.transactions = state.transactions.filter((t) => !(t.source === source && !t.reconciled));
  }
  const made = { groups: 0, categories: 0, debts: 0, planned: 0, transactions: 0 };
  const setPlanned = (catId, cents) => {
    if (cents > 0) rec.planned[catId] = cents;
    else delete rec.planned[catId];
    made.planned++;
  };
  const addTx = (type, amount, catId) => {
    if (!wantSpent || !amount) return;
    state.transactions.push({
      id: uid('t_'), type, date: txDate, amount, accountId: account.id, payee: 'EveryDollar import', memo: 'Month total imported from EveryDollar',
      catId, reconciled: false, createdAt: new Date().toISOString(), source
    });
    made.transactions++;
  };

  for (const g of groups) {
    let group;
    if (g.type === 'debt') group = ensureDebtGroup(state, g.name);
    else group = findGroup(state, g.name, g.type === 'income' ? 'income' : 'expense');
    if (!group) {
      group = { id: uid('g_'), name: g.name, kind: g.type === 'income' ? 'income' : 'expense', sort: Math.max(-1, ...state.groups.map((x) => x.sort)) + 1 };
      state.groups.push(group);
      made.groups++;
    }
    group.archived = false;
    const catType = g.type === 'income' ? 'income' : g.type === 'fund' ? 'fund' : 'expense';

    for (const r of g.items) {
      if (g.type === 'debt' && wantDebts && r.remaining > 0) {
        let d = state.debts.find((x) => lc(x.name) === lc(r.item));
        if (d) {
          d.baseBalance = r.remaining;
          d.asOf = today;
          if (r.planned > 0) d.minPayment = r.planned;
        } else {
          d = { id: uid('d_'), name: r.item, baseBalance: r.remaining, asOf: today, minPayment: r.planned, apr: 0 };
          const c = { id: uid('c_'), groupId: group.id, name: d.name, type: 'debt', debtId: d.id, sort: state.categories.filter((x) => x.groupId === group.id).length };
          d.catId = c.id;
          state.categories.push(c);
          state.debts.push(d);
          made.debts++;
        }
        const c = state.categories.find((x) => x.id === d.catId);
        if (c) c.archived = false;
        setPlanned(d.catId, r.planned);
        if (r.spent < 0) addTx('expense', -r.spent, d.catId); // history only: imported totals never change a balance
        continue;
      }
      let cat = state.categories.find((c) => c.groupId === group.id && lc(c.name) === lc(r.item));
      if (!cat) {
        cat = { id: uid('c_'), groupId: group.id, name: r.item, type: catType, sort: state.categories.filter((x) => x.groupId === group.id).length };
        state.categories.push(cat);
        made.categories++;
      }
      cat.archived = false;
      setPlanned(cat.id, r.planned);
      if (cat.type === 'fund' || cat.type === 'debt') continue;
      if (cat.type === 'income') {
        if (r.spent > 0) addTx('income', r.spent, cat.id);
        else if (r.spent < 0) addTx('expense', -r.spent, cat.id);
      } else if (r.spent < 0) addTx('expense', -r.spent, cat.id);
      else if (r.spent > 0) addTx('income', r.spent, cat.id); // a refund
    }
  }
  return { month, ...made };
}
