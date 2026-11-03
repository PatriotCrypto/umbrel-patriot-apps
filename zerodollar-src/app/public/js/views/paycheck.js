import { h, icon, modal, guard, toast, todayLocal, monthLabel, shortDate, dayPicker } from '../ui.js';
import { api } from '../api.js';
import { S, fmt, loadMeta } from '../state.js';
import { parseMoney } from '../money.js';

const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th');
const LEVEL = { low: 'Low', medium: 'Medium', high: 'High', none: '—' };

export async function render(root, ctx) {
  const p = await api.get(`/paycheck/${S.month}?today=${todayLocal()}`);
  if (!p.initialized) {
    root.append(h('div', { class: 'card empty', style: { maxWidth: '620px', margin: '40px auto' } },
      h('h3', { style: { fontSize: '20px' } }, `Plan ${monthLabel(S.month, S.meta.settings.locale)} first`),
      h('p', null, 'Paycheck Planning lays your planned income and bills out by date. Start the month on the Budget page, then come back.'),
      h('a', { class: 'btn primary', href: '#/budget' }, 'Go to Budget')));
    return;
  }
  const dateBox = (d) => {
    const dt = new Date(d + 'T00:00:00');
    return h('div', { class: 'dt' }, dt.toLocaleDateString(S.meta.settings.locale, { month: 'short' }), h('b', null, dt.getDate()));
  };

  const bufferIn = h('input', { class: 'plan num', inputMode: 'decimal', placeholder: '0.00', value: p.buffer ? S.money.plain(p.buffer) : '', 'aria-label': 'Buffer',
    onfocus: (e) => e.target.select(),
    onchange: async () => {
      const c = bufferIn.value.trim() === '' ? 0 : parseMoney(bufferIn.value);
      if (c == null || c < 0) return toast('Enter a dollar amount', true);
      if (await guard(() => api.put(`/paycheck/${S.month}/buffer`, { amount: c }))) ctx.refresh();
    },
    onkeydown: (e) => e.key === 'Enter' && bufferIn.blur() });

  const rows = p.events.map((e) => {
    const income = e.kind === 'income';
    const sub = income ? `${e.n} of ${e.of}${e.auto ? ' · from pay days' : ''}` : e.kind === 'fund' ? `Savings · due ${ord(e.day)}` : `Due ${ord(e.day)}${e.moved ? ' · moved this month' : ''}${e.paid ? ' · paid' : ''}`;
    return h('div', { class: 'sched-row clickable' + (income ? ' income' : '') + (e.paid ? ' paid' : ''), tabIndex: 0, role: 'button',
      onclick: () => (income ? editPaychecks(p, e.catId, ctx) : editDue(p, e, ctx)),
      onkeydown: (ev) => ev.key === 'Enter' && (income ? editPaychecks(p, e.catId, ctx) : editDue(p, e, ctx)) },
      dateBox(e.date),
      h('div', { class: 'nmx' }, h('b', null, e.name), h('span', null, sub)),
      h('div', { class: 'delta num' + (income ? ' in' : '') }, (income ? '+' : '−') + fmt(e.amount)),
      h('div', { class: 'bal num' + (e.balance < 0 ? ' neg' : '') }, fmt(e.balance)));
  });

  const schedule = h('section', { class: 'card', style: { overflow: 'hidden' } },
    h('header', { class: 'row between', style: { padding: '14px 18px', borderBottom: '1px solid var(--line)' } },
      h('h3', { style: { fontSize: '15px' } }, 'Spending schedule'), h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'Balance')),
    h('div', { class: 'sched-row', style: { background: 'var(--surface2)' } },
      h('div', { class: 'dt' }, icon('down')),
      h('div', { class: 'nmx' }, h('b', null, 'Buffer'), h('span', null, 'Money from a previous month to pay for expenses.')),
      bufferIn, h('div', { class: 'bal num' }, fmt(p.buffer))),
    rows.length ? rows : h('div', { class: 'empty' }, 'Give your income pay days and your bills due days to see them here.'));

  const r = p.risk;
  const risk = h('section', { class: `card risk ${r.level}` },
    h('div', { class: 'row' }, h('div', { class: 'dot', 'aria-hidden': 'true' }, r.level === 'low' ? '✓' : r.level === 'none' ? '–' : '!'), h('div', { class: 'lbl' }, 'Risk of overspending')),
    h('div', { class: 'lvl' }, LEVEL[r.level]),
    h('div', { class: 'muted' }, r.level === 'high'
      ? `Your balance drops below zero on ${shortDate(r.minDate, S.meta.settings.locale)} (short by ${fmt(r.neededBuffer)}). Move a bill, move a paycheck, or start the month with a buffer of at least that much.`
      : r.message),
    r.level === 'high' ? h('button', { class: 'btn sm', onclick: () => { bufferIn.value = S.money.plain(p.buffer + r.neededBuffer); bufferIn.dispatchEvent(new Event('change')); } }, `Set buffer to ${fmt(p.buffer + r.neededBuffer)}`) : null);

  const side = h('aside', { class: 'stack' }, risk);
  const t = p.totals;
  side.append(h('section', { class: 'card pad stack' },
    h('h3', { style: { fontSize: '15px' } }, 'This month'),
    line('Paychecks scheduled', fmt(t.scheduledIn)),
    line('Bills with a due day', fmt(t.scheduledOut)),
    line('Spending without a due day', fmt(t.unscheduledOut)),
    line('Left at month end', fmt(t.afterUnscheduled), t.afterUnscheduled < 0)));
  if (p.unscheduledIncome.length) {
    side.append(h('section', { class: 'card pad stack' },
      h('h3', { style: { fontSize: '15px' } }, 'Income not on a date'),
      p.unscheduledIncome.map((u) => h('div', { class: 'row between' },
        h('div', null, h('b', null, u.name), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `${fmt(u.left)} of ${fmt(u.planned)} unplaced`)),
        h('button', { class: 'btn sm', onclick: () => editPaychecks(p, u.catId, ctx) }, 'Set dates')))));
  }
  if (p.warnings.length) side.append(h('section', { class: 'card pad stack' }, p.warnings.map((w) => h('div', { class: 'muted', style: { fontSize: '13px' } }, w))));

  root.append(h('div', { class: 'pc' }, schedule, side));
}

