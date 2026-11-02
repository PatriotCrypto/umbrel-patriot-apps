// Group: members, tasks, watch roster and go-bags.
import { h, btn, clear, n0, n1, badge, fmtDate, relDays, daysFrom, modal, confirmBox, printNode, toast, bar } from './ui.js';
import { RP, api, act, go, find } from './core.js';
import { viewHead, tabBar, panel, ptypeBadge, memberName } from './parts.js';
import { editRecord } from './form.js';

// ---------------------------------------------------------------- members
function membersTab(root) {
  const st = RP.st;
  const cards = st.members.map((m) => h('div', { class: 'card click', onclick: () => editRecord({ coll: 'members', rec: m, photo: true }) },
    h('div', { class: 'row' },
      m.photo ? h('img', { class: 'thumb big', src: '/photos/' + m.photo + '.jpg', alt: '' }) : null,
      h('div', { class: 'grow' }, h('h4', null, m.name), h('div', { class: 'chips' }, ptypeBadge(m.ptype), m.age != null ? badge(m.age + ' yrs') : null))),
    m.role ? h('p', { style: { marginTop: '.5rem' } }, h('strong', null, m.role)) : null,
    (m.skills || []).length ? h('div', { class: 'chips', style: { marginBottom: '.4rem' } }, m.skills.map((s) => badge(s))) : null,
    m.phone ? h('div', { class: 'dim' }, m.phone) : null,
    m.emergencyName ? h('div', { class: 'hint' }, 'Emergency: ' + m.emergencyName + (m.emergencyPhone ? ' ' + m.emergencyPhone : '')) : null,
    m.gear ? h('div', { class: 'hint' }, 'Gear: ' + m.gear.slice(0, 80)) : null));
  root.append(panel(`Members (${st.members.length})`, st.members.length ? h('div', { class: 'cards' }, cards) : h('div', { class: 'empty' }, 'Add the people and pets in your group. They drive your water and calorie math.'),
    btn('Medical records', () => go('vault', 'medical'), 'small ghost'),
    btn('+ Add member', () => editRecord({ coll: 'members', photo: true }), 'small primary')));

  const roles = st.calc.roles;
  root.append(panel('Key roles', h('div', { class: 'panel-body' }, roles.length ? h('div', { class: 'chips' }, roles.map((r) =>
    h('span', { class: 'badge ' + (r.members.length ? 'good' : 'crit'), title: r.members.join(', ') }, r.role + ': ' + (r.members.length ? r.members.join(', ') : 'nobody yet')))) : h('div', { class: 'dim' }, 'No key roles set.'),
  h('p', { class: 'hint' }, 'A role counts as covered when someone\'s position or skills mention it. Edit the list in Settings.')),
  btn('Settings', () => go('settings'), 'small ghost')));
}

// ---------------------------------------------------------------- tasks
const taskUi = { who: '' };

function taskRow(t) {
  const st = RP.st;
  const d = t.due ? daysFrom(st.today, t.due) : null;
  return h('tr', { class: 'click' + (t.done ? ' done' : ''), onclick: (e) => { if (!e.target.closest('button')) editRecord({ coll: 'tasks', rec: t }); } },
    h('td', { style: { width: '44px' } }, h('button', { class: 'qbtn', title: t.done ? 'Undo' : 'Mark done', onclick: () => act(() => api('POST', `/api/tasks/${t.id}/${t.done ? 'undo' : 'done'}`)) }, t.done ? '↺' : '✓')),
    h('td', { 'data-label': 'Task' }, t.title, t.priority === 'high' ? h('span', { style: { marginLeft: '.4rem' } }, badge('high', 'warn')) : null),
    h('td', { 'data-label': 'Who', class: 'dim' }, memberName(t.assignee)),
    h('td', { 'data-label': 'Due', class: d != null && d < 0 && !t.done ? 'crit-t' : '' }, t.due ? fmtDate(t.due) + ' (' + relDays(d) + ')' : ''),
    h('td', { 'data-label': 'Repeats', class: 'dim' }, t.every > 0 ? 'every ' + t.every + 'd' : ''));
}

