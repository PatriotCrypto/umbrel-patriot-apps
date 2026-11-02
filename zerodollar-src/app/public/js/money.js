/* Money helpers shared by every screen. Amounts are integer cents everywhere. */

/** "12", "12.5", "$1,234.56", "(5.00)", "-5", "12,50" -> cents, or null when it is not a number. */
export function parseMoney(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s$€£¥]/g, '');
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const dot = s.lastIndexOf('.');
  const com = s.lastIndexOf(',');
  if (dot >= 0 && com >= 0) s = com > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (com >= 0) s = s.length - com - 1 === 2 && s.indexOf(',') === com ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return neg ? -c : c;
}

export function makeFormatter(currency = 'USD', locale = 'en-US') {
  let nf;
  let plainNf;
  try {
    nf = new Intl.NumberFormat(locale, { style: 'currency', currency });
    plainNf = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  } catch {
    nf = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    plainNf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  }
  return {
    /** $1,234.56 */
    fmt: (c) => nf.format((c || 0) / 100),
    /** whole dollars for charts: $1,235 */
    short: (c) => new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format((c || 0) / 100),
    /** 1234.56, for input boxes */
    plain: (c) => (c ? plainNf.format(c / 100) : ''),
    symbol: nf.formatToParts(1).find((p) => p.type === 'currency')?.value || '$'
  };
}
