import { h, icon, modal, guard, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { S, fmt, loadMeta } from '../state.js';
import { parseMoney } from '../money.js';
import { lineChart } from '../charts.js';

let extra = 0;
let strategy = 'snowball';

function whenLabel(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString(S.meta.settings.locale, { month: 'long', year: 'numeric' });
}
const span = (months) => {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} yr` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ') || '0 mo';
};

export async function render(root, ctx) {
  const r = await api.get(`/debts/plan?extra=${extra}&strategy=${strategy}`);
  const byId = new Map(S.meta.debts.map((d) => [d.id, d]));
  const payoff = new Map(r.plan.payoff.map((p) => [p.id, p.month]));
  const ordered = r.plan.order.map((id) => r.debts.find((d) => d.id === id)).filter(Boolean);
  const paidOff = r.debts.filter((d) => d.balance === 0);

  const extraIn = h('input', { class: 'num', inputMode: 'decimal', value: extra ? S.money.plain(extra) : '', placeholder: '0.00', style: { maxWidth: '140px' }, 'aria-label': 'Extra per month',
    onchange: () => { extra = Math.max(0, parseMoney(extraIn.value) || 0); ctx.refresh(); } });
  const seg = h('div', { class: 'seg' }, [['snowball', 'Snowball'], ['avalanche', 'Avalanche']].map(([v, l]) => h('button', { class: v === strategy ? 'on' : '', onclick: () => { strategy = v; ctx.refresh(); } }, l)));

  const saved = r.minimumsOnly.months && r.plan.months ? r.minimumsOnly.months - r.plan.months : 0;
  const interestSaved = r.minimumsOnly.totalInterest - r.plan.totalInterest;

  root.append(h('div', { class: 'page' },
    h('div', { class: 'card hero' },
      h('div', null, h('div', { class: 'lbl' }, 'Total debt'), h('div', { class: 'big num' }, fmt(r.total)),
        h('div', { class: 'muted', style: { marginTop: '6px' } }, !r.debts.length ? 'Add a debt to build a payoff plan.' : r.plan.neverPaysOff ? 'At these payments the debt never reaches zero. Raise a payment.' : r.total === 0 ? 'Debt-free!' : `Debt-free by ${whenLabel(r.plan.months)}`)),
      h('div', { class: 'stats' },
        r.total && !r.plan.neverPaysOff ? stat('Time to payoff', span(r.plan.months)) : null,
        r.total ? stat('Interest to pay', fmt(r.plan.totalInterest)) : null,
        saved > 0 ? stat('Sooner than minimums', span(saved)) : null,
        interestSaved > 0 ? stat('Interest saved', fmt(interestSaved)) : null)),
    h('div', { class: 'card pad row wrap between' },
      h('div', { class: 'row wrap' }, seg, h('label', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'muted' }, 'Extra each month'), extraIn)),
      h('button', { class: 'btn primary', onclick: () => debtForm(null, ctx) }, icon('plus'), 'Add debt')),
    h('p', { class: 'muted', style: { margin: 0 } }, strategy === 'snowball' ? 'Snowball: pay minimums on everything, and throw every spare dollar at the smallest balance first. Each payoff frees its payment for the next debt.' : 'Avalanche: spare dollars go to the highest interest rate first, which costs the least interest overall.'),
    ordered.length ? h('section', { class: 'card', style: { overflow: 'hidden' } }, ordered.map((d, i) => {
      const full = byId.get(d.id);
      return h('div', { class: 'debt', style: { borderBottom: '1px solid var(--line)' } },
        h('div', { class: 'rank' }, i + 1),
        h('div', { style: { minWidth: 0 } }, h('b', null, d.name),
          h('div', { class: 'muted', style: { fontSize: '13px' } }, `${d.apr}% APR · minimum ${fmt(d.minPayment)}`),
          h('div', { class: 'bar', style: { marginTop: '8px' } }, h('i', { style: { width: Math.min(100, Math.max(0, full?.baseBalance ? 100 - (d.balance / full.baseBalance) * 100 : 0)) + '%' } }))),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amt num', style: { fontSize: '18px' } }, fmt(d.balance)),
          payoff.get(d.id) ? h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `Paid off ${whenLabel(payoff.get(d.id))}`) : null,
          h('button', { class: 'btn ghost sm', onclick: () => debtForm(full, ctx) }, icon('edit'), 'Edit')));
    })) : null,
    paidOff.length ? h('p', { class: 'muted' }, `${paidOff.length} paid off: ${paidOff.map((d) => d.name).join(', ')} 🎉`) : null,
    r.plan.timeline.length > 2 && r.total ? h('section', { class: 'card pad stack' }, h('h3', { style: { fontSize: '15px' } }, 'Balance over time'),
      lineChart(r.plan.timeline.map((t) => ({ label: whenLabel(t.month).replace(/ \d{4}$/, (y) => ' ’' + y.trim().slice(2)), value: t.total })), { short: S.money.short, label: 'Total debt balance over time' })) : null,
    h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Each debt also appears in your budget under “Debt”. Plan your payment there, and record payments as transactions in that category; the balance here drops automatically.')));
}

const stat = (l, v) => h('div', null, h('b', { class: 'num' }, v), h('span', null, l));

function debtForm(d, ctx) {
  const name = h('input', { value: d?.name || '', maxLength: 40, placeholder: 'e.g. Car loan', autofocus: true });
  const bal = h('input', { inputMode: 'decimal', value: d ? S.money.plain(d.balance) : '', placeholder: '0.00' });
  const min = h('input', { inputMode: 'decimal', value: d ? S.money.plain(d.minPayment) : '', placeholder: '0.00' });
  const apr = h('input', { inputMode: 'decimal', value: d?.apr ?? '', placeholder: '0' });
  const m = modal({
    title: d ? 'Edit debt' : 'Add debt',
    body: [h('label', { class: 'f' }, 'Name', name), h('div', { class: 'grid2' }, h('label', { class: 'f' }, d ? 'Balance today' : 'Current balance', bal), h('label', { class: 'f' }, 'Minimum payment', min)), h('label', { class: 'f' }, 'Interest rate (APR %)', apr),
      d ? h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Changing the balance resets it to that number as of today. Payments you record afterwards bring it down.') : null],
    footer: [
      d ? h('button', { class: 'btn danger', style: { marginRight: 'auto' }, onclick: async () => {
        if (!(await confirmDialog(`Remove ${d.name}? Past payments stay in your transactions.`, { ok: 'Remove', danger: true }))) return;
        if (await guard(() => api.del('/debts/' + d.id))) { await loadMeta(); m.close(); ctx.refresh(); }
      } }, 'Remove') : null,
      h('button', { class: 'btn primary', onclick: async () => {
        const body = { name: name.value, minPayment: parseMoney(min.value) || 0, apr: Number(apr.value) || 0 };
        const nb = parseMoney(bal.value) || 0;
        if (!d || nb !== d.balance) body.balance = nb;
        const ok = d ? await guard(() => api.patch('/debts/' + d.id, body)) : await guard(() => api.post('/debts', body));
        if (ok) { await loadMeta(); m.close(); ctx.refresh(); }
      } }, 'Save')]
  });
}