function tasksTab(root) {
  const st = RP.st;
  const title = h('input', { type: 'text', placeholder: 'New task, then press Enter' });
  const who = h('select', { style: { width: 'auto' } }, [['', 'Anyone'], ...st.members.filter((m) => m.ptype !== 'pet').map((m) => [m.id, m.name])].map(([v, l]) => h('option', { value: v }, l)));
  const due = h('input', { type: 'date', style: { width: 'auto' } });
  const every = h('select', { style: { width: 'auto' } }, [[0, 'One time'], [1, 'Daily'], [7, 'Weekly'], [14, 'Every 2 weeks'], [30, 'Monthly'], [90, 'Quarterly'], [365, 'Yearly']].map(([v, l]) => h('option', { value: v }, l)));
  const add = async () => {
    if (!title.value.trim()) return;
    if (await act(() => api('POST', '/api/c/tasks', { title: title.value, assignee: who.value, due: due.value, every: +every.value }), { ok: 'Task added' })) title.value = '';
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  root.append(h('div', { class: 'toolbar' }, h('div', { style: { flex: '1 1 240px' } }, title), who, due, every, btn('Add', add, 'primary')));

  const filter = h('select', { style: { width: 'auto' }, onchange: (e) => { taskUi.who = e.target.value; RP.render(); } },
    [['', 'Everyone'], ...st.members.filter((m) => m.ptype !== 'pet').map((m) => [m.id, m.name])].map(([v, l]) => h('option', { value: v, selected: v === taskUi.who }, l)));
  let tasks = st.tasks.filter((t) => !taskUi.who || t.assignee === taskUi.who);
  const buckets = { 'Overdue': [], 'This week': [], 'Later': [], 'No date': [], 'Done': [] };
  for (const t of tasks) {
    if (t.done) { buckets.Done.push(t); continue; }
    if (!t.due) { buckets['No date'].push(t); continue; }
    const d = daysFrom(st.today, t.due);
    (d < 0 ? buckets.Overdue : d <= 7 ? buckets['This week'] : buckets.Later).push(t);
  }
  for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const body = h('div');
  for (const [k, list] of Object.entries(buckets)) {
    if (!list.length) continue;
    body.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
      h('thead', null, h('tr', null, [h('th'), h('th', null, `${k} (${list.length})`), h('th', null, 'Who'), h('th', null, 'Due'), h('th', null, 'Repeats')])),
      h('tbody', null, list.map(taskRow)))));
  }
  if (!tasks.length) body.append(h('div', { class: 'empty' }, 'No tasks. Add chores, drills and projects above. Repeating tasks reschedule themselves when you check them off.'));
  root.append(panel('Tasks', body, filter,
    btn('Print duty roster', () => printDuty(), 'small ghost')));
}

function printDuty() {
  const st = RP.st;
  const by = {};
  for (const t of st.tasks.filter((x) => !x.done)) (by[memberName(t.assignee) || 'Unassigned'] = by[memberName(t.assignee) || 'Unassigned'] || []).push(t);
  const wrap = h('div');
  for (const who of Object.keys(by).sort()) {
    wrap.append(h('h2', null, who), h('table', null, h('thead', null, h('tr', null, ['', 'Task', 'Due', 'Repeats'].map((x) => h('th', null, x)))),
      h('tbody', null, by[who].map((t) => h('tr', null, h('td', null, h('span', { class: 'box' })), h('td', null, t.title), h('td', null, t.due ? fmtDate(t.due) : ''), h('td', null, t.every > 0 ? 'every ' + t.every + ' days' : ''))))));
  }
  printNode('Duty roster: ' + st.settings.groupName, wrap);
}

// ---------------------------------------------------------------- roster
const ro = { ids: null, shift: 4, start: '', hours: 72, from: '20:00' };

