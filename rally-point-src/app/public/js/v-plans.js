// Plans: checklists, contacts, places, documents, comms plan.
import { h, btn, badge, bar, fmtDate, daysFrom, relDays, printNode, confirmBox, n1 } from './ui.js';
import { RP, api, act, go } from './core.js';
import { viewHead, tabBar, panel, memberName } from './parts.js';
import { editRecord, listPanel } from './form.js';

function checklistCard(c) {
  const items = c.items || [];
  const done = items.filter((i) => i.done).length;
  const list = h('ul', { class: 'checks' }, items.map((i) => h('li', null,
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!i.done, onchange: (e) => act(() => api('POST', `/api/checklists/${c.id}/toggle`, { itemId: i.id, done: e.target.checked })) }),
      h('span', { class: i.done ? 'struck' : '' }, i.text)))));
  return panel(c.title, h('div', null,
    h('div', { class: 'panel-body' }, h('div', { class: 'chips' }, badge(c.kind || 'general'), badge(`${done}/${items.length}`)), bar(items.length ? done / items.length : 0, done === items.length && items.length ? 'good' : 'warn'),
      c.notes ? h('p', { class: 'hint' }, c.notes) : null),
    items.length ? list : h('div', { class: 'empty' }, 'No steps yet. Use Edit.')),
  btn('Reset', () => act(() => api('POST', `/api/checklists/${c.id}/reset`)), 'small ghost'),
  btn('Print', () => printNode(c.title, h('div', null, c.notes ? h('p', null, c.notes) : null, h('table', null, h('tbody', null, items.map((i) => h('tr', null, h('td', null, h('span', { class: 'box' })), h('td', null, i.text))))))), 'small ghost'),
  btn('Edit', () => editRecord({ coll: 'checklists', rec: c, wide: true }), 'small'));
}

