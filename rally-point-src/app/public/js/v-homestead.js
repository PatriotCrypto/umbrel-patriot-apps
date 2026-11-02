// Homestead: garden, sowing calendar, seeds, animals, harvest and preserving.
import { h, btn, badge, bar, n0, n1, fmtDate, daysFrom, relDays } from './ui.js';
import { RP, api, act, go } from './core.js';
import { viewHead, tabBar, panel, tile } from './parts.js';
import { editRecord, listPanel } from './form.js';

function gardenTab(root) {
  const st = RP.st; const g = st.calc.garden; const t = st.today;
  root.append(h('div', { class: 'tiles' },
    tile({ title: `Harvested ${st.calc.year}`, big: n0(g.lb), unit: 'lb', sub: n0(g.kcal) + ' kcal' }),
    tile({ title: 'Plantings', big: String(st.plantings.length), sub: `${st.beds.length} beds, ${n0(st.beds.reduce((a, b) => a + (+b.sqft || 0), 0))} sq ft` }),
    tile({ title: 'Last / first frost', big: (st.calc.frost.last || '').slice(5) || '-', sub: 'first frost ' + ((st.calc.frost.first || '').slice(5) || '-') + ' (set in Settings)' })));
  root.append(listPanel({ coll: 'beds', title: 'Beds', cols: [{ h: 'Bed', f: (r) => r.name }, { h: 'Sq ft', f: (r) => n0(r.sqft), cls: 'num' }, { h: 'Sun', f: (r) => r.sun, cls: 'dim' }, { h: 'Soil', f: (r) => r.soil || '', cls: 'dim' }], empty: 'Add your garden beds, plots or containers.' }));
  root.append(listPanel({ coll: 'plantings', title: 'Plantings', wide: true,
    cols: [{ h: 'Crop', f: (r) => r.crop + (r.variety ? ' (' + r.variety + ')' : '') },
      { h: 'Bed', f: (r) => { const b = st.beds.find((x) => x.id === r.bed); return b ? b.name : ''; }, cls: 'dim' },
      { h: 'Status', f: (r) => badge(r.status, r.status === 'failed' ? 'crit' : r.status === 'harvested' ? 'good' : '') },
      { h: 'Sown', f: (r) => (r.sowDate ? fmtDate(r.sowDate) : '') },
      { h: 'Harvest', f: (r) => (r.harvestDate ? fmtDate(r.harvestDate) : '') },
      { h: 'Yield', f: (r) => (r.yieldLb ? n1(r.yieldLb) + ' lb' : ''), cls: 'num' }],
    sort: (a, b) => (b.sowDate || '').localeCompare(a.sowDate || ''), empty: 'No plantings yet. The Calendar tab shows what to sow and when.' }));
}

function calendarTab(root) {
  const st = RP.st; const t = st.today;
  const rows = st.calc.sowPlan.filter((p) => p.outdoor).slice().sort((a, b) => (a.indoor || a.outdoor).localeCompare(b.indoor || b.outdoor));
  root.append(panel('Sowing calendar', h('div', null,
    h('p', { class: 'hint pad' }, `Based on last frost ${st.calc.frost.last} and first frost ${st.calc.frost.first}. These are rough guides; adjust for your microclimate and local extension advice.`),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
      h('thead', null, h('tr', null, ['Crop', 'Start indoors', 'Sow / plant out', 'Harvest from', 'Days'].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((p) => {
        const d = daysFrom(t, p.indoor || p.outdoor);
        const cell = (v) => (v ? h('span', { class: daysFrom(t, v) < 0 ? 'dim' : '' }, fmtDate(v)) : '');
        return h('tr', { class: d >= 0 && d <= 14 ? 'hot' : '' }, h('td', null, h('strong', null, p.crop), ' ', badge(p.kind)), h('td', null, cell(p.indoor)), h('td', null, cell(p.outdoor)), h('td', null, cell(p.harvest)), h('td', { class: 'num dim' }, p.dtm));
      })))))));
}

