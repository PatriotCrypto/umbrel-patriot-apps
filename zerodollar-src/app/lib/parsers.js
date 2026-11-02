import { bad, isDate, normPayee } from './util.js';

/* ------------------------------------------------------------------ amounts */

/** Parse a money string to integer cents, or null. Handles $1,234.56  (12.34)  12.34-  1.234,56  CR/DR */
export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/\bDR\b/i.test(s)) neg = true;
  s = s.replace(/\b(CR|DR)\b/gi, '');
  s = s.replace(/[A-Za-z$€£¥\s]/g, '');
  if (s.endsWith('-')) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const after = s.length - lastComma - 1;
    s = after === 2 && s.indexOf(',') === lastComma ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return neg ? -cents : cents;
}

/* -------------------------------------------------------------------- dates */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const p2 = (n) => String(n).padStart(2, '0');

function build(y, m, d) {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  const s = `${String(y).padStart(4, '0')}-${p2(m)}-${p2(d)}`;
  return isDate(s) ? s : null;
}

/** order: 'mdy' | 'dmy'. Only used for ambiguous numeric dates. */
export function parseDate(raw, order = 'mdy') {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/))) return build(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/))) return build(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{0,6}.*)?$/))) return build(+m[1], +m[2], +m[3]); // OFX style
  if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/))) {
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    if (a > 12) return build(y, b, a);
    if (b > 12) return build(y, a, b);
    return order === 'dmy' ? build(y, b, a) : build(y, a, b);
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/))) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return build(+m[3], mi + 1, +m[2]);
  }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{2,4})/))) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return build(+m[3], mi + 1, +m[1]);
  }
  return null;
}

/** If any ambiguous numeric date has a first part > 12 the file is day-first; if a second part > 12 it is month-first. */
function detectOrder(dateStrings, fallback) {
  let dmy = false;
  let mdy = false;
  for (const s of dateStrings) {
    const m = String(s || '').trim().match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
    if (!m) continue;
    if (+m[1] > 12) dmy = true;
    if (+m[2] > 12) mdy = true;
  }
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  return fallback;
}

/* ---------------------------------------------------------------------- csv */

