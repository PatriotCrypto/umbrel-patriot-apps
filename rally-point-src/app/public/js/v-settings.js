// Settings: group, needs, location, comms plan, alerts, data.
import { h, btn, badge, toast, confirmBox, download, fmtDate } from './ui.js';
import { RP, api, act, saveSettings, go } from './core.js';
import { viewHead, tabBar, panel } from './parts.js';

const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function put(o, p, v) { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach((k) => { a = a[k] = a[k] || {}; }); a[ks[ks.length - 1]] = v; }

// Collect edits into a patch object; save with one button per section.
function section(title, build, saveMsg) {
  const patch = {};
  const fields = [];
  const field = (label, path, type, o) => {
    o = o || {};
    const cur = get(RP.st.settings, path);
    let el; let read;
    if (type === 'bool') { el = h('input', { type: 'checkbox', checked: !!cur }); read = () => el.checked; }
    else if (type === 'sel') { el = h('select', null, o.options.map(([v, l]) => h('option', { value: v }, l))); el.value = cur; read = () => el.value; }
    else if (type === 'num') { el = h('input', { type: 'number', step: 'any', value: cur == null ? '' : cur, min: o.min, max: o.max }); read = () => el.value; }
    else if (type === 'password') { el = h('input', { type: 'password', value: cur || '', autocomplete: 'off' }); read = () => el.value; }
    else if (type === 'long') { el = h('textarea', { rows: 3, value: cur || '' }); read = () => el.value; }
    else { el = h('input', { type: 'text', value: cur == null ? '' : cur }); read = () => el.value; }
    fields.push([path, read]);
    return type === 'bool'
      ? h('div', { class: 'field inline' }, h('label', { class: 'chk' }, el, h('span', null, label)), o.hint ? h('div', { class: 'hint' }, o.hint) : null)
      : h('div', { class: 'field' }, h('label', { class: 'lbl' }, label), el, o.hint ? h('div', { class: 'hint' }, o.hint) : null);
  };
  const extra = {};
  const body = build(field, extra);
  const save = btn('Save', () => {
    const p = {};
    fields.forEach(([path, read]) => put(p, path, read()));
    Object.keys(extra).forEach((k) => put(p, k, extra[k]()));
    saveSettings(p, saveMsg || 'Saved');
  }, 'primary');
  return panel(title, h('div', { class: 'panel-body' }, body), save);
}

const mults = ['adult', 'teen', 'child', 'infant', 'senior'];

function groupTab(root) {
  root.append(section('Group and targets', (f) => h('div', { class: 'form' },
    f('Group name', 'groupName', 'text'),
    f('Extra people not listed as members (guests)', 'guests', 'num', { min: 0 }),
    f('Target days of supply', 'targetDays', 'num', { min: 1, hint: 'Bars and the readiness score measure against this.' }),
    f('Count expired lots toward supply', 'countExpired', 'bool'),
    f('Expiring soon (days)', 'expiry.soonDays', 'num'), f('Warning window (days)', 'expiry.warnDays', 'num'))));

  root.append(section('Food needs', (f) => h('div', null,
    h('div', { class: 'form' }, f('Calories per adult per day', 'calories.perDay', 'num'), f('Pet food per pet per day (lb)', 'pet.foodLb', 'num')),
    h('p', { class: 'hint' }, 'Multipliers by age group, applied to calories:'),
    h('div', { class: 'form' }, mults.map((m) => f(m, 'calories.mult.' + m, 'num'))))));

  root.append(section('Water needs (gallons per person per day)', (f) => h('div', null,
    h('div', { class: 'form' }, f('Drinking', 'water.drink', 'num'), f('Cooking', 'water.cook', 'num'), f('Washing and hygiene', 'water.hygiene', 'num'), f('Per pet', 'water.petGal', 'num')),
    h('p', { class: 'hint' }, 'Drinking plus cooking is "survival water". Hygiene is extra and is counted separately. Multipliers:'),
    h('div', { class: 'form' }, mults.map((m) => f(m, 'water.mult.' + m, 'num'))))));

  root.append(section('Key roles', (f, ex) => {
    const ta = h('textarea', { rows: 4, value: RP.st.settings.keyRoles.join('\n') });
    ex.keyRoles = () => ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
    return h('div', null, h('p', { class: 'hint' }, 'One role per line. Coverage is checked against each member\'s position and skills.'), ta);
  }));
}

function placeTab(root) {
  root.append(section('Location and growing', (f) => h('div', null,
    h('div', { class: 'form' }, f('Home label', 'home.label', 'text'), f('Latitude', 'home.lat', 'num'), f('Longitude', 'home.lon', 'num'),
      f('Last spring frost (MM-DD)', 'frost.last', 'text'), f('First fall frost (MM-DD)', 'frost.first', 'text'), f('Annual rainfall (inches)', 'rainfallIn', 'num')),
    h('p', { class: 'hint' }, 'Coordinates stay on your server. They are used only for distances to your saved places.'),
    btn('Use my current location', () => {
      if (!navigator.geolocation) return toast('Location is not available here', 'err');
      navigator.geolocation.getCurrentPosition((p) => saveSettings({ home: { lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) } }, 'Location saved'), () => toast('Could not get location', 'err'));
    }, 'small'))));
}

