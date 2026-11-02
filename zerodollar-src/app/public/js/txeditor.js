import { h, modal, icon, toast, guard, todayLocal, confirmDialog } from './ui.js';
import { api } from './api.js';
import { S, fmt, activeAccounts, loadMeta } from './state.js';
import { parseMoney } from './money.js';
import { parseQuick, norm } from './quick.js';

/** <select> of categories grouped by budget group. kind: 'income' | 'expense' */
export function categorySelect(kind, value, { blank = 'Uncategorized', onchange } = {}) {
  const sel = h('select', { 'aria-label': 'Category', onchange });
  sel.append(h('option', { value: '' }, blank));
  const groups = [...S.meta.groups].filter((g) => !g.archived).sort((a, b) => a.sort - b.sort);
  for (const g of groups) {
    const cats = S.meta.categories.filter((c) => c.groupId === g.id && !c.archived && (kind === 'income' ? c.type === 'income' : c.type !== 'income')).sort((a, b) => a.sort - b.sort);
    if (!cats.length) continue;
    const og = h('optgroup', { label: g.name });
    for (const c of cats) og.append(h('option', { value: c.id }, c.name));
    sel.append(og);
  }
  // keep an archived category selectable when editing an old transaction
  if (value && !sel.querySelector(`option[value="${value}"]`)) {
    const c = S.catMap.get(value);
    if (c) sel.append(h('option', { value }, c.name + ' (archived)'));
  }
  sel.value = value || '';
  return sel;
}

/**
 * Add or edit a transaction.
 * opts: { tx, prefill, onSaved }  - tx present = edit.
 */
