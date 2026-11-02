// App shell: routing, navigation, header controls, command box, easter eggs.
import { h, $, clear, toast, closeTopModal, anyModal, promptBox, confirmBox, badge } from './ui.js';
import { RP, api, loadState, refresh, act } from './core.js';
import * as console_ from './v-console.js';
import * as inventory from './v-inventory.js';
import * as planner from './v-planner.js';
import * as water from './v-water.js';
import * as group from './v-group.js';
import * as plans from './v-plans.js';
import * as homestead from './v-homestead.js';
import * as library from './v-library.js';
import * as vault from './v-vault.js';
import * as upkeep from './v-upkeep.js';
import * as settings from './v-settings.js';

const VIEWS = [
  ['console', 'Console', console_], ['inventory', 'Inventory', inventory], ['planner', 'Planner', planner], ['water', 'Water & Power', water],
  ['group', 'Group', group], ['plans', 'Plans', plans], ['homestead', 'Homestead', homestead], ['library', 'Library', library],
  ['vault', 'Vault', vault], ['upkeep', 'Upkeep', upkeep], ['settings', 'Settings', settings],
];
const SKINS = ['bunker', 'nightred', 'homestead', 'blueprint'];

let cur = { view: 'console', sub: '' };
let renderToken = 0;

function parseHash() {
  const m = location.hash.replace(/^#\/?/, '').split('/');
  const view = VIEWS.find((v) => v[0] === m[0]) ? m[0] : 'console';
  return { view, sub: m[1] || '' };
}

function go(view, sub) {
  const next = '#/' + view + (sub ? '/' + sub : '');
  if (location.hash === next) { render(); return; }
  location.hash = next;
}

function drawNav() {
  const nav = $('#side'); clear(nav);
  const st = RP.st;
  const counts = { upkeep: st.calc.alerts.filter((a) => a.sev === 'crit').length };
  VIEWS.forEach(([id, label], i) => {
    if (id === 'vault' || id === 'settings') { if (id === 'vault') nav.append(h('div', { class: 'sep' })); }
    if (id === 'vault' && st.stealth) return;
    nav.append(h('a', { href: '#/' + id, class: id === cur.view ? 'on' : '', onclick: () => document.body.classList.remove('nav-open') }, label, counts[id] ? h('span', { class: 'n' }, String(counts[id])) : null));
  });
  nav.append(h('div', { class: 'foot' }, 'Rally Point ' + st.version));
}

function drawHeader() {
  const st = RP.st; const r = st.calc.ready;
  const chip = $('#ready-chip');
  chip.textContent = 'READY ' + r.score;
  chip.className = 'chip ' + (r.score >= 75 ? 'good' : r.score >= 50 ? 'warn' : 'crit');
  const sb = $('#stealth-btn');
  sb.textContent = st.stealth ? '\u{1F6E1}\u{FE0F}✓' : '\u{1F6E1}\u{FE0F}';
  sb.classList.toggle('on', st.stealth);
  const lb = $('#lock-btn');
  lb.hidden = st.stealth || !st.vault.exists;
  lb.textContent = st.vault.unlocked ? '\u{1F513}' : '\u{1F512}';
  lb.title = st.vault.unlocked ? 'Lock the vault' : 'Open the vault';
  $('#brand-name').textContent = (st.settings.groupName || 'Rally Point').toUpperCase().slice(0, 28);
}

async function render() {
  if (!RP.st) return;
  const token = ++renderToken;
  cur = parseHash();
  const entry = VIEWS.find((v) => v[0] === cur.view);
  const root = $('#view');
  const y = window.scrollY;
  const tmp = h('div');
  drawHeader(); drawNav();
  try {
    await entry[2].render(tmp, cur.sub);
  } catch (e) {
    console.error(e);
    tmp.append(h('div', { class: 'notice' }, 'This screen hit an error: ' + e.message));
  }
  if (token !== renderToken) return;
  root.replaceChildren(...tmp.childNodes);
  document.title = entry[1] + ' | Rally Point';
  window.scrollTo(0, y);
}

RP.render = render; RP.go = go;

// ---------------------------------------------------------------- header controls
function cycleSkin() {
  const now = document.documentElement.getAttribute('data-skin') || 'bunker';
  const next = SKINS[(SKINS.indexOf(now) + 1) % SKINS.length];
  document.documentElement.setAttribute('data-skin', next);
  try { localStorage.setItem('rp.skin', next); } catch (e) { /* ignore */ }
  toast('Look: ' + next);
}

async function toggleStealth() {
  if (!RP.st.stealth) {
    if (!(await confirmBox('Turn on stealth mode? Ammo is hidden everywhere and the vault locks and disappears. Turning it off needs your vault PIN.', { okText: 'Stealth on' }))) return;
    await act(() => api('POST', '/api/stealth', { on: true }), { ok: 'Stealth mode on' });
    if (cur.view === 'vault') go('console');
  } else {
    let code = '';
    if (RP.st.vault.exists) { code = await promptBox('PIN or recovery code', { type: 'password', title: 'Turn off stealth mode' }); if (code == null) return; }
    await act(() => api('POST', '/api/stealth', { on: false, code }), { ok: 'Stealth mode off' });
  }
}

async function lockBtn() {
  if (RP.st.vault.unlocked) await act(() => api('POST', '/api/vault/lock'), { ok: 'Vault locked' });
  else go('vault');
}

// ---------------------------------------------------------------- easter eggs
function egg(lines, morse) {
  const pre = h('pre');
  const box = h('div', { class: 'egg', onclick: () => box.remove() }, pre);
  document.body.append(box);
  let i = 0;
  const type = () => {
    if (!box.isConnected) return;
    pre.textContent = lines.slice(0, ++i).join('\n');
    if (i < lines.length) setTimeout(type, 450);
    else if (morse) playMorse(box);
  };
  type();
}

function playMorse(box) {
  const code = { B: '-...', E: '.', P: '.--.', R: '.-.', A: '.-', D: '-..' };
  const strip = h('div', { class: 'morse' });
  box.append(strip);
  for (const ch of 'BE PREPARED') {
    if (ch === ' ') { strip.append(h('span', { style: { width: '1.5rem' } })); continue; }
    for (const s of code[ch]) strip.append(h('i', { style: { width: s === '.' ? '12px' : '36px' } }));
    strip.append(h('span', { style: { width: '.8rem' } }));
  }
}

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let kpos = 0;
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
  kpos = e.key === KONAMI[kpos] ? kpos + 1 : (e.key === KONAMI[0] ? 1 : 0);
  if (kpos === KONAMI.length) { kpos = 0; egg(['> SIGNAL LOCKED', '> ALL STATIONS: RALLY POINT IS UP', '> WATER: STORED   FOOD: STORED   MORALE: HIGH', '> STAND BY.']); }
});

