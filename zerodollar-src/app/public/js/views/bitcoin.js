import { h, icon, modal, guard, toast, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { S, fmt, loadMeta } from '../state.js';

const btc = (sats) => (sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '.0');
const ago = (iso) => {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};

export async function render(root, ctx) {
  const d = await api.get('/btc');
  const statusMain = h('span', null, 'Starting…');
  const statusSub = h('span', { class: 'sub' }, '');
  const status = h('div', { class: 'working', role: 'status', 'aria-live': 'polite', style: { display: 'none' } }, h('span', { class: 'dot' }), h('div', null, statusMain, statusSub));
  const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const paint = (p) => {
    if (!p?.running) return;
    const done = p.wallets.filter((w) => w.done).length;
    const busy = p.wallets.filter((w) => !w.done);
    const idle = p.now - p.activityAt;
    statusMain.textContent = p.phase === 'price'
      ? 'Getting the Bitcoin price…'
      : busy.length
        ? `Checking ${busy.map((w) => `${w.name}${w.kind === 'xpub' ? ` (${w.checked} address${w.checked === 1 ? '' : 'es'} so far)` : ''}`).join(', ')}…`
        : 'Finishing up…';
    statusSub.textContent = `Working for ${clock(p.now - p.startedAt)}${p.wallets.length > 1 ? ` · ${done} of ${p.wallets.length} wallets done` : ''}. ` +
      (idle > 10000 ? 'Mempool is taking a while to answer. That is normal right after it restarts. ZeroDollar is still waiting.' : 'This can take a few minutes the first time.');
  };
  const refresh = async (btn) => {
    btn.disabled = true;
    btn.textContent = 'Checking…';
    status.style.display = '';
    statusMain.textContent = 'Starting…';
    statusSub.textContent = 'Working for 0:00.';
    let alive = true;
    const poll = async () => {
      while (alive) {
        try { paint(await api.get('/btc/progress')); } catch { /* keep trying */ }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    poll();
    const r = await guard(() => api.post('/btc/refresh'));
    alive = false;
    if (r?.priceError) toast('Balances updated, but the price lookup failed: ' + r.priceError, true);
    ctx.refresh();
  };
  const rbtn = h('button', { class: 'btn primary', disabled: !d.lookups, onclick: (e) => refresh(e.currentTarget) }, icon('upload', 'ico'), 'Refresh now');

  const hero = h('section', { class: 'card pad stack' },
    h('div', { class: 'lbl muted', style: { fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: '12.5px' } }, 'Bitcoin'),
    h('div', { class: 'btc-big' }, `₿ ${btc(d.sats)}`),
    d.hasPrice ? h('div', { class: 'row wrap', style: { gap: '18px' } }, h('b', { class: 'num', style: { fontSize: '20px' } }, fmt(d.cents)), h('span', { class: 'muted' }, `at ${S.money.fmt(d.price * 100)} per bitcoin · ${ago(d.priceAt)}`))
      : h('div', { class: 'muted' }, d.price == null && !d.priceAt ? 'No price yet. Press Refresh to fetch one.' : `The price service has no ${d.currency} price.`),
    h('div', { class: 'row wrap' }, rbtn, h('button', { class: 'btn', onclick: () => walletForm(null, ctx) }, icon('plus'), 'Add wallet'), h('a', { class: 'btn ghost', href: '#/networth' }, 'See in net worth')),
    status);

  const list = h('section', { class: 'card', style: { overflow: 'hidden' } },
    d.wallets.length ? d.wallets.map((w) => {
      const l = w.last;
      const sats = (l?.confirmed || 0) + (w.manualSats || 0);
      const sub = w.kind === 'manual' ? 'Entered by hand' : `${w.kind === 'xpub' ? 'Extended public key' : 'Address'} ${w.hint}${l?.at ? ` · checked ${ago(l.at)}` : ' · not checked yet'}${l?.pending ? ` · ${btc(l.pending)} pending` : ''}${l?.txCount ? ` · ${l.txCount} transactions` : ''}`;
      return h('div', { class: 'txmini', tabIndex: 0, role: 'button', onclick: () => walletForm(w, ctx), onkeydown: (e) => e.key === 'Enter' && walletForm(w, ctx) },
        h('div', { class: 'who' }, h('b', null, w.name), h('span', { class: 'mono' }, sub), l?.error ? h('span', { style: { color: 'var(--bad)' } }, `Last check failed: ${l.error}`) : null),
        h('span', { class: 'amt num' }, `₿ ${btc(sats)}`));
    }) : h('div', { class: 'empty' }, h('h3', null, 'No wallets yet'), 'Add a public address or an extended public key (xpub, ypub, zpub), or type in an amount by hand.'));

  const api_ = h('input', { value: d.api, placeholder: 'https://mempool.space/api' });
  const electrs = h('input', { value: d.electrs || '', placeholder: 'e.g. 192.168.1.50:50001', spellcheck: false, autocomplete: 'off', class: 'mono' });
  const on = h('input', { type: 'checkbox', checked: d.lookups });
  const save = async () => { if (await guard(() => api.put('/settings', { btcLookups: on.checked, btcApi: api_.value, btcElectrs: electrs.value }))) { await loadMeta(); toast('Saved'); ctx.refresh(); } };
  const settings = h('section', { class: 'card pad stack' },
    h('h3', { style: { fontSize: '16px' } }, 'Lookups'),
    h('label', { class: 'row' }, on, 'Look up balances and the price online'),
    h('label', { class: 'f' }, 'Electrs address (recommended on Umbrel)', electrs),
    h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'If you run the Electrs app on your Umbrel, enter its address here, for example 192.168.1.50:50001 (the IP address of your Umbrel, then the port the Electrs app shows). ZeroDollar then reads balances straight from Electrs, which is faster and more reliable than going through Mempool. Leave it empty to use the Mempool address below instead.'),
    h('label', { class: 'f' }, 'Mempool API address (used for the price, and for balances when Electrs is empty)', api_),
    h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Your addresses are sent to the service you choose to read their public balances. To keep that on your own network, use your own Electrs app above. For the Mempool address, use the IP address of your Umbrel, not a .local name, and end it with /api, for example http://192.168.1.50:3006/api. Only public information is ever used. Never enter a seed phrase or private key.'),
    h('div', null, h('button', { class: 'btn', onclick: save }, 'Save lookup settings')));

  root.append(h('div', { class: 'page', style: { maxWidth: '820px' } }, hero, list, settings));
}

function walletForm(w, ctx) {
  const name = h('input', { value: w?.name || '', maxLength: 40, autofocus: true, placeholder: 'e.g. Cold storage' });
  const input = h('input', { placeholder: 'bc1… address, or xpub / ypub / zpub', spellcheck: false, autocomplete: 'off', class: 'mono' });
  const sats = h('input', { inputMode: 'numeric', placeholder: 'Satoshis, e.g. 2500000', value: w?.manualSats || '' });
  const kind = w?.kind || 'address';
  const body = [h('label', { class: 'f' }, 'Name', name)];
  if (!w) body.push(h('label', { class: 'f' }, 'Public address or extended public key', input), h('div', { class: 'muted', style: { fontSize: '13px' } }, 'or leave that empty and enter an amount by hand:'), h('label', { class: 'f' }, 'Amount in satoshis (1 bitcoin = 100,000,000)', sats),
    h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Never paste a seed phrase or private key. They are refused, and nobody legitimate needs them to show a balance.'));
  else if (kind === 'manual') body.push(h('label', { class: 'f' }, 'Amount in satoshis', sats));
  else body.push(h('p', { class: 'muted mono', style: { margin: 0 } }, `${w.hint}`));
  const m = modal({ title: w ? 'Edit wallet' : 'Add wallet', body, footer: [
    w ? h('button', { class: 'btn danger', style: { marginRight: 'auto' }, onclick: async () => { if (!(await confirmDialog(`Stop tracking “${w.name}”?`, { ok: 'Remove', danger: true }))) return; if (await guard(() => api.del('/btc/wallets/' + w.id))) { m.close(); ctx.refresh(); } } }, 'Remove') : null,
    h('button', { class: 'btn primary', onclick: async () => {
      const n = sats.value.trim() === '' ? undefined : Number(sats.value.replace(/[, ]/g, ''));
      if (n !== undefined && !Number.isInteger(n)) return toast('Satoshis must be a whole number', true);
      const ok = w ? await guard(() => api.patch('/btc/wallets/' + w.id, { name: name.value, ...(kind === 'manual' ? { manualSats: n ?? 0 } : {}) }))
        : await guard(() => api.post('/btc/wallets', input.value.trim() ? { name: name.value, input: input.value } : { name: name.value, manualSats: n ?? 0 }));
      if (ok) { m.close(); ctx.refresh(); }
    } }, 'Save')] });
}
