import { HttpError, uid, bad, notFound, daysBetween, similarity, normPayee, clampStr } from './util.js';
import { signedFor, byId } from './budget.js';
import { rowKey } from './parsers.js';

/* A statement is an uploaded bank file turned into rows. Each row ends up as:
   matched   - linked to a transaction you already entered
   suggested - a likely match that needs your OK (a tip made the amount differ, say)
   added     - turned into a new transaction
   ignored   - set aside (or a duplicate from an earlier upload)
   new       - still needs a decision                                              */

const LINKED = new Set(['matched', 'added']);

export const rowAmount = (st, row) => (st.flip ? -row.amount : row.amount);

function getStatement(state, id) {
  const st = state.statements.find((s) => s.id === id);
  if (!st) throw notFound('Statement not found');
  return st;
}
function open(st) {
  if (st.finalizedAt) throw new HttpError(409, 'This statement is already reconciled. Undo the reconciliation to change it.');
}
function getRow(st, rowId) {
  const r = st.rows.find((x) => x.id === rowId);
  if (!r) throw notFound('Row not found');
  return r;
}

/** Transaction ids already claimed by some statement row. */
export function linkedTxIds(state) {
  const set = new Set();
  for (const s of state.statements) {
    for (const r of s.rows) if (r.txId && (LINKED.has(r.status) || r.status === 'suggested')) set.add(r.txId);
  }
  return set;
}

function titleIfShouty(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t && t === t.toUpperCase() && /[A-Z]{3}/.test(t)) {
    return t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  return t;
}

/* ------------------------------------------------------- payee memory */

export function suggestCategory(state, text) {
  if (!text) return null;
  const valid = (id) => id && state.categories.some((c) => c.id === id && !c.archived);
  const exact = state.payeeRules[normPayee(text)];
  if (valid(exact)) return exact;
  let best = null;
  let score = 0;
  for (const [k, v] of Object.entries(state.payeeRules)) {
    if (!valid(v)) continue;
    const s = similarity(text, k);
    if (s > score) {
      score = s;
      best = v;
    }
  }
  return score >= 0.7 ? best : null;
}

export function learnPayee(state, tx) {
  if (tx.type === 'transfer' || !tx.payee || !tx.catId) return;
  const key = normPayee(tx.payee);
  if (!key) return;
  state.payeeRules[key] = tx.catId;
  const keys = Object.keys(state.payeeRules);
  if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete state.payeeRules[k];
}

/* ------------------------------------------------------------ matching */

function candidatesFor(state, st) {
  const claimed = linkedTxIds(state);
  return state.transactions.filter(
    (t) => !t.reconciled && !claimed.has(t.id) && (t.accountId === st.accountId || t.toAccountId === st.accountId) && signedFor(t, st.accountId) !== 0
  );
}

export function autoMatch(state, st) {
  const W = state.settings.matchWindowDays ?? 5;
  // Drop earlier automatic guesses; keep anything the user decided by hand.
  for (const r of st.rows) {
    if (r.status === 'suggested' || (r.status === 'matched' && r.auto)) {
      r.status = 'new';
      r.txId = null;
      r.auto = false;
    }
  }
  const cands = candidatesFor(state, st);
  const rows = st.rows.filter((r) => r.status === 'new');
  const pairs = [];
  const sugg = [];
  for (const r of rows) {
    const amt = rowAmount(st, r);
    for (const t of cands) {
      const days = Math.abs(daysBetween(r.date, t.date));
      if (days > W) continue;
      const sim = similarity(r.desc, `${t.payee || ''} ${t.memo || ''}`);
      const signed = signedFor(t, st.accountId);
      if (signed === amt) pairs.push({ r, t, score: 100 - days * 10 + sim * 30 });
      else if (amt < 0 && signed < 0 && Math.sign(signed) === Math.sign(amt)) {
        // restaurant tips and fuel pre-auths: charged a bit more than what you entered
        const ratio = amt / signed;
        if (ratio > 1 && ratio <= 1.4 && sim >= 0.5) sugg.push({ r, t, score: 50 - days * 5 + sim * 30 });
      }
    }
  }
  const usedR = new Set();
  const usedT = new Set();
  for (const p of pairs.sort((a, b) => b.score - a.score)) {
    if (usedR.has(p.r.id) || usedT.has(p.t.id)) continue;
    usedR.add(p.r.id);
    usedT.add(p.t.id);
    p.r.status = 'matched';
    p.r.txId = p.t.id;
    p.r.auto = true;
  }
  for (const p of sugg.sort((a, b) => b.score - a.score)) {
    if (usedR.has(p.r.id) || usedT.has(p.t.id)) continue;
    usedR.add(p.r.id);
    usedT.add(p.t.id);
    p.r.status = 'suggested';
    p.r.txId = p.t.id;
  }
}

/* --------------------------------------------------------------- create */