const line = (a, b, bad) => h('div', { class: 'row between' }, h('span', { class: 'muted' }, a), h('b', { class: 'num', style: bad ? { color: 'var(--bad)' } : null }, b));

function editDue(p, e, ctx) {
  const day = h('input', { type: 'number', min: 1, max: 31, value: e.day, autofocus: true });
  const scope = h('select', null, h('option', { value: 'month' }, 'This month only'), h('option', { value: 'always' }, 'Every month'));
  const m = modal({
    title: e.name,
    body: [h('p', { class: 'muted', style: { margin: 0 } }, `${fmt(e.amount)} planned. Choose the day of the month it is due.`),
      h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Due on day', day), h('label', { class: 'f' }, 'Apply to', scope))],
    footer: [
      h('button', { class: 'btn ghost', style: { marginRight: 'auto' }, onclick: async () => {
        if (await guard(() => api.put(`/paycheck/${S.month}/due`, { catId: e.catId, day: null, always: scope.value === 'always' }))) { await loadMeta(); m.close(); ctx.refresh(); }
      } }, scope.value === 'always' ? 'Remove due day' : 'Clear'),
      h('button', { class: 'btn primary', onclick: async () => {
        const d = parseInt(day.value, 10);
        if (!d || d < 1 || d > 31) return toast('Pick a day from 1 to 31', true);
        if (await guard(() => api.put(`/paycheck/${S.month}/due`, { catId: e.catId, day: d, always: scope.value === 'always' }))) { await loadMeta(); m.close(); ctx.refresh(); }
      } }, 'Save')]
  });
}

async function editPaychecks(p, catId, ctx) {
  const cat = S.catMap.get(catId);
  const rec = p.events.filter((e) => e.catId === catId);
  const planned = (await api.get(`/budget/${S.month}`)).income.cats.find((c) => c.id === catId)?.planned || 0;
  const list = h('div', { class: 'stack', style: { gap: '8px' } });
  const rowsEls = [];
  const addRow = (date = '', amount = 0) => {
    const d = h('input', { type: 'date', value: date, min: `${S.month}-01`, max: `${S.month}-31` });
    const a = h('input', { inputMode: 'decimal', placeholder: '0.00', value: amount ? S.money.plain(amount) : '' });
    const row = h('div', { class: 'row' }, d, a, h('button', { class: 'btn ghost sm', 'aria-label': 'Remove paycheck', onclick: () => { row.remove(); rowsEls.splice(rowsEls.findIndex((x) => x.row === row), 1); sum(); } }, icon('trash')));
    a.addEventListener('input', sum);
    rowsEls.push({ row, d, a });
    list.append(row);
  };
  rec.forEach((e) => addRow(e.date, e.amount));
  const tot = h('div', { class: 'muted', style: { fontSize: '13px' } });
  function sum() {
    const n = rowsEls.reduce((s, r) => s + (parseMoney(r.a.value) || 0), 0);
    tot.textContent = `Scheduled ${fmt(n)} of ${fmt(planned)} planned${n === planned ? ' ✓' : n > planned ? ' · more than planned' : ` · ${fmt(planned - n)} left to place`}`;
    tot.style.color = n > planned ? 'var(--warn)' : '';
  }
  const days = dayPicker(cat?.payDays || []);
  const remember = h('input', { type: 'checkbox', checked: true, id: 'rem-pd' });
  const parseDays = () => days.get();
  const m = modal({
    title: `${cat?.name || 'Income'} paychecks`, wide: true,
    body: [
      h('p', { class: 'muted', style: { margin: 0 } }, `Planned for ${monthLabel(S.month, S.meta.settings.locale)}: ${fmt(planned)}. Enter each paycheck's date and amount, or split the plan evenly across pay days.`),
      list, h('div', null, h('button', { class: 'btn sm', onclick: () => { addRow(`${S.month}-15`, 0); } }, icon('plus'), 'Add paycheck')), tot,
      h('div', { class: 'card pad stack', style: { boxShadow: 'none', background: 'var(--surface2)' } },
        h('div', { class: 'f' }, 'Split evenly on these days of the month', days.el),
        h('label', { class: 'row', for: 'rem-pd', style: { fontSize: '13px' } }, remember, 'Use these pay days every month'),
        h('div', null, h('button', { class: 'btn sm', onclick: async () => {
          const d = parseDays();
          if (!d.length || d.some((x) => !(x >= 1 && x <= 31))) return toast('Tap the days you get paid', true);
          if (await guard(() => api.post(`/paycheck/${S.month}/split`, { catId, days: d, remember: remember.checked }))) { await loadMeta(); m.close(); ctx.refresh(); }
        } }, 'Split evenly')))
    ],
    footer: [
      h('button', { class: 'btn ghost', style: { marginRight: 'auto' }, onclick: async () => { if (await guard(() => api.put(`/paycheck/${S.month}/paychecks`, { catId, paychecks: [] }))) { m.close(); ctx.refresh(); } } }, 'Clear dates'),
      h('button', { class: 'btn primary', onclick: async () => {
        const paychecks = rowsEls.map((r) => ({ date: r.d.value, amount: parseMoney(r.a.value) || 0 }));
        if (paychecks.some((x) => !x.date || x.amount <= 0)) return toast('Each paycheck needs a date and an amount', true);
        if (await guard(() => api.put(`/paycheck/${S.month}/paychecks`, { catId, paychecks }))) { m.close(); ctx.refresh(); }
      } }, 'Save')]
  });
  sum();
}
