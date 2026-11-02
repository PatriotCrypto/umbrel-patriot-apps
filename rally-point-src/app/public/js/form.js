// Form builder driven by the server's schema (/api/meta), plus the generic
// record editor and list panel used by most screens.
import { h, modal, btn, confirmBox, toast, badge, clear } from './ui.js';
import { RP, api, act } from './core.js';

let listId = 0;

// ---------------------------------------------------------------- fields
function optionLabel(o) { return Array.isArray(o) ? o[1] : o; }
function optionValue(o) { return Array.isArray(o) ? o[0] : o; }

function refOptions(coll) {
  const rows = RP.st[coll] || [];
  const label = (r) => r.name || r.title || r.crop || '';
  return [['', '(none)'], ...rows.map((r) => [r.id, label(r)])];
}

function datalistFor(name) {
  const id = 'dl-' + name;
  let dl = document.getElementById(id);
  if (!dl) { dl = h('datalist', { id }); document.body.append(dl); }
  let vals = [];
  if (name === 'units') vals = RP.meta.units;
  else if (name === 'locations') vals = [...new Set(RP.st.items.map((i) => i.location).filter(Boolean))].sort();
  else if (name === 'calibers') vals = ['9mm', '.22 LR', '.223 / 5.56', '.308 / 7.62x51', '7.62x39', '.45 ACP', '.40 S&W', '.380 ACP', '.357 / .38 Spl', '.44 Mag', '12 gauge', '20 gauge', '.30-06', '6.5 Creedmoor', '10mm'];
  else if (name === 'crops') vals = RP.meta.crops.map((c) => c.crop);
  else if (name === 'species') vals = ['Chickens', 'Ducks', 'Goats', 'Sheep', 'Cattle', 'Pigs', 'Rabbits', 'Bees', 'Horses', 'Turkeys'];
  else if (name === 'hunits') vals = ['lb', 'oz', 'each', 'dozen', 'gal', 'qt', 'bushel'];
  clear(dl);
  vals.forEach((v) => dl.append(h('option', { value: v })));
  return id;
}

// Build one input element for a field spec. Returns {el, get, set?}
function inputFor(spec, value, ctx) {
  const t = spec.type;
  if (t === 'bool') {
    const c = h('input', { type: 'checkbox', checked: !!value });
    return { el: h('label', { class: 'chk' }, c, h('span', null, spec.label)), get: () => c.checked, inline: true };
  }
  if (t === 'long') {
    const a = h('textarea', { rows: 3, value: value || '' });
    return { el: a, get: () => a.value };
  }
  if (t === 'sel') {
    const s = h('select', null, (spec.options || []).map((o) => h('option', { value: optionValue(o) }, optionLabel(o) === '' ? '(none)' : optionLabel(o))));
    s.value = value != null && value !== '' ? value : (spec.def != null ? spec.def : (spec.options || [''])[0]);
    return { el: s, get: () => s.value };
  }
  if (t === 'ref') {
    const opts = refOptions(spec.ref);
    const s = h('select', null, opts.map(([v, l]) => h('option', { value: v }, l)));
    s.value = value || '';
    return { el: s, get: () => s.value };
  }
  if (t === 'tags') {
    const i = h('input', { type: 'text', value: (value || []).join(', '), placeholder: 'comma separated' });
    return { el: i, get: () => i.value.split(',').map((x) => x.trim()).filter(Boolean) };
  }
  if (t === 'num') {
    const i = h('input', { type: 'number', step: 'any', inputmode: 'decimal', value: value == null ? '' : value, min: spec.min, max: spec.max });
    return { el: i, get: () => i.value };
  }
  if (t === 'date') {
    const i = h('input', { type: 'date', value: value || '' });
    return { el: i, get: () => i.value };
  }
  if (t === 'lines') return linesInput(spec, value || [], ctx);
  const i = h('input', { type: 'text', value: value || '', maxlength: spec.max || 200, list: spec.list ? datalistFor(spec.list) : null, autocomplete: 'off' });
  return { el: i, get: () => i.value };
}

function linesInput(spec, rows, ctx) {
  const box = h('div', { class: 'lines' });
  const body = h('div', { class: 'lines-body' });
  const getters = [];
  const addRow = (row) => {
    const cells = {};
    const line = h('div', { class: 'line' });
    spec.of.forEach((sub) => {
      const inp = inputFor(sub, row ? row[sub.key] : undefined, ctx);
      cells[sub.key] = inp;
      const wrap = h('div', { class: 'cell cell-' + sub.type + ' k-' + sub.key }, sub.type === 'bool' ? inp.el : [h('label', { class: 'mini' }, sub.label), inp.el]);
      line.append(wrap);
    });
    const rm = h('button', { type: 'button', class: 'x', title: 'Remove', onclick: () => { line.remove(); const i = getters.indexOf(entry); if (i >= 0) getters.splice(i, 1); } }, '×');
    line.append(rm);
    const entry = { id: row && row.id, cells };
    getters.push(entry);
    body.append(line);
  };
  rows.forEach(addRow);
  box.append(body, h('button', { type: 'button', class: 'btn small', onclick: () => addRow(null) }, '+ Add'));
  return {
    el: box,
    get: () => getters.map((g) => {
      const o = {};
      if (g.id) o.id = g.id;
      for (const k of Object.keys(g.cells)) o[k] = g.cells[k].get();
      return o;
    }),
    add: (row) => addRow(row),
  };
}