function seedsTab(root) {
  const y = +RP.st.today.slice(0, 4);
  root.append(listPanel({ coll: 'seeds', title: 'Seed bank', wide: true,
    cols: [{ h: 'Crop', f: (r) => r.crop + (r.variety ? ' (' + r.variety + ')' : '') }, { h: 'Type', f: (r) => badge(r.kind), cls: '' },
      { h: 'Qty', f: (r) => (r.qty != null ? n0(r.qty) + ' ' + r.unit : ''), cls: 'num' },
      { h: 'Viable until', f: (r) => { if (!r.packedYear || !r.viableYears) return ''; const u = r.packedYear + r.viableYears; return h('span', { class: u < y ? 'crit-t' : u === y ? 'warn-t' : '' }, String(u)); } },
      { h: 'Germ %', f: (r) => (r.germRate != null ? r.germRate + '%' : ''), cls: 'num' }],
    empty: 'Track seed stock, type (heirloom seed saves true) and viability.' }));
}

function animalsTab(root) {
  const st = RP.st; const a = st.calc.supply.animals; const t = st.today;
  root.append(h('div', { class: 'tiles' }, tile({ title: 'Feed on hand', big: a.days != null ? n1(a.days) : '-', unit: a.days != null ? 'days' : '', sub: n0(a.lbs) + ' lb in Pets & animals inventory' }),
    tile({ title: 'Animals', big: n0(st.livestock.reduce((x, l) => x + (+l.count || 0), 0)), sub: st.livestock.length + ' groups' })));
  root.append(listPanel({ coll: 'livestock', title: 'Livestock', wide: true,
    cols: [{ h: 'Group', f: (r) => r.name }, { h: 'Species', f: (r) => r.species || '', cls: 'dim' }, { h: 'Count', f: (r) => n0(r.count), cls: 'num' },
      { h: 'Feed/day', f: (r) => (r.feedLbPerDay ? n1(r.feedLbPerDay) + ' lb' : ''), cls: 'num' }, { h: 'Water/day', f: (r) => (r.waterGalPerDay ? n1(r.waterGalPerDay) + ' gal' : ''), cls: 'num' },
      { h: 'Next health', f: (r) => { if (!r.nextHealth) return ''; const d = daysFrom(t, r.nextHealth); return h('span', { class: d < 0 ? 'crit-t' : d < 14 ? 'warn-t' : '' }, fmtDate(r.nextHealth) + ' (' + relDays(d) + ')'); } }],
    empty: 'Add chickens, goats, bees or other animals to include their feed and water in your supply math.' }));
}

function harvestTab(root) {
  const st = RP.st;
  if (st.calc.harvest.length) root.append(panel(`Harvest totals ${st.calc.year}`, h('div', { class: 'panel-body chips' }, st.calc.harvest.map((x) => badge(`${x.what}: ${n1(x.qty)} ${x.unit || ''}`)))));
  root.append(listPanel({ coll: 'hlog', title: 'Harvest log', rows: st.hlog, wide: true,
    cols: [{ h: 'Date', f: (r) => fmtDate(r.date) }, { h: 'What', f: (r) => r.what }, { h: 'Qty', f: (r) => n1(r.qty) + ' ' + (r.unit || ''), cls: 'num' }, { h: 'Source', f: (r) => r.source, cls: 'dim' }],
    defaults: { date: st.today }, empty: 'Log what you harvest, hunt, catch or forage.' }));
  root.append(listPanel({ coll: 'canning', title: 'Preserving log', wide: true,
    cols: [{ h: 'Date', f: (r) => fmtDate(r.date) }, { h: 'Product', f: (r) => r.product }, { h: 'Method', f: (r) => r.method, cls: 'dim' }, { h: 'Qty', f: (r) => n0(r.qty), cls: 'num' },
      { h: 'Pantry', f: (r) => (r.addedToPantry ? badge('in inventory', 'good') : r.qty > 0 ? btn('Add to pantry', () => act(() => api('POST', `/api/canning/${r.id}/pantry`), { ok: 'Added to inventory' }), 'small') : '') }],
    defaults: { date: st.today }, empty: 'Log each canning or drying batch, then add it to the pantry in one click.' }));
}

export function render(root, sub) {
  const cur = sub || 'garden';
  root.append(viewHead('Homestead'));
  root.append(tabBar([['garden', 'Garden'], ['calendar', 'Calendar'], ['seeds', 'Seeds'], ['animals', 'Animals'], ['harvest', 'Harvest']], cur, (t) => go('homestead', t)));
  ({ calendar: calendarTab, seeds: seedsTab, animals: animalsTab, harvest: harvestTab }[cur] || gardenTab)(root);
}