function checklistsTab(root) {
  const cl = RP.st.checklists;
  root.append(h('div', { class: 'toolbar' },
    btn('+ New checklist', () => editRecord({ coll: 'checklists', wide: true }), 'primary'),
    btn('Add standard checklists', () => act(() => api('POST', '/api/checklists/defaults'), { ok: 'Standard checklists added' }), 'ghost')));
  if (!cl.length) root.append(h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No checklists. Add the standard set: power outage, evacuation, house fire, storms and more.')));
  root.append(h('div', { class: 'grid g2' }, cl.map(checklistCard)));
}

function contactsTab(root) {
  root.append(listPanel({ coll: 'contacts', title: 'Contacts', cols: [
    { h: 'Name', f: (r) => r.name }, { h: 'Role', f: (r) => badge(r.relation || '') },
    { h: 'Phone', f: (r) => (r.phone ? h('a', { href: 'tel:' + r.phone.replace(/[^\d+]/g, '') }, r.phone) : '') },
    { h: 'Email', f: (r) => r.email || '', cls: 'dim' }],
  sort: (a, b) => (a.relation || '').localeCompare(b.relation || '') || a.name.localeCompare(b.name),
  headExtra: [btn('Print', () => printNode('Emergency contacts', h('table', null, h('thead', null, h('tr', null, ['Name', 'Role', 'Phone', 'Alt', 'Address'].map((x) => h('th', null, x)))),
    h('tbody', null, RP.st.contacts.map((c) => h('tr', null, [c.name, c.relation, c.phone, c.altPhone, c.address].map((x) => h('td', null, x || ''))))))), 'small ghost')],
  empty: 'Add family, an out-of-area contact, doctors, the vet, utilities and local emergency management.' }));
}

function placesTab(root) {
  const home = RP.st.settings.home;
  root.append(listPanel({ coll: 'places', title: 'Places and routes', wide: true,
    note: home && home.lat != null ? 'Distances are straight-line from your home coordinates in Settings.' : 'Set home coordinates in Settings to see distances.',
    cols: [{ h: 'Name', f: (r) => r.name }, { h: 'Kind', f: (r) => badge(r.kind || '') }, { h: 'Where', f: (r) => r.address || '', cls: 'dim' },
      { h: 'Distance', f: (r) => (r.distMi != null ? n1(r.distMi) + ' mi' : ''), cls: 'num' }],
    empty: 'Record a primary and alternate rally point, a bug-out destination, and where to get water or fuel.' }));
}

function docsTab(root) {
  const t = RP.st.today;
  root.append(listPanel({ coll: 'docs', title: 'Important documents', wide: true,
    note: 'Track where copies are kept and when they expire. Do not store ID numbers here; use the Vault for sensitive notes.',
    cols: [{ h: 'Document', f: (r) => r.name }, { h: 'Kind', f: (r) => r.kind || '', cls: 'dim' }, { h: 'Whose', f: (r) => memberName(r.owner), cls: 'dim' },
      { h: 'Expires', f: (r) => { if (!r.expires) return ''; const d = daysFrom(t, r.expires); return h('span', { class: d < 0 ? 'crit-t' : d < 90 ? 'warn-t' : '' }, fmtDate(r.expires) + ' (' + relDays(d) + ')'); } },
      { h: 'Copy', f: (r) => (r.hasCopy ? badge('paper copy', 'good') : badge('none', 'warn')) }, { h: 'Kept at', f: (r) => r.where || '', cls: 'dim' }],
    sort: (a, b) => (a.expires || '9').localeCompare(b.expires || '9') }));
}

function commsTab(root) {
  const radio = RP.meta.radio || [];
  root.append(panel('Radio reference', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
    h('thead', null, h('tr', null, ['Service', 'Frequencies', 'License', 'Note'].map((x) => h('th', null, x)))),
    h('tbody', null, radio.map((r) => h('tr', null, h('td', null, h('strong', null, r.service)), h('td', null, r.where), h('td', { class: 'dim' }, r.license), h('td', { class: 'dim' }, r.note))))))));
  const radios = RP.st.items.filter((i) => i.cat === 'comms');
  root.append(panel(`Your comms gear (${radios.length})`, radios.length ? h('ul', { class: 'plain' }, radios.map((i) => h('li', null, `${i.name}: ${i.qty} ${i.unit || ''}`))) : h('div', { class: 'empty' }, 'Add radios in Inventory under Comms.'),
    btn('Inventory', () => go('inventory'), 'small ghost')));
  root.append(panel('Family comms plan', h('div', { class: 'panel-body' },
    h('p', null, 'Agree on these ahead of time and print the card.'),
    h('ul', null, ['Out-of-area contact everyone calls or texts first (texts often get through when calls fail)', 'Primary and alternate meeting places (see Places)', 'Radio channel and a backup channel; check-in times (for example the top of each hour)', 'A code word that means "come home now"']
      .map((x) => h('li', null, x)))),
  btn('Print card', () => {
    const c = RP.st.contacts.slice(0, 8); const p = RP.st.places.slice(0, 4);
    printNode('Family comms card: ' + RP.st.settings.groupName, h('div', null, h('h2', null, 'Contacts'),
      h('table', null, h('tbody', null, c.map((x) => h('tr', null, h('td', null, x.name), h('td', null, x.phone || ''))))), h('h2', null, 'Meeting places'),
      h('table', null, h('tbody', null, p.map((x) => h('tr', null, h('td', null, x.name), h('td', null, x.address || ''))))),
      h('h2', null, 'Radio'), h('p', null, 'Channel: ________   Backup: ________   Check-in: ________   Code word: ________')));
  }, 'small')));
}

export function render(root, sub) {
  const cur = sub || 'checklists';
  root.append(viewHead('Plans'));
  root.append(tabBar([['checklists', 'Checklists'], ['contacts', 'Contacts'], ['places', 'Places'], ['docs', 'Documents'], ['comms', 'Comms']], cur, (t) => go('plans', t)));
  ({ contacts: contactsTab, places: placesTab, docs: docsTab, comms: commsTab }[cur] || checklistsTab)(root);
}
