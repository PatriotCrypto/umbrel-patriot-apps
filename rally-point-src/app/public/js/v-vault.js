// Vault: encrypted firearms, medical and secure notes.
import { h, btn, badge, n0, fmtDate, relDays, daysFrom, modal, promptBox, confirmBox, toast, download } from './ui.js';
import { RP, api, act, go, refresh } from './core.js';
import { viewHead, tabBar, panel, memberName } from './parts.js';
import { editRecord, listPanel } from './form.js';

const pinField = (ph) => h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: ph || 'PIN', maxlength: 64 });

function showRecovery(code) {
  const m = modal({ title: 'Your recovery code', body: h('div', null,
    h('p', null, 'This code opens the vault if you forget the PIN. It is shown once. Write it on paper and keep it somewhere safe, away from this device.'),
    h('div', { class: 'recovery' }, code),
    h('p', { class: 'hint' }, 'Without the PIN or this code, vault data cannot be recovered. Nobody, including the developer, can reset it.')),
  buttons: [btn('I have saved it', () => m.close(), 'primary')] });
}

function setupView(root) {
  const a = pinField('Choose a PIN (6+ characters)'); const b = pinField('Repeat PIN');
  root.append(panel('Set up the vault', h('div', { class: 'panel-body' },
    h('p', null, 'The vault holds firearm records, medical details and secure notes. It is encrypted on disk with a key derived from your PIN (AES-256-GCM). It stays locked after a timeout, and stealth mode locks it at once.'),
    h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'PIN'), a), h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Repeat'), b),
    btn('Create vault', async () => {
      if (a.value !== b.value) return toast('PINs do not match', 'err');
      const r = await act(() => api('POST', '/api/vault/setup', { pin: a.value }), {});
      if (r && r.recovery) showRecovery(r.recovery);
    }, 'primary'))));
}

function lockedView(root, status) {
  const code = pinField('PIN or recovery code');
  const go1 = async () => {
    const r = await act(() => api('POST', '/api/vault/unlock', { code: code.value }), {});
    if (r && r.viaRecovery) toast('Unlocked with the recovery code. Set a new PIN under Security.');
  };
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go1(); });
  root.append(panel('Vault is locked', h('div', { class: 'panel-body' },
    status.lockedOutSeconds > 0 ? h('p', { class: 'crit-t' }, `Too many wrong attempts. Try again in ${status.lockedOutSeconds} seconds.`) : null,
    h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'PIN'), code), btn('Unlock', go1, 'primary'))));
}

function firearmsTab(root, v) {
  const t = RP.st.today;
  if (v.calibers.length) root.append(panel('Ammo by caliber', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
    h('thead', null, h('tr', null, ['Caliber', 'Guns', 'Rounds', 'Per gun'].map((x) => h('th', null, x)))),
    h('tbody', null, v.calibers.map((c) => h('tr', null, h('td', null, c.caliber), h('td', { class: 'num' }, c.guns), h('td', { class: 'num' }, n0(c.rounds)), h('td', { class: 'num' }, c.perGun == null ? '' : n0(c.perGun)))))))));
  root.append(listPanel({ coll: 'firearms', vault: true, rows: v.firearms, title: 'Firearms', wide: true,
    cols: [{ h: 'Name', f: (r) => r.name }, { h: 'Type', f: (r) => r.type, cls: 'dim' }, { h: 'Caliber', f: (r) => r.caliber || '' },
      { h: 'Assigned', f: (r) => memberName(r.assignedTo), cls: 'dim' },
      { h: 'Cleaning', f: (r) => (r.cleanEvery > 0 && r.roundsSinceClean >= r.cleanEvery ? badge('due', 'warn') : '') },
      { h: 'Stored', f: (r) => r.location || '', cls: 'dim' }], empty: 'No firearms recorded.' }));
}

