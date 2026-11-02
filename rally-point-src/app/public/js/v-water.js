// Water & Power: sources, treatment, rain catchment, loads, solar/battery budget, generators and fuel.
import { h, btn, clear, n0, n1, n2, badge, bar, fmtDate, relDays, dueClass, daysFrom, modal, confirmBox } from './ui.js';
import { RP, api, act, saveSettings, go } from './core.js';
import { viewHead, tabBar, tile, panel, kv } from './parts.js';
import { editRecord, listPanel, buildForm } from './form.js';
import { editItem } from './v-inventory.js';

const kindOf = (days, T, sust) => (sust ? 'good' : days == null ? 'crit' : days < T / 3 ? 'crit' : days < T ? 'warn' : 'good');

// ---------------------------------------------------------------- water
function rainCalc() {
  const st = RP.st;
  const roof = st.wsources.reduce((t, w) => t + (+w.roofSqft || 0), 0) || 1000;
  const roofIn = h('input', { type: 'number', value: roof, min: 0 });
  const rainIn = h('input', { type: 'number', value: st.settings.rainfallIn, min: 0 });
  const effIn = h('input', { type: 'number', value: 80, min: 10, max: 100 });
  const out = h('div', { class: 'dim' }, 'Working...');
  const run = async () => {
    try {
      const r = await api('GET', `/api/calc/rain?roof=${+roofIn.value || 0}&rain=${+rainIn.value || 0}&eff=${(+effIn.value || 80) / 100}`);
      clear(out);
      out.append(kv([['Per inch of rain', n0(r.perInch) + ' gal'], ['Per year', n0(r.perYear) + ' gal'], ['Average per day', n1(r.perDay) + ' gal']]),
        h('p', { class: 'hint' }, 'Treat catchment water before drinking. See the Library for first-flush and storage notes.'));
    } catch (e) { out.textContent = e.message; }
  };
  [roofIn, rainIn, effIn].forEach((i) => i.addEventListener('input', run));
  run();
  return panel('Rain catchment calculator', h('div', { class: 'panel-body' },
    h('div', { class: 'form' },
      h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Roof area (sq ft)'), roofIn),
      h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Rainfall per year (inches)'), rainIn),
      h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Collection efficiency (%)'), effIn)), out));
}

function bleachCalc() {
  const gal = h('input', { type: 'number', value: 5, min: 0, step: 'any' });
  const pct = h('select', null, [['6', '5 to 6% (regular)'], ['8.25', '8.25% (concentrated)'], ['7.5', '7.5%'], ['4', '4 to 4.5%']].map(([v, l]) => h('option', { value: v }, l)));
  const cloudy = h('input', { type: 'checkbox' });
  const out = h('div');
  const run = async () => {
    try {
      const r = await api('GET', `/api/calc/bleach?gal=${+gal.value || 0}&pct=${pct.value}&cloudy=${cloudy.checked ? 1 : 0}`);
      clear(out);
      out.append(kv([['Drops', n0(r.drops)], ['Teaspoons', n2(r.tsp)], ['Milliliters', n1(r.ml)], ['Drops per gallon', n1(r.dropsPerGal)]]),
        h('p', { class: 'hint' }, 'Plain unscented bleach only. Stir, wait 30 minutes; it should smell faintly of chlorine. If not, dose again and wait 15 minutes. Based on EPA guidance: 8 drops of 6% bleach per gallon of clear water.'));
    } catch (e) { out.textContent = e.message; }
  };
  [gal, pct, cloudy].forEach((i) => i.addEventListener('input', run));
  run();
  return panel('Bleach dose calculator', h('div', { class: 'panel-body' },
    h('div', { class: 'form' },
      h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Gallons to treat'), gal),
      h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Bleach strength'), pct)),
    h('label', { class: 'chk', style: { marginBottom: '.7rem' } }, cloudy, h('span', null, 'Water is cloudy or very cold (double dose)')), out));
}

function waterTab(root) {
  const st = RP.st; const sup = st.calc.supply; const T = st.settings.targetDays; const n = sup.needs;
  const tiles = h('div', { class: 'tiles' },
    tile({ title: 'Drinking water stored', big: n0(sup.water.potable), unit: 'gal', sub: 'containers plus tank levels' }),
    tile({ title: 'Non-potable stored', big: n0(sup.water.nonpotable), unit: 'gal', sub: 'for washing and flushing' }),
    tile({ title: 'Reliable inflow', big: n1(sup.water.inflow), unit: 'gal/day', sub: sup.water.inflow ? 'from wells, springs or similar' : 'none counted' }),
    tile({ title: 'Drink and cook', big: sup.water.survivalSustainable ? 'OK' : n1(sup.water.survivalDays || 0), unit: sup.water.survivalSustainable ? '' : 'days',
      kind: n.water.survival > 0 ? kindOf(sup.water.survivalDays || 0, T, sup.water.survivalSustainable) : '', sub: `${n1(n.water.survival)} gal/day` }),
    tile({ title: 'All uses', big: sup.water.fullSustainable ? 'OK' : n1(sup.water.fullDays || 0), unit: sup.water.fullSustainable ? '' : 'days',
      kind: n.water.total > 0 ? kindOf(sup.water.fullDays || 0, T, sup.water.fullSustainable) : '', sub: `${n1(n.water.total)} gal/day` }));
  root.append(tiles);

  root.append(h('div', { class: 'grid g2' },
    panel('Daily water need', h('div', { class: 'panel-body' }, kv([
      ['Drinking', n1(n.water.drink) + ' gal'], ['Cooking', n1(n.water.cook) + ' gal'], ['Animals and pets', n1(n.water.animals) + ' gal'],
      ['Hygiene and cleaning', n1(n.water.hygiene) + ' gal'], ['Total', n1(n.water.total) + ' gal']]),
    h('p', { class: 'hint' }, 'Change the per-person amounts in Settings. Counting ' + n.people + ' people.')), btn('Settings', () => go('settings'), 'small ghost')),
    h('div', null, rainCalc())));

  root.append(listPanel({
    coll: 'wsources', title: 'Water sources', wide: true, addLabel: '+ Add source', empty: 'Add rain barrels, tanks, a well or a creek you can draw from.',
    cols: [
      { h: 'Source', f: (r) => r.name }, { h: 'Type', f: (r) => r.type, cls: 'dim' },
      { h: 'Level', f: (r) => (r.capacityGal > 0 ? h('span', { class: 'row' }, bar((r.currentGal || 0) / r.capacityGal, 'info'), n0(r.currentGal) + ' / ' + n0(r.capacityGal) + ' gal') : n0(r.currentGal) + ' gal') },
      { h: 'Inflow', f: (r) => (r.inflowGalPerDay > 0 ? n1(r.inflowGalPerDay) + ' gal/day' : ''), cls: 'num' },
      { h: 'Water test', f: (r) => { if (!r.lastTested) return h('span', { class: 'dim' }, 'never'); const d = daysFrom(st.today, r.lastTested); return h('span', { class: d < -365 ? 'warn-t' : '' }, fmtDate(r.lastTested)); } },
    ],
  }));
  root.append(h('div', { class: 'grid g2' }, bleachCalc(),
    listPanel({
      coll: 'wlog', title: 'Treatment log', addLabel: '+ Log', empty: 'Log each batch you treat or filter.', defaults: { date: st.today },
      cols: [{ h: 'Date', f: (r) => fmtDate(r.date) }, { h: 'Method', f: (r) => r.method }, { h: 'Gallons', f: (r) => n1(r.gallons), cls: 'num' }, { h: 'Source', f: (r) => r.source, cls: 'dim' }],
      rows: st.wlog.slice(0, 20),
    })));
}

// ---------------------------------------------------------------- power
const POWER_FIELDS = [
  { key: 'solarW', label: 'Solar array (watts)', type: 'num', min: 0 },
  { key: 'sunHours', label: 'Peak sun hours per day', type: 'num', min: 0, max: 12, hint: 'Winter is often 2 to 3 in the Midwest, summer 5 to 6.' },
  { key: 'systemEff', label: 'System efficiency (%)', type: 'num', min: 10, max: 100, hint: 'Panels, wiring, charge controller and inverter losses. 70 to 80 is typical.' },
  { key: 'bankWh', label: 'Battery bank (Wh)', type: 'num', min: 0, hint: 'Volts x amp-hours. A 12 V 100 Ah battery is 1,200 Wh.' },
  { key: 'dod', label: 'Usable depth of discharge (%)', type: 'num', min: 10, max: 100, hint: 'LiFePO4 about 80 to 90. Lead-acid about 50.' },
  { key: 'inverterW', label: 'Inverter size (watts)', type: 'num', min: 0 },
  { key: 'genSupplementHrs', label: 'Generator hours per day to charge', type: 'num', min: 0, max: 24 },
  { key: 'genWatts', label: 'Generator charging power (watts)', type: 'num', min: 0 },
];

function powerTab(root) {
  const st = RP.st; const pw = st.calc.power;
  const form = buildForm(POWER_FIELDS, st.settings.power);
  root.append(panel('Solar and battery system', h('div', { class: 'panel-body' }, form.el), btn('Save', () => saveSettings({ power: form.get() }, 'Saved'), 'small primary')));

  const days = (r) => (r.sustainable ? 'sustainable' : n1(r.days) + ' days');
  root.append(h('div', { class: 'tiles' },
    tile({ title: 'Daily use', big: n0(pw.dailyWh), unit: 'Wh', sub: `${n0(pw.criticalWh)} Wh from critical loads` }),
    tile({ title: 'Daily production', big: n0(pw.solarWh + pw.genWh), unit: 'Wh', sub: `${n0(pw.solarWh)} solar, ${n0(pw.genWh)} generator` }),
    tile({ title: 'Battery usable', big: n0(pw.usableBankWh), unit: 'Wh' }),
    tile({ title: 'Autonomy, all loads', big: pw.all.sustainable ? 'OK' : n1(pw.all.days), unit: pw.all.sustainable ? '' : 'days', kind: pw.all.sustainable ? 'good' : pw.all.days < 1 ? 'crit' : 'warn', sub: `net ${n0(pw.all.net)} Wh/day` }),
    tile({ title: 'Autonomy, critical only', big: pw.critical.sustainable ? 'OK' : n1(pw.critical.days), unit: pw.critical.sustainable ? '' : 'days', kind: pw.critical.sustainable ? 'good' : pw.critical.days < 1 ? 'crit' : 'warn', sub: `net ${n0(pw.critical.net)} Wh/day` }),
    tile({ title: 'Peak load', big: n0(pw.peakW), unit: 'W', kind: pw.inverterOk === false ? 'crit' : '', sub: pw.inverterOk == null ? 'set an inverter size' : pw.inverterOk ? 'inverter can carry it all at once' : 'bigger than your inverter if everything runs together' })));
  if (pw.dailyWh > 0) {
    root.append(h('p', { class: 'hint' }, `To cover all loads on a typical day you would need about ${n0(pw.needSolarW)} W of solar, and about ${n0(pw.needBankWh2d)} Wh of battery for two days with no sun.`));
  }
  root.append(listPanel({
    coll: 'loads', title: 'Electrical loads', addLabel: '+ Add load', empty: 'List what you would run off-grid: fridge, lights, radios, well pump.',
    cols: [
      { h: 'Device', f: (r) => r.name }, { h: 'Watts', f: (r) => n0(r.watts), cls: 'num' }, { h: 'Qty', f: (r) => r.qty, cls: 'num' },
      { h: 'Hours/day', f: (r) => n1(r.hoursPerDay), cls: 'num' }, { h: 'Wh/day', f: (r) => n0(r.watts * (r.qty == null ? 1 : r.qty) * r.hoursPerDay), cls: 'num' },
      { h: 'Critical', f: (r) => (r.critical ? badge('critical', 'warn') : '') },
    ],
    sort: (a, b) => b.watts * b.hoursPerDay - a.watts * a.hoursPerDay,
  }));
}

// ---------------------------------------------------------------- fuel
function editGenerator(g) {
  const fields = [
    { key: 'name', label: 'Name', type: 'text', req: true },
    { key: 'fuelType', label: 'Fuel', type: 'sel', options: RP.meta.fuelTypes },
    { key: 'gph', label: 'Fuel burn (gal/hour)', type: 'num', min: 0, hint: 'From the manual at your typical load. Many 3 to 5 kW units burn 0.3 to 0.6.' },
    { key: 'hoursPerDay', label: 'Hours run per day', type: 'num', min: 0, max: 24 },
    { key: 'watts', label: 'Rated watts', type: 'num', min: 0 },
  ];
  const form = buildForm(fields, g || { fuelType: 'gasoline', gph: 0.5, hoursPerDay: 4 });
  const save = async (list) => { if (await saveSettings({ generators: list }, 'Saved')) m.close(); };
  const m = modal({
    title: g ? 'Edit generator' : 'Add generator', body: form.el,
    buttons: [
      g ? btn('Delete', async () => { if (await confirmBox('Remove this generator?', { okText: 'Remove', danger: true })) save(RP.st.settings.generators.filter((x) => x.id !== g.id)); }, 'danger left') : null,
      btn('Cancel', () => m.close(), 'ghost'),
      btn('Save', () => {
        const v = form.get();
        if (!v.name) return;
        const list = RP.st.settings.generators.slice();
        if (g) list[list.findIndex((x) => x.id === g.id)] = Object.assign({}, g, v);
        else list.push(v);
        save(list);
      }, 'primary'),
    ],
  });
}

function fuelTab(root) {
  const st = RP.st; const sup = st.calc.supply; const T = st.settings.targetDays;
  const gens = st.settings.generators;
  root.append(panel('Generators', gens.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
    h('thead', null, h('tr', null, ['Name', 'Fuel', 'Burn', 'Hours/day', 'Per day'].map((x) => h('th', null, x)))),
    h('tbody', null, gens.map((g) => h('tr', { class: 'click', onclick: () => editGenerator(g) },
      h('td', null, g.name), h('td', null, g.fuelType), h('td', { class: 'num' }, n2(g.gph) + ' gal/h'), h('td', { class: 'num' }, n1(g.hoursPerDay)), h('td', { class: 'num' }, n1(g.gph * g.hoursPerDay) + ' gal')))))) :
    h('div', { class: 'empty' }, 'No generators yet. Add one so the app can work out how long your fuel lasts.'),
  btn('+ Add generator', () => editGenerator(null), 'small')));

  root.append(panel('Fuel on hand', sup.fuel.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
    h('thead', null, h('tr', null, ['Fuel', 'On hand', 'Burn per day', 'Runtime', ''].map((x) => h('th', null, x)))),
    h('tbody', null, sup.fuel.map((f) => h('tr', null,
      h('td', null, f.type), h('td', { class: 'num' }, n1(f.gallons) + ' gal'), h('td', { class: 'num' }, f.burnPerDay ? n1(f.burnPerDay) + ' gal' : ''),
      h('td', { class: 'num ' + (f.days != null && f.days < T ? 'warn-t' : '') }, f.days != null ? n1(f.days) + ' days' : ''),
      h('td', { style: { minWidth: '120px' } }, f.days != null ? bar(f.days / Math.max(1, T), kindOf(f.days, T)) : null)))))) :
    h('div', { class: 'empty' }, 'Add fuel items (gasoline, propane, diesel) in Inventory.'),
  btn('Add fuel', () => editItem(null, { cat: 'fuel', unit: 'can', x: { fuelType: 'gasoline', gallons: 5 } }), 'small')));

  const fuelItems = st.items.filter((i) => i.cat === 'fuel');
  if (fuelItems.length) {
    root.append(panel('Fuel age', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
      h('thead', null, h('tr', null, ['Item', 'Type', 'Qty', 'Stabilized', 'Good until'].map((x) => h('th', null, x)))),
      h('tbody', null, fuelItems.map((i) => h('tr', { class: 'click', onclick: () => editItem(i) },
        h('td', null, i.name), h('td', null, i.x.fuelType), h('td', { class: 'num' }, n1(i.st.qty) + ' ' + (i.unit || '')), h('td', null, i.x.stabilized ? 'yes' : 'no'),
        h('td', { class: dueClass(i.st.nearestDays, st.settings.expiry.soonDays, st.settings.expiry.warnDays) + '-t' }, i.st.nearest ? fmtDate(i.st.nearest) + ' (' + relDays(i.st.nearestDays) + ')' : 'no date')))))),
    h('p', { class: 'hint pad' }, 'Enter the date bought and the app estimates when fuel goes stale: gasoline about 3 months (12 with stabilizer), diesel about a year, kerosene about two. Propane does not expire.')));
  }
}

export function render(root, sub) {
  const cur = sub || 'water';
  root.append(viewHead('Water & Power'));
  root.append(tabBar([['water', 'Water'], ['power', 'Power'], ['fuel', 'Fuel & generators']], cur, (t) => go('water', t)));
  if (cur === 'power') powerTab(root); else if (cur === 'fuel') fuelTab(root); else waterTab(root);
}