export function createStatement(state, { accountId, fileName, parsed, flip }) {
  const acct = state.accounts.find((a) => a.id === accountId);
  if (!acct) throw bad('Pick an account for this statement');
  const rows = parsed.rows.map((r, i) => ({ id: `r${i + 1}`, date: r.date, amount: r.amount, desc: r.desc, ...(r.fitid ? { fitid: r.fitid } : {}), status: 'new', txId: null, auto: false }));

  // Credit-card CSVs often list charges as positive numbers. If nearly everything is positive on a credit account, flip.
  let doFlip = !!flip;
  if (flip == null && parsed.format === 'csv' && acct.type === 'credit' && rows.length >= 3) {
    const pos = rows.filter((r) => r.amount > 0).length;
    doFlip = pos / rows.length > 0.8;
  }

  // Skip rows that were already in an earlier upload for this account.
  const seen = new Map();
  for (const s of state.statements) {
    if (s.accountId !== accountId) continue;
    for (const r of s.rows) if (r.dup !== true) seen.set(rowKey(r), (seen.get(rowKey(r)) || 0) + 1);
  }
  let dups = 0;
  for (const r of rows) {
    const k = rowKey(r);
    const n = seen.get(k) || 0;
    if (n > 0) {
      seen.set(k, n - 1);
      r.status = 'ignored';
      r.dup = true;
      dups++;
    }
  }

  const st = {
    id: uid('s_'),
    accountId,
    fileName: clampStr(fileName, 120),
    format: parsed.format,
    importedAt: new Date().toISOString(),
    flip: doFlip,
    endBalance: parsed.endBalance ?? null,
    endDate: parsed.endDate ?? null,
    warnings: [...(parsed.warnings || []), ...(dups ? [`${dups} row${dups === 1 ? ' was' : 's were'} already in an earlier upload and set aside.`] : [])],
    rows,
    finalizedAt: null
  };
  state.statements.push(st);
  autoMatch(state, st);
  return st;
}

/* ------------------------------------------------------- manual actions */

export function setFlip(state, id, flip) {
  const st = getStatement(state, id);
  open(st);
  st.flip = !!flip;
  autoMatch(state, st);
  return st;
}

export function link(state, id, rowId, txId) {
  const st = getStatement(state, id);
  open(st);
  const row = getRow(st, rowId);
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) throw notFound('Transaction not found');
  if (tx.reconciled) throw bad('That transaction is already reconciled');
  if (tx.accountId !== st.accountId && tx.toAccountId !== st.accountId) throw bad('That transaction belongs to a different account');
  // free it if another row in this or another open statement holds it
  for (const s of state.statements) {
    for (const r of s.rows) {
      if (r.txId === txId && r !== row && (LINKED.has(r.status) || r.status === 'suggested')) {
        if (s.finalizedAt) throw bad('That transaction is part of a reconciled statement');
        if (r.status === 'added') throw bad('That transaction was created from another statement row');
        r.status = 'new';
        r.txId = null;
        r.auto = false;
      }
    }
  }
  if (row.status === 'added') throw bad('This row already created a transaction. Remove it first.');
  row.status = 'matched';
  row.txId = txId;
  row.auto = false;
  return st;
}

export function unlink(state, id, rowId) {
  const st = getStatement(state, id);
  open(st);
  const row = getRow(st, rowId);
  if (row.status === 'added' && row.txId) {
    const i = state.transactions.findIndex((t) => t.id === row.txId);
    if (i >= 0 && !state.transactions[i].reconciled) state.transactions.splice(i, 1);
  }
  row.status = 'new';
  row.txId = null;
  row.auto = false;
  return st;
}

export function accept(state, id, rowId) {
  const st = getStatement(state, id);
  open(st);
  const row = getRow(st, rowId);
  if (row.status !== 'suggested' || !row.txId) throw bad('Nothing to accept on that row');
  row.status = 'matched';
  row.auto = false;
  return st;
}

export function ignoreRow(state, id, rowId, ignore = true) {
  const st = getStatement(state, id);
  open(st);
  const row = getRow(st, rowId);
  if (row.status === 'added') throw bad('Remove the added transaction first');
  row.status = ignore ? 'ignored' : 'new';
  row.txId = null;
  row.auto = false;
  if (!ignore) row.dup = false;
  return st;
}

/** Turn a statement row into a real transaction. `opts` may carry catId, splits, payee, memo, transferTo. */
export function addRow(state, id, rowId, opts = {}) {
  const st = getStatement(state, id);
  open(st);
  const row = getRow(st, rowId);
  if (row.status === 'added' || row.status === 'matched') throw bad('That row is already resolved');
  const amt = rowAmount(st, row);
  if (amt === 0) throw bad('Zero-amount rows cannot be added');
  const payee = clampStr(opts.payee || titleIfShouty(row.desc), 80);
  const tx = {
    id: uid('t_'),
    date: row.date,
    type: amt < 0 ? 'expense' : 'income',
    amount: Math.abs(amt),
    accountId: st.accountId,
    payee,
    memo: clampStr(opts.memo || '', 200),
    catId: null,
    reconciled: false,
    source: 'statement',
    createdAt: new Date().toISOString()
  };
  if (opts.transferTo) {
    if (!state.accounts.some((a) => a.id === opts.transferTo) || opts.transferTo === st.accountId) throw bad('Pick a different account to transfer with');
    tx.type = 'transfer';
    if (amt < 0) tx.toAccountId = opts.transferTo;
    else {
      tx.accountId = opts.transferTo;
      tx.toAccountId = st.accountId;
    }
  } else if (Array.isArray(opts.splits) && opts.splits.length) {
    const cats = byId(state.categories);
    let sum = 0;
    tx.splits = opts.splits.map((p) => {
      if (!cats.has(p.catId) || !Number.isInteger(p.amount) || p.amount <= 0) throw bad('Invalid split');
      sum += p.amount;
      return { catId: p.catId, amount: p.amount };
    });
    if (sum !== tx.amount) throw bad('Splits must add up to the statement amount');
  } else {
    const cat = opts.catId ?? suggestCategory(state, row.desc);
    if (cat && !state.categories.some((c) => c.id === cat)) throw bad('Unknown category');
    tx.catId = cat || null;
  }
  state.transactions.push(tx);
  learnPayee(state, tx);
  row.status = 'added';
  row.txId = tx.id;
  row.auto = false;
  return { st, tx };
}

