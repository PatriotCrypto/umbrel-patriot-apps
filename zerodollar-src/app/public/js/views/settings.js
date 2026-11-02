import { h, icon, modal, toast, guard, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { S, fmt, loadMeta, THEMES, setTheme, currentTheme, setMonth } from '../state.js';
import { parseMoney } from '../money.js';

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'MXN', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'INR', 'BRL', 'ZAR'];

export async function render(root, ctx) {
  const set = S.meta.settings;

  /* looks */
  const looks = h('div', { class: 'cards', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' } }, THEMES.map((t) => {
    const b = h('button', { class: 'card', 'aria-pressed': currentTheme() === t.id, style: { padding: '12px', textAlign: 'left', borderColor: currentTheme() === t.id ? 'var(--accent)' : '', borderWidth: currentTheme() === t.id ? '2px' : '1px' }, onclick: () => { setTheme(t.id); ctx.refresh(); } },
      h('div', { 'data-theme': t.id, style: { background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '8px', padding: '8px', display: 'grid', gap: '5px' } },
        h('div', { style: { height: '8px', width: '60%', borderRadius: '4px', background: 'var(--accent)' } }),
        h('div', { style: { height: '6px', borderRadius: '4px', background: 'var(--surface2)' } }),
        h('div', { style: { height: '6px', width: '80%', borderRadius: '4px', background: 'var(--surface2)' } })),
      h('div', { style: { fontWeight: 600, marginTop: '8px' } }, t.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, t.note));
    return b;
  }));

  /* preferences */
  const cur = h('select', null, [...new Set([set.currency, ...CURRENCIES])].map((c) => h('option', { value: c }, c)));
  cur.value = set.currency;
  const loc = h('input', { value: set.locale, placeholder: 'en-US' });
  const win = h('input', { type: 'number', min: 0, max: 15, value: set.matchWindowDays });
  const ord = h('select', null, h('option', { value: 'mdy' }, 'Month first (03/27/2026)'), h('option', { value: 'dmy' }, 'Day first (27/03/2026)'));
  ord.value = set.dateOrder;
  const hh = h('input', { value: set.householdName || '', maxLength: 40, placeholder: 'Optional' });
  const savePrefs = async () => {
    if (await guard(() => api.put('/settings', { currency: cur.value, locale: loc.value.trim() || 'en-US', matchWindowDays: parseInt(win.value, 10), dateOrder: ord.value, householdName: hh.value }))) {
      await loadMeta();
      toast('Saved');
      ctx.refresh();
    }
  };

  /* accounts */
  const acctRows = S.meta.accounts.map((a) => h('div', { class: 'txmini', onclick: () => acctForm(a, ctx) },
    h('div', { class: 'who' }, h('b', null, a.name, a.archived ? h('span', { class: 'pill', style: { marginLeft: '8px' } }, 'Archived') : null), h('span', null, `${a.type} · started at ${fmt(a.openingBalance)}`)),
    h('span', { class: 'amt num' }, fmt(a.balance))));

  /* data */
  const importIn = h('input', { type: 'file', accept: '.json,application/json', class: 'sr', id: 'imp', onchange: async () => {
    const f = importIn.files[0];
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { return toast('That file is not valid JSON', true); }
    if (!(await confirmDialog('Replace everything in ZeroDollar with the contents of this backup?', { ok: 'Replace everything', danger: true, title: 'Restore backup' }))) return;
    if (await guard(() => api.post('/import', data))) { await loadMeta(); toast('Backup restored'); location.hash = '#/budget'; ctx.refresh(); }
  } });

  const edIn = h('input', { type: 'file', accept: '.csv,text/csv', class: 'sr', id: 'ed-file', onchange: async () => {
    const f = edIn.files[0];
    edIn.value = '';
    if (!f) return;
    openEveryDollar(await f.text(), f.name, ctx);
  } });

  root.append(h('div', { class: 'page', style: { maxWidth: '820px' } },
    section('Look', 'Pick the one that suits you. It is remembered on this device.', looks),
    section('Accounts', 'Where your money lives. The opening balance is what the account held before your first transaction here.',
      h('div', { class: 'card', style: { overflow: 'hidden' } }, acctRows),
      h('div', null, h('button', { class: 'btn', onclick: () => acctForm(null, ctx) }, icon('plus'), 'Add account'))),
    section('Preferences', null,
      h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Currency', cur), h('label', { class: 'f' }, 'Number format (locale)', loc),
        h('label', { class: 'f' }, 'Statement date order', ord), h('label', { class: 'f' }, 'Match window (days either side)', win), h('label', { class: 'f' }, 'Household name', hh)),
      h('div', null, h('button', { class: 'btn primary', onclick: savePrefs }, 'Save preferences'))),
    section('Import from EveryDollar', 'Bring a month of your budget across. In EveryDollar, open the month and choose Download CSV (the Budget Items file, named like 10-2026-EveryDollar-BudgetItems.csv). Do one month at a time, oldest first, to fill in Insights.',
      h('div', { class: 'row wrap' }, h('label', { class: 'btn', for: 'ed-file', tabIndex: 0 }, icon('upload'), 'Choose Budget Items CSV…'), edIn)),
    section('Your data', 'Everything lives in one file on your Umbrel. A daily snapshot is kept for two weeks.',
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn', href: '/api/export', download: '' }, 'Download full backup (.json)'),
        h('a', { class: 'btn', href: '/api/export/transactions.csv', download: '' }, 'Export transactions (.csv)'),
        h('label', { class: 'btn', for: 'imp', tabIndex: 0 }, 'Restore from backup…'), importIn,
        h('button', { class: 'btn danger', onclick: async () => {
          if (!(await confirmDialog('This permanently deletes every budget, transaction and statement. Download a backup first if you might want it back.', { ok: 'Erase everything', danger: true, title: 'Erase all data?' }))) return;
          if (await guard(() => api.post('/reset', { confirm: 'ERASE' }))) { await loadMeta(); toast('All data erased'); location.hash = '#/budget'; ctx.refresh(); }
        } }, 'Erase everything'))),
    section('About', null,
      h('p', { class: 'muted', style: { margin: 0 } }, `ZeroDollar ${S.meta.version}. A self-hosted zero-based budget: give every dollar a job, log spending in seconds, and reconcile against your bank statement each month. No accounts, no cloud, no subscription.`),
      h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'ZeroDollar is an independent community app. It is not affiliated with, endorsed by, or connected to Ramsey Solutions, EveryDollar, or Umbrel. It does not give financial advice.'))));
}

