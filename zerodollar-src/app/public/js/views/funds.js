import { h, icon, modal, guard } from '../ui.js';
import { api } from '../api.js';
import { S, fmt, loadMeta } from '../state.js';
import { parseMoney } from '../money.js';
import { editCategory } from './budget.js';

export async function render(root, ctx) {
  const b = await api.get(`/budget/${S.month}`);
  const funds = b.groups.flatMap((g) => g.cats.filter((c) => c.type === 'fund').map((c) => ({ ...c, group: g.name })));
  const total = funds.reduce((n, c) => n + c.balance, 0);

  const card = (c) => {
    const pct = c.target ? Math.max(0, Math.min(100, Math.round((c.balance / c.target) * 100))) : null;
    const plan = h('input', { class: 'plan num', inputMode: 'decimal', value: c.planned ? S.money.plain(c.planned) : '', placeholder: '0.00', 'aria-label': `${c.name} monthly contribution`, style: { width: '110px', textAlign: 'right' },
      onfocus: (e) => e.target.select(),
      onchange: async () => { const v = parseMoney(plan.value) || 0; if (await guard(() => api.put(`/budget/${S.month}/planned`, { catId: c.id, amount: v }))) ctx.refresh(); } });
    const monthsLeft = c.target && c.planned > 0 && c.balance < c.target ? Math.ceil((c.target - c.balance) / c.planned) : null;
    return h('article', { class: 'card fund' },
      h('div', { class: 'row between' }, h('b', null, c.name), h('button', { class: 'btn ghost sm', 'aria-label': `Edit ${c.name}`, onclick: () => editCategory(c, ctx) }, icon('edit'))),
      h('div', null, h('div', { class: 'bal' }, fmt(c.balance)), c.target ? h('div', { class: 'muted', style: { fontSize: '13px' } }, `of ${fmt(c.target)} goal`) : h('div', { class: 'muted', style: { fontSize: '13px' } }, 'No goal set')),
      pct != null ? h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } })) : null,
      h('div', { class: 'row between' }, h('span', { class: 'muted', style: { fontSize: '13px' } }, 'Adding this month'), plan),
      monthsLeft ? h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `${monthsLeft} month${monthsLeft === 1 ? '' : 's'} to goal at this pace`) : null,
      pct === 100 ? h('span', { class: 'pill good' }, 'Goal reached') : null);
  };

  root.append(h('div', { class: 'page' },
    h('div', { class: 'card pad row between wrap' },
      h('div', null, h('div', { class: 'muted', style: { fontSize: '12.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' } }, 'Saved in funds'), h('div', { style: { fontSize: '34px', fontWeight: 700 }, class: 'num' }, fmt(total))),
      h('button', { class: 'btn primary', onclick: () => addFund(b, ctx) }, icon('plus'), 'New fund')),
    h('p', { class: 'muted', style: { margin: 0 } }, 'A fund is a category whose balance carries over month to month: car repairs, holidays, an emergency cushion. Money you plan into it builds up; spending from it draws it down.'),
    funds.length ? h('div', { class: 'cards' }, funds.map(card)) : h('div', { class: 'card empty' }, h('h3', null, 'No funds yet'), 'Create one for anything you save toward.')));
}

function addFund(b, ctx) {
  const groups = b.groups;
  const name = h('input', { maxLength: 40, placeholder: 'e.g. New roof', autofocus: true });
  const goal = h('input', { inputMode: 'decimal', placeholder: 'Optional' });
  const start = h('input', { inputMode: 'decimal', placeholder: '0.00' });
  const g = h('select', null, groups.map((x) => h('option', { value: x.id }, x.name)));
  g.value = groups.find((x) => x.name === 'Savings')?.id || groups[0].id;
  const m = modal({
    title: 'New fund',
    body: [h('label', { class: 'f' }, 'Name', name), h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Goal amount', goal), h('label', { class: 'f' }, 'Already saved', start)), h('label', { class: 'f' }, 'Group', g)],
    footer: h('button', { class: 'btn primary', onclick: async () => {
      if (!name.value.trim()) return;
      const c = await guard(() => api.post('/categories', { groupId: g.value, name: name.value, type: 'fund' }));
      if (!c) return;
      await guard(() => api.patch('/categories/' + c.id, { target: parseMoney(goal.value) || 0, fundStart: parseMoney(start.value) || 0 }));
      await loadMeta(); m.close(); ctx.refresh();
    } }, 'Create')
  });
}