export function openTxEditor({ tx = null, prefill = {}, onSaved } = {}) {
  const editing = !!tx;
  const accts = activeAccounts();
  const st = {
    type: tx?.type || prefill.type || 'expense',
    splitMode: !!tx?.splits?.length,
    splits: tx?.splits?.map((s) => ({ ...s })) || []
  };
  let lastAcct = prefill.accountId || tx?.accountId || sessionStorage.getItem('zd.acct') || accts[0].id;
  if (!accts.some((a) => a.id === lastAcct) && !tx) lastAcct = accts[0].id;

  const amount = h('input', { class: 'qa-amount num', inputMode: 'decimal', placeholder: S.money.fmt(0), 'aria-label': 'Amount', value: tx ? S.money.plain(tx.amount) : prefill.amount ? S.money.plain(prefill.amount) : '', autocomplete: 'off' });
  const date = h('input', { type: 'date', value: tx?.date || prefill.date || todayLocal(), 'aria-label': 'Date' });
  const payee = h('input', { value: tx?.payee ?? prefill.payee ?? '', placeholder: 'Who was it?', list: 'payee-list', autocomplete: 'off', maxLength: 80, 'aria-label': 'Payee' });
  const dl = h('datalist', { id: 'payee-list' }, S.meta.payees.map((p) => h('option', { value: p })));
  const memo = h('input', { value: tx?.memo || '', placeholder: 'Note (optional)', maxLength: 200, 'aria-label': 'Note' });
  const acct = h('select', { 'aria-label': 'Account' }, accts.map((a) => h('option', { value: a.id }, a.name)));
  acct.value = lastAcct;
  const toAcct = h('select', { 'aria-label': 'To account' }, accts.map((a) => h('option', { value: a.id }, a.name)));
  toAcct.value = tx?.toAccountId || accts.find((a) => a.id !== lastAcct)?.id || lastAcct;
  const catSlot = h('div');
  const splitSlot = h('div');
  const typeSeg = h('div', { class: 'seg', role: 'tablist' });
  const toRow = h('label', { class: 'f' }, 'To account', toAcct);
  const fromLabel = h('span');
  let cat = categorySelect(st.type === 'income' ? 'income' : 'expense', tx?.catId || prefill.catId);

  const smart = editing ? null : h('input', { class: 'smart', placeholder: 'Quick line: 45.20 kroger groceries   (try "yesterday 12 chipotle")', 'aria-label': 'Quick line', autocomplete: 'off' });
  if (smart) {
    smart.addEventListener('input', () => {
      const p = parseQuick(smart.value, { categories: S.meta.categories, rules: S.meta.payeeRules, today: todayLocal() });
      if (p.type !== st.type && (p.type === 'income' || st.type === 'income')) setType(p.type);
      if (p.amount != null) amount.value = S.money.plain(p.amount);
      payee.value = p.payee;
      if (p.date) date.value = p.date;
      if (p.catId) cat.value = p.catId;
    });
    smart.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), save(false)));
  }

  function setType(t) {
    st.type = t;
    typeSeg.replaceChildren(...[['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']].map(([v, l]) => h('button', { type: 'button', class: v === t ? 'on' : '', role: 'tab', 'aria-selected': v === t, onclick: () => setType(v) }, l)));
    if (t !== 'transfer') {
      const keep = cat.value;
      cat = categorySelect(t === 'income' ? 'income' : 'expense', keep);
      catSlot.replaceChildren(h('label', { class: 'f' }, 'Category', cat));
    } else catSlot.replaceChildren();
    toRow.style.display = t === 'transfer' ? '' : 'none';
    fromLabel.textContent = t === 'transfer' ? 'From account' : 'Account';
    acctLabel.firstChild.textContent = t === 'transfer' ? 'From account' : 'Account';
    payee.parentElement.style.display = t === 'transfer' ? 'none' : '';
    paintSplits();
  }

  const remaining = h('span', { class: 'muted num' });
  function paintSplits() {
    splitSlot.replaceChildren();
    if (st.type === 'transfer') return;
    if (!st.splitMode) {
      catSlot.style.display = '';
      splitSlot.append(h('button', { type: 'button', class: 'link', onclick: () => {
        st.splitMode = true;
        const total = parseMoney(amount.value) || 0;
        st.splits = [{ catId: cat.value || '', amount: total }, { catId: '', amount: 0 }];
        paintSplits();
      } }, 'Split across categories'));
      return;
    }
    catSlot.style.display = 'none';
    const rows = h('div', { class: 'stack' });
    const upd = () => {
      const total = parseMoney(amount.value) || 0;
      const used = st.splits.reduce((n, s) => n + (s.amount || 0), 0);
      remaining.textContent = total - used === 0 ? 'Fully split' : `${fmt(total - used)} left to assign`;
      remaining.style.color = total - used === 0 ? 'var(--good)' : 'var(--warn)';
    };
    st.splits.forEach((s, i) => {
      const sel = categorySelect(st.type === 'income' ? 'income' : 'expense', s.catId, { blank: 'Pick a category…', onchange: () => (s.catId = sel.value) });
      const amt = h('input', { class: 'num', inputMode: 'decimal', style: { width: '120px', textAlign: 'right' }, value: s.amount ? S.money.plain(s.amount) : '', placeholder: '0.00', 'aria-label': 'Split amount', oninput: () => { s.amount = parseMoney(amt.value) || 0; upd(); } });
      rows.append(h('div', { class: 'row' }, sel, amt, st.splits.length > 2 ? h('button', { type: 'button', class: 'btn ghost sm', 'aria-label': 'Remove split', onclick: () => { st.splits.splice(i, 1); paintSplits(); } }, icon('x')) : null));
    });
    splitSlot.append(rows, h('div', { class: 'row between', style: { marginTop: '8px' } },
      h('button', { type: 'button', class: 'link', onclick: () => { st.splits.push({ catId: '', amount: 0 }); paintSplits(); } }, '+ Add a split'),
      remaining,
      h('button', { type: 'button', class: 'link', onclick: () => { st.splitMode = false; st.splits = []; paintSplits(); } }, 'Single category')));
    upd();
  }
  amount.addEventListener('input', () => st.splitMode && paintSplits());

  // remember a payee's usual category
  const autoCat = () => {
    if (cat.value || st.splitMode || st.type === 'transfer') return;
    const hit = S.meta.payeeRules[norm(payee.value)];
    if (hit && [...cat.options].some((o) => o.value === hit)) cat.value = hit;
  };
  payee.addEventListener('change', autoCat);
  payee.addEventListener('blur', autoCat);

  const acctLabel = h('label', { class: 'f' }, h('span', null, 'Account'), acct);

  async function save(another) {
    const cents = parseMoney(amount.value);
    if (!cents || cents <= 0) return toast('Enter an amount', true), amount.focus();
    const body = { type: st.type, date: date.value, amount: Math.abs(cents), accountId: acct.value, payee: payee.value, memo: memo.value };
    if (st.type === 'transfer') body.toAccountId = toAcct.value;
    else if (st.splitMode) {
      const parts = st.splits.filter((s) => s.catId && s.amount > 0);
      if (parts.length < 1) return toast('Pick a category for each split', true);
      if (parts.reduce((n, s) => n + s.amount, 0) !== body.amount) return toast('Splits must add up to the full amount', true);
      body.splits = parts;
    } else {
      body.catId = cat.value || null;
      if (editing) body.splits = [];
    }
    const ok = await guard(async () => {
      if (editing) await api.patch('/transactions/' + tx.id, body);
      else await api.post('/transactions', body);
      try { sessionStorage.setItem('zd.acct', acct.value); } catch {}
      await loadMeta();
      return true;
    });
    if (!ok) return;
    toast(editing ? 'Saved' : `Added ${fmt(body.amount)}${body.payee ? ' · ' + body.payee : ''}`);
    onSaved?.();
    if (another) {
      amount.value = '';
      payee.value = '';
      memo.value = '';
      if (smart) smart.value = '';
      st.splitMode = false;
      st.splits = [];
      setType(st.type);
      (smart || amount).focus();
    } else m.close();
  }

  const body = h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(false); } },
    typeSeg,
    smart,
    amount,
    h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Payee', payee), h('label', { class: 'f' }, 'Date', date)),
    catSlot, splitSlot,
    h('div', { class: 'grid2' }, acctLabel, toRow),
    h('label', { class: 'f' }, 'Note', memo),
    dl,
    h('button', { type: 'submit', class: 'sr' }, 'Save')
  );
  const footer = [
    editing ? h('button', { type: 'button', class: 'btn danger', style: { marginRight: 'auto' }, onclick: async () => {
      if (!(await confirmDialog('Delete this transaction?', { ok: 'Delete', danger: true }))) return;
      await guard(async () => { await api.del('/transactions/' + tx.id); await loadMeta(); toast('Deleted'); onSaved?.(); m.close(); });
    } }, 'Delete') : null,
    !editing ? h('button', { type: 'button', class: 'btn', onclick: () => save(true) }, 'Save & add another') : null,
    h('button', { type: 'button', class: 'btn primary', onclick: () => save(false) }, editing ? 'Save' : 'Add')
  ];
  const m = modal({ title: editing ? 'Edit transaction' : 'Add transaction', body, footer });
  setType(st.type);
  if (st.type !== 'transfer') { cat = cat; }
  if (tx?.reconciled) body.prepend(h('div', { class: 'pill good' }, 'Reconciled · changing the amount, date or account will unreconcile it'));
  (smart || amount).focus();
  return m;
}