function rosterTab(root) {
  const st = RP.st;
  const crew = st.members.filter((m) => m.ptype !== 'pet' && m.ptype !== 'infant' && !(m.age != null && m.age < 13));
  if (!ro.ids) ro.ids = new Set(crew.map((m) => m.id));
  if (!ro.start) ro.start = st.today;
  const out = h('div');

  const gen = () => {
    clear(out);
    const people = crew.filter((m) => ro.ids.has(m.id));
    if (!people.length) { out.append(h('div', { class: 'empty' }, 'Pick at least one person.')); return; }
    const [hh, mm] = ro.from.split(':').map((x) => parseInt(x, 10) || 0);
    const start = new Date(ro.start + 'T00:00:00'); start.setHours(hh, mm, 0, 0);
    const slots = Math.ceil(ro.hours / ro.shift);
    const rows = []; const hrs = {};
    for (let i = 0; i < slots; i++) {
      const s = new Date(start.getTime() + i * ro.shift * 3600000);
      const e = new Date(s.getTime() + ro.shift * 3600000);
      const p = people[i % people.length];
      hrs[p.name] = (hrs[p.name] || 0) + ro.shift;
      rows.push([s, e, p.name]);
    }
    const fmtT = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const fmtD = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const table = h('table', { class: 'tbl keep' }, h('thead', null, h('tr', null, ['Day', 'From', 'To', 'On watch'].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map(([s, e, p]) => h('tr', null, h('td', null, fmtD(s)), h('td', null, fmtT(s)), h('td', null, fmtT(e)), h('td', null, h('strong', null, p))))));
    out.append(panel(`${slots} shifts of ${ro.shift} hours`, h('div', { class: 'tbl-wrap' }, table),
      h('span', { class: 'dim' }, Object.entries(hrs).map(([k, v]) => `${k} ${v}h`).join(', ')),
      btn('Print', () => printNode('Watch roster: ' + st.settings.groupName, h('table', null, h('thead', null, h('tr', null, ['Day', 'From', 'To', 'On watch', 'Initial'].map((x) => h('th', null, x)))),
        h('tbody', null, rows.map(([s, e, p]) => h('tr', null, h('td', null, fmtD(s)), h('td', null, fmtT(s)), h('td', null, fmtT(e)), h('td', null, p), h('td', null)))))), 'small ghost')));
  };

  const checks = crew.map((m) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: ro.ids.has(m.id), onchange: (e) => { e.target.checked ? ro.ids.add(m.id) : ro.ids.delete(m.id); gen(); } }), h('span', null, m.name)));
  const num = (label, key, min, max) => h('div', { class: 'field' }, h('label', { class: 'lbl' }, label), h('input', { type: 'number', min, max, value: ro[key], oninput: (e) => { ro[key] = Math.max(min, Math.min(max, parseInt(e.target.value, 10) || min)); gen(); } }));
  root.append(panel('Watch roster generator', h('div', { class: 'panel-body' },
    h('div', { class: 'form', style: { gridTemplateColumns: 'repeat(4, minmax(0,1fr))' } },
      num('Shift length (hours)', 'shift', 1, 12), num('Total hours to cover', 'hours', 4, 336),
      h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Start date'), h('input', { type: 'date', value: ro.start, oninput: (e) => { ro.start = e.target.value || st.today; gen(); } })),
      h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Start time'), h('input', { type: 'time', value: ro.from, oninput: (e) => { ro.from = e.target.value || '20:00'; gen(); } }))),
    h('div', { class: 'lbl' }, 'Who stands watch'), h('div', { class: 'chips' }, checks.length ? checks : h('span', { class: 'dim' }, 'Add members first.')),
    h('p', { class: 'hint' }, 'Shifts rotate in order so nobody takes two back to back. Children under 13 and infants are left out by default.'))), out);
  gen();
}

// ---------------------------------------------------------------- bags
const TEMPLATE = [
  ['Water bottle, 1 L, full', 2, 35], ['Water filter or purification tablets', 1, 3], ['Food for 3 days (bars, freeze-dried)', 3, 16],
  ['Tarp or emergency shelter', 1, 16], ['Sleeping bag or wool blanket', 1, 32], ['Lighter and waterproof matches', 2, 1],
  ['Knife or multi-tool', 1, 6], ['Headlamp with spare batteries', 1, 4], ['First-aid kit with tourniquet', 1, 16],
  ['Handheld or hand-crank radio', 1, 8], ['Rain jacket or poncho', 1, 8], ['Spare socks and underwear', 2, 5],
  ['Warm hat and gloves', 1, 6], ['Hygiene kit (soap, toothbrush, paper)', 1, 8], ['Document copies and small-bill cash', 1, 4],
  ['Phone charger or power bank', 1, 10], ['Map and compass', 1, 4], ['Whistle', 1, 1], ['Paracord, 50 ft', 1, 6],
  ['Medications, 7-day supply', 1, 4], ['Work gloves', 1, 6], ['Cup and small stove', 1, 12],
];

const bagWeight = (b) => (b.lines || []).reduce((t, l) => t + (+l.qty || 0) * (+l.weightOz || 0), 0) / 16;