function section(title, note, ...kids) {
  return h('section', { class: 'card pad stack' }, h('div', null, h('h3', { style: { fontSize: '16px' } }, title), note ? h('div', { class: 'muted', style: { fontSize: '13px', marginTop: '3px' } }, note) : null), ...kids);
}

function acctForm(a, ctx) {
  const name = h('input', { value: a?.name || '', maxLength: 40, autofocus: true });
  const type = h('select', null, ['checking', 'savings', 'credit', 'cash'].map((t) => h('option', { value: t }, t[0].toUpperCase() + t.slice(1))));
  type.value = a?.type || 'checking';
  const open = h('input', { inputMode: 'decimal', value: a ? S.money.plain(a.openingBalance) : '', placeholder: '0.00' });
  const m = modal({
    title: a ? 'Edit account' : 'Add account',
    body: [h('label', { class: 'f' }, 'Name', name), h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Type', type), h('label', { class: 'f' }, 'Opening balance', open)),
      h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'For a credit card, enter what you owe as a negative number (for example -450.00).')],
    footer: [
      a ? h('button', { class: 'btn danger', style: { marginRight: 'auto' }, onclick: async () => {
        const r = await guard(() => api.del('/accounts/' + a.id));
        if (r) { await loadMeta(); toast(r.archived ? 'Archived (it has history)' : 'Removed'); m.close(); ctx.refresh(); }
      } }, 'Remove') : null,
      a?.archived ? h('button', { class: 'btn', onclick: async () => { if (await guard(() => api.patch('/accounts/' + a.id, { archived: false }))) { await loadMeta(); m.close(); ctx.refresh(); } } }, 'Restore') : null,
      h('button', { class: 'btn primary', onclick: async () => {
        const body = { name: name.value, type: type.value, openingBalance: parseMoney(open.value) || 0 };
        const ok = a ? await guard(() => api.patch('/accounts/' + a.id, body)) : await guard(() => api.post('/accounts', body));
        if (ok) { await loadMeta(); m.close(); ctx.refresh(); }
      } }, 'Save')]
  });
}