function medicalTab(root, v) {
  const cards = v.medical.map((m) => h('div', { class: 'card click', onclick: () => editRecord({ coll: 'medical', vault: true, rec: m, wide: true }) },
    h('h4', null, memberName(m.member) || 'Unknown'),
    h('div', { class: 'chips' }, m.bloodType ? badge(m.bloodType) : null, m.allergies ? badge('allergies', 'warn') : null),
    m.allergies ? h('p', null, h('strong', null, 'Allergies: '), m.allergies) : null,
    m.conditions ? h('p', null, h('strong', null, 'Conditions: '), m.conditions) : null,
    (m.rx || []).map((r) => h('div', { class: 'hint' }, `${r.name} ${r.dose || ''}`, r.daysLeft != null ? h('span', { class: r.daysLeft < 14 ? 'crit-t' : r.daysLeft < 30 ? 'warn-t' : '' }, ` ${n0(r.daysLeft)} days left`) : null))));
  const missing = RP.st.members.filter((m) => m.ptype !== 'pet' && !v.medical.some((x) => x.member === m.id));
  root.append(panel(`Medical records (${v.medical.length})`, v.medical.length ? h('div', { class: 'cards' }, cards) : h('div', { class: 'empty' }, 'Record allergies, conditions, blood type and medications. Medication days-left feeds your alerts.'),
    btn('+ Add', () => editRecord({ coll: 'medical', vault: true, wide: true, defaults: { member: missing[0] && missing[0].id } }), 'small primary')));
}

function notesTab(root, v) {
  root.append(listPanel({ coll: 'vnotes', vault: true, rows: v.vnotes, title: 'Secure notes', wide: true,
    cols: [{ h: 'Title', f: (r) => r.title }, { h: 'Kind', f: (r) => badge(r.kind) }],
    empty: 'Cache locations, combinations, recovery details.' }));
}

function securityTab(root) {
  const st = RP.st;
  root.append(panel('Security', h('div', { class: 'panel-body' },
    h('p', null, `Auto-lock after ${st.settings.vaultAutoLockMin} minutes of inactivity (change in Settings).`),
    h('div', { class: 'chips' },
      btn('Change PIN', async () => {
        const cur = await promptBox('Current PIN or recovery code', { type: 'password' }); if (cur == null) return;
        const nxt = await promptBox('New PIN (6+ characters)', { type: 'password' }); if (nxt == null) return;
        await act(() => api('POST', '/api/vault/pin', { current: cur, next: nxt }), { ok: 'PIN changed' });
      }),
      btn('New recovery code', async () => {
        if (!(await confirmBox('Make a new recovery code? The old one stops working.', { okText: 'Make new code' }))) return;
        const r = await act(() => api('POST', '/api/vault/recovery'), {});
        if (r && r.recovery) showRecovery(r.recovery);
      }),
      btn('Erase vault', async () => {
        const code = await promptBox('PIN or recovery code', { type: 'password', title: 'Erase the vault' }); if (code == null) return;
        const c = await promptBox('Type ERASE to confirm', { title: 'This deletes all vault data' }); if (c == null) return;
        await act(() => api('DELETE', '/api/vault', { code, confirm: c }), { ok: 'Vault erased' });
      }, 'danger')))));
}

export async function render(root, sub) {
  root.append(viewHead('Vault', btn('Lock now', () => act(() => api('POST', '/api/vault/lock')), 'small')));
  const vs = RP.st.vault;
  if (vs.stealthBlocked) { root.append(h('div', { class: 'notice' }, 'Stealth mode is on. The vault is locked and hidden. Turn stealth off (shield icon) to use it.')); return; }
  if (!vs.exists) return setupView(root);
  if (!vs.unlocked) return lockedView(root, vs);
  let v;
  try { v = await api('GET', '/api/vault/data'); } catch (e) { if (e.status === 423) { await refresh(); return; } toast(e.message, 'err'); return; }
  RP.vdata = v;
  const cur = sub || 'medical';
  const tabs = tabBar([['medical', 'Medical'], ['firearms', 'Firearms'], ['notes', 'Secure notes'], ['security', 'Security']], cur, (t) => go('vault', t));
  const body = h('div');
  root.append(tabs, body);
  ({ firearms: firearmsTab, notes: notesTab, security: securityTab }[cur] || medicalTab)(body, v);
}
