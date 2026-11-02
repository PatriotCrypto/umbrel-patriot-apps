// Inventory: everything you own, with lots, expiry and quick quantity buttons.
import { h, btn, clear, modal, n1, n2, fmtDate, relDays, dueClass, badge, promptBox, printNode, toast, money } from './ui.js';
import { RP, api, act, catLabel, catCode, go } from './core.js';
import { viewHead } from './parts.js';
import { editRecord, buildForm } from './form.js';

export const inv = { cat: 'all', q: '', loc: '', flag: '', sort: 'name', group: '' };

export function setSearch(q) { inv.q = q; inv.cat = 'all'; inv.flag = ''; inv.loc = ''; }

// ---------------------------------------------------------------- editor
export function editItem(rec, defaults) {
  const m = editRecord({
    coll: 'items', rec, photo: true, wide: true,
    defaults: rec ? undefined : Object.assign({ cat: inv.cat !== 'all' ? inv.cat : 'food', unit: 'each', lots: [{ qty: 1 }] }, defaults || {}),
    extra: (body, form) => {
      const box = h('div');
      let xform = null;
      const draw = () => {
        clear(box);
        const cat = form.gets.cat.get();
        const spec = RP.meta.cats.find((c) => c.id === cat);
        xform = null;
        if (!spec || !spec.fields.length) return;
        const cur = rec && rec.cat === cat && rec.x ? rec.x : ((defaults && defaults.x) || {});
        xform = buildForm(spec.fields, cur);
        box.append(h('h4', null, spec.label + ' details'), xform.el);
      };
      form.gets.cat.el.addEventListener('change', draw);
      draw();
      body.append(box);
      return { get: () => ({ x: xform ? xform.get() : {} }) };
    },
    extraButtons: rec ? [{ label: 'Duplicate', cls: 'ghost', fn: (r, mm) => { mm.close(); editItem(null, Object.assign({}, r, { name: r.name + ' (copy)', photo: '', lots: (r.lots || []).map((l) => ({ qty: l.qty })) })); } }] : [],
  });
  return m;
}

// ---------------------------------------------------------------- scan / lookup
export async function scan(code) {
  let found = null;
  try { found = (await api('GET', '/api/scan/' + encodeURIComponent(code))).item; } catch (e) { toast(e.message, 'err'); return; }
  if (found) {
    const qty = h('input', { type: 'number', value: 1, min: 0, step: 'any', inputmode: 'decimal' });
    const m = modal({
      title: found.name,
      body: h('div', null, h('p', { class: 'dim' }, 'Barcode ' + code), h('label', { class: 'lbl' }, 'Quantity (' + (found.unit || 'each') + ')'), qty),
      buttons: [
        btn('Edit item', () => { m.close(); const it = RP.st.items.find((i) => i.id === found.id); if (it) editItem(it); }, 'ghost'),
        btn('Use', async () => { if (await act(() => api('POST', `/api/items/${found.id}/adjust`, { delta: -Math.abs(+qty.value || 1) }), { ok: 'Updated' })) m.close(); }),
        btn('Add', async () => { if (await act(() => api('POST', `/api/items/${found.id}/adjust`, { delta: Math.abs(+qty.value || 1) }), { ok: 'Updated' })) m.close(); }, 'primary'),
      ],
    });
    return;
  }
  const defaults = { barcode: code, cat: 'food', unit: 'each', lots: [{ qty: 1 }] };
  if (RP.st.settings.lookupOnline) {
    try {
      const r = await api('GET', '/api/lookup/' + encodeURIComponent(code));
      if (r.found) { defaults.name = r.name; if (r.calories) defaults.x = { calories: r.calories }; toast('Found online: ' + r.name); }
      else toast('Not found online. Fill it in by hand.');
    } catch (e) { toast(e.message, 'err'); }
  } else toast('New barcode. Fill in the details.');
  editItem(null, defaults);
}

