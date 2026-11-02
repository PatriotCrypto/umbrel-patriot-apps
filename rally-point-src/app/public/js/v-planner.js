// Planner: days of supply, what-if scenarios, gaps and the shopping list.
import { h, btn, clear, n0, n1, bar, badge, confirmBox, printNode, promptBox } from './ui.js';
import { RP, api, act, saveSettings, catLabel, go } from './core.js';
import { viewHead, tabBar, panel, supplyRow } from './parts.js';
import { editRecord } from './form.js';

const sim = { adult: 0, teen: 0, child: 0, infant: 0, water: 100, kcal: 100, expired: false, days: null };
let simResult = null;
let simSeq = 0;

function targetPicker() {
  const T = RP.st.settings.targetDays;
  const opts = [7, 14, 30, 60, 90, 180, 365];
  if (!opts.includes(T)) opts.push(T);
  opts.sort((a, b) => a - b);
  return h('label', { class: 'row' }, h('span', { class: 'dim' }, 'Target'),
    h('select', { style: { width: 'auto' }, onchange: (e) => saveSettings({ targetDays: +e.target.value }) },
      opts.map((d) => h('option', { value: d, selected: d === T }, d + ' days')), ));
}

function gapTable(gaps, T) {
  if (!gaps.length) return h('div', { class: 'empty' }, `You cover ${T} days for everything the app can measure.`);
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
    h('thead', null, h('tr', null, ['Short on', 'Need to add', 'Note'].map((x) => h('th', null, x)))),
    h('tbody', null, gaps.map((g) => h('tr', null,
      h('td', null, g.name, ' ', h('span', { class: 'dim' }, g.cat ? '(' + catLabel(g.cat) + ')' : '')),
      h('td', { class: 'num' }, n0(g.short) + ' ' + g.unit),
      h('td', { class: 'dim' }, g.detail))))));
}

function supplyTable(sup, T) {
  const n = sup.needs;
  const rows = [];
  if (n.kcal > 0) rows.push(supplyRow('Food', sup.food.days, T, false, `${n0(sup.food.kcal)} of ${n0(n.kcal * T)} kcal`));
  if (n.water.survival > 0) rows.push(supplyRow('Water: drink and cook', sup.water.survivalDays, T, sup.water.survivalSustainable, `${n0(sup.water.potable)} gal, ${n1(n.water.survival)} gal/day`));
  if (n.water.total > 0) rows.push(supplyRow('Water: everything', sup.water.fullDays, T, sup.water.fullSustainable, `${n0(sup.water.potable + sup.water.nonpotable)} gal, ${n1(n.water.total)} gal/day`));
  if (sup.animals.days != null) rows.push(supplyRow('Animal feed', sup.animals.days, T, false, `${n0(sup.animals.lbs)} lb, ${n1(n.animalFeedLb)} lb/day`));
  for (const f of sup.fuel.filter((x) => x.hasGen && x.days != null)) rows.push(supplyRow('Fuel: ' + f.type, f.days, T, false, `${n1(f.gallons)} gal, ${n1(f.burnPerDay)} gal/day`));
  if (!rows.length) return h('div', { class: 'empty' }, 'Add members and food or water to see days of supply.');
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
    h('thead', null, h('tr', null, ['Supply', 'Days', '', 'Detail'].map((x) => h('th', null, x)))), h('tbody', null, rows)));
}

function calorieBreakdown() {
  const rows = RP.st.items.filter((i) => i.cat === 'food' && i.x && i.x.calories > 0 && i.st.qty > 0)
    .map((i) => ({ name: i.name, kcal: (i.st.qty - i.st.expiredQty) * i.x.calories })).filter((r) => r.kcal > 0)
    .sort((a, b) => b.kcal - a.kcal).slice(0, 10);
  if (!rows.length) return h('div', { class: 'empty' }, 'Enter calories per unit on your food items to see where your calories come from.');
  const max = rows[0].kcal; const need = RP.st.calc.supply.needs.kcal || 1;
  return h('div', { class: 'panel-body' }, rows.map((r) => h('div', { class: 'part', style: { marginBottom: '.35rem' } },
    h('span', null, r.name), bar(r.kcal / max), h('span', null, `${n0(r.kcal)} kcal (${n1(r.kcal / need)} d)`))));
}

