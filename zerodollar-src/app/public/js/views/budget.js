import { h, icon, modal, toast, guard, todayLocal, dayLabel, monthLabel, confirmDialog, clear, dayPicker } from '../ui.js';
import { PALETTE } from '../charts.js';
import { api } from '../api.js';
import { S, fmt, loadMeta, catName, groupColor } from '../state.js';
import { parseMoney } from '../money.js';
import { openTxEditor } from '../txeditor.js';

const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th');
let editMode = false;

export async function render(root, ctx) {
  const month = S.month;
  let b = await api.get(`/budget/${month}?today=${todayLocal()}`);
  const txs = await api.get(`/transactions?month=${month}&limit=80`);
  const due = await api.get(`/due-week?today=${todayLocal()}`);
  const noHistory = S.meta.counts.transactions === 0 && !b.previousMonth;

  if (!b.initialized) {
    root.append(startCard(b, ctx, noHistory));
    return;
  }

  const refs = new Map();
  const heroEl = h('section', { class: 'card hero', 'aria-live': 'polite' });
  let lastLeft = b.totals.leftToBudget;

  function paint() {
    const t = b.totals;
    const left = t.leftToBudget;
    heroEl.className = 'card hero' + (left === 0 && t.plannedIncome > 0 ? ' zero' : left < 0 ? ' over' : '');
    heroEl.replaceChildren(
      h('div', null,
        h('div', { class: 'lbl' }, left === 0 && t.plannedIncome > 0 ? 'Zero-based ✓' : left < 0 ? 'Over-planned by' : 'Left to budget'),
        h('div', { class: 'big num' }, left === 0 && t.plannedIncome > 0 ? fmt(0) : fmt(Math.abs(left))),
        h('div', { class: 'muted', style: { marginTop: '6px', fontSize: '13.5px' } },
          t.plannedIncome === 0 ? 'Start by planning your income below.' : left === 0 ? 'Every dollar has a job this month.' : left > 0 ? 'Give every remaining dollar a job.' : 'Plan less than you earn, or raise your income.')),
      h('div', { class: 'stats' },
        stat('Income planned', fmt(t.plannedIncome)),
        stat('Spending planned', fmt(t.plannedOut)),
        stat('Received', fmt(t.receivedIncome)),
        stat('Spent', fmt(t.spentOut))));
    for (const g of [b.income, ...b.groups]) {
      if (!g) continue;
      const gr = refs.get('g:' + g.id);
      if (gr) gr.textContent = g.kind === 'income' ? `${fmt(g.spent)} of ${fmt(g.planned)}` : `${fmt(g.spent)} of ${fmt(g.planned)}`;
      for (const c of g.cats) paintCat(c);
    }
    if (left === 0 && lastLeft !== 0 && t.plannedIncome > 0) toast('Zero! Every dollar is planned.');
    lastLeft = left;
  }

  function paintCat(c) {
    const r = refs.get(c.id);
    if (!r) return;
    const income = c.type === 'income';
    if (document.activeElement !== r.input) r.input.value = c.planned ? S.money.plain(c.planned) : '';
    if (income) {
      r.rem.className = 'rem' + (c.spent >= c.planned && c.planned > 0 ? ' done' : '');
      r.rem.replaceChildren(fmt(c.spent), h('small', null, 'received'));
    } else {
      const over = c.remaining < 0;
      r.rem.className = 'rem' + (over ? ' over' : c.planned > 0 && c.remaining === 0 ? ' done' : '');
      r.rem.replaceChildren(fmt(Math.abs(c.remaining)), h('small', null, over ? 'over' : 'left'));
    }
    const pct = c.planned > 0 ? Math.min(100, Math.round((c.spent / c.planned) * 100)) : c.spent > 0 ? 100 : 0;
    r.bar.style.width = pct + '%';
    r.barWrap.classList.toggle('over', !income && c.remaining < 0);
    if (r.sub) {
      r.sub.textContent = c.type === 'fund' ? `Balance ${fmt(c.balance)}${c.target ? ' of ' + fmt(c.target) : ''}` : c.debt ? `Owe ${fmt(c.debt.balance)}` : '';
    }
  }

  async function setPlanned(c, input) {
    const raw = input.value.trim();
    const cents = raw === '' ? 0 : parseMoney(raw);
    if (cents == null || cents < 0) {
      toast('Enter a dollar amount', true);
      input.value = c.planned ? S.money.plain(c.planned) : '';
      return;
    }
    if (cents === c.planned) return input.value = cents ? S.money.plain(cents) : '';
    const res = await guard(() => api.put(`/budget/${month}/planned`, { catId: c.id, amount: cents }));
    if (res) {
      b = { ...b, ...res, bills: b.bills };
      paint();
      input.value = cents ? S.money.plain(cents) : '';
    }
  }

  function catRow(c, list) {
    const income = c.type === 'income';
    const input = h('input', { class: 'plan num', inputMode: 'decimal', 'aria-label': `${c.name} planned`, placeholder: '0.00',
      onfocus: (e) => e.target.select(),
      onchange: () => setPlanned(c, input),
      onkeydown: (e) => { if (e.key === 'Enter') input.blur(); } });
    const bar = h('i');
    const barWrap = h('div', { class: 'bar' }, bar);
    const sub = !income && (c.type === 'fund' || c.debt) ? h('span', { class: 'muted', style: { fontSize: '12px' } }) : null;
    const rem = h('div', { class: 'rem num' });
    refs.set(c.id, { input, bar, barWrap, rem, sub });
    const nameBtn = h('button', { class: 'nm', title: 'Edit this item', onclick: () => editCategory(c, ctx) },
      c.name,
      c.dueDay ? h('span', { class: 'pill', title: 'Due day' }, `Due ${ord(c.dueDay)}`) : null,
      income && c.payDays?.length ? h('span', { class: 'pill', title: 'Pay days' }, `Paid ${c.payDays.map(ord).join(', ')}`) : null,
      c.type === 'fund' ? h('span', { class: 'pill good' }, 'Fund') : null);
    return h('div', { class: 'cat' },
      h('div', { class: 'name' }, h('div', { class: 'row', style: { gap: '8px' } }, nameBtn, editMode ? mover(c.id, list) : null), income ? null : barWrap, sub),
      input, rem);
  }

  function groupCard(g) {
    const totalEl = h('span', { class: 'tot num' });
    refs.set('g:' + g.id, totalEl);
    const isIncome = g.kind === 'income';
    const card = h('section', { class: 'card group' + (editMode ? ' editing' : '') },
      h('header', { style: { '--gc': groupColor(g.id) } },
        h('h3', null, g.name),
        totalEl,
        editMode && !isIncome ? groupMover(g) : null,
        h('button', { class: 'btn ghost sm', 'aria-label': `Edit ${g.name}`, title: 'Edit group', onclick: () => renameGroup(g, ctx) }, icon('edit'))),
      isIncome ? null : h('div', { class: 'cat head' }, h('span', null, 'Category'), h('span', null, 'Planned'), h('span', null, 'Left')),
      isIncome ? h('div', { class: 'cat head' }, h('span', null, 'Income'), h('span', null, 'Expected'), h('span', null, 'Received')) : null,
      g.cats.map((c) => catRow(c, g.cats)),
      !g.cats.length ? h('div', { class: 'muted', style: { padding: '14px 18px' } }, 'No categories yet.') : null,
      addInline(g, ctx));
    return card;
  }

  const mover = (id, list) => {
    const i = list.findIndex((x) => x.id === id);
    const go = async (n) => {
      const ids = list.map((x) => x.id);
      [ids[i], ids[i + n]] = [ids[i + n], ids[i]];
      if (await guard(() => api.put('/categories-order', { ids }))) { await loadMeta(); ctx.refresh(); }
    };
    return h('span', { class: 'reorder' },
      h('button', { disabled: i <= 0, 'aria-label': 'Move up', onclick: () => go(-1) }, icon('up')),
      h('button', { disabled: i >= list.length - 1, 'aria-label': 'Move down', onclick: () => go(1) }, icon('down')));
  };
  const groupMover = (g) => {
    const ids = b.groups.map((x) => x.id);
    const i = ids.indexOf(g.id);
    const go = async (n) => {
      [ids[i], ids[i + n]] = [ids[i + n], ids[i]];
      if (await guard(() => api.put('/groups-order', { ids }))) { await loadMeta(); ctx.refresh(); }
    };
    return h('span', { class: 'reorder' },
      h('button', { disabled: i <= 0, 'aria-label': 'Move group up', onclick: () => go(-1) }, icon('up')),
      h('button', { disabled: i >= ids.length - 1, 'aria-label': 'Move group down', onclick: () => go(1) }, icon('down')));
  };

  const left = h('div', { class: 'stack', style: { gap: '18px' } });
  left.append(heroEl);
  if (noHistory || !b.income.cats.some((c) => c.planned)) {
    left.append(h('div', { class: 'card pad row wrap' }, h('div', { style: { flex: 1, minWidth: '220px' } }, h('b', null, 'Welcome to ZeroDollar'),
      h('div', { class: 'muted' }, 'Type your expected paychecks in the Income box, then plan each category until “Left to budget” reaches zero. Click an item’s name to rename it, set its due date, or remove it.'))));
  }
  left.append(groupCard(b.income), ...b.groups.map(groupCard),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => addGroup(ctx) }, icon('plus'), 'Add group'),
      h('button', { class: 'btn ghost', onclick: () => { editMode = !editMode; ctx.refresh(); } }, icon('edit'), editMode ? 'Done reordering' : 'Reorder')));

  // right column: this month's transactions + bills
  const newOnes = txs.transactions.filter((t) => t.type !== 'transfer' && !t.catId && !t.splits?.length);
  const side = h('aside', { class: 'side-panel' });
  side.append(h('section', { class: 'card' },
    h('header', { class: 'row between', style: { padding: '14px 16px 10px' } }, h('h3', { style: { fontSize: '15px' } }, 'Transactions'),
      h('button', { class: 'btn sm primary', onclick: () => openTxEditor({ onSaved: ctx.refresh }) }, icon('plus'), 'Add')),
    newOnes.length ? h('div', { class: 'day', style: { color: 'var(--warn)' } }, `New · ${newOnes.length} to categorize`) : null,
    newOnes.map((t) => miniTx(t, ctx)),
    txs.transactions.length === newOnes.length ? null : h('div', { class: 'day' }, 'Categorized'),
    txs.transactions.filter((t) => !newOnes.includes(t)).slice(0, 25).map((t) => miniTx(t, ctx)),
    !txs.transactions.length ? h('div', { class: 'empty' }, h('h3', null, 'Nothing spent yet'), 'Press + to log your first purchase.') : null));
  side.append(dueWeekCard(due));
  if (b.bills?.length) {
    side.append(h('section', { class: 'card' },
      h('header', { style: { padding: '14px 16px 6px' } }, h('h3', { style: { fontSize: '15px' } }, 'Bills this month')),
      b.bills.map((bill) => h('div', { class: 'txmini', style: { cursor: 'default' } },
        h('div', { class: 'who' }, h('b', null, bill.name), h('span', null, `Due ${ord(+bill.due.slice(8))}`)),
        bill.settled ? h('span', { class: 'pill good' }, 'Paid') : h('span', { class: 'amt num' }, fmt(bill.amount))))));
  }

  root.append(h('div', { class: 'budget' }, left, side));
  paint();
}