async function cameraScan() {
  if (!(window.isSecureContext && 'BarcodeDetector' in window && navigator.mediaDevices)) {
    toast('Camera scanning needs a secure (https) connection and a supported browser. A USB barcode scanner works anywhere: click the search box and scan.', 'err');
    return;
  }
  let stream; let stop = false;
  const video = h('video', { autoplay: true, playsinline: true, muted: true, style: { width: '100%', borderRadius: '4px' } });
  const m = modal({ title: 'Scan a barcode', body: video, onclose: () => { stop = true; if (stream) stream.getTracks().forEach((t) => t.stop()); }, buttons: [btn('Cancel', () => m.close(), 'ghost')] });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
    const loop = async () => {
      if (stop) return;
      try { const r = await det.detect(video); if (r.length) { const v = r[0].rawValue; m.close(); scan(v); return; } } catch (e) { /* keep trying */ }
      setTimeout(loop, 300);
    };
    loop();
  } catch (e) { m.close(); toast('Could not open the camera: ' + e.message, 'err'); }
}

// ---------------------------------------------------------------- starter list
function starterModal() {
  const have = new Set(RP.st.items.map((i) => i.name.toLowerCase()));
  const checks = [];
  const groups = {};
  for (const s of RP.meta.starter) (groups[s.cat] = groups[s.cat] || []).push(s);
  const body = h('div', null, h('p', { class: 'hint' }, 'Pick what you want as a starting checklist. Items arrive with zero quantity and typical calories where they apply. Fill in what you actually have.'));
  for (const [cat, list] of Object.entries(groups)) {
    const box = h('div');
    body.append(h('h4', null, catLabel(cat)), box);
    for (const s of list) {
      const c = h('input', { type: 'checkbox', checked: !have.has(s.name.toLowerCase()), disabled: have.has(s.name.toLowerCase()) });
      checks.push([c, s.name]);
      box.append(h('label', { class: 'chk', style: { marginBottom: '.25rem' } }, c, h('span', null, s.name, have.has(s.name.toLowerCase()) ? h('span', { class: 'dim' }, '  (already have)') : null)));
    }
  }
  const m = modal({
    title: 'Starter inventory', wide: true, body,
    buttons: [
      btn('Cancel', () => m.close(), 'ghost'),
      btn('Add selected', async () => {
        const names = checks.filter(([c]) => c.checked && !c.disabled).map(([, n]) => n);
        if (!names.length) { m.close(); return; }
        if (await act(() => api('POST', '/api/starter', { names }), { ok: 'Added ' + names.length + ' items' })) m.close();
      }, 'primary'),
    ],
  });
}