// ---------------------------------------------------------------- tabs
async function supplyTab(root) {
  const st = RP.st; const T = st.settings.targetDays; const sup = st.calc.supply;
  root.append(panel('Days of supply', supplyTable(sup, T)));
  const note = sup.countExpired ? 'Expired lots are counted.' : (sup.food.kcalExpired > 0 ? `${n0(sup.food.kcalExpired)} kcal of expired food is not counted. Change this in Settings.` : '');
  if (note) root.append(h('p', { class: 'hint' }, note));
  root.append(h('div', { class: 'grid g2' },
    panel('Where your calories come from', calorieBreakdown()),
    panel('Weakest links', sup.links.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
      h('thead', null, h('tr', null, ['Item', 'On hand', 'Use per day', 'Days'].map((x) => h('th', null, x)))),
      h('tbody', null, sup.links.slice(0, 15).map((l) => h('tr', null,
        h('td', null, l.name), h('td', { class: 'num' }, n1(l.qty) + ' ' + (l.unit || '')), h('td', { class: 'num' }, n1(l.need)),
        h('td', { class: 'num ' + (l.days < T / 3 ? 'crit-t' : l.days < T ? 'warn-t' : '') }, n1(l.days))))))) :
      h('div', { class: 'empty' }, 'Set a daily use on items like toilet paper, batteries or medicine and they appear here.'))));

  const gapHost = h('div', { class: 'empty' }, 'Working it out...');
  const addBtn = btn('Add to shopping list', async () => { if (await act(() => api('POST', '/api/shopping/generate', { targetDays: T }), { ok: 'Shopping list updated' })) go('planner', 'shopping'); }, 'small');
  root.append(panel(`Gaps to reach ${T} days`, gapHost, addBtn));
  try {
    const r = await api('POST', '/api/whatif', { targetDays: T });
    clear(gapHost); gapHost.className = ''; gapHost.append(gapTable(r.gaps, T));
  } catch (e) { gapHost.textContent = e.message; }
}

function simControls(onChange) {
  const num = (key, label) => h('div', { class: 'field' }, h('label', { class: 'lbl' }, label),
    h('input', { type: 'number', min: 0, max: 50, value: sim[key], oninput: (e) => { sim[key] = Math.max(0, parseInt(e.target.value, 10) || 0); onChange(); } }));
  const pct = (key, label) => {
    const out = h('span', { class: 'mono' }, sim[key] + '%');
    return h('div', { class: 'field' }, h('label', { class: 'lbl' }, label, ' ', out),
      h('input', { type: 'range', min: 25, max: 300, step: 5, value: sim[key], oninput: (e) => { sim[key] = +e.target.value; out.textContent = sim[key] + '%'; onChange(); } }));
  };
  return h('div', null,
    h('div', { class: 'form', style: { gridTemplateColumns: 'repeat(4, minmax(0,1fr))' } }, num('adult', 'Extra adults'), num('teen', 'Extra teens'), num('child', 'Extra children'), num('infant', 'Extra infants')),
    h('div', { class: 'form' }, pct('water', 'Water use'), pct('kcal', 'Calorie need')),
    h('div', { class: 'row' },
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: sim.expired, onchange: (e) => { sim.expired = e.target.checked; onChange(); } }), h('span', null, 'Count expired food and water')),
      h('label', { class: 'row' }, h('span', { class: 'dim' }, 'Outage length'), h('input', { type: 'number', min: 1, max: 3650, style: { width: '90px' }, placeholder: String(RP.st.settings.targetDays), value: sim.days || '', oninput: (e) => { sim.days = parseInt(e.target.value, 10) || null; onChange(); } }), h('span', { class: 'dim' }, 'days')),
      btn('Reset', () => { Object.assign(sim, { adult: 0, teen: 0, child: 0, infant: 0, water: 100, kcal: 100, expired: false, days: null }); RP.render(); }, 'small ghost')));
}