// ---------------------------------------------------------------- command box
async function command(text) {
  const q = text.trim();
  if (!q) return;
  if (q === '/prep' || q === '/cw') return egg(['> HAM BONE CALLING ALL STATIONS', '> MESSAGE FOLLOWS:'], true);
  if (q[0] === '/') {
    const name = q.slice(1).toLowerCase();
    const v = VIEWS.find((x) => x[0] === name || x[1].toLowerCase() === name);
    if (v && !(v[0] === 'vault' && RP.st.stealth)) return go(v[0]);
    if (name === 'skin') return cycleSkin();
    if (name === 'stealth') return toggleStealth();
    return toast('Commands: /console /inventory /planner /water /group /plans /homestead /library /upkeep /settings /skin /stealth', 'err');
  }
  if (/^\d{6,14}$/.test(q)) { go('inventory'); return inventory.scan(q); }
  inventory.setSearch(q);
  go('inventory');
}

// ---------------------------------------------------------------- boot
async function boot() {
  $('#menu').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#skin-btn').addEventListener('click', cycleSkin);
  $('#stealth-btn').addEventListener('click', toggleStealth);
  $('#lock-btn').addEventListener('click', lockBtn);
  $('#brand').addEventListener('click', () => go('console'));
  $('#ready-chip').addEventListener('click', () => go('console'));
  $('#cmd-form').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#cmd'); const v = i.value; i.value = ''; i.blur(); command(v); });
  window.addEventListener('hashchange', () => { document.body.classList.remove('nav-open'); render(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && anyModal()) { closeTopModal(); return; }
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '') && !anyModal()) { e.preventDefault(); $('#cmd').focus(); }
  });
  try {
    await loadState();
  } catch (e) {
    $('#view').append(h('div', { class: 'notice' }, 'Could not load data: ' + e.message));
    return;
  }
  await render();
  // the server auto-locks the vault; keep the screen honest
  setInterval(async () => {
    if (document.hidden || anyModal()) return;
    try {
      const was = RP.st.vault.unlocked;
      const s = await api('GET', '/api/vault/status');
      if (was && !s.unlocked) await refresh();
    } catch (e) { /* offline */ }
  }, 30000);
  if (RP.st.fresh && !RP.st.settings.setupDone && !RP.st.items.length) {
    toast('Welcome to Rally Point. Add members and items, or load sample data to look around.');
  }
}

boot();
