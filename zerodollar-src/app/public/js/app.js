import { h, icon, clear, monthLabel, shiftMonth, monthNow, modal, guard, toast } from './ui.js';
import { S, loadMeta, setMonth, setTheme, currentTheme, THEMES } from './state.js';
import { openTxEditor } from './txeditor.js';

const ROUTES = {
  budget: { title: 'Budget', icon: 'budget', month: true, load: () => import('./views/budget.js') },
  transactions: { title: 'Transactions', icon: 'list', month: true, load: () => import('./views/transactions.js') },
  reconcile: { title: 'Reconcile', icon: 'check', load: () => import('./views/reconcile.js') },
  funds: { title: 'Funds', icon: 'funds', month: true, load: () => import('./views/funds.js') },
  debt: { title: 'Debt', icon: 'debt', load: () => import('./views/debt.js') },
  reports: { title: 'Reports', icon: 'chart', month: true, load: () => import('./views/reports.js') },
  settings: { title: 'Settings', icon: 'gear', load: () => import('./views/settings.js') }
};
const PRIMARY = ['budget', 'transactions', 'reconcile', 'funds'];

const app = document.getElementById('app');
let route = 'budget';
let token = 0;

const routeFromHash = () => {
  const r = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return ROUTES[r] ? r : 'budget';
};

function shell() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, Object.entries(ROUTES).map(([id, r]) =>
    h('a', { href: '#/' + id, 'data-route': id, class: PRIMARY.includes(id) ? '' : 'desk' }, icon(r.icon), r.title)));
  const more = h('a', { href: '#/more', class: 'mob-more', 'data-route': 'more', onclick: (e) => { e.preventDefault(); openMore(); } }, icon('dots'), 'More');
  more.style.display = 'none';
  nav.append(more);
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, h('img', { src: '/icon.png', alt: '' }), 'ZeroDollar'),
    nav, h('div', { class: 'grow' }),
    h('div', { class: 'foot' }, S.meta.settings.householdName || 'Every dollar planned'));
  const title = h('h1', { id: 'page-title' });
  const monthbar = h('div', { class: 'monthbar', id: 'monthbar' },
    h('button', { 'aria-label': 'Previous month', onclick: () => step(-1) }, icon('left')),
    h('button', { class: 'label', id: 'month-label', title: 'Jump to this month', onclick: () => { setMonth(monthNow()); go(); } }),
    h('button', { 'aria-label': 'Next month', onclick: () => step(1) }, icon('right')));
  const content = h('div', { id: 'content' });
  const main = h('main', { class: 'main' }, h('div', { class: 'top' }, title, monthbar), content);
  const fab = h('button', { class: 'fab', 'aria-label': 'Add transaction (N)', title: 'Add transaction (N)', onclick: () => openTxEditor({ onSaved: go }) }, icon('plus'));
  clear(app).append(h('div', { class: 'shell' }, side, main), fab);
  // mobile: collapse secondary links behind "More"
  const mq = matchMedia('(max-width:820px)');
  const sync = () => {
    more.style.display = mq.matches ? '' : 'none';
    nav.querySelectorAll('a.desk').forEach((a) => (a.style.display = mq.matches ? 'none' : ''));
  };
  mq.addEventListener('change', sync);
  sync();
}

function openMore() {
  const body = h('div', { class: 'stack' }, ['debt', 'reports', 'settings'].map((id) => h('a', { class: 'btn', href: '#/' + id, onclick: () => m.close() }, icon(ROUTES[id].icon), ROUTES[id].title)));
  const m = modal({ title: 'More', body });
}

function step(n) {
  setMonth(shiftMonth(S.month, n));
  go();
}

async function go() {
  route = routeFromHash();
  const my = ++token;
  const r = ROUTES[route];
  document.title = `${r.title} · ZeroDollar`;
  document.getElementById('page-title').textContent = r.title;
  document.getElementById('monthbar').style.display = r.month ? '' : 'none';
  document.getElementById('month-label').textContent = monthLabel(S.month, S.meta.settings.locale);
  document.querySelectorAll('.nav a[data-route]').forEach((a) => {
    const on = a.dataset.route === route || (a.dataset.route === 'more' && !PRIMARY.includes(route));
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const content = document.getElementById('content');
  const y = window.scrollY;
  try {
    const mod = await r.load();
    const frag = h('div');
    await mod.render(frag, { refresh: go });
    if (my !== token) return;
    content.replaceChildren(...frag.childNodes);
    window.scrollTo(0, y);
  } catch (e) {
    if (my !== token) return;
    console.error(e);
    content.replaceChildren(h('div', { class: 'card empty' }, h('h3', null, 'Something went wrong'), e.message || String(e), h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: go }, 'Try again'))));
  }
}

/* keyboard: N = new transaction, [ ] = previous / next month */
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.matches?.('input,textarea,select,[contenteditable]') || document.querySelector('.scrim')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTxEditor({ onSaved: go }); }
  else if (e.key === '[') step(-1);
  else if (e.key === ']') step(1);
});

/* Easter egg: the Konami code makes it rain dollars. */
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let kpos = 0;
document.addEventListener('keydown', (e) => {
  kpos = e.key === KONAMI[kpos] ? kpos + 1 : e.key === KONAMI[0] ? 1 : 0;
  if (kpos === KONAMI.length) { kpos = 0; rain(); }
});
function rain() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return toast('Zero is the hero.');
  const box = h('div', { class: 'rain', 'aria-hidden': 'true' });
  for (let i = 0; i < 70; i++) {
    box.append(h('span', { style: { left: Math.random() * 100 + 'vw', fontSize: 16 + Math.random() * 26 + 'px', animationDuration: 2.2 + Math.random() * 2.4 + 's', animationDelay: Math.random() * 1.2 + 's' } }, S.money.symbol));
  }
  const msg = h('div', { class: 'rain-msg' }, 'Zero is the hero.');
  document.body.append(box, msg);
  setTimeout(() => { box.remove(); msg.remove(); }, 5600);
}

async function boot() {
  try {
    await loadMeta();
  } catch (e) {
    app.replaceChildren(h('div', { class: 'boot' }, 'Could not reach the server. ', h('button', { class: 'btn', onclick: () => location.reload() }, 'Retry')));
    return;
  }
  setTheme(currentTheme());
  shell();
  window.addEventListener('hashchange', go);
  go();
}
boot();
void guard; void THEMES;
