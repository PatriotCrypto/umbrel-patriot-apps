// Reusable view pieces.
import { h, svg, badge, bar, n0, n1 } from './ui.js';
import { RP, go } from './core.js';

export function viewHead(title, ...right) {
  return h('div', { class: 'view-head' }, h('h2', null, title), h('div', { class: 'spacer' }), ...right);
}

export function tabBar(tabs, cur, pick) {
  return h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) =>
    h('button', { class: id === cur ? 'on' : '', role: 'tab', onclick: () => pick(id) }, label)));
}

export function tile(o) {
  const el = h(o.onclick ? 'button' : 'div', { class: 'tile ' + (o.kind || '') + (o.onclick ? '' : ' static'), onclick: o.onclick, type: o.onclick ? 'button' : null },
    h('div', { class: 't-title' }, o.title),
    h('div', { class: 't-big' }, o.big, o.unit ? h('small', null, o.unit) : null),
    o.sub ? h('div', { class: 't-sub' }, o.sub) : null);
  return el;
}

export function panel(title, body, ...headExtra) {
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h3', null, title), h('div', { class: 'spacer' }), ...headExtra),
    body);
}

export function kv(pairs) {
  const dl = h('dl', { class: 'kv' });
  for (const [k, v] of pairs) dl.append(h('dt', null, k), h('dd', null, v));
  return dl;
}

export function gauge(score, grade) {
  const r = 62; const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / 100));
  const col = score >= 75 ? 'var(--good)' : score >= 50 ? 'var(--warn)' : 'var(--crit)';
  return svg('svg', { viewBox: '0 0 150 150', role: 'img', 'aria-label': `Readiness ${score} of 100, ${grade}` },
    svg('circle', { cx: 75, cy: 75, r, fill: 'none', stroke: 'var(--line2)', 'stroke-width': 10 }),
    svg('circle', { cx: 75, cy: 75, r, fill: 'none', stroke: col, 'stroke-width': 10, 'stroke-linecap': 'round',
      'stroke-dasharray': `${(c * frac).toFixed(1)} ${c.toFixed(1)}`, transform: 'rotate(-90 75 75)' }),
    svg('text', { x: 75, y: 82, 'text-anchor': 'middle', class: 'g-num' }, String(score)),
    svg('text', { x: 75, y: 104, 'text-anchor': 'middle', class: 'g-lbl' }, grade));
}

export function alertList(list, limit, empty) {
  const ul = h('ul', { class: 'alerts' });
  const shown = limit ? list.slice(0, limit) : list;
  if (!shown.length) return h('div', { class: 'empty' }, empty || 'Nothing needs attention.');
  for (const a of shown) {
    ul.append(h('li', { class: a.sev, onclick: () => go(a.view || 'console') },
      h('span', { class: 'dot' }), h('span', null, a.title), a.detail ? h('span', { class: 'det' }, a.detail) : null));
  }
  return ul;
}

// "12.4 days" with the right unit text; null means sustainable/unknown
export function daysText(d, sustainable) {
  if (sustainable) return 'sustainable';
  if (d == null) return '0';
  return n1(d);
}

export function supplyRow(label, days, target, sustainable, extra) {
  const kind = sustainable ? 'good' : (days == null ? 'crit' : days < target / 3 ? 'crit' : days < target ? 'warn' : 'good');
  const frac = sustainable ? 1 : (days || 0) / Math.max(1, target);
  return h('tr', null,
    h('td', null, label),
    h('td', { class: 'num' }, sustainable ? 'OK' : n1(days || 0)),
    h('td', { style: { minWidth: '120px' } }, bar(frac, kind)),
    h('td', { class: 'dim' }, extra || ''));
}

export function memberName(id) {
  const m = RP.st.members.find((x) => x.id === id);
  return m ? m.name : '';
}

export function ptypeBadge(t) { return badge(t, t === 'pet' ? 'info' : ''); }

export { n0, n1 };