// ---------------------------------------------------------------- list
function matches(it, st) {
  if (inv.cat !== 'all' && it.cat !== inv.cat) return false;
  if (inv.loc && (it.location || '') !== inv.loc) return false;
  if (inv.q) {
    const q = inv.q.toLowerCase();
    const hay = [it.name, it.location, it.notes, it.barcode, (it.tags || []).join(' '), it.x && it.x.caliber].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  const s = it.st;
  if (inv.flag === 'low' && !(it.minQty > 0 && s.qty <= it.minQty)) return false;
  if (inv.flag === 'expiring' && !(s.expiredQty > 0 || (s.nearestDays != null && s.nearestDays <= st.settings.expiry.soonDays))) return false;
  if (inv.flag === 'expired' && !(s.expiredQty > 0)) return false;
  if (inv.flag === 'zero' && s.qty > 0) return false;
  return true;
}

function sorter(key) {
  return (a, b) => {
    if (key === 'expiry') {
      const x = a.st.nearestDays == null ? 1e9 : a.st.nearestDays; const y = b.st.nearestDays == null ? 1e9 : b.st.nearestDays;
      return x - y || a.name.localeCompare(b.name);
    }
    if (key === 'qty') return a.st.qty - b.st.qty || a.name.localeCompare(b.name);
    if (key === 'location') return (a.location || '~').localeCompare(b.location || '~') || a.name.localeCompare(b.name);
    if (key === 'category') return a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  };
}

function qtyCell(it) {
  const q = it.st.qty;
  return h('span', { class: 'inv-qty' },
    h('button', { class: 'qbtn', title: 'Use one', onclick: (e) => { e.stopPropagation(); if (q > 0) act(() => api('POST', `/api/items/${it.id}/adjust`, { delta: -1 })); } }, '−'),
    h('span', { class: 'q', title: 'Set quantity', onclick: async (e) => {
      e.stopPropagation();
      const v = await promptBox('Total quantity on hand (' + (it.unit || 'each') + ')', { value: q, type: 'number' });
      if (v == null || v === '') return;
      const nv = parseFloat(v);
      if (!Number.isFinite(nv) || nv < 0) { toast('Enter a number', 'err'); return; }
      const delta = Math.round((nv - q) * 10000) / 10000;
      if (delta !== 0) act(() => api('POST', `/api/items/${it.id}/adjust`, { delta }));
    } }, n2(q)),
    h('button', { class: 'qbtn', title: 'Add one', onclick: (e) => { e.stopPropagation(); act(() => api('POST', `/api/items/${it.id}/adjust`, { delta: 1 })); } }, '+'),
    h('span', { class: 'dim' }, it.unit || ''));
}

function expCell(it, st) {
  const s = it.st;
  if (s.nearestDays == null) return h('span', { class: 'dim' }, '-');
  const cls = dueClass(s.nearestDays, st.settings.expiry.soonDays, st.settings.expiry.warnDays);
  return h('span', { class: 'exp-cell ' + cls, title: fmtDate(s.nearest) }, s.nearestDays < 0 ? 'expired ' + relDays(s.nearestDays) : fmtDate(s.nearest) + ' (' + relDays(s.nearestDays) + ')');
}

function flags(it, st) {
  const out = [];
  const s = it.st;
  if (it.minQty > 0 && s.qty <= it.minQty) out.push(badge(s.qty <= 0 ? 'out' : 'low', s.qty <= 0 ? 'crit' : 'warn'));
  if (s.expiredQty > 0) out.push(badge(n1(s.expiredQty) + ' expired', 'crit'));
  if (s.inBags > 0) out.push(badge(n1(s.inBags) + ' in bags', 'info'));
  const link = st.calc.supply.links.find((l) => l.id === it.id);
  if (link && link.days != null) out.push(badge(n1(link.days) + ' days', link.days < st.settings.targetDays ? 'warn' : 'good'));
  if (it.cat === 'filters' && it.x && it.x.lifeTotal > 0) out.push(badge(Math.round((it.x.lifeUsed / it.x.lifeTotal) * 100) + '% life used', it.x.lifeUsed >= it.x.lifeTotal * 0.9 ? 'warn' : ''));
  return out;
}

function printInventory(items, st) {
  const by = {};
  for (const it of items) (by[it.location || 'No location'] = by[it.location || 'No location'] || []).push(it);
  const wrap = h('div');
  for (const loc of Object.keys(by).sort()) {
    wrap.append(h('h2', null, loc), h('table', null,
      h('thead', null, h('tr', null, ['Item', 'Qty', 'Unit', 'Nearest expiry', 'Counted'].map((x) => h('th', null, x)))),
      h('tbody', null, by[loc].sort(sorter('name')).map((it) => h('tr', null,
        h('td', null, it.name), h('td', null, n2(it.st.qty)), h('td', null, it.unit || ''), h('td', null, it.st.nearest ? fmtDate(it.st.nearest) : ''), h('td', null, h('span', { class: 'box' })))))));
  }
  printNode('Inventory: ' + st.settings.groupName + ' (' + fmtDate(st.today) + ')', wrap);
}

export function render(root) {
  const st = RP.st;
  root.append(viewHead('Inventory',
    btn('Starter list', starterModal, 'ghost'),
    btn('Camera', cameraScan, 'ghost'),
    btn('+ Add item', () => editItem(null), 'primary')));

  const counts = {};
  for (const it of st.items) counts[it.cat] = (counts[it.cat] || 0) + 1;

  const chips = h('div', { class: 'chips', style: { marginBottom: '.7rem' } },
    h('button', { class: 'chipbtn' + (inv.cat === 'all' ? ' on' : ''), onclick: () => { inv.cat = 'all'; RP.render(); } }, 'All', h('small', null, st.items.length)),
    RP.meta.cats.filter((c) => counts[c.id] || inv.cat === c.id).map((c) =>
      h('button', { class: 'chipbtn' + (inv.cat === c.id ? ' on' : ''), onclick: () => { inv.cat = c.id; RP.render(); } }, c.label, h('small', null, counts[c.id] || 0))));
  root.append(chips);

  const locs = [...new Set(st.items.map((i) => i.location).filter(Boolean))].sort();
  const listHost = h('div');

  const search = h('input', { type: 'search', placeholder: 'Filter this list', value: inv.q, oninput: (e) => { inv.q = e.target.value; draw(); } });
  const sel = (opts, cur, fn) => h('select', { onchange: (e) => { fn(e.target.value); draw(); } }, opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
  root.append(h('div', { class: 'toolbar' },
    search,
    sel([['', 'Any location'], ...locs.map((l) => [l, l])], inv.loc, (v) => { inv.loc = v; }),
    sel([['', 'Any status'], ['low', 'Low stock'], ['expiring', 'Expiring or expired'], ['expired', 'Expired'], ['zero', 'Out']], inv.flag, (v) => { inv.flag = v; }),
    sel([['name', 'Sort: name'], ['expiry', 'Sort: expiry'], ['qty', 'Sort: quantity'], ['location', 'Sort: location'], ['category', 'Sort: category']], inv.sort, (v) => { inv.sort = v; }),
    sel([['', 'No grouping'], ['location', 'Group by location'], ['cat', 'Group by category']], inv.group, (v) => { inv.group = v; }),
    h('div', { class: 'spacer' }),
    btn('Print', () => printInventory(st.items.filter((i) => matches(i, st)), st), 'small ghost'),
    h('a', { class: 'btn small ghost', href: '/api/export/items.csv', download: '' }, 'CSV')));
  root.append(listHost);

  function draw() {
    clear(listHost);
    const items = st.items.filter((i) => matches(i, st)).sort(sorter(inv.sort));
    if (!st.items.length) {
      listHost.append(h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No items yet. ', btn('Start from a starter list', starterModal, 'small'), ' or add your first item.')));
      return;
    }
    if (!items.length) { listHost.append(h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'Nothing matches those filters.'))); return; }
    const tbody = h('tbody');
    let lastGroup = null;
    for (const it of items) {
      if (inv.group) {
        const g = inv.group === 'cat' ? catLabel(it.cat) : (it.location || 'No location');
        if (g !== lastGroup) { tbody.append(h('tr', { class: 'group-head' }, h('td', { colspan: 5 }, g))); lastGroup = g; }
      }
      tbody.append(h('tr', { class: 'click', onclick: (e) => { if (!e.target.closest('button,a,input')) editItem(it); } },
        h('td', { 'data-label': 'Item' },
          it.photo ? h('img', { class: 'thumb', src: '/photos/' + it.photo + '.jpg', alt: '', loading: 'lazy' }) : null,
          h('span', { class: 'code', title: catLabel(it.cat) }, catCode(it.cat)), it.name,
          (it.tags || []).map((t) => h('span', { class: 'badge', style: { marginLeft: '.3rem' } }, t))),
        h('td', { 'data-label': 'On hand' }, qtyCell(it)),
        h('td', { 'data-label': 'Expires' }, expCell(it, st)),
        h('td', { 'data-label': 'Where', class: 'dim' }, it.location || ''),
        h('td', { 'data-label': 'Status' }, h('span', { class: 'chips' }, flags(it, st)))));
    }
    const value = items.reduce((t, it) => t + (it.lots || []).reduce((a, l) => a + (+l.cost || 0), 0), 0);
    listHost.append(h('div', { class: 'panel' },
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Item', 'On hand', 'Expires', 'Where', 'Status'].map((x) => h('th', null, x)))), tbody)),
      h('p', { class: 'hint pad', style: { padding: '.5rem 1rem' } }, `${items.length} item${items.length === 1 ? '' : 's'}${value ? ' · ' + money(value) + ' recorded cost' : ''}`)));
  }
  draw();
}
