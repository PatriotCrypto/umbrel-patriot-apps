// Console: the at-a-glance dashboard.
import { h, badge, bar, n0, n1, fmtDate, daysFrom, relDays, btn } from './ui.js';
import { RP, go } from './core.js';
import { viewHead, tile, panel, gauge, alertList, memberName } from './parts.js';
import { inv } from './v-inventory.js';

function kindFor(days, target, sustainable) {
  if (sustainable) return 'good';
  if (days == null) return 'crit';
  return days < target / 3 ? 'crit' : days < target ? 'warn' : 'good';
}

export function render(root) {
  const st = RP.st; const c = st.calc; const sup = c.supply; const T = st.settings.targetDays;
  const n = sup.needs;

  root.append(viewHead(st.settings.groupName,
    badge(`${n.people} ${n.people === 1 ? 'person' : 'people'}${n.pets ? ' + ' + n.pets + ' pet' + (n.pets > 1 ? 's' : '') : ''}`),
    badge(`target ${T} days`)));

  if (!st.items.length) {
    root.append(h('div', { class: 'notice' },
      h('strong', null, 'Welcome. '), 'Start by adding what you have: ',
      btn('Open Inventory', () => go('inventory'), 'small'), ' or ',
      btn('Load sample data to look around', async () => {
        const { api, act } = await import('./core.js');
        await act(() => api('POST', '/api/sample/load'), { ok: 'Sample data loaded. Remove it any time in Settings.' });
      }, 'small')));
  }

  // readiness + alerts
  const rd = c.ready;
  const gaugeBox = h('div', { class: 'gauge' }, gauge(rd.score, rd.grade),
    h('div', { class: 'parts' }, rd.parts.length ? rd.parts.map((p) => h('div', { class: 'part' },
      h('span', null, p.label),
      bar(p.value, p.value >= 0.75 ? 'good' : p.value >= 0.4 ? 'warn' : 'crit'),
      h('span', null, p.detail))) : h('div', { class: 'dim' }, 'Add inventory and group members to see your score.')));
  root.append(h('div', { class: 'grid g2' },
    panel('Readiness', gaugeBox),
    panel(`Needs attention (${c.alerts.length})`, alertList(c.alerts, 8, 'All clear.'),
      c.alerts.length > 8 ? btn('All alerts', () => go('upkeep', 'alerts'), 'small ghost') : null)));

  // tiles
  const tiles = h('div', { class: 'tiles' });
  tiles.append(tile({
    title: 'Food', big: n.kcal > 0 ? n1(sup.food.days || 0) : '-', unit: 'days',
    sub: `${n0(sup.food.kcal)} kcal stored, ${n0(n.kcal)} needed per day`,
    kind: n.kcal > 0 ? kindFor(sup.food.days || 0, T) : '', onclick: () => go('planner'),
  }));
  tiles.append(tile({
    title: 'Water', big: n.water.survival > 0 ? (sup.water.survivalSustainable ? 'OK' : n1(sup.water.survivalDays || 0)) : '-',
    unit: sup.water.survivalSustainable ? '' : 'days',
    sub: `${n0(sup.water.potable)} gal stored, ${n1(n.water.survival)} gal/day to drink and cook`,
    kind: n.water.survival > 0 ? kindFor(sup.water.survivalDays || 0, T, sup.water.survivalSustainable) : '', onclick: () => go('water'),
  }));
  const gen = sup.fuel.find((f) => f.hasGen && f.days != null);
  tiles.append(tile({
    title: 'Generator fuel', big: gen ? n1(gen.days) : '-', unit: gen ? 'days' : '',
    sub: gen ? `${n1(gen.gallons)} gal ${gen.type}, ${n1(gen.burnPerDay)} gal/day` : 'Add a generator under Water & Power',
    kind: gen ? kindFor(gen.days, T) : '', onclick: () => go('water', 'fuel'),
  }));
  const pw = c.power;
  if (pw.dailyWh > 0) {
    tiles.append(tile({
      title: 'Power', big: pw.all.sustainable ? 'OK' : n1(pw.all.days), unit: pw.all.sustainable ? '' : 'days',
      sub: `${n0(pw.dailyWh)} Wh/day used, ${n0(pw.solarWh + pw.genWh)} Wh/day made`,
      kind: pw.all.sustainable ? 'good' : kindFor(pw.all.days, Math.min(T, 7)), onclick: () => go('water', 'power'),
    }));
  }
  if (sup.animals.days != null) {
    tiles.append(tile({ title: 'Animal feed', big: n1(sup.animals.days), unit: 'days', sub: `${n0(sup.animals.lbs)} lb on hand`, kind: kindFor(sup.animals.days, T), onclick: () => go('homestead', 'animals') }));
  }
  const expiring = c.alerts.filter((a) => a.kind === 'expiring' || a.kind === 'expired');
  const expired = c.alerts.filter((a) => a.kind === 'expired').length;
  tiles.append(tile({
    title: 'Expiring soon', big: String(expiring.length), unit: 'items',
    sub: expired ? `${expired} already expired` : 'nothing expired',
    kind: expired ? 'crit' : expiring.length ? 'warn' : 'good',
    onclick: () => { inv.flag = 'expiring'; inv.cat = 'all'; go('inventory'); },
  }));
  const low = c.alerts.filter((a) => a.kind === 'low').length;
  tiles.append(tile({
    title: 'Low stock', big: String(low), unit: 'items', sub: low ? 'below your alert levels' : 'all above alert levels',
    kind: low ? 'warn' : 'good', onclick: () => { inv.flag = 'low'; inv.cat = 'all'; go('inventory'); },
  }));

  // next due
  const due = [];
  for (const t of st.tasks) if (!t.done && t.due) due.push({ what: t.title, d: daysFrom(st.today, t.due), who: memberName(t.assignee), view: 'group' });
  for (const m of st.maint) due.push({ what: m.name, d: m.st.days, view: 'upkeep' });
  due.sort((a, b) => a.d - b.d);
  const nd = due[0];
  tiles.append(tile({
    title: 'Next due', big: nd ? relDays(nd.d) : '-', sub: nd ? nd.what : 'no tasks scheduled',
    kind: nd && nd.d < 0 ? 'crit' : '', onclick: () => go(nd ? nd.view : 'group'),
  }));

  const rolesHave = c.roles.filter((r) => r.members.length).length;
  tiles.append(tile({
    title: 'Group', big: String(n.people), unit: n.people === 1 ? 'person' : 'people',
    sub: c.roles.length ? `${rolesHave} of ${c.roles.length} key roles covered` : '', onclick: () => go('group'),
  }));

  if (!st.stealth) {
    const total = sup.ammo.reduce((t, a) => t + a.rounds, 0);
    if (total > 0) tiles.append(tile({ title: 'Ammo', big: n0(total), unit: 'rounds', sub: sup.ammo.slice(0, 3).map((a) => `${a.caliber}: ${n0(a.rounds)}`).join(', '), onclick: () => { inv.cat = 'ammo'; inv.flag = ''; go('inventory'); } }));
  }
  if (c.garden.lb > 0 || c.garden.plannedKcal > 0) {
    tiles.append(tile({ title: `Garden ${c.year}`, big: n0(c.garden.lb), unit: 'lb', sub: `${n0(c.garden.kcal)} kcal harvested`, onclick: () => go('homestead') }));
  }
  if (c.value.total > 0) tiles.append(tile({ title: 'Inventory value', big: '$' + n0(c.value.total), sub: 'from lot costs', onclick: () => go('inventory') }));
  root.append(tiles);

  // weakest links + expiry timeline
  const links = sup.links.slice(0, 7);
  const weak = links.length ? h('div', { class: 'panel-body' }, links.map((l) => h('div', { class: 'part', style: { marginBottom: '.4rem' } },
    h('span', null, l.name), bar((l.days || 0) / Math.max(1, T), l.days < T / 3 ? 'crit' : l.days < T ? 'warn' : 'good'),
    h('span', null, `${n1(l.days)} days`))))
    : h('div', { class: 'empty' }, 'Give inventory items a daily use (like toilet paper or batteries) and the weakest ones show up here.');

  const maxN = Math.max(1, ...c.timeline.map((t) => t.n));
  const chart = h('div', { class: 'panel-body' }, h('div', { style: { display: 'flex', gap: '4px', alignItems: 'flex-end', height: '110px' } },
    c.timeline.map((t, i) => h('div', { style: { flex: 1, textAlign: 'center', fontSize: '.65rem', color: 'var(--dim)' }, title: `${t.n} lot${t.n === 1 ? '' : 's'}` },
      h('div', { style: { height: Math.max(2, (t.n / maxN) * 86) + 'px', background: i === 0 ? 'var(--crit)' : 'var(--accent)', opacity: t.n ? 1 : .25, borderRadius: '2px 2px 0 0' } }),
      i === 0 ? 'old' : t.label.slice(5)))),
    h('p', { class: 'hint' }, 'Lots expiring each month for the next year. Red is already expired.'));

  root.append(h('div', { class: 'grid g2' },
    panel('Weakest links', weak, btn('Planner', () => go('planner'), 'small ghost')),
    panel('Expiry timeline', chart)));

  if (c.roles.length && st.members.some((m) => m.ptype !== 'pet')) {
    root.append(panel('Key roles', h('div', { class: 'panel-body chips' }, c.roles.map((r) =>
      h('span', { class: 'badge ' + (r.members.length ? 'good' : 'crit') }, r.role + ': ' + (r.members.length ? r.members.join(', ') : 'nobody yet')))),
    btn('Group', () => go('group'), 'small ghost')));
  }
}
