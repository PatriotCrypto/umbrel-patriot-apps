import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

export const uid = (prefix = '') => prefix + crypto.randomBytes(6).toString('hex');

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const monthOf = (date) => date.slice(0, 7);

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export function monthEnd(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, '0')}`;
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---- text helpers used for payee memory and statement matching ---- */
const NOISE = new Set([
  'pos', 'purchase', 'debit', 'credit', 'card', 'checkcard', 'visa', 'mastercard', 'mc', 'ach', 'payment', 'pmt',
  'www', 'com', 'online', 'the', 'and', 'inc', 'llc', 'co', 'corp', 'store', 'sq', 'tst', 'pp', 'recurring',
  'withdrawal', 'deposit', 'transfer', 'from', 'to', 'web', 'id', 'ref', 'dbt', 'crd'
]);
export function normPayee(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[0-9#*]+/g, ' ')
    .replace(/[^a-z& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function tokens(s) {
  return normPayee(s)
    .split(' ')
    .filter((t) => t.length > 1 && !NOISE.has(t));
}
/** 0..1. Blend of Jaccard and coverage of the shorter side, so "STARBUCKS #123 SEATTLE" ~ "Starbucks". */
export function similarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) {
    if (B.has(t)) inter++;
    else {
      for (const u of B) {
        if (t.length >= 4 && u.length >= 4 && (t.startsWith(u) || u.startsWith(t))) {
          inter += 0.8;
          break;
        }
      }
    }
  }
  const jaccard = inter / (A.size + B.size - inter);
  const cover = inter / Math.min(A.size, B.size);
  return Math.min(1, 0.4 * jaccard + 0.6 * cover);
}

export const clampStr = (v, max = 120) => String(v ?? '').trim().slice(0, max);
export const MAX_CENTS = 100_000_000_00; // $100M ceiling guards against typos and overflow

export function asCents(v, { allowNegative = false, name = 'amount' } = {}) {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw bad(`${name} must be a whole number of cents`);
  if (!allowNegative && v < 0) throw bad(`${name} cannot be negative`);
  if (Math.abs(v) > MAX_CENTS) throw bad(`${name} is too large`);
  return v;
}
