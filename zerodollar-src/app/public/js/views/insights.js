import { h, todayLocal } from '../ui.js';
import { api } from '../api.js';
import { S, fmt, groupColor } from '../state.js';
import { pieChart, stackedBars, multiLine, colorFor } from '../charts.js';

const st = { range: 'ytd', group: '', item: '', pieGroup: '', savings: true };
/** Items within one group get lighter and darker steps of the group's own colour. */
function shade(hex, i, n) {
  const t = n <= 1 ? 0 : i / (n - 1); // 0 = base, 1 = lightest
  return `color-mix(in srgb, ${hex} ${Math.round(100 - t * 55)}%, white)`;
}
const sum = (a) => a.reduce((n, v) => n + v, 0);

export async function render(root, ctx) {
  const d = await api.get(`/insights?range=${st.range}&savings=${st.savings ? 1 : 0}&today=${todayLocal()}`);
  const loc = S.meta.settings.locale;
  const short = S.money.short;
  const labels = d.months.map((m) => new Date(m + '-01T00:00:00').toLocaleDateString(loc, { month: 'short' }) + (d.months.length > 12 ? ` ${m.slice(2, 4)}` : ''));

  // groups, biggest first, with a stable colour per group name
  const groupTotals = new Map();
  for (const s of d.series) {
    const g = groupTotals.get(s.groupId) || { id: s.groupId, name: s.group, total: 0 };
    g.total += sum(s.values);
    groupTotals.set(s.groupId, g);
  }
  const groups = [...groupTotals.values()].sort((a, b) => b.total - a.total);
  const gColor = new Map(groups.map((g) => [g.id, groupColor(g.id)]));
  if (st.pieGroup && !groupTotals.has(st.pieGroup)) st.pieGroup = '';
  if (st.group && !groupTotals.has(st.group)) { st.group = ''; st.item = ''; }

  const range = h('select', { 'aria-label': 'Period', onchange: (e) => { st.range = e.target.value; ctx.refresh(); } },
    [['ytd', 'Year to date'], ['3', 'Past 3 months'], ['6', 'Past 6 months'], ['9', 'Past 9 months'], ['12', 'Past 12 months'], ...d.years.map((y) => [y, y])]
      .filter(([v], i, a) => a.findIndex((x) => x[0] === v) === i)
      .map(([v, l]) => h('option', { value: v }, l)));
  range.value = st.range;
  const sav = h('label', { class: 'row', style: { fontSize: '13.5px' } }, h('input', { type: 'checkbox', checked: st.savings, onchange: (e) => { st.savings = e.target.checked; ctx.refresh(); } }), 'Count money set aside in savings funds as spending');

  const totalSpent = sum(d.series.map((s) => sum(s.values)));
  const totalIncome = sum(d.income.map((s) => sum(s.values)));
  if (!totalSpent && !totalIncome) {
    root.append(h('div', { class: 'page' }, h('div', { class: 'row wrap' }, range),
      h('div', { class: 'card empty' }, h('h3', null, 'Nothing to chart yet'), 'Log or import transactions, and your spending and income show up here by month. You can import each past month from EveryDollar in Settings.')));
    return;
  }

  /* ---- Spending totals (pie) ---- */
  const pieSel = h('select', { 'aria-label': 'Group', onchange: (e) => { st.pieGroup = e.target.value; ctx.refresh(); } }, h('option', { value: '' }, 'All groups'), groups.map((g) => h('option', { value: g.id }, g.name)));
  pieSel.value = st.pieGroup;
  let slices;
  if (!st.pieGroup) slices = groups.map((g) => ({ label: g.name, value: g.total, color: gColor.get(g.id), pick: g.id }));
  else {
    slices = d.series.filter((s) => s.groupId === st.pieGroup).map((s) => ({ label: s.name, value: sum(s.values) })).filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
    slices.forEach((s, i) => (s.color = shade(groupColor(st.pieGroup), i, slices.length)));
  }
  const pieTotal = sum(slices.map((s) => s.value));
  const spanLabel = st.range === 'ytd' ? 'year to date' : /^\d{4}$/.test(st.range) ? st.range : `past ${st.range} months`;
  const pie = h('section', { class: 'card pad stack' },
    h('h3', { style: { fontSize: '17px', textAlign: 'center' } }, 'Spending totals'), pieSel,
    h('div', { class: 'pie-wrap' }, pieChart(slices, { fmt, label: 'Spending by ' + (st.pieGroup ? 'item' : 'group') }),
      h('div', { class: 'leg-list' }, slices.slice(0, 12).map((s) => h('button', { onclick: () => { if (s.pick) { st.pieGroup = s.pick; ctx.refresh(); } } }, h('i', { style: { background: s.color } }), s.label, h('span', { class: 'v num' }, fmt(s.value)))),
        slices.length > 12 ? h('div', { class: 'muted' }, `+${slices.length - 12} more`) : null)),
    h('div', { class: 'muted', style: { textAlign: 'center', fontSize: '13px' } }, h('b', { class: 'num', style: { color: 'var(--text)' } }, fmt(pieTotal)), ` total spent (${spanLabel})`));

  /* ---- Spending details (stacked by month) ---- */
  const gSel = h('select', { 'aria-label': 'Group', onchange: (e) => { st.group = e.target.value; st.item = ''; ctx.refresh(); } }, h('option', { value: '' }, 'All groups'), groups.map((g) => h('option', { value: g.id }, g.name)));
  gSel.value = st.group;
  const items = st.group ? d.series.filter((s) => s.groupId === st.group) : [];
  const iSel = h('select', { 'aria-label': 'Item', disabled: !st.group, onchange: (e) => { st.item = e.target.value; ctx.refresh(); } }, h('option', { value: '' }, 'All items'), items.map((s) => h('option', { value: s.catId || 'uncat' }, s.name)));
  iSel.value = st.item;
  let ds;
  if (!st.group) ds = groups.map((g) => ({ name: g.name, color: gColor.get(g.id), values: d.months.map((_, i) => sum(d.series.filter((s) => s.groupId === g.id).map((s) => s.values[i]))) }));
  else {
    const pick = st.item ? items.filter((s) => (s.catId || 'uncat') === st.item) : items;
    ds = pick.map((s, i) => ({ name: s.name, color: shade(groupColor(st.group), i, pick.length), values: s.values })).sort((a, b) => sum(b.values) - sum(a.values));
  }
  const monthsWithData = d.months.filter((_, i) => ds.some((s) => s.values[i] > 0)).length || 1;
  const avgSpent = Math.round(sum(ds.map((s) => sum(s.values))) / monthsWithData);
  const legend = (arr) => h('div', { class: 'legend' }, arr.slice(0, 8).map((s) => h('span', null, h('i', { style: { background: s.color } }), s.name)), arr.length > 8 ? h('span', null, `+${arr.length - 8} more`) : null);
  const details = h('section', { class: 'card pad stack' },
    h('h3', { style: { fontSize: '17px', textAlign: 'center' } }, 'Spending details'),
    h('div', { class: 'grid2' }, gSel, iSel), legend(ds),
    stackedBars(labels, ds, { short, label: 'Spending by month', avg: avgSpent }));

  /* ---- Monthly income ---- */
  const incBase = S.meta.groups.find((g) => g.kind === 'income');
  const inc = d.income.map((s, i) => ({ name: s.name, color: shade(incBase ? groupColor(incBase.id) : colorFor(0), i, d.income.length), values: s.values }));
  const incMonths = d.months.filter((_, i) => inc.some((s) => s.values[i] > 0)).length || 1;
  const monthlyIncome = h('section', { class: 'card pad stack' },
    h('h3', { style: { fontSize: '17px', textAlign: 'center' } }, 'Monthly income'), legend(inc),
    stackedBars(labels, inc, { short, label: 'Income by month', avg: Math.round(totalIncome / incMonths) }));

  /* ---- Income vs spent ---- */
  const incTotals = d.months.map((_, i) => sum(d.income.map((s) => s.values[i])));
  const spentTotals = d.months.map((_, i) => sum(d.series.map((s) => s.values[i])));
  const vs = h('section', { class: 'card pad stack' },
    h('h3', { style: { fontSize: '17px', textAlign: 'center' } }, 'Income vs. spent'),
    h('div', { class: 'legend', style: { justifyContent: 'center' } },
      h('span', null, h('i', { style: { background: 'var(--good)' } }), 'Income ', h('b', { class: 'num', style: { color: 'var(--text)' } }, fmt(totalIncome))),
      h('span', null, h('i', { style: { background: '#3b82c4' } }), 'Spent ', h('b', { class: 'num', style: { color: 'var(--bad)' } }, fmt(totalSpent)))),
    multiLine(labels, [{ name: 'Income', color: '#2f9e6b', values: incTotals }, { name: 'Spent', color: '#3b82c4', values: spentTotals }], { short, label: 'Income versus spending', avg: Math.round(totalSpent / monthsWithData) }),
    h('div', { class: 'muted', style: { fontSize: '13px', textAlign: 'center' } }, totalIncome >= totalSpent ? `${fmt(totalIncome - totalSpent)} more came in than went out.` : `${fmt(totalSpent - totalIncome)} more went out than came in.`));

  root.append(h('div', { class: 'page', style: { maxWidth: '1180px' } },
    h('div', { class: 'row wrap between' }, h('div', { style: { minWidth: '220px' } }, range), sav),
    h('div', { class: 'grid2' }, pie, details),
    h('div', { class: 'grid2' }, monthlyIncome, vs)));
}