/** Add every undecided row. With onlyKnown, rows whose payee has no remembered category stay for you to handle. */
export function addAll(state, id, { onlyKnown = true } = {}) {
  const st = getStatement(state, id);
  open(st);
  let added = 0;
  for (const row of st.rows) {
    if (row.status !== 'new' || rowAmount(st, row) === 0) continue;
    if (onlyKnown && !suggestCategory(state, row.desc)) continue;
    addRow(state, id, row.id);
    added++;
  }
  return { st, added };
}

/* ------------------------------------------------------------ summary */

export function statementSummary(state, st) {
  const acct = state.accounts.find((a) => a.id === st.accountId);
  const txById = byId(state.transactions);
  const counts = { new: 0, matched: 0, suggested: 0, added: 0, ignored: 0 };
  for (const r of st.rows) counts[r.status]++;
  const linked = new Set(st.rows.filter((r) => LINKED.has(r.status) && r.txId).map((r) => r.txId));

  let cleared = acct?.openingBalance || 0;
  for (const t of state.transactions) {
    if (t.reconciled || linked.has(t.id)) cleared += signedFor(t, st.accountId);
  }
  const difference = st.endBalance == null ? null : st.endBalance - cleared;

  // Entered in the app but not on this statement (pending, or entered on the wrong date)
  let leftover = [];
  if (st.rows.length) {
    const W = state.settings.matchWindowDays ?? 5;
    const dates = st.rows.map((r) => r.date).sort();
    const lo = dates[0];
    const hi = dates[dates.length - 1];
    const claimed = linkedTxIds(state);
    leftover = state.transactions
      .filter(
        (t) =>
          !t.reconciled &&
          !claimed.has(t.id) &&
          (t.accountId === st.accountId || t.toAccountId === st.accountId) &&
          Math.abs(daysBetween(lo, t.date)) <= 400 &&
          t.date >= lo &&
          t.date <= hi &&
          signedFor(t, st.accountId) !== 0
      )
      .map((t) => t.id);
    void W;
  }

  return {
    counts,
    total: st.rows.length,
    unresolved: counts.new + counts.suggested,
    cleared,
    difference,
    leftover,
    txById: Object.fromEntries(
      [...linked, ...st.rows.filter((r) => r.txId).map((r) => r.txId), ...leftover]
        .filter((tid) => txById.has(tid))
        .map((tid) => [tid, txById.get(tid)])
    )
  };
}

export function finalize(state, id, { endBalance = undefined, force = false } = {}) {
  const st = getStatement(state, id);
  open(st);
  if (endBalance !== undefined) {
    if (endBalance !== null && !Number.isInteger(endBalance)) throw bad('Ending balance must be in cents');
    st.endBalance = endBalance;
  }
  const unresolved = st.rows.filter((r) => r.status === 'new' || r.status === 'suggested').length;
  if (unresolved && !force) throw bad(`${unresolved} row${unresolved === 1 ? ' is' : 's are'} still undecided. Match, add or ignore ${unresolved === 1 ? 'it' : 'them'} first.`);
  const stamp = new Date().toISOString();
  let n = 0;
  for (const r of st.rows) {
    if (!LINKED.has(r.status) || !r.txId) continue;
    const tx = state.transactions.find((t) => t.id === r.txId);
    if (!tx) continue;
    tx.reconciled = true;
    tx.reconciledAt = stamp;
    tx.statementId = st.id;
    n++;
  }
  st.finalizedAt = stamp;
  return { st, reconciled: n };
}

export function reopen(state, id) {
  const st = getStatement(state, id);
  if (!st.finalizedAt) return st;
  for (const t of state.transactions) {
    if (t.statementId === st.id) {
      t.reconciled = false;
      delete t.reconciledAt;
      delete t.statementId;
    }
  }
  st.finalizedAt = null;
  return st;
}

export function removeStatement(state, id) {
  const st = getStatement(state, id);
  reopen(state, id);
  // Transactions created from this statement stay; only the upload record goes away.
  state.statements = state.statements.filter((s) => s.id !== id);
}

export { getStatement };