function dueWeekCard(due) {
  const short = (d) => dayLabel(d, S.meta.settings.locale);
  return h('section', { class: 'card due-week' },
    h('header', { class: 'row between', style: { padding: '14px 16px 6px' } },
      h('h3', { style: { fontSize: '15px' } }, 'Due this week'),
      due.items.length ? h('span', { class: 'muted num', style: { fontSize: '13px' } }, fmt(due.total)) : null),
    due.items.length
      ? due.items.map((i) => h('div', { class: 'txmini', style: { cursor: 'default' } },
          h('div', { class: 'who' }, h('b', null, i.name), h('span', { style: i.overdue ? { color: 'var(--bad)' } : null }, i.overdue ? `Overdue · was due ${short(i.date)}` : short(i.date))),
          h('span', { class: 'amt num' }, fmt(i.amount))))
      : h('div', { class: 'muted', style: { padding: '4px 16px 16px', fontSize: '13.5px' } }, 'Nothing due in the next 7 days. Set due days on your bills (Edit) and they will show up here.'));
}

const stat = (label, value) => h('div', null, h('b', { class: 'num' }, value), h('span', null, label));

function miniTx(t, ctx) {
  const cat = t.splits?.length ? 'Split' : t.type === 'transfer' ? 'Transfer' : catName(t.catId);
  return h('div', { class: 'txmini', tabIndex: 0, role: 'button', onclick: () => openTxEditor({ tx: t, onSaved: ctx.refresh }), onkeydown: (e) => e.key === 'Enter' && openTxEditor({ tx: t, onSaved: ctx.refresh }) },
    h('div', { class: 'who' }, h('b', null, t.payee || (t.type === 'transfer' ? 'Transfer' : 'No payee')), h('span', null, `${dayLabel(t.date, S.meta.settings.locale)} · `, cat || h('span', { style: { color: 'var(--warn)' } }, 'Uncategorized'))),
    h('span', { class: 'amt num' + (t.type === 'income' ? ' in' : '') }, (t.type === 'income' ? '+' : '') + fmt(t.amount)));
}