/** Minimal RFC-4180 parser with quoted fields and embedded newlines. */
export function parseCSVText(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).filter(Boolean).slice(0, 10).join('\n');
  let best = ',';
  let bestN = -1;
  for (const d of [',', ';', '\t', '|']) {
    const n = sample.split(d).length;
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

const H = {
  date: [/^post(ed|ing)?\s*date$/, /^trans(action)?\.?\s*date$/, /^(booking|value|effective)\s*date$/, /^date$/],
  desc: [/^(transaction\s*)?description$/, /^details?$/, /^payee$/, /^merchant$/, /^name$/, /^narrative$/, /^memo$/, /^reference$/, /^original description$/],
  amount: [/^(transaction\s*)?amount$/, /^amt$/, /^value$/],
  debit: [/^debits?$/, /^withdrawals?$/, /^money\s*out$/, /^paid\s*out$/, /^charges?$/, /^payments?$/],
  credit: [/^credits?$/, /^deposits?$/, /^money\s*in$/, /^paid\s*in$/],
  balance: [/^(running\s*)?balance$/, /^bal$/],
  type: [/^(transaction\s*)?type$/, /^dr\/?cr$/, /^debit\/?credit$/],
  check: [/^(check|cheque)\s*(number|no\.?|#)?$/],
  id: [/^(fit\s*id|transaction\s*id|reference\s*number|ref\s*no\.?|id)$/]
};

function mapHeader(cells) {
  const idx = {};
  const norm = cells.map((c) => c.trim().toLowerCase().replace(/\s+/g, ' '));
  for (const [key, pats] of Object.entries(H)) {
    for (const pat of pats) {
      const i = norm.findIndex((c, ix) => pat.test(c) && !Object.values(idx).includes(ix));
      if (i >= 0) {
        idx[key] = i;
        break;
      }
    }
  }
  return idx;
}

/** Position-based guess for header-less files. */
function guessColumns(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  const sample = rows.slice(0, 25);
  const idx = {};
  let amountScore = 0;
  let dateScore = 0;
  let descScore = 0;
  for (let c = 0; c < width; c++) {
    const col = sample.map((r) => (r[c] || '').trim()).filter(Boolean);
    if (!col.length) continue;
    const dates = col.filter((v) => parseDate(v) && /[\d]/.test(v)).length / col.length;
    const nums = col.filter((v) => parseAmount(v) != null && /^[-+($\s\d.,)]+[\d.,)\sCRDcrd-]*$/.test(v)).length / col.length;
    const avgLen = col.reduce((a, v) => a + v.length, 0) / col.length;
    if (dates > 0.8 && dates > dateScore) {
      idx.date = c;
      dateScore = dates;
    } else if (nums > 0.8 && avgLen < 16) {
      if (idx.amount == null) {
        idx.amount = c;
        amountScore = nums;
      }
    } else if (avgLen >= 6 && avgLen > descScore) {
      idx.desc = c;
      descScore = avgLen;
    }
  }
  void amountScore;
  return idx;
}

export function parseCSV(text, { dateOrder = 'mdy' } = {}) {
  const delim = detectDelimiter(text);
  const all = parseCSVText(text, delim);
  if (all.length < 1) throw bad('That file looks empty.');

  // Many banks put account info above the header. The header is the first row with 2+ recognised names.
  let headerAt = -1;
  let map = {};
  for (let i = 0; i < Math.min(all.length, 30); i++) {
    const m = mapHeader(all[i]);
    if (m.date != null && (m.amount != null || m.debit != null || m.credit != null) ) {
      headerAt = i;
      map = m;
      break;
    }
  }
  let body;
  const warnings = [];
  if (headerAt >= 0) body = all.slice(headerAt + 1);
  else {
    map = guessColumns(all);
    body = all;
    if (map.date == null || map.amount == null) throw bad('Could not find date and amount columns in that CSV. It needs a header row such as Date, Description, Amount.');
    warnings.push('No header row found; columns were guessed. Check the results carefully.');
  }
  if (map.desc == null) {
    // pick the widest remaining text column
    const used = new Set(Object.values(map));
    let best = -1;
    let bestLen = 0;
    const width = Math.max(...body.map((r) => r.length), 0);
    for (let c = 0; c < width; c++) {
      if (used.has(c)) continue;
      const len = body.slice(0, 20).reduce((a, r) => a + (r[c] || '').length, 0);
      if (len > bestLen) {
        best = c;
        bestLen = len;
      }
    }
    if (best >= 0) map.desc = best;
  }

  const order = detectOrder(body.map((r) => r[map.date]), dateOrder);
  // A Type column only decides the sign when the Amount column is unsigned (every value positive).
  const unsigned = map.amount != null && map.type != null && body.every((r) => {
    const a = parseAmount(r[map.amount]);
    return a == null || a >= 0;
  });
  const rows = [];
  let skipped = 0;
  for (const r of body) {
    const date = parseDate(r[map.date], order);
    let amount = null;
    if (map.amount != null) {
      amount = parseAmount(r[map.amount]);
      if (amount != null && unsigned) {
        const t = String(r[map.type] || '').trim().toLowerCase();
        if (amount > 0 && /^(debit|dr|dbt|withdrawal)$/.test(t)) amount = -amount;
      }
    }
    if (amount == null && (map.debit != null || map.credit != null)) {
      const d = map.debit != null ? parseAmount(r[map.debit]) : null;
      const c = map.credit != null ? parseAmount(r[map.credit]) : null;
      if (d) amount = -Math.abs(d);
      else if (c) amount = Math.abs(c);
      else if (d === 0 || c === 0) amount = 0;
    }
    if (!date || amount == null) {
      skipped++;
      continue;
    }
    const desc = (map.desc != null ? r[map.desc] || '' : '').replace(/\s+/g, ' ').trim();
    const row = { date, amount, desc: desc || '(no description)' };
    if (map.id != null && r[map.id]?.trim()) row.fitid = r[map.id].trim();
    if (map.balance != null) {
      const b = parseAmount(r[map.balance]);
      if (b != null) row.balance = b;
    }
    rows.push(row);
  }
  if (skipped) warnings.push(`${skipped} line${skipped === 1 ? '' : 's'} could not be read and were skipped.`);
  if (!rows.length) throw bad('No transactions could be read from that CSV.');

  // Ending balance: the balance on the latest-dated row, when the file has a balance column.
  let endBalance = null;
  let endDate = null;
  if (map.balance != null) {
    const withBal = rows.filter((r) => r.balance != null);
    if (withBal.length) {
      const latest = withBal.reduce((a, b) => (b.date >= a.date ? b : a));
      // statements list newest-first or oldest-first; for ties on date prefer file order extremes
      const first = withBal[0];
      const last = withBal[withBal.length - 1];
      const pick = first.date > last.date ? first : last.date > first.date ? last : latest;
      endBalance = pick.balance;
      endDate = pick.date;
    }
  }
  return { format: 'csv', rows, endBalance, endDate, warnings };
}

/* ---------------------------------------------------------------------- ofx */

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
}
const decodeEntities = (s) => s.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");

export function parseOFX(text) {
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTRS>|<\/STMTRS>|$)/gi) || [];
  const rows = [];
  let skipped = 0;
  for (const b of blocks) {
    const date = parseDate(tag(b, 'DTPOSTED') || '', 'mdy');
    const amount = parseAmount(tag(b, 'TRNAMT'));
    if (!date || amount == null) {
      skipped++;
      continue;
    }
    const name = decodeEntities(tag(b, 'NAME') || tag(b, 'PAYEE') || '');
    const memo = decodeEntities(tag(b, 'MEMO') || '');
    let desc = name;
    if (memo && memo.toLowerCase() !== name.toLowerCase()) desc = name ? `${name} ${memo}` : memo;
    const row = { date, amount, desc: desc.replace(/\s+/g, ' ').trim() || '(no description)' };
    const fitid = tag(b, 'FITID');
    if (fitid) row.fitid = fitid;
    const chk = tag(b, 'CHECKNUM');
    if (chk) row.check = chk;
    rows.push(row);
  }
  if (!rows.length) throw bad('No transactions were found in that OFX/QFX file.');
  const warnings = skipped ? [`${skipped} entr${skipped === 1 ? 'y' : 'ies'} could not be read and were skipped.`] : [];
  let endBalance = null;
  let endDate = null;
  const led = text.match(/<LEDGERBAL>[\s\S]*?(?=<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>|$)/i);
  if (led) {
    endBalance = parseAmount(tag(led[0], 'BALAMT'));
    endDate = parseDate(tag(led[0], 'DTASOF') || '', 'mdy');
  }
  return { format: 'ofx', rows, endBalance, endDate, warnings };
}

/* ------------------------------------------------------------------ front door */

export function parseStatement(text, fileName = '', opts = {}) {
  if (typeof text !== 'string' || !text.trim()) throw bad('That file is empty.');
  const t = text.replace(/^﻿/, '');
  const head = t.slice(0, 2000);
  if (/^%PDF/.test(head)) throw bad('PDF statements cannot be read. Download your bank\'s CSV or OFX/QFX export instead.');
  if (/<OFX>|<STMTTRN>|OFXHEADER/i.test(head) || /<STMTTRN>/i.test(t) || /\.(ofx|qfx)$/i.test(fileName)) return parseOFX(t);
  return parseCSV(t, opts);
}

/** Stable key for duplicate detection between statements. */
export function rowKey(r) {
  return r.fitid ? `id:${r.fitid}` : `${r.date}|${r.amount}|${normPayee(r.desc)}`;
}
