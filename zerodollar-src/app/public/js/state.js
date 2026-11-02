import { api } from './api.js';
import { makeFormatter } from './money.js';
import { monthNow } from './ui.js';

/* App-wide state: reference data from /api/meta plus the month being viewed. */
export const S = {
  meta: null,
  month: monthNow(),
  money: makeFormatter(),
  catMap: new Map(),
  acctMap: new Map()
};

try {
  const saved = sessionStorage.getItem('zd.month');
  if (/^\d{4}-\d{2}$/.test(saved || '')) S.month = saved;
} catch {}

export function setMonth(m) {
  S.month = m;
  try {
    sessionStorage.setItem('zd.month', m);
  } catch {}
}

export async function loadMeta() {
  S.meta = await api.get('/meta');
  S.money = makeFormatter(S.meta.settings.currency, S.meta.settings.locale);
  S.catMap = new Map(S.meta.categories.map((c) => [c.id, c]));
  S.acctMap = new Map(S.meta.accounts.map((a) => [a.id, a]));
  return S.meta;
}

export const fmt = (c) => S.money.fmt(c);
export const activeAccounts = () => S.meta.accounts.filter((a) => !a.archived);
export const catName = (id) => S.catMap.get(id)?.name || '';

export const THEMES = [
  { id: 'daylight', name: 'Daylight', note: 'Clean and bright' },
  { id: 'midnight', name: 'Midnight', note: 'Easy on the eyes after dark' },
  { id: 'paper', name: 'Paper', note: 'A warm, bookish ledger' },
  { id: 'terminal', name: 'Terminal', note: 'Green phosphor on black' }
];
export function setTheme(id) {
  if (!THEMES.some((t) => t.id === id)) id = 'daylight';
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem('zd.theme', id);
  } catch {}
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
}
export const currentTheme = () => document.documentElement.dataset.theme || 'daylight';
