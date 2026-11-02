import { addMonths, monthEnd } from './util.js';
import { activityByCategory, byId, partsOf } from './budget.js';

/** Resolve a range name to {from, to} months. today is YYYY-MM-DD. */
export function resolveRange(range, today) {
  const cur = today.slice(0, 7);
  if (/^\d{4}$/.test(range)) return { from: `${range}-01`.slice(0, 7), to: `${range}-12` };
  if (range === 'ytd' || !range) return { from: `${cur.slice(0, 4)}-01`, to: cur };
  const n = Number(range);
  if ([3, 6, 9, 12].includes(n)) return { from: addMonths(cur, -(n - 1)), to: cur };
  return null;
}

/**
 * Per-month figures for the Insights page. Spending counts every non-income category, savings
 * funds (their planned contribution, shown as "set aside") and debt payments, the way a
 * zero-based budget does. Income is what was actually received.
 */
export function insights(state, from, to, { savings = true } = {}) {
  const months = [];
  for (let m = from; m <= to && months.length < 60; m = addMonths(m, 1)) months.push(m);
  const cats = byId(state.categories);
  const groups = byId(state.groups);
  const idx = new Map(months.map((m, i) => [m, i]));
  const spend = new Map(); // catId -> values
  const income = new Map();
  const zeros = () => months.map(() => 0);
  const bump = (map, id, i, v) => {
    if (!map.has(id)) map.set(id, zeros());
    map.get(id)[i] += v;
  };

  months.forEach((m, i) => {
    const act = activityByCategory(state, `${m}-01`, monthEnd(m), cats);
    for (const [id, amt] of act) {
      const c = cats.get(id);
      if (!c) continue;
      if (c.type === 'income') bump(income, id, i, amt);
      else if (c.type !== 'fund' && amt > 0) bump(spend, id, i, amt);
    }
    if (savings) {
      const planned = state.months[m]?.planned || {};
      for (const [id, p] of Object.entries(planned)) if (cats.get(id)?.type === 'fund' && p > 0) bump(spend, id, i, p);
    }
  });
  let uncategorized = zeros();
  for (const t of state.transactions) {
    const i = idx.get(t.date.slice(0, 7));
    if (i == null || t.type !== 'expense' || partsOf(t).length) continue;
    uncategorized[i] += t.amount;
  }

  const series = [];
  for (const [id, values] of spend) {
    const c = cats.get(id);
    const g = groups.get(c.groupId);
    series.push({ catId: id, name: c.name, groupId: g?.id || '', group: g?.name || '', type: c.type, values });
  }
  if (uncategorized.some(Boolean)) series.push({ catId: null, name: 'Uncategorized', groupId: 'uncat', group: 'Uncategorized', type: 'expense', values: uncategorized });
  const inc = [...income].map(([id, values]) => ({ catId: id, name: cats.get(id).name, values })).filter((x) => x.values.some(Boolean));
  const years = [...new Set(state.transactions.map((t) => t.date.slice(0, 4)).concat(Object.keys(state.months).map((m) => m.slice(0, 4))))].sort().reverse();
  return { from, to, months, series, income: inc, years };
}
