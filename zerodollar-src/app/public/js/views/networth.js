import { h, icon, modal, guard, toast, confirmDialog, monthLabel } from '../ui.js';
import { api } from '../api.js';
import { S, fmt } from '../state.js';
import { parseMoney } from '../money.js';
import { lineChart } from '../charts.js';

const SRC = { account: 'From your accounts', bitcoin: 'From Bitcoin tracker', debt: 'From Debt planner' };

export async function render(root, ctx) {
  const d = await api.get('/networth');
  const t = d.totals;
  const hist = d.history;
  const prev = [...hist].filter((x) => x.month < new Date().toISOString().slice(0, 7)).pop();
  const delta = prev ? t.net - (prev.assets - prev.liabilities) : null;
  const done = async (p) => { if (await guard(p)) ctx.refresh(); };

  const toggles = h('div', { class: 'row wrap', style: { gap: '16px', fontSize: '13.5px' } },
    [['accounts', 'Account balances'], ['bitcoin', 'Bitcoin'], ['debts', 'Debt planner']].map(([k, l]) =>
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: d.include[k], onchange: (e) => done(() => api.put('/networth/include', { [k]: e.target.checked })) }), l)));

  const hero = h('section', { class: 'card pad stack nw-hero' },
    h('div', { class: 'lbl muted', style: { fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: '12.5px' } }, 'Net worth'),
    h('div', { class: 'big num', style: { fontFamily: 'var(--font-num)', fontSize: '40px', fontWeight: 700, color: t.net < 0 ? 'var(--bad)' : '' } }, fmt(t.net)),
    h('div', { class: 'row wrap', style: { gap: '22px' } },
      h('div', null, h('b', { class: 'num' }, fmt(t.assets)), h('span', { class: 'muted' }, ' assets')),
      h('div', null, h('b', { class: 'num' }, fmt(t.liabilities)), h('span', { class: 'muted' }, ' owed')),
      delta != null ? h('div', { class: 'muted' }, h('b', { class: 'num', style: { color: delta >= 0 ? 'var(--good)' : 'var(--bad)' } }, (delta >= 0 ? '+' : '−') + fmt(Math.abs(delta))), ` since ${monthLabel(prev.month, S.meta.settings.locale)}`) : null),
    h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Counted automatically, so nothing is entered twice:'), toggles);

  /* goals */
  const goals = h('section', { class: 'card pad stack' },
    h('div', { class: 'row between' }, h('h3', { style: { fontSize: '16px' } }, 'Goals'), h('button', { class: 'btn sm', onclick: () => goalForm(null, ctx) }, icon('plus'), 'Add goal')),
    d.goals.length ? d.goals.map((g) => h('div', { class: 'stack', style: { gap: '6px', cursor: 'pointer' }, role: 'button', tabIndex: 0, onclick: () => goalForm(g, ctx), onkeydown: (e) => e.key === 'Enter' && goalForm(g, ctx) },
      h('div', { class: 'row between' }, h('b', null, g.name), h('span', { class: 'muted num', style: { fontSize: '13px' } }, `${fmt(g.value)} of ${fmt(g.target)}${g.date ? ' · by ' + g.date : ''}`)),
      h('div', { class: 'bar' }, h('i', { style: { width: g.pct + '%' } })))) : h('div', { class: 'muted' }, 'Set a target, like “$100,000 net worth”, and watch the bar fill.'));

  /* chart */
  const short = (m) => new Date(m + '-01T00:00:00').toLocaleDateString(S.meta.settings.locale, { month: 'short', year: '2-digit' });
  const pts = hist.slice(-24).map((x) => ({ label: short(x.month), value: x.assets - x.liabilities }));
  const trend = h('section', { class: 'card pad stack' }, h('h3', { style: { fontSize: '16px' } }, 'Trend'),
    pts.length > 1 ? lineChart(pts, { short: S.money.short, label: 'Net worth by month' }) : h('div', { class: 'empty' }, 'The chart fills in as months go by. This month is recorded automatically.'));

  /* lists */
  const byCat = (arr, key) => {
    const m = new Map();
    for (const x of arr) m.set(x.category, [...(m.get(x.category) || []), x]);
    return [...m].sort((a, b) => b[1].reduce((n, x) => n + x[key], 0) - a[1].reduce((n, x) => n + x[key], 0));
  };
  const lineEl = (x, key, kind) => {
    const manual = x.source === 'manual';
    const sub = manual ? [x.location, kind === 'l' && x.rate ? `${x.rate}%` : '', kind === 'l' && x.monthly ? `${fmt(x.monthly)}/mo` : '', kind === 'l' && x.payoff ? `until ${x.payoff}` : ''].filter(Boolean).join(' · ') : SRC[x.source];
    return h('div', { class: 'line', ...(manual ? { role: 'button', tabIndex: 0, onclick: () => (kind === 'a' ? assetForm(x, d, ctx) : liabForm(x, d, ctx)), onkeydown: (e) => e.key === 'Enter' && (kind === 'a' ? assetForm(x, d, ctx) : liabForm(x, d, ctx)) } : {}) },
      h('div', { style: { minWidth: 0 } }, h('b', { style: { fontWeight: 500 } }, x.name, manual ? null : h('span', { class: 'pill', style: { marginLeft: '8px' } }, 'auto')), sub ? h('div', { class: 'muted', style: { fontSize: '12.5px' } }, sub) : null),
      h('b', { class: 'num' }, fmt(x[key])));
  };
  const listCard = (title, arr, key, kind, add) => h('section', { class: 'card nw-lines', style: { overflow: 'hidden' } },
    h('header', { class: 'row between', style: { padding: '14px 18px', borderBottom: '1px solid var(--line)' } }, h('h3', { style: { fontSize: '15px' } }, title), h('button', { class: 'btn sm', onclick: add }, icon('plus'), 'Add')),
    arr.length ? byCat(arr, key).map(([cat, xs]) => [
      h('div', { class: 'line', style: { background: 'var(--surface2)', padding: '7px 18px' } }, h('span', { class: 'muted', style: { fontSize: '12px', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase' } }, cat), h('span', { class: 'muted num', style: { fontSize: '13px' } }, fmt(xs.reduce((n, x) => n + x[key], 0)))),
      xs.map((x) => lineEl(x, key, kind))]) : h('div', { class: 'empty' }, 'Nothing here yet.'));

  /* history */
  const histCard = h('section', { class: 'card nw-lines', style: { overflow: 'hidden' } },
    h('header', { class: 'row between', style: { padding: '14px 18px', borderBottom: '1px solid var(--line)' } }, h('h3', { style: { fontSize: '15px' } }, 'History'),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => histForm(null, ctx) }, icon('plus'), 'Add past month'), h('a', { class: 'btn sm', href: '/api/networth.csv', download: '' }, 'Export .csv'))),
    hist.length ? [...hist].reverse().map((x) => h('div', { class: 'line', role: 'button', tabIndex: 0, onclick: () => histForm(x, ctx), onkeydown: (e) => e.key === 'Enter' && histForm(x, ctx) },
      h('div', null, h('b', { style: { fontWeight: 500 } }, monthLabel(x.month, S.meta.settings.locale)), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `${fmt(x.assets)} assets · ${fmt(x.liabilities)} owed${x.manual ? ' · entered by hand' : ''}`)),
      h('b', { class: 'num' }, fmt(x.assets - x.liabilities)))) : h('div', { class: 'empty' }, 'No history yet.'));

  root.append(h('div', { class: 'page', style: { maxWidth: '1000px' } }, hero, h('div', { class: 'grid2' }, goals, trend),
    h('div', { class: 'grid2', style: { alignItems: 'start' } }, listCard('Assets', d.assets, 'value', 'a', () => assetForm(null, d, ctx)), listCard('What you owe', d.liabilities, 'owed', 'l', () => liabForm(null, d, ctx))), histCard));
}

