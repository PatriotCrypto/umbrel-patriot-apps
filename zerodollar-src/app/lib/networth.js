import { accountBalance, debtBalance } from './budget.js';
import { addMonths, bad, uid, clampStr, asCents, isMonth, isDate, todayStr } from './util.js';

export const ASSET_CATS = ['Cash', 'Investments', 'Retirement', 'Real estate', 'Vehicles', 'Business', 'Valuables', 'Other'];
export const LIABILITY_CATS = ['Mortgage', 'Auto', 'Student', 'Credit card', 'Personal', 'Medical', 'Other'];

export const SATS = 100_000_000;
/** Value of a sat amount in cents at a price (whole currency units per BTC). */
export const satsToCents = (sats, price) => (price ? Math.round((sats / SATS) * price * 100) : 0);

export function btcValue(state) {
  const cur = state.settings.currency;
  const p = state.btc?.price;
  const price = p ? (p[cur] ?? null) : null;
  let sats = 0;
  for (const w of state.wallets) sats += (w.last?.confirmed || 0) + (w.manualSats || 0);
  return { sats, price, currency: cur, cents: satsToCents(sats, price), priceAt: state.btc?.priceAt || null, hasPrice: price != null };
}

/** Everything that makes up net worth right now: your own entries plus lines taken from the rest of the app. */
export function netWorthNow(state) {
  const nw = state.networth;
  const assets = nw.assets.map((a) => ({ ...a, source: 'manual' }));
  const liabilities = nw.liabilities.map((l) => ({ ...l, source: 'manual' }));
  if (nw.include.accounts) {
    for (const a of state.accounts) {
      if (a.archived) continue;
      const b = accountBalance(state, a);
      if (a.type === 'credit') {
        if (b < 0) liabilities.push({ id: 'acct_' + a.id, name: a.name, category: 'Credit card', owed: -b, source: 'account' });
      } else if (b >= 0) assets.push({ id: 'acct_' + a.id, name: a.name, category: 'Cash', value: b, source: 'account' });
      else liabilities.push({ id: 'acct_' + a.id, name: a.name + ' (overdrawn)', category: 'Other', owed: -b, source: 'account' });
    }
  }
  const btc = btcValue(state);
  if (nw.include.bitcoin && btc.sats > 0) assets.push({ id: 'btc', name: 'Bitcoin', category: 'Investments', value: btc.cents, source: 'bitcoin', sats: btc.sats });
  if (nw.include.debts) {
    for (const d of state.debts) {
      const owed = debtBalance(state, d);
      if (owed > 0) liabilities.push({ id: 'debt_' + d.id, name: d.name, category: 'Other', owed, monthly: d.minPayment || 0, rate: d.apr || 0, source: 'debt' });
    }
  }
  const totalAssets = assets.reduce((n, a) => n + (a.value || 0), 0);
  const totalLiabilities = liabilities.reduce((n, l) => n + (l.owed || 0), 0);
  return { assets, liabilities, totals: { assets: totalAssets, liabilities: totalLiabilities, net: totalAssets - totalLiabilities }, btc };
}

/** Keep this month's history point current unless it was entered by hand. Returns true if it changed. */
export function snapshotMonth(state, month, now = netWorthNow(state)) {
  const h = state.networth.history;
  const cur = h.find((x) => x.month === month);
  if (cur?.manual) return false;
  if (cur && cur.assets === now.totals.assets && cur.liabilities === now.totals.liabilities) return false;
  if (cur) {
    cur.assets = now.totals.assets;
    cur.liabilities = now.totals.liabilities;
  } else {
    h.push({ month, assets: now.totals.assets, liabilities: now.totals.liabilities, manual: false });
    h.sort((a, b) => a.month.localeCompare(b.month));
  }
  return true;
}

export function goalProgress(goal, totals) {
  const v = goal.metric === 'assets' ? totals.assets : goal.metric === 'debts' ? totals.liabilities : totals.net;
  const start = goal.start || 0;
  const span = goal.target - start;
  const pct = span === 0 ? (v === goal.target ? 100 : 0) : Math.max(0, Math.min(100, Math.round(((v - start) / span) * 100)));
  return { value: v, pct };
}

/* ---- validation for the manual lists ---- */
const text = (v, max, what) => {
  const s = clampStr(v, max);
  if (!s) throw bad(`Give the ${what} a name`);
  return s;
};
export function cleanAsset(body, cur = {}) {
  const a = { ...cur };
  if (body.name !== undefined || !cur.id) a.name = text(body.name, 60, 'asset');
  if (body.category !== undefined) a.category = ASSET_CATS.includes(body.category) ? body.category : 'Other';
  a.category ??= 'Other';
  if (body.location !== undefined) a.location = clampStr(body.location, 60);
  if (body.notes !== undefined) a.notes = clampStr(body.notes, 300);
  if (body.value !== undefined || !cur.id) a.value = asCents(body.value ?? 0, { name: 'Value' });
  a.id ??= uid('na_');
  return a;
}
export function cleanLiability(body, cur = {}) {
  const l = { ...cur };
  if (body.name !== undefined || !cur.id) l.name = text(body.name, 60, 'debt');
  if (body.category !== undefined) l.category = LIABILITY_CATS.includes(body.category) ? body.category : 'Other';
  l.category ??= 'Other';
  if (body.owed !== undefined || !cur.id) l.owed = asCents(body.owed ?? 0, { name: 'Amount owed' });
  if (body.monthly !== undefined) l.monthly = asCents(body.monthly || 0, { name: 'Monthly payment' });
  if (body.rate !== undefined) {
    const r = Number(body.rate || 0);
    if (!Number.isFinite(r) || r < 0 || r > 100) throw bad('Rate must be 0 to 100');
    l.rate = r;
  }
  if (body.payoff !== undefined) {
    if (body.payoff && !isMonth(body.payoff)) throw bad('Payoff month must look like 2030-06');
    l.payoff = body.payoff || '';
  }
  if (body.notes !== undefined) l.notes = clampStr(body.notes, 300);
  l.id ??= uid('nl_');
  return l;
}
export function cleanGoal(body, cur = {}) {
  const g = { ...cur };
  if (body.name !== undefined || !cur.id) g.name = text(body.name, 60, 'goal');
  if (body.metric !== undefined) {
    if (!['net', 'assets', 'debts'].includes(body.metric)) throw bad('Goal type must be net, assets or debts');
    g.metric = body.metric;
  }
  g.metric ??= 'net';
  if (body.target !== undefined || !cur.id) g.target = asCents(body.target ?? 0, { allowNegative: true, name: 'Target' });
  if (body.start !== undefined) g.start = asCents(body.start || 0, { allowNegative: true, name: 'Starting point' });
  if (body.date !== undefined) {
    if (body.date && !isDate(body.date)) throw bad('Date must look like 2030-06-30');
    g.date = body.date || '';
  }
  g.id ??= uid('ng_');
  return g;
}

export function csvRows(state) {
  const now = netWorthNow(state);
  const rows = [['Type', 'Name', 'Category', 'Amount', 'Source']];
  for (const a of now.assets) rows.push(['Asset', a.name, a.category, (a.value / 100).toFixed(2), a.source]);
  for (const l of now.liabilities) rows.push(['Liability', l.name, l.category, (l.owed / 100).toFixed(2), l.source]);
  rows.push(['Net worth', '', '', (now.totals.net / 100).toFixed(2), '']);
  return rows;
}

void addMonths; void todayStr;