async function openEveryDollar(csv, fileName, ctx) {
  const fm = /(?:^|\D)(\d{1,2})-(\d{4})(?:\D|$)/.exec(fileName);
  const guess = fm && +fm[1] >= 1 && +fm[1] <= 12 ? `${fm[2]}-${String(fm[1]).padStart(2, '0')}` : S.month;
  const opts = { csv, fileName, debts: true, spent: false, groupTypes: {}, month: guess, accountId: undefined };
  let pv = await guard(() => api.post('/import/everydollar/preview', opts));
  if (!pv) return;
  opts.month = pv.month;
  const TYPES = [['income', 'Income'], ['expense', 'Regular spending'], ['fund', 'Savings fund'], ['debt', 'Debt']];
  const body = h('div', { class: 'stack' });
  const m = modal({ title: 'Import from EveryDollar', wide: true, body, footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', id: 'ed-go', onclick: apply }, 'Import')] });

  async function reload() {
    const r = await guard(() => api.post('/import/everydollar/preview', opts));
    if (r) { pv = r; paint(); }
  }
  async function apply() {
    const r = await guard(() => api.post('/import/everydollar/apply', opts));
    if (!r) return;
    await loadMeta();
    setMonth(r.month);
    m.close();
    toast(`Imported ${r.planned} items for ${r.month}${r.debts ? `, ${r.debts} new debts` : ''}${r.transactions ? `, ${r.transactions} spending totals` : ''}.`);
    location.hash = '#/budget';
    ctx.refresh();
  }
  function paint() {
    const month = h('input', { type: 'month', value: opts.month || '', onchange: (e) => { opts.month = e.target.value; reload(); } });
    const acct = h('select', { onchange: (e) => { opts.accountId = e.target.value; } }, pv.accounts.map((a) => h('option', { value: a.id }, a.name)));
    if (opts.accountId) acct.value = opts.accountId;
    const c = pv.counts;
    body.replaceChildren(...[
      h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'This budget is for', month),
        h('div', { class: 'muted', style: { fontSize: '13.5px', alignSelf: 'end' } }, `${c.items} items in ${c.groups} groups. ${c.newItems} new, ${c.items - c.newItems} already here.${pv.monthExists ? ` Planned amounts for ${pv.month} will be updated.` : ''}${c.overwritten ? ` ${c.overwritten} existing amounts will change.` : ''}`)),
      h('div', { class: 'row wrap', style: { gap: '18px' } },
        h('span', null, 'Income ', h('b', { class: 'num' }, fmt(pv.totals.plannedIncome))),
        h('span', null, 'Planned ', h('b', { class: 'num' }, fmt(pv.totals.plannedOut))),
        h('span', null, 'Left to budget ', h('b', { class: 'num', style: { color: pv.totals.leftToBudget === 0 ? 'var(--good)' : 'var(--warn)' } }, fmt(pv.totals.leftToBudget)))),
      h('div', { class: 'card', style: { maxHeight: '300px', overflow: 'auto', boxShadow: 'none' } }, pv.groups.map((g) => h('div', null,
        h('div', { class: 'row between', style: { padding: '8px 14px', background: 'var(--surface2)', position: 'sticky', top: 0 } }, h('b', null, g.name, g.exists ? null : h('span', { class: 'pill good', style: { marginLeft: '8px' } }, 'new')),
          (() => { const sel = h('select', { style: { width: 'auto', padding: '4px 8px' }, 'aria-label': `${g.name} type`, onchange: (e) => { opts.groupTypes[g.name] = e.target.value; reload(); } }, TYPES.map(([v, l]) => h('option', { value: v }, l))); sel.value = g.type; return sel; })()),
        g.items.map((i) => h('div', { class: 'txmini', style: { cursor: 'default' } }, h('div', { class: 'who' }, h('b', null, i.name), h('span', null, [i.exists ? 'already here' : 'new', i.debt === 'new' ? `new debt, balance ${fmt(i.balance)}` : i.debt === 'update' ? `updates debt balance to ${fmt(i.balance)}` : ''].filter(Boolean).join(' · '))), h('span', { class: 'amt num' }, fmt(i.planned))))))),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: opts.debts, onchange: (e) => { opts.debts = e.target.checked; reload(); } }), 'Turn Debt items with a balance into tracked debts'),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: opts.spent, onchange: (e) => { opts.spent = e.target.checked; if (opts.spent && !opts.accountId) opts.accountId = pv.accounts[0]?.id; reload(); } }), 'Also record what was spent as one total per item (for Insights)'),
      opts.spent ? h('label', { class: 'f' }, 'Record spending in account', acct) : null,
      pv.warnings.length ? h('div', { class: 'stack', style: { gap: '4px' } }, pv.warnings.map((w) => h('div', { class: 'muted', style: { fontSize: '13px' } }, '• ' + w))) : null,
      h('p', { class: 'muted', style: { margin: 0, fontSize: '12.5px' } }, 'Nothing is deleted. Importing the same file again only updates planned amounts. Due days are not in EveryDollar’s file: click an item on the Budget page to set them.')].filter(Boolean));
  }
  paint();
}
