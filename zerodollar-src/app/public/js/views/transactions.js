import { h, icon, toast, guard, todayLocal, dayLabel, debounce, clear } from '../ui.js';
import { api } from '../api.js';
import { S, fmt, loadMeta, catName, activeAccounts } from '../state.js';
import { parseQuick } from '../quick.js';
import { openTxEditor, categorySelect } from '../txeditor.js';

const f = { q: '', acct: '', cat: '', unrec: false, all: false };

export async function render(root, ctx) {
  const selected = new Set();
  const listEl = h('div');
  const bulkEl = h('div');
  const countEl = h('span', { class: 'muted' });

  /* ---- fast entry line: "12.50 starbucks coffee" + Enter ---- */
  const quick = h('input', { class: 'smart', placeholder: 'Quick add: 12.50 starbucks coffee   ·   "+2400 paycheck"   ·   "yesterday 40 gas"', 'aria-label': 'Quick add', autocomplete: 'off' });
  quick.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !quick.value.trim()) return;
    const p = parseQuick(quick.value, { categories: S.meta.categories, rules: S.meta.payeeRules, today: todayLocal() });
    const acct = activeAccounts().find((a) => a.id === sessionStorage.getItem('zd.acct'))?.id || activeAccounts()[0].id;
    if (!p.amount) return openTxEditor({ prefill: { ...p, accountId: acct }, onSaved: ctx.refresh });
    const ok = await guard(async () => {
      await api.post('/transactions', { type: p.type, date: p.date || todayLocal(), amount: p.amount, accountId: acct, payee: p.payee, catId: p.catId });
      await loadMeta();
      return true;
    });
    if (ok) {
      toast(`Added ${fmt(p.amount)}${p.payee ? ' · ' + p.payee : ''}${p.catId ? ' → ' + catName(p.catId) : ' (uncategorized)'}`);
      quick.value = '';
      load();
    }
  });

  const search = h('input', { type: 'search', placeholder: 'Search payee, note, category or amount', value: f.q, 'aria-label': 'Search', oninput: debounce(() => { f.q = search.value; load(); }) });
  const acctSel = h('select', { 'aria-label': 'Account', onchange: () => { f.acct = acctSel.value; load(); } }, h('option', { value: '' }, 'All accounts'), S.meta.accounts.map((a) => h('option', { value: a.id }, a.name)));
  acctSel.value = f.acct;
  const catSel = h('select', { 'aria-label': 'Category filter', onchange: () => { f.cat = catSel.value; load(); } }, h('option', { value: '' }, 'All categories'), h('option', { value: '__none' }, 'Uncategorized'),
    S.meta.groups.filter((g) => !g.archived).sort((a, b) => a.sort - b.sort).map((g) => h('optgroup', { label: g.name }, S.meta.categories.filter((c) => c.groupId === g.id).map((c) => h('option', { value: c.id }, c.name + (c.archived ? ' (archived)' : ''))))));
  catSel.value = f.cat;
  const scope = h('select', { 'aria-label': 'Date range', onchange: () => { f.all = scope.value === 'all'; load(); } }, h('option', { value: 'month' }, 'This month'), h('option', { value: 'all' }, 'All time'));
  scope.value = f.all ? 'all' : 'month';
  const unrec = h('label', { class: 'row', style: { gap: '6px', fontSize: '13.5px', whiteSpace: 'nowrap' } }, h('input', { type: 'checkbox', style: { width: 'auto' }, checked: f.unrec, onchange: (e) => { f.unrec = e.target.checked; load(); } }), 'Unreconciled only');

  function bulk() {
    clear(bulkEl);
    if (!selected.size) return;
    const sel = categorySelect('expense', '', { blank: 'Set category…' });
    bulkEl.append(h('div', { class: 'card pad row wrap', style: { position: 'sticky', top: '70px', zIndex: 4 } },
      h('b', null, `${selected.size} selected`), sel,
      h('button', { class: 'btn primary sm', onclick: async () => {
        if (!sel.value) return toast('Pick a category first', true);
        if (await guard(() => api.post('/transactions/bulk-category', { ids: [...selected], catId: sel.value }))) { selected.clear(); await loadMeta(); toast('Updated'); load(); }
      } }, 'Apply'),
      h('button', { class: 'btn ghost sm', onclick: () => { selected.clear(); bulk(); mark(); } }, 'Clear')));
  }
  const mark = () => listEl.querySelectorAll('input.check').forEach((c) => (c.checked = selected.has(c.dataset.id)));

  async function load() {
    const p = new URLSearchParams({ limit: '800' });
    if (!f.all) p.set('month', S.month);
    if (f.q) p.set('q', f.q);
    if (f.acct) p.set('accountId', f.acct);
    if (f.cat && f.cat !== '__none') p.set('catId', f.cat);
    if (f.cat === '__none') p.set('uncategorized', '1');
    if (f.unrec) p.set('unreconciled', '1');
    const r = await guard(() => api.get('/transactions?' + p));
    if (!r) return;
    countEl.textContent = `${r.total} transaction${r.total === 1 ? '' : 's'}${r.total > r.transactions.length ? ` (showing ${r.transactions.length})` : ''}`;
    clear(listEl);
    if (!r.transactions.length) {
      listEl.append(h('div', { class: 'empty' }, h('h3', null, f.q || f.cat || f.acct || f.unrec ? 'No matches' : 'No transactions yet'), f.q || f.cat || f.acct || f.unrec ? 'Try clearing a filter.' : 'Use the quick-add line above, or press + to add one.'));
      return;
    }
    let day = '';
    let dayTotal = 0;
    let dayHead;
    const flush = () => dayHead && (dayHead.lastChild.textContent = fmt(dayTotal));
    for (const t of r.transactions) {
      if (t.date !== day) {
        flush();
        day = t.date;
        dayTotal = 0;
        dayHead = h('div', { class: 'day' }, h('span', null, dayLabel(t.date, S.meta.settings.locale)), h('span', { class: 'num' }));
        listEl.append(dayHead);
      }
      if (t.type === 'expense') dayTotal -= t.amount;
      else if (t.type === 'income') dayTotal += t.amount;
      listEl.append(row(t));
    }
    flush();
  }

  function row(t) {
    const acct = S.acctMap.get(t.accountId)?.name || '';
    const cat = t.type === 'transfer' ? `Transfer → ${S.acctMap.get(t.toAccountId)?.name || ''}` : t.splits?.length ? `Split · ${t.splits.length}` : catName(t.catId);
    const open = () => openTxEditor({ tx: t, onSaved: load });
    return h('div', { class: 'tx', tabIndex: 0, role: 'button', onclick: (e) => { if (e.target.closest('.c-check')) return; open(); }, onkeydown: (e) => e.key === 'Enter' && e.target === e.currentTarget && open() },
      h('div', { class: 'c-check' }, h('input', { type: 'checkbox', class: 'check', 'data-id': t.id, 'aria-label': 'Select', checked: selected.has(t.id), onchange: (e) => { e.target.checked ? selected.add(t.id) : selected.delete(t.id); bulk(); } })),
      h('div', { class: 'who' }, h('b', null, t.payee || (t.type === 'transfer' ? 'Transfer' : 'No payee'), t.reconciled ? h('span', { class: 'rec', title: 'Reconciled', style: { marginLeft: '6px' } }, icon('check')) : null),
        h('span', null, t.memo || '', h('span', { class: 'cat-m' }, (t.memo ? ' · ' : '') + (cat || 'Uncategorized') + ' · ' + acct))),
      h('div', { class: 'c-cat' }, cat ? cat : h('span', { class: 'pill warn' }, 'Uncategorized')),
      h('div', { class: 'c-acct muted' }, acct),
      h('div', { class: 'amt num' + (t.type === 'income' ? ' in' : '') }, (t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '') + fmt(t.amount)));
  }

  root.append(h('div', { class: 'page' },
    quick,
    h('div', { class: 'filters' }, search, scope, acctSel, catSel, unrec),
    h('div', { class: 'row between' }, countEl, h('a', { class: 'btn sm', href: '/api/export/transactions.csv', download: '' }, 'Export CSV')),
    bulkEl,
    h('section', { class: 'card', style: { overflow: 'hidden' } }, listEl)));
  await load();
}