function bagPanel(b) {
  const st = RP.st;
  const lb = bagWeight(b);
  const packed = (b.lines || []).filter((l) => l.packed).length;
  const saveLines = (lines, msg) => act(() => api('PUT', '/api/c/bags/' + b.id, { lines }), msg ? { ok: msg } : {});
  const rows = (b.lines || []).map((l) => h('tr', null,
    h('td', { style: { width: '36px' } }, h('input', { type: 'checkbox', checked: l.packed, onchange: (e) => saveLines(b.lines.map((x) => (x.id === l.id ? Object.assign({}, x, { packed: e.target.checked }) : x))) })),
    h('td', null, l.name || (find('items', l.itemId) || {}).name || '', l.itemId ? h('span', { style: { marginLeft: '.4rem' } }, badge('inventory', 'info')) : null),
    h('td', { class: 'num' }, n1(l.qty)), h('td', { class: 'num' }, l.weightOz ? n1(l.weightOz) + ' oz' : ''),
    h('td', { class: 'acts' }, btn('×', () => saveLines(b.lines.filter((x) => x.id !== l.id)), 'small ghost'))));
  const target = b.maxWeightLb > 0 ? b.maxWeightLb : null;
  const addFromInv = () => {
    const sel = h('select', null, st.items.slice().sort((a, c) => a.name.localeCompare(c.name)).map((i) => h('option', { value: i.id }, i.name)));
    const qty = h('input', { type: 'number', value: 1, min: 0, step: 'any' });
    const free = h('input', { type: 'text', placeholder: 'Or type any item' });
    const oz = h('input', { type: 'number', min: 0, step: 'any', placeholder: 'Weight each (oz)' });
    const m = modal({ title: 'Add to ' + b.name, body: h('div', null,
      h('label', { class: 'lbl' }, 'From inventory'), sel, h('label', { class: 'lbl', style: { marginTop: '.6rem' } }, 'Quantity'), qty,
      h('label', { class: 'lbl', style: { marginTop: '.6rem' } }, 'Or a custom item'), free, h('label', { class: 'lbl', style: { marginTop: '.6rem' } }, 'Weight each (oz)'), oz),
    buttons: [btn('Cancel', () => m.close(), 'ghost'), btn('Add', async () => {
      let line;
      if (free.value.trim()) line = { name: free.value.trim(), qty: +qty.value || 1, weightOz: +oz.value || 0, packed: false, itemId: '' };
      else if (sel.value) { const it = find('items', sel.value); line = { name: it.name, qty: +qty.value || 1, weightOz: +oz.value || it.weightOz || 0, packed: false, itemId: it.id }; }
      else return;
      if (await saveLines(b.lines.concat([line]))) m.close();
    }, 'primary')] });
  };
  return panel(b.name, h('div', null,
    h('div', { class: 'panel-body' }, h('div', { class: 'row' },
      h('span', null, `${packed} of ${(b.lines || []).length} packed`), h('span', { class: 'spacer' }),
      h('strong', { class: target && lb > target ? 'crit-t' : '' }, n1(lb) + ' lb'), target ? h('span', { class: 'dim' }, 'of ' + target + ' lb target') : null),
    bar(target ? lb / target : packed / Math.max(1, (b.lines || []).length), target && lb > target ? 'crit' : 'good'),
    b.owner ? h('p', { class: 'hint' }, 'Owner: ' + memberName(b.owner)) : null),
    rows.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' }, h('thead', null, h('tr', null, ['', 'Item', 'Qty', 'Weight', ''].map((x) => h('th', null, x)))), h('tbody', null, rows))) : h('div', { class: 'empty' }, 'Empty bag. Add items or start from the 72-hour template.')),
  btn('+ Item', addFromInv, 'small'),
  btn('Template', async () => {
    if (b.lines.length && !(await confirmBox('Add the standard 72-hour list to this bag?', { okText: 'Add' }))) return;
    saveLines(b.lines.concat(TEMPLATE.map(([name, qty, weightOz]) => ({ name, qty, weightOz, packed: false, itemId: '' }))), 'Template added');
  }, 'small ghost'),
  btn('Print', () => printNode('Go-bag: ' + b.name, h('table', null, h('thead', null, h('tr', null, ['Packed', 'Item', 'Qty'].map((x) => h('th', null, x)))),
    h('tbody', null, (b.lines || []).map((l) => h('tr', null, h('td', null, h('span', { class: 'box' })), h('td', null, l.name || (find('items', l.itemId) || {}).name), h('td', null, n1(l.qty))))))), 'small ghost'),
  btn('Edit', () => editRecord({ coll: 'bags', rec: b, wide: true }), 'small'));
}

function bagsTab(root) {
  const bags = RP.st.bags;
  root.append(h('div', { class: 'toolbar' }, btn('+ New go-bag', () => editRecord({ coll: 'bags', wide: true }), 'primary')));
  if (!bags.length) root.append(h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No go-bags yet. Make one per person, one for the vehicle, and a get-home bag for work.')));
  for (const b of bags) root.append(bagPanel(b));
}

export function render(root, sub) {
  const cur = sub || 'members';
  root.append(viewHead('Group'));
  root.append(tabBar([['members', 'Members'], ['tasks', 'Tasks'], ['roster', 'Watch roster'], ['bags', 'Go-bags']], cur, (t) => go('group', t)));
  if (cur === 'tasks') tasksTab(root); else if (cur === 'roster') rosterTab(root); else if (cur === 'bags') bagsTab(root); else membersTab(root);
}
