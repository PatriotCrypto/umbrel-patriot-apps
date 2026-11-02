// Upkeep: alerts, maintenance schedule, activity log.
import { h, btn, badge, fmtDate, fmtTime, relDays, promptBox, confirmBox } from './ui.js';
import { RP, api, act, go } from './core.js';
import { viewHead, tabBar, panel, alertList } from './parts.js';
import { editRecord, listPanel } from './form.js';

function maintTab(root) {
  const st = RP.st;
  root.append(listPanel({ coll: 'maint', title: 'Maintenance schedule', wide: true,
    sort: (a, b) => a.st.days - b.st.days,
    headExtra: [btn('Add suggested', () => act(() => api('POST', '/api/maint/suggested'), { ok: 'Suggested schedule added' }), 'small ghost')],
    cols: [{ h: 'What', f: (r) => r.name },
      { h: 'Every', f: (r) => r.everyDays + ' d', cls: 'dim' },
      { h: 'Last done', f: (r) => (r.lastDone ? fmtDate(r.lastDone) : 'never'), cls: 'dim' },
      { h: 'Next', f: (r) => h('span', { class: r.st.days < 0 ? 'crit-t' : r.st.days < 14 ? 'warn-t' : '' }, fmtDate(r.st.next) + ' (' + relDays(r.st.days) + ')') }],
    rowActions: (r) => btn('Done', async () => {
      const note = await promptBox('Note (optional)', { okText: 'Mark done' });
      if (note === null) return;
      act(() => api('POST', `/api/maint/${r.id}/done`, { note }), { ok: 'Logged' });
    }, 'small'),
    empty: 'Nothing scheduled. "Add suggested" loads a starter schedule: water rotation, battery checks, generator exercise, smoke detectors and more.' }));
}

function logTab(root) {
  const log = RP.st.log;
  root.append(panel('Recent activity', log.length ? h('ul', { class: 'plain log' }, log.map((l) => h('li', null, h('span', { class: 'dim' }, fmtTime(l.t) + '  '), l.text))) : h('div', { class: 'empty' }, 'Nothing yet.')));
}

export function render(root, sub) {
  const cur = sub || 'alerts';
  const al = RP.st.calc.alerts;
  root.append(viewHead('Upkeep'));
  root.append(tabBar([['alerts', `Alerts (${al.length})`], ['maint', 'Maintenance'], ['log', 'Activity']], cur, (t) => go('upkeep', t)));
  if (cur === 'maint') maintTab(root);
  else if (cur === 'log') logTab(root);
  else root.append(panel('Needs attention', alertList(al, 0, 'All clear.')));
}
