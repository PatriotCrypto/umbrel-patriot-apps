import { h, monthLabel } from '../ui.js';
import { api } from '../api.js';
import { S, fmt } from '../state.js';
import { barChart, lineChart } from '../charts.js';

let span = 1;

export async function render(root, ctx) {
  const [sp, tr] = await Promise.all([api.get(`/reports/spending?month=${S.month}&months=${span}`), api.get(`/reports/trend?month=${S.month}`)]);
  const total = sp.categories.reduce((n, c) => n + c.amount, 0);
  const max = sp.categories[0]?.amount || 1;
  const short = (m) => new Date(m + '-01T00:00:00').toLocaleDateString(S.meta.settings.locale, { month: 'short' });
  const seg = h('div', { class: 'seg' }, [[1, 'Month'], [3, '3 months'], [12, '12 months']].map(([v, l]) => h('button', { class: v === span ? 'on' : '', onclick: () => { span = v; ctx.refresh(); } }, l)));
  const net = tr.netWorth;
  const hasData = tr.trend.some((t) => t.income || t.spending);

  root.append(h('div', { class: 'page' },
    h('section', { class: 'card pad stack' },
      h('div', { class: 'row between wrap' }, h('div', null, h('h3', { style: { fontSize: '16px' } }, 'Where the money went'), h('div', { class: 'muted', style: { fontSize: '13px' } }, `${span === 1 ? monthLabel(S.month, S.meta.settings.locale) : 'Last ' + span + ' months'} · ${fmt(total)}`)), seg),
      sp.categories.length ? h('div', null, sp.categories.slice(0, 14).map((c) => h('div', { class: 'hbar' }, h('span', { title: c.name, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.name),
        h('div', { class: 'bar' }, h('i', { style: { width: Math.max(2, (c.amount / max) * 100) + '%' } })), h('span', { class: 'num', style: { textAlign: 'right' } }, fmt(c.amount))))) : h('div', { class: 'empty' }, 'No spending in this period yet.')),
    h('div', { class: 'grid2' },
      h('section', { class: 'card pad stack' }, h('h3', { style: { fontSize: '16px' } }, 'Income vs. spending'),
        hasData ? barChart(tr.trend.map((t) => ({ label: short(t.month), values: [Math.max(0, t.income), Math.max(0, t.spending)] })), { colors: ['var(--accent)', 'var(--warn)'], short: S.money.short, label: 'Income and spending by month' }) : h('div', { class: 'empty' }, 'Appears once you have a few transactions.'),
        h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: 'var(--accent)' } }), 'Income'), h('span', null, h('i', { style: { background: 'var(--warn)' } }), 'Spending'))),
      h('section', { class: 'card pad stack' }, h('h3', { style: { fontSize: '16px' } }, 'Net worth'),
        net.some((n) => n.netWorth) ? lineChart(net.map((n) => ({ label: short(n.month), value: n.netWorth })), { short: S.money.short, label: 'Net worth by month' }) : h('div', { class: 'empty' }, 'Add account balances and debts to see this.'),
        h('div', { class: 'muted', style: { fontSize: '12.5px' } }, 'Account balances minus debts.'))),
    h('section', { class: 'card' },
      h('header', { style: { padding: '14px 18px', borderBottom: '1px solid var(--line)' } }, h('h3', { style: { fontSize: '15px' } }, 'Top payees')),
      sp.payees.length ? sp.payees.map((p) => h('div', { class: 'txmini', style: { cursor: 'default' } }, h('div', { class: 'who' }, h('b', null, p.payee), h('span', null, `${p.count} purchase${p.count === 1 ? '' : 's'}`)), h('span', { class: 'amt num' }, fmt(p.amount)))) : h('div', { class: 'empty' }, 'Nothing yet.'))));
}