function whatIfTab(root) {
  const out = h('div');
  const T = () => sim.days || RP.st.settings.targetDays;
  const run = async () => {
    const seq = ++simSeq;
    try {
      const r = await api('POST', '/api/whatif', {
        targetDays: T(), extra: { adult: sim.adult, teen: sim.teen, child: sim.child, infant: sim.infant },
        waterMult: sim.water / 100, kcalMult: sim.kcal / 100, countExpired: sim.expired,
      });
      if (seq !== simSeq) return;
      simResult = r;
      clear(out);
      const sup = r.supply; const t = r.targetDays;
      out.append(
        h('p', null, `Scenario: ${sup.needs.people} people${sup.needs.pets ? ' and ' + sup.needs.pets + ' pets' : ''} for ${t} days.`),
        panel('Days of supply in this scenario', supplyTable(sup, t)),
        panel('What you would be short', gapTable(r.gaps, t)));
    } catch (e) { clear(out); out.append(h('div', { class: 'notice' }, e.message)); }
  };
  let timer;
  const later = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
  root.append(panel('Try a scenario', h('div', { class: 'panel-body' }, simControls(later),
    h('p', { class: 'hint' }, 'Nothing here changes your real data. Use it to see what happens if relatives arrive, water use doubles, or the grid is down for months.'))), out);
  run();
}

function shoppingTab(root) {
  const lines = RP.st.shopping.slice().sort((a, b) => (a.done - b.done) || a.name.localeCompare(b.name));
  const T = RP.st.settings.targetDays;
  const body = lines.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
    h('thead', null, h('tr', null, ['', 'Item', 'Qty', 'Note', ''].map((x) => h('th', null, x)))),
    h('tbody', null, lines.map((l) => h('tr', { class: l.done ? 'done' : '' },
      h('td', { style: { width: '36px' } }, h('input', { type: 'checkbox', checked: l.done, onchange: (e) => act(() => api('PUT', '/api/c/shopping/' + l.id, { done: e.target.checked })) })),
      h('td', { class: 'click', style: { cursor: 'pointer' }, onclick: () => editRecord({ coll: 'shopping', rec: l }) }, l.name),
      h('td', { class: 'num' }, n1(l.qty) + ' ' + (l.unit || '')),
      h('td', { class: 'dim' }, l.note),
      h('td', { class: 'acts' }, btn('Got it', async () => {
        const v = await promptBox('How many did you get? (adds to inventory)', { value: l.qty, type: 'number', okText: 'Add to inventory' });
        if (v == null) return;
        act(() => api('POST', `/api/shopping/${l.id}/stock`, { qty: parseFloat(v) }), { ok: 'Added to inventory' });
      }, 'small')))))))
    : h('div', { class: 'empty' }, 'Your shopping list is empty. Generate it from your gaps, or add lines by hand.');
  root.append(panel('Shopping list', body,
    btn('Fill from gaps', () => act(() => api('POST', '/api/shopping/generate', { targetDays: T }), { ok: 'List updated' }), 'small'),
    btn('+ Add line', () => editRecord({ coll: 'shopping', defaults: { qty: 1 } }), 'small'),
    btn('Clear bought', () => act(() => api('POST', '/api/shopping/clear', { done: true })), 'small ghost'),
    btn('Print', () => printNode('Shopping list', h('table', null, h('thead', null, h('tr', null, ['', 'Item', 'Qty', 'Note'].map((x) => h('th', null, x)))),
      h('tbody', null, lines.map((l) => h('tr', null, h('td', null, h('span', { class: 'box' })), h('td', null, l.name), h('td', null, n1(l.qty) + ' ' + (l.unit || '')), h('td', null, l.note)))))), 'small ghost'),
    h('a', { class: 'btn small ghost', href: '/api/export/shopping.csv', download: '' }, 'CSV'),
    lines.length ? btn('Clear all', async () => { if (await confirmBox('Remove every line from the shopping list?', { okText: 'Clear', danger: true })) act(() => api('POST', '/api/shopping/clear', { all: true })); }, 'small danger') : null));
}

export function render(root, sub) {
  const cur = sub || 'supply';
  root.append(viewHead('Planner', targetPicker()));
  root.append(tabBar([['supply', 'Supply'], ['whatif', 'What if'], ['shopping', 'Shopping list']], cur, (t) => go('planner', t)));
  if (cur === 'whatif') whatIfTab(root);
  else if (cur === 'shopping') shoppingTab(root);
  else supplyTab(root);
}
