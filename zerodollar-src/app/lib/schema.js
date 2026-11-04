import { uid } from './util.js';
import { DEFAULT_NTFY } from './ntfy.js';

export const SCHEMA_VERSION = 3;

export const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'cash'];
export const CATEGORY_TYPES = ['expense', 'income', 'fund', 'debt'];

/** A starter plan so the first run is not an empty page. Everything is editable. */
const TEMPLATE = [
  { name: 'Income', kind: 'income', cats: [['Paycheck 1', 'income'], ['Paycheck 2', 'income'], ['Other income', 'income']] },
  { name: 'Giving', cats: [['Charity', 'expense']] },
  { name: 'Savings', cats: [['Emergency fund', 'fund'], ['Car repairs', 'fund'], ['Annual bills', 'fund'], ['Vacation', 'fund']] },
  { name: 'Housing', cats: [['Rent / mortgage', 'expense', 1], ['Electric', 'expense'], ['Water', 'expense'], ['Internet', 'expense'], ['Phone', 'expense']] },
  { name: 'Transportation', cats: [['Gas', 'expense'], ['Car insurance', 'expense']] },
  { name: 'Food', cats: [['Groceries', 'expense'], ['Restaurants', 'expense']] },
  { name: 'Personal', cats: [['Clothing', 'expense'], ['Fun money', 'expense'], ['Subscriptions', 'expense']] },
  { name: 'Health', cats: [['Medical', 'expense'], ['Pharmacy', 'expense']] }
];

export function defaultState() {
  const groups = [];
  const categories = [];
  TEMPLATE.forEach((g, gi) => {
    const group = { id: uid('g_'), name: g.name, kind: g.kind === 'income' ? 'income' : 'expense', sort: gi };
    groups.push(group);
    g.cats.forEach(([name, type, dueDay], ci) => {
      const c = { id: uid('c_'), groupId: group.id, name, type, sort: ci };
      if (dueDay) c.dueDay = dueDay;
      categories.push(c);
    });
  });
  return {
    version: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    settings: {
      currency: 'USD',
      locale: 'en-US',
      matchWindowDays: 5,
      dateOrder: 'mdy',
      householdName: '',
      btcLookups: true,
      btcApi: 'https://mempool.space/api',
      btcElectrs: '',
      ntfy: structuredClone(DEFAULT_NTFY)
    },
    accounts: [{ id: uid('a_'), name: 'Checking', type: 'checking', openingBalance: 0, archived: false }],
    groups,
    categories,
    months: {},
    transactions: [],
    debts: [],
    statements: [],
    payeeRules: {},
    wallets: [],
    btc: { price: null, priceAt: null },
    networth: defaultNetWorth()
  };
}

export function defaultNetWorth() {
  return { assets: [], liabilities: [], history: [], goals: [], include: { accounts: true, bitcoin: true, debts: true } };
}

/** Bring older or imported data up to the current shape; never throws on missing keys. */
export function migrate(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('not a ZeroDollar data file');
  const d = defaultState();
  const out = { ...d, ...s };
  out.settings = { ...d.settings, ...(s.settings || {}) };
  const n = out.settings.ntfy && typeof out.settings.ntfy === 'object' ? out.settings.ntfy : {};
  out.settings.ntfy = { ...DEFAULT_NTFY, ...n, weekly: { ...DEFAULT_NTFY.weekly, ...(n.weekly || {}) }, monthly: { ...DEFAULT_NTFY.monthly, ...(n.monthly || {}) } };
  for (const k of ['accounts', 'groups', 'categories', 'transactions', 'debts', 'statements']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  if (!out.months || typeof out.months !== 'object') out.months = {};
  if (!out.payeeRules || typeof out.payeeRules !== 'object') out.payeeRules = {};
  if (!Array.isArray(out.wallets)) out.wallets = [];
  if (!out.btc || typeof out.btc !== 'object') out.btc = { price: null, priceAt: null };
  const nw = out.networth && typeof out.networth === 'object' ? out.networth : {};
  out.networth = { ...defaultNetWorth(), ...nw, include: { ...defaultNetWorth().include, ...(nw.include || {}) } };
  for (const k of ['assets', 'liabilities', 'history', 'goals']) if (!Array.isArray(out.networth[k])) out.networth[k] = [];
  // If an import has no data at all, keep the starter plan.
  if (!out.groups.length && !out.categories.length) {
    out.groups = d.groups;
    out.categories = d.categories;
  }
  if (!out.accounts.length) out.accounts = d.accounts;
  out.version = SCHEMA_VERSION;
  return out;
}