const field = (label, el) => h('label', { class: 'f' }, label, el);
const sel = (opts, v) => { const s = h('select', null, opts.map((o) => h('option', { value: o }, o))); s.value = v; return s; };

function assetForm(a, d, ctx) {
  const name = h('input', { value: a?.name || '', maxLength: 60, autofocus: true });
  const cat = sel(d.assetCategories, a?.category || 'Cash');
  const loc = h('input', { value: a?.location || '', maxLength: 60, placeholder: 'Optional, e.g. Credit union' });
  const val = h('input', { inputMode: 'decimal', placeholder: '0.00', value: a ? S.money.plain(a.value) : '' });
  const notes = h('input', { value: a?.notes || '', maxLength: 300, placeholder: 'Optional' });
  formModal(a ? 'Edit asset' : 'Add asset', [field('Name', name), h('div', { class: 'grid2' }, field('Category', cat), field('Value today', val)), field('Where it is held', loc), field('Notes', notes)], a, '/networth/assets/', () => ({ name: name.value, category: cat.value, location: loc.value, value: parseMoney(val.value) ?? 0, notes: notes.value }), '/networth/assets', ctx);
}
function liabForm(l, d, ctx) {
  const name = h('input', { value: l?.name || '', maxLength: 60, autofocus: true });
  const cat = sel(d.liabilityCategories, l?.category || 'Other');
  const owed = h('input', { inputMode: 'decimal', placeholder: '0.00', value: l ? S.money.plain(l.owed) : '' });
  const mo = h('input', { inputMode: 'decimal', placeholder: 'Optional', value: l?.monthly ? S.money.plain(l.monthly) : '' });
  const rate = h('input', { type: 'number', step: '0.01', min: 0, max: 100, placeholder: 'Optional', value: l?.rate || '' });
  const payoff = h('input', { type: 'month', value: l?.payoff || '' });
  formModal(l ? 'Edit debt' : 'Add debt', [field('Name', name), h('div', { class: 'grid2' }, field('Category', cat), field('Amount owed', owed)), h('div', { class: 'grid2' }, field('Monthly payment', mo), field('Interest rate %', rate)), field('Paid off by', payoff),
    h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Debts you track on the Debt page are counted automatically. Use this for anything else, such as a mortgage.')], l, '/networth/liabilities/', () => ({ name: name.value, category: cat.value, owed: parseMoney(owed.value) ?? 0, monthly: parseMoney(mo.value) || 0, rate: Number(rate.value) || 0, payoff: payoff.value }), '/networth/liabilities', ctx);
}
function goalForm(g, ctx) {
  const name = h('input', { value: g?.name || '', maxLength: 60, autofocus: true, placeholder: 'e.g. $100,000 net worth' });
  const metric = h('select', null, h('option', { value: 'net' }, 'Net worth reaches'), h('option', { value: 'assets' }, 'Assets reach'), h('option', { value: 'debts' }, 'Debt falls to'));
  metric.value = g?.metric || 'net';
  const target = h('input', { inputMode: 'decimal', value: g ? S.money.plain(g.target) : '', placeholder: '0.00' });
  const start = h('input', { inputMode: 'decimal', value: g?.start ? S.money.plain(g.start) : '', placeholder: 'Where you began' });
  const date = h('input', { type: 'date', value: g?.date || '' });
  formModal(g ? 'Edit goal' : 'Add goal', [field('Name', name), h('div', { class: 'grid2' }, field('Goal', metric), field('Target', target)), h('div', { class: 'grid2' }, field('Starting point', start), field('Target date', date))], g, '/networth/goals/', () => ({ name: name.value, metric: metric.value, target: parseMoney(target.value) ?? 0, start: parseMoney(start.value) || 0, date: date.value }), '/networth/goals', ctx);
}
function histForm(x, ctx) {
  const month = h('input', { type: 'month', value: x?.month || '', disabled: !!x });
  const as = h('input', { inputMode: 'decimal', value: x ? S.money.plain(x.assets) : '', placeholder: '0.00' });
  const li = h('input', { inputMode: 'decimal', value: x ? S.money.plain(x.liabilities) : '', placeholder: '0.00' });
  const m = modal({ title: x ? 'Edit month' : 'Add past month', body: [field('Month', month), h('div', { class: 'grid2' }, field('Total assets', as), field('Total owed', li)), h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Months you enter by hand are kept as typed. The current month always updates by itself.')],
    footer: [x ? h('button', { class: 'btn danger', style: { marginRight: 'auto' }, onclick: async () => { if (await guard(() => api.del('/networth/history/' + x.month))) { m.close(); ctx.refresh(); } } }, 'Remove') : null,
      h('button', { class: 'btn primary', onclick: async () => {
        if (!month.value) return toast('Pick a month', true);
        if (await guard(() => api.put('/networth/history/' + month.value, { assets: parseMoney(as.value) || 0, liabilities: parseMoney(li.value) || 0 }))) { m.close(); ctx.refresh(); }
      } }, 'Save')] });
}
function formModal(title, body, cur, itemBase, collect, listUrl, ctx) {
  const m = modal({ title, body, footer: [
    cur ? h('button', { class: 'btn danger', style: { marginRight: 'auto' }, onclick: async () => { if (!(await confirmDialog(`Remove “${cur.name}”?`, { ok: 'Remove', danger: true }))) return; if (await guard(() => api.del(itemBase + cur.id))) { m.close(); ctx.refresh(); } } }, 'Remove') : null,
    h('button', { class: 'btn primary', onclick: async () => {
      const b = collect();
      if (await guard(() => (cur ? api.patch(itemBase + cur.id, b) : api.post(listUrl, b)))) { m.close(); ctx.refresh(); }
    } }, 'Save')] });
}