function startCard(b, ctx, first) {
  const m = monthLabel(S.month, S.meta.settings.locale);
  const go = (mode) => guard(async () => { await api.post(`/budget/${S.month}/init`, { mode }); ctx.refresh(); });
  return h('div', { class: 'card empty', style: { maxWidth: '620px', margin: '40px auto' } },
    h('h3', { style: { fontSize: '22px' } }, `Plan ${m}`),
    h('p', null, first ? 'Your starter categories are ready. Begin with a blank plan, then enter your income and give every dollar a job.' : 'Every month gets its own plan. Copy last month to save time, or start fresh.'),
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      b.previousMonth ? h('button', { class: 'btn primary', onclick: () => go('previous') }, `Copy ${monthLabel(b.previousMonth, S.meta.settings.locale)}`) : null,
      h('button', { class: b.previousMonth ? 'btn' : 'btn primary', onclick: () => go('blank') }, 'Start from scratch'),
      h('a', { class: 'btn', href: '#/settings' }, icon('upload'), 'Import from EveryDollar')));
}

function addInline(g, ctx) {
  const input = h('input', { placeholder: g.kind === 'income' ? 'Add income source…' : 'Add category…', maxLength: 40, 'aria-label': 'New category name' });
  const add = async () => {
    const name = input.value.trim();
    if (!name) return;
    const r = await guard(() => api.post('/categories', { groupId: g.id, name }));
    if (r) { await loadMeta(); ctx.refresh(); }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  return h('div', { class: 'add-inline' }, input, h('button', { class: 'btn sm', onclick: add }, icon('plus'), 'Add'));
}

function addGroup(ctx) {
  const name = h('input', { placeholder: 'e.g. Pets', maxLength: 40, autofocus: true });
  const m = modal({ title: 'New group', body: h('label', { class: 'f' }, 'Group name', name), footer: h('button', { class: 'btn primary', onclick: save }, 'Create') });
  name.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  async function save() {
    if (!name.value.trim()) return;
    if (await guard(() => api.post('/groups', { name: name.value }))) { await loadMeta(); m.close(); ctx.refresh(); }
  }
}

function renameGroup(g, ctx) {
  const name = h('input', { value: g.name, maxLength: 40 });
  const full = S.meta.groups.find((x) => x.id === g.id) || g;
  let color = full.color || null;
  const sw = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Group color' });
  const paintSw = () => sw.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', (b.dataset.c || '') === (color || '') ? 'true' : 'false'));
  sw.append(h('button', { type: 'button', class: 'none', 'data-c': '', title: 'Automatic', onclick: () => { color = null; paintSw(); } }, 'Auto'),
    ...PALETTE.map((c) => h('button', { type: 'button', 'data-c': c, title: c, 'aria-label': 'Color ' + c, style: { background: c }, onclick: () => { color = c; paintSw(); } })));
  paintSw();
  const m = modal({
    title: 'Edit group', body: [h('label', { class: 'f' }, 'Name', name), h('div', { class: 'f' }, 'Color (also used on the Insights page)', sw)],
    footer: [
      g.kind === 'income' ? null : h('button', { class: 'btn danger', style: { marginRight: 'auto' }, onclick: async () => {
        if (!(await confirmDialog(`Remove the “${g.name}” group? It must be empty.`, { ok: 'Remove', danger: true }))) return;
        if (await guard(() => api.del('/groups/' + g.id))) { await loadMeta(); m.close(); ctx.refresh(); }
      } }, 'Remove group'),
      h('button', { class: 'btn primary', onclick: async () => { if (await guard(() => api.patch('/groups/' + g.id, { name: name.value, color }))) { await loadMeta(); m.close(); ctx.refresh(); } } }, 'Save')]
  });
}

export function editCategory(c, ctx) {
  const full = S.catMap.get(c.id) || c;
  const name = h('input', { value: full.name, maxLength: 40 });
  const groups = S.meta.groups.filter((g) => !g.archived && (g.kind === 'income') === (full.type === 'income'));
  const group = h('select', null, groups.map((g) => h('option', { value: g.id }, g.name)));
  group.value = full.groupId;
  const due = h('input', { type: 'number', min: 1, max: 31, placeholder: 'None', value: full.dueDay || '' });
  const isFund = full.type === 'fund';
  const kind = h('select', null, h('option', { value: 'expense' }, 'Regular (resets monthly)'), h('option', { value: 'fund' }, 'Fund (balance carries over)'));
  kind.value = full.type === 'fund' ? 'fund' : 'expense';
  const target = h('input', { inputMode: 'decimal', placeholder: 'Optional goal', value: full.target ? S.money.plain(full.target) : '' });
  const start = h('input', { inputMode: 'decimal', placeholder: '0.00', value: full.fundStart ? S.money.plain(full.fundStart) : '' });
  const fundBox = h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Goal amount', target), h('label', { class: 'f' }, 'Balance when you started', start));
  const sync = () => (fundBox.style.display = kind.value === 'fund' ? '' : 'none');
  kind.addEventListener('change', sync);
  sync();
  const income = full.type === 'income';
  const debt = full.type === 'debt';
  const locked = income || debt;
  const payDays = dayPicker(full.payDays || []);
  const parsePayDays = () => payDays.get();
  const m = modal({
    title: 'Edit category',
    body: [
      h('label', { class: 'f' }, 'Name', name),
      h('div', { class: 'grid2' }, income ? null : h('label', { class: 'f' }, 'Group', group), income ? null : h('label', { class: 'f' }, 'Bill due on day', due)),
      income ? h('div', { class: 'f' }, 'Paid on these days of the month', payDays.el, h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'Tap every day you get paid. Paycheck Planning splits this income across them.')) : null,
      debt ? h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, h('a', { href: '#/debt', onclick: () => m.close() }, 'Balance, interest rate and minimum payment are on the Debt page.')) : null,
      locked ? null : h('label', { class: 'f' }, 'Type', kind),
      locked ? null : fundBox
    ],
    footer: [
      debt ? null : h('button', { class: 'btn danger', style: { marginRight: 'auto' }, onclick: async () => {
        if (!(await confirmDialog(`Remove “${full.name}”? If it has history it is hidden instead of deleted.`, { ok: 'Remove', danger: true }))) return;
        if (await guard(() => api.del('/categories/' + full.id))) { await loadMeta(); m.close(); ctx.refresh(); }
      } }, 'Remove'),
      h('button', { class: 'btn primary', onclick: async () => {
        const body = { name: name.value, groupId: group.value };
        if (income) { delete body.groupId; body.payDays = parsePayDays(); }
        if (debt) body.dueDay = due.value ? parseInt(due.value, 10) : null;
        if (!locked) {
          body.dueDay = due.value ? parseInt(due.value, 10) : null;
          body.type = kind.value;
          if (kind.value === 'fund') {
            body.target = parseMoney(target.value) || 0;
            body.fundStart = parseMoney(start.value) || 0;
          }
        }
        if (await guard(() => api.patch('/categories/' + full.id, body))) { await loadMeta(); m.close(); ctx.refresh(); }
      } }, 'Save')
    ]
  });
  void isFund; void clear;
}
