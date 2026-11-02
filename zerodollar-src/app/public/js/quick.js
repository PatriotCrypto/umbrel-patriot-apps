import { parseMoney } from './money.js';

const INCOME_WORDS = /\b(income|paycheck|payroll|deposit|refund|received|salary|bonus)\b/i;

const titleCase = (s) => (s === s.toLowerCase() ? s.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);
export const norm = (s) => String(s || '').toLowerCase().replace(/[0-9#*]+/g, ' ').replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Turn "45.20 kroger groceries" or "yesterday 12 chipotle" into fields for a transaction.
 * ctx: { categories, rules (normalised payee -> category id), today: 'YYYY-MM-DD' }
 */
export function parseQuick(text, ctx = {}) {
  const out = { amount: null, type: 'expense', payee: '', catId: null, date: null };
  let t = ` ${String(text || '').trim()} `;
  if (!t.trim()) return out;

  if (/^\s*\+/.test(t) || INCOME_WORDS.test(t)) out.type = 'income';

  // dates: yesterday / today / m/d / m/d/yy
  if (/\b(yesterday|yday)\b/i.test(t) && ctx.today) {
    const d = new Date(ctx.today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    out.date = d.toISOString().slice(0, 10);
    t = t.replace(/\b(yesterday|yday)\b/i, ' ');
  } else if (/\btoday\b/i.test(t)) {
    out.date = ctx.today || null;
    t = t.replace(/\btoday\b/i, ' ');
  }
  const dm = t.match(/(?<![\d./])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/);
  if (dm && ctx.today) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : +ctx.today.slice(0, 4);
    const iso = `${y}-${String(+dm[1]).padStart(2, '0')}-${String(+dm[2]).padStart(2, '0')}`;
    const dt = new Date(iso + 'T00:00:00Z');
    if (!Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso) {
      out.date = iso;
      t = t.replace(dm[0], ' ');
    }
  }

  // amount: first money-looking number
  const am = t.match(/(?<![\w.#])[+-]?\$?\d[\d,]*(?:\.\d{1,2})?(?![\w.])/);
  if (am) {
    const c = parseMoney(am[0]);
    if (c != null) {
      out.amount = Math.abs(c);
      t = t.replace(am[0], ' ');
    }
  }
  t = t.replace(INCOME_WORDS, ' ').replace(/\s+/g, ' ').trim();

  // a category named in the text wins; longest name first
  const cats = (ctx.categories || []).filter((c) => !c.archived && (out.type === 'income' ? c.type === 'income' : c.type !== 'income'));
  for (const c of [...cats].sort((a, b) => b.name.length - a.name.length)) {
    const re = new RegExp(`(^|\\s)${esc(c.name.toLowerCase())}(?=\\s|$)`, 'i');
    if (re.test(t)) {
      out.catId = c.id;
      t = t.replace(re, ' ').replace(/\s+/g, ' ').trim();
      break;
    }
  }
  out.payee = titleCase(t);
  if (!out.catId && out.payee && ctx.rules) {
    const hit = ctx.rules[norm(out.payee)];
    if (hit && (ctx.categories || []).some((c) => c.id === hit && !c.archived)) out.catId = hit;
  }
  return out;
}