function commsTab(root) {
  const pace = RP.st.settings.comms.pace;
  root.append(section('PACE communications plan', (f, ex) => {
    const rows = pace.map((p) => ({ p, method: h('input', { type: 'text', value: p.method }), details: h('input', { type: 'text', value: p.details }), schedule: h('input', { type: 'text', value: p.schedule }) }));
    ex['comms.pace'] = () => rows.map((r) => ({ level: r.p.level, method: r.method.value, details: r.details.value, schedule: r.schedule.value }));
    return h('div', null, h('p', { class: 'hint' }, 'Primary, Alternate, Contingency, Emergency: four ways to reach each other, in order. Example: phone call, text, GMRS channel 3, meet at the rally point.'),
      rows.map((r) => h('div', { class: 'form', style: { marginBottom: '.6rem' } }, h('div', { class: 'field' }, h('label', { class: 'lbl' }, r.p.level), r.method), h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Details'), r.details), h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'When'), r.schedule))));
  }));
}

function alertsTab(root) {
  const s = RP.st.settings;
  root.append(section('Vault', (f) => h('div', { class: 'form' }, f('Auto-lock after (minutes)', 'vaultAutoLockMin', 'num', { min: 1, max: 240 }))));
  const digest = section('Daily digest (ntfy)', (f) => h('div', null,
    h('p', { class: 'hint' }, 'Sends one daily push notification with expiring items, low stock and overdue tasks. It never includes vault data. Use your own ntfy server, or ntfy.sh with a hard-to-guess topic name.'),
    h('div', { class: 'form' }, f('Enable digest', 'ntfy.enabled', 'bool'), f('Server', 'ntfy.url', 'text'), f('Topic', 'ntfy.topic', 'text'),
      f('Access token (optional)', 'ntfy.token', 'password', { hint: s.ntfy.tokenSet ? 'A token is saved. Leave as is to keep it.' : '' }),
      f('Send at hour (0 to 23)', 'ntfy.hour', 'num', { min: 0, max: 23 }), f('Time zone (e.g. America/Chicago)', 'ntfy.tz', 'text'))));
  digest.querySelector('.panel-head').insertBefore(btn('Send test', () => act(() => api('POST', '/api/ntfy/test'), { ok: 'Test sent' }), 'small ghost'), digest.querySelector('.panel-head .spacer').nextSibling);
  root.append(digest);
  root.append(section('Privacy', (f) => h('div', null,
    f('Look up unknown barcodes online (Open Food Facts)', 'lookupOnline', 'bool', { hint: 'Off by default. When on, scanning an unknown code sends only that number to openfoodfacts.org.' }))));
}

function dataTab(root) {
  const st = RP.st;
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!(await confirmBox('Restoring replaces ALL current data with the backup. Continue?', { okText: 'Restore', danger: true }))) return;
    try { const j = JSON.parse(await f.text()); await act(() => api('POST', '/api/restore', j), { ok: 'Restored' }); } catch (err) { toast(err.message, 'err'); }
  } });
  const hasSample = st.items.some((i) => i.sample) || st.members.some((m) => m.sample);
  root.append(panel('Backup and restore', h('div', { class: 'panel-body' },
    h('p', null, 'Data is stored in your Umbrel app data folder, with a rolling 7-day automatic backup. A manual backup downloads everything; vault contents stay encrypted inside it and still need your PIN or recovery code.'),
    h('div', { class: 'chips' },
      btn('Download backup', async () => { const r = await fetch('/api/backup?photos=1', { headers: { 'x-rp': '1' } }); download('rally-point-backup-' + st.today + '.json', await r.text(), 'application/json'); }),
      btn('Restore from file', () => file.click()), file,
      btn('Inventory CSV', () => { location.href = '/api/export/items.csv'; }, 'ghost'),
      btn('Shopping CSV', () => { location.href = '/api/export/shopping.csv'; }, 'ghost')))));
  root.append(panel('Sample data', h('div', { class: 'panel-body' },
    h('p', null, 'A fictional family and stock so you can see how everything fits together. It is marked and can be removed in one click without touching your own entries.'),
    hasSample ? btn('Remove sample data', () => act(() => api('DELETE', '/api/sample'), { ok: 'Sample data removed' }), 'danger') : btn('Load sample data', () => act(() => api('POST', '/api/sample/load'), { ok: 'Loaded' })))));
  root.append(panel('About', h('div', { class: 'panel-body' },
    h('p', null, `Rally Point ${st.version}. Independent community app, not affiliated with Umbrel. ${st.photoCount} photos stored.`),
    h('p', { class: 'hint' }, 'Tip: type /prep in the search box for a message.'))));
}

export function render(root, sub) {
  const cur = sub || 'group';
  root.append(viewHead('Settings'));
  root.append(tabBar([['group', 'Group'], ['place', 'Place'], ['comms', 'Comms plan'], ['alerts', 'Alerts and privacy'], ['data', 'Data']], cur, (t) => go('settings', t)));
  ({ place: placeTab, comms: commsTab, alerts: alertsTab, data: dataTab }[cur] || groupTab)(root);
}