// Render a list of field specs into a form. Returns {el, get()}.
export function buildForm(fields, values, ctx) {
  values = values || {};
  const el = h('div', { class: 'form' });
  const gets = {};
  for (const spec of fields) {
    if (spec.readonly) continue;
    const inp = inputFor(spec, values[spec.key], ctx);
    gets[spec.key] = inp;
    if (inp.inline) { el.append(h('div', { class: 'field inline' }, inp.el)); continue; }
    el.append(h('div', { class: 'field f-' + spec.type },
      h('label', { class: 'lbl' }, spec.label, spec.req ? h('b', { class: 'req' }, ' *') : null),
      inp.el,
      spec.hint ? h('div', { class: 'hint' }, spec.hint) : null));
  }
  return { el, gets, get: () => { const o = {}; for (const k of Object.keys(gets)) o[k] = gets[k].get(); return o; } };
}

// ---------------------------------------------------------------- photos
export function resizeToJpeg(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => { URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error('Could not read that image')); }, 'image/jpeg', 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

async function uploadPhoto(file) {
  const blob = await resizeToJpeg(file, 800);
  const res = await fetch('/api/photo', { method: 'POST', headers: { 'x-rp': '1', 'content-type': 'image/jpeg' }, body: blob });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'Upload failed');
  return j.id;
}

export function photoPicker(initial) {
  let id = initial || '';
  const img = h('img', { class: 'thumb big', alt: '' });
  const holder = h('div', { class: 'photo-pick' });
  const draw = () => {
    clear(holder);
    if (id) { img.src = '/photos/' + id + '.jpg'; holder.append(img); }
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { id = await uploadPhoto(f); draw(); } catch (err) { toast(err.message, 'err'); }
    } });
    holder.append(file, btn(id ? 'Replace photo' : 'Add photo', () => file.click(), 'small'));
    if (id) holder.append(btn('Remove', () => { id = ''; draw(); }, 'small ghost'));
  };
  draw();
  return { el: holder, get: () => id };
}

// ---------------------------------------------------------------- record editor
// o: { coll, vault, rec, title, fields?, defaults?, extraButtons?, after?, afterSave?, extra?(form) }
export function editRecord(o) {
  const spec = (o.vault ? RP.meta.vcoll : RP.meta.coll)[o.coll];
  const rec = o.rec || null;
  const values = Object.assign({}, o.defaults || {}, rec || {});
  const fields = (o.fields || spec.fields).filter((f) => !(f.key === 'photo'));
  const form = buildForm(fields, values);
  const body = h('div');
  body.append(form.el);
  let photo = null;
  if (o.photo) { photo = photoPicker(rec && rec.photo); body.append(h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Photo'), photo.el)); }
  const extra = o.extra ? o.extra(body, form, values) : null;
  const base = o.vault ? '/api/v/' : '/api/c/';
  const m = modal({
    title: o.title || (rec ? 'Edit ' : 'Add ') + spec.label.replace(/s$/, '').toLowerCase(),
    body,
    wide: !!o.wide,
    buttons: [
      rec && !o.noDelete ? btn('Delete', async () => {
        if (await confirmBox('Delete this entry? This cannot be undone.', { okText: 'Delete', danger: true })) {
          const ok = await act(() => api('DELETE', base + o.coll + '/' + rec.id), { ok: 'Deleted' });
          if (ok) { m.close(); if (o.afterDelete) o.afterDelete(); }
        }
      }, 'danger left') : null,
      ...(o.extraButtons || []).map((b) => btn(b.label, () => b.fn(rec, m, form), b.cls)),
      btn('Cancel', () => m.close(), 'ghost'),
      btn('Save', async () => {
        const data = form.get();
        if (photo) data.photo = photo.get();
        if (extra && extra.get) Object.assign(data, extra.get());
        if (o.transform) o.transform(data);
        const r = await act(() => (rec ? api('PUT', base + o.coll + '/' + rec.id, data) : api('POST', base + o.coll, data)), { ok: 'Saved' });
        if (r) { m.close(); if (o.afterSave) o.afterSave(r.rec); }
      }, 'primary'),
    ],
  });
  return m;
}

// ---------------------------------------------------------------- list panel
// o: { coll, vault, cols:[{h, f(r), cls}], rows, defaults, addLabel, empty, sort, rowActions(r), onEdit(r), card(r) }
export function listPanel(o) {
  const rows = (o.rows || RP.st[o.coll] || []).slice();
  if (o.sort) rows.sort(o.sort);
  const wrap = h('div', { class: 'panel' });
  const head = h('div', { class: 'panel-head' }, h('h3', null, o.title || ''), h('div', { class: 'spacer' }), ...(o.headExtra || []));
  if (o.addLabel !== null) head.append(btn(o.addLabel || '+ Add', () => (o.onAdd ? o.onAdd() : editRecord({ coll: o.coll, vault: o.vault, defaults: o.defaults, photo: o.photo, wide: o.wide }))));
  wrap.append(head);
  if (o.note) wrap.append(h('p', { class: 'hint pad' }, o.note));
  if (!rows.length) { wrap.append(h('div', { class: 'empty' }, o.empty || 'Nothing here yet.')); return wrap; }
  const table = h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, o.cols.map((c) => h('th', { class: c.cls || '' }, c.h)), o.rowActions ? h('th') : null)),
    h('tbody', null, rows.map((r) => {
      const tr = h('tr', { class: 'click ' + (o.rowClass ? o.rowClass(r) : ''), onclick: (e) => {
        if (e.target.closest('button,a,input,select,label')) return;
        if (o.onEdit) o.onEdit(r); else editRecord({ coll: o.coll, vault: o.vault, rec: r, photo: o.photo, wide: o.wide });
      } },
      o.cols.map((c) => h('td', { class: c.cls || '', 'data-label': c.h }, c.f(r))),
      o.rowActions ? h('td', { class: 'acts' }, o.rowActions(r)) : null);
      return tr;
    })));
  wrap.append(h('div', { class: 'tbl-wrap' }, table));
  return wrap;
}

export { optionLabel, optionValue, badge };
