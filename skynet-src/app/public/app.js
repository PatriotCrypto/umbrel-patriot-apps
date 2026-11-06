'use strict';
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SKINS = [['cyberdeck', 'Cyberdeck'], ['terminal', 'Phosphor'], ['battlefield', 'Battlefield'], ['nightred', 'Night Red']];

  let S = { nodes: [], alerts: [], settings: {}, status: {}, me: null, mode: 'demo' };
  let contacts = [], freqs = [], qsos = [], msgs = [], trails = {}, coverage = [];
  let view = 'nodes', selected = null, map = null, showTrails = true, showCov = true, search = '';
  let folded = new Set();
  try { folded = new Set(JSON.parse(localStorage.getItem('sk.fold') || '[]')); } catch (_) {}
  let chatTo = '^all';

  // ---------- helpers ----------
  async function api(path, opts = {}) {
    const o = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    const r = await fetch('/api/' + path, o);
    let j = null; try { j = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error((j && j.error) || 'Request failed (' + r.status + ')');
    return j;
  }
  let toastT;
  function toast(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (e.hidden = true), 3200); }
  const ago = (sec) => {
    if (!sec) return 'never';
    const d = Math.max(0, Date.now() / 1000 - sec);
    return d < 90 ? 'just now' : d < 5400 ? Math.round(d / 60) + ' min ago' : d < 129600 ? Math.round(d / 3600) + ' h ago' : Math.round(d / 86400) + ' d ago';
  };
  const fmtF = (f) => { let s = Number(f).toFixed(4).replace(/0+$/, ''); if (/\.\d{0,2}$/.test(s)) s = Number(f).toFixed(3); return s; };
  const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dstr = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const contactOf = (id) => contacts.find((c) => c.nodeId && c.nodeId === id);
  const nodeOf = (id) => S.nodes.find((n) => n.id === id);
  const nodeName = (id) => { if (id === '^all') return 'Everyone'; const c = contactOf(id), n = nodeOf(id); return (c && c.name) || (n && (n.long || n.short)) || id; };
  const isStale = (n) => Date.now() / 1000 - (n.lastHeard || 0) > (S.settings.staleMinutes || 60) * 60;
  const isLow = (n) => typeof n.battery === 'number' && n.battery <= (S.settings.lowBattery || 20) && n.battery <= 100;
  const batHtml = (n) => typeof n.battery !== 'number' ? '<span class="dim">–</span>' : n.battery > 100 ? '<span class="dim">powered</span>' : `<span class="bat ${isLow(n) ? 'low' : ''}"><i style="width:${n.battery}%"></i></span>${n.battery}%`;

  // ---------- dialog form builder ----------
  function form(title, fields, vals, save, opts = {}) {
    const dlg = $('#dlg'), f = $('#dform');
    const fld = (x) => {
      const v = vals[x.k] == null ? '' : vals[x.k];
      const id = 'f_' + x.k;
      if (x.t === 'checkbox') return `<label class="chk"><input type="checkbox" name="${x.k}" ${v ? 'checked' : ''}> ${esc(x.l)}</label>`;
      if (x.t === 'pick') { // filterable list of checkboxes; value is an array of ids
        const sel = new Set(Array.isArray(vals[x.k]) ? vals[x.k] : []);
        return `<label>${esc(x.l)}</label><input type="text" class="pickq" placeholder="Filter…" autocomplete="off"><div class="pick" data-pick="${x.k}">${x.o.length
          ? x.o.map((o) => `<label class="chk" data-t="${esc(String(o[1]).toLowerCase())}"><input type="checkbox" value="${esc(o[0])}" ${sel.has(o[0]) ? 'checked' : ''}> ${esc(o[1])}</label>`).join('')
          : '<div class="small dim">None yet. Add frequencies in the Freqs tab first.</div>'}</div>${x.h ? `<div class="small dim">${esc(x.h)}</div>` : ''}`;
      }
      let inner;
      if (x.t === 'select') inner = `<select name="${x.k}" id="${id}">${x.o.map((o) => `<option value="${esc(o[0])}" ${String(o[0]) === String(v) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
      else if (x.t === 'textarea') inner = `<textarea name="${x.k}" id="${id}" rows="3">${esc(v)}</textarea>`;
      else inner = `<input name="${x.k}" id="${id}" type="${x.t || 'text'}" value="${esc(v)}" ${x.step ? `step="${x.step}"` : ''} ${x.list ? `list="${x.list}"` : ''} ${x.ph ? `placeholder="${esc(x.ph)}"` : ''} autocomplete="off">`;
      return `<label for="${id}">${esc(x.l)}</label>${inner}${x.h ? `<div class="small dim">${esc(x.h)}</div>` : ''}`;
    };
    f.innerHTML = `<h2>${esc(title)}</h2>${opts.pre || ''}${fields.map(fld).join('')}<div id="ferr" class="small" style="color:var(--bad);margin-top:8px"></div>
      <div class="row" style="margin-top:14px"><button class="btn" type="submit">Save</button><button class="btn sec" type="button" id="fcancel">Cancel</button></div>`;
    $('#fcancel').onclick = () => dlg.close();
    for (const q of f.querySelectorAll('.pickq')) {
      q.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
      q.oninput = () => { const t = q.value.trim().toLowerCase(); for (const l of q.nextElementSibling.querySelectorAll('label')) l.hidden = !!t && !l.dataset.t.includes(t); };
    }
    f.onsubmit = async (e) => {
      e.preventDefault();
      const out = {};
      for (const x of fields) {
        if (x.t === 'pick') { out[x.k] = [...f.querySelectorAll(`[data-pick="${x.k}"] input:checked`)].map((i) => i.value); continue; }
        const el = f.elements[x.k]; out[x.k] = x.t === 'checkbox' ? el.checked : el.value;
      }
      try { await save(out); dlg.close(); } catch (err) { $('#ferr').textContent = err.message; }
    };
    dlg.showModal();
    const first = f.querySelector('input:not([type=checkbox]),select,textarea'); if (first && !('ontouchstart' in window)) first.focus();
  }
  const confirmBox = (msg) => window.confirm(msg);

  // ---------- data ----------
  async function loadAll() {
    const [st, c, fr, q, m, tr, cv] = await Promise.all([api('state'), api('contacts'), api('freqs'), api('log'), api('messages'), api('trails'), api('coverage')]);
    S = st; contacts = c; freqs = fr; qsos = q; msgs = m; trails = tr; coverage = cv;
  }
  async function refreshMesh() {
    const [st, tr, cv] = await Promise.all([api('state'), api('trails'), api('coverage')]);
    S = st; trails = tr; coverage = cv; header(); if (view === 'nodes') drawNodes(); else if (view === 'contacts') render();
  }
  // Message ping: one short two-note chime, off by default, remembered per browser. Only for incoming texts.
  const Ping = {
    ctx: null,
    on() { try { return localStorage.getItem('sk.ping') === '1'; } catch (_) { return false; } },
    set(v) { try { localStorage.setItem('sk.ping', v ? '1' : '0'); } catch (_) {} },
    ready() { try { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; this.ctx = this.ctx || new C(); if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; } catch (_) { return null; } },
    play(force) {
      if (!force && !this.on()) return;
      const c = this.ready(); if (!c) return;
      try {
        const t = c.currentTime;
        [[880, 0], [1175, 0.13]].forEach(([f, d]) => {
          const o = c.createOscillator(), g = c.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.2, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
          o.connect(g); g.connect(c.destination); o.start(t + d); o.stop(t + d + 0.22);
        });
      } catch (_) {}
    }
  };
  document.addEventListener('pointerdown', () => { if (Ping.on()) Ping.ready(); }, { passive: true }); // browsers only allow sound after a tap or click
  let unread = 0;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { unread = 0; document.title = 'Skynet'; } });
  async function refreshMsgs() {
    const seen = new Set(msgs.map((m) => m.id));
    msgs = await api('messages');
    const fresh = msgs.filter((m) => !seen.has(m.id) && !m.mine);
    if (fresh.length) {
      Ping.play();
      if (document.hidden) { unread += fresh.length; document.title = '(' + unread + ') Skynet'; }
    }
    if (view === 'chat') drawMsgs(true);
  }

  function header() {
    $('#callsign').textContent = S.settings.callsign || '';
    const l = $('#link'); let cls = 'chip', t;
    if (S.mode === 'demo') { cls += ' warn'; t = 'DEMO MESH'; }
    else if (S.status && S.status.connected) { cls += ' ok'; t = 'LIVE · ' + (S.settings.host || ''); }
    else { cls += ' bad'; t = S.settings.host ? 'NODE OFFLINE' : 'NO NODE SET'; }
    l.className = cls; l.textContent = t;
  }

  // ---------- views ----------
  function render() {
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.v === view);
    const v = $('#view');
    if (view !== 'nodes' && map) { map = null; }
    ({ nodes: vNodes, chat: vChat, contacts: vContacts, freqs: vFreqs, log: vLog, settings: vSettings }[view])(v);
  }

  // --- Nodes ---
  function vNodes(v) {
    v.innerHTML = `<div id="alerts" class="alerts"></div><div class="hud" id="hud"></div>
      <div class="grid2 nodes"><div><div class="mapwrap"><canvas id="map"></canvas>
        <div class="mapbar"><button id="zi" aria-label="Zoom in">+</button><button id="zo" aria-label="Zoom out">−</button><button id="zf" aria-label="Fit all" title="Fit all">⌖</button></div></div>
        <div class="row small" style="margin-top:8px"><label class="chk"><input type="checkbox" id="ct" ${showTrails ? 'checked' : ''}> Trails</label><label class="chk"><input type="checkbox" id="cc" ${showCov ? 'checked' : ''}> Coverage</label><span class="dim" id="mapnote"></span></div></div>
      <div><div class="card tbl" id="nodelist"></div><div class="card" id="nodedetail"></div><div class="card" id="feed"></div></div></div>`;
    map = new window.MapView($('#map'), (id) => { selected = id; drawNodes(); });
    $('#zi').onclick = () => map.zoom(0.5); $('#zo').onclick = () => map.zoom(-0.5); $('#zf').onclick = () => { map.fit(); map.draw(); };
    $('#ct').onchange = (e) => { showTrails = e.target.checked; drawNodes(); };
    $('#cc').onchange = (e) => { showCov = e.target.checked; drawNodes(); };
    drawNodes();
  }
  function drawNodes() {
    if (view !== 'nodes' || !map) return;
    $('#alerts').innerHTML = S.alerts.map((a) => `<div class="a">⚠ ${esc(a.msg)}</div>`).join('');
    const live = S.nodes.filter((x) => !isStale(x)).length, mine = S.nodes.find((x) => x.id === S.me);
    const best = S.nodes.filter((x) => x.id !== S.me && typeof x.snr === 'number').sort((a, b) => b.snr - a.snr)[0];
    $('#hud').innerHTML = `<div><span>Nodes</span><b>${S.nodes.length}</b></div><div><span>Online</span><b>${live}</b></div>
      <div><span>Alerts</span><b class="${S.alerts.length ? 'w' : ''}">${S.alerts.length}</b></div>
      <div><span>Best link</span><b class="m">${best ? best.snr.toFixed(1) + ' dB' : '–'}</b></div>`;
    const list = S.nodes.slice().sort((a, b) => (b.id === S.me) - (a.id === S.me) || (b.lastHeard || 0) - (a.lastHeard || 0));
    let html;
    if (!list.length) {
      html = S.mode === 'live'
        ? `<div class="empty">${S.settings.host ? 'Waiting for the node to report in…' : 'No Meshtastic node set up yet.<br>Open <b>Settings</b> and enter your node’s address.'}</div>`
        : '<div class="empty">Starting demo mesh…</div>';
    } else {
      html = `<table><thead><tr><th>Node</th><th>Battery</th><th class="hide-s">SNR</th><th class="hide-s">Hops</th><th>Heard</th></tr></thead><tbody>` +
        list.map((n) => {
          const c = contactOf(n.id), cls = isStale(n) ? 'stale' : isLow(n) ? 'low' : '';
          return `<tr class="click ${n.id === selected ? 'sel' : ''}" data-id="${esc(n.id)}"><td class="wrap"><span class="dot ${cls}"></span>${esc(c ? c.name : (n.long || n.short || n.id))}${n.id === S.me ? '<span class="tag acc">BASE</span>' : ''}${c && c.callsign ? `<span class="tag">${esc(c.callsign)}</span>` : ''}</td>
          <td>${batHtml(n)}</td><td class="hide-s">${typeof n.snr === 'number' ? n.snr.toFixed(1) + ' dB' : '–'}</td><td class="hide-s">${n.hops ?? '–'}</td><td style="white-space:nowrap">${ago(n.lastHeard)}</td></tr>`;
        }).join('') + '</tbody></table>';
    }
    $('#nodelist').innerHTML = html;
    for (const r of document.querySelectorAll('#nodelist tr.click')) r.onclick = () => { selected = r.dataset.id; drawNodes(); map.focus(nodeOf(selected)); };
    const n = selected && nodeOf(selected);
    $('#nodedetail').innerHTML = n ? detail(n) : '<div class="dim small">Tap a node on the map or in the list for details.</div>';
    const sc = $('#savec'); if (sc) sc.onclick = () => contactForm({ name: n.long || n.short || '', nodeId: n.id });
    const unplaced = S.nodes.filter((x) => typeof x.lat !== 'number');
    $('#mapnote').textContent = unplaced.length ? 'Not on the map (no GPS position yet): ' + unplaced.map((x) => nodeName(x.id)).join(', ') : '';
    const act = (S.activity || []).slice(-8).reverse();
    $('#feed').innerHTML = '<h2>Packets</h2>' + (act.length ? act.map((a) => {
      const t = new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `<div class="feedrow"><span class="mono dim">${esc(t)}</span> <span class="tag ${a.dir === 'tx' ? 'acc' : ''}">${a.dir.toUpperCase()}</span> ${esc(nodeName(a.from))}${a.dir === 'tx' && a.to !== '^all' ? ' → ' + esc(nodeName(a.to)) : ''} · ${esc(a.kind)}${typeof a.snr === 'number' ? ' · ' + a.snr.toFixed(1) + ' dB' : ''}</div>`;
    }).join('') : '<div class="dim small">No packets yet.</div>');
    map.set({ activity: S.activity, nodes: S.nodes, trails, coverage, me: S.me, home: S.settings.home, showTrails, showCov, tiles: !!S.settings.tiles, selected, staleMinutes: S.settings.staleMinutes, lowBattery: S.settings.lowBattery });
  }
  function detail(n) {
    const c = contactOf(n.id);
    return `<h2>${esc(n.long || n.short || n.id)}</h2><div class="kv">
      <span>ID</span><span class="mono">${esc(n.id)}</span>
      <span>Short name</span><span>${esc(n.short || '–')}</span>
      <span>Position</span><span>${typeof n.lat === 'number' ? n.lat.toFixed(5) + ', ' + n.lon.toFixed(5) + (typeof n.alt === 'number' ? ' · ' + n.alt + ' m' : '') : '–'}</span>
      <span>Battery</span><span>${batHtml(n)}${typeof n.voltage === 'number' ? ' · ' + n.voltage.toFixed(2) + ' V' : ''}</span>
      <span>Signal</span><span>${typeof n.snr === 'number' ? n.snr.toFixed(1) + ' dB SNR' : '–'}${typeof n.rssi === 'number' ? ' · ' + n.rssi + ' dBm' : ''}</span>
      <span>Channel use</span><span>${typeof n.chUtil === 'number' ? n.chUtil.toFixed(1) + ' %' : '–'}</span>
      <span>Uptime</span><span>${typeof n.uptime === 'number' ? Math.round(n.uptime / 3600) + ' h' : '–'}</span>
      <span>Last heard</span><span>${ago(n.lastHeard)}</span>
      <span>Contact</span><span>${c ? esc(c.name) : '<span class="dim">not saved</span>'}</span></div>
      ${c || n.id === S.me ? '' : '<div style="margin-top:10px"><button class="btn sec" id="savec">Save as contact</button></div>'}`;
  }

  // --- Chat ---
  function vChat(v) {
    const opts = [['^all', 'Everyone']].concat(S.nodes.filter((n) => n.id !== S.me).map((n) => [n.id, nodeName(n.id)]));
    v.innerHTML = `<div class="card chat"><h2>Mesh channel</h2><div class="msgs" id="msgs"></div>
      <form id="send" class="prompt"><select id="to" style="width:36%">${opts.map((o) => `<option value="${esc(o[0])}" ${o[0] === chatTo ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>
      <span class="pm">&gt;</span><input id="txt" maxlength="200" placeholder="Transmit…  (max 200)" autocomplete="off"><button class="btn" type="submit">Send</button></form></div>`;
    $('#to').onchange = (e) => (chatTo = e.target.value);
    $('#send').onsubmit = async (e) => {
      e.preventDefault();
      const t = $('#txt').value.trim(); if (!t) return;
      if (t.toLowerCase() === '/skynet') { $('#txt').value = ''; return egg(); }
      try { await api('messages', { method: 'POST', body: { text: t, to: chatTo } }); $('#txt').value = ''; await refreshMsgs(); } catch (err) { toast(err.message); }
    };
    drawMsgs(true);
  }
  function drawMsgs(stick) {
    const box = $('#msgs'); if (!box) return;
    const atEnd = stick || box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = msgs.length ? msgs.map((m) => {
      const mine = m.mine || m.from === S.me || m.from === 'me';
      const dm = m.to && m.to !== '^all';
      return `<div class="ln ${mine ? 'mine' : ''}"><span class="t">${hhmm(m.ts)}</span><span class="who">${esc(mine ? 'YOU' : nodeName(m.from).toUpperCase())}</span>${dm ? `<span class="dm">→${esc(nodeName(m.to).toUpperCase())}</span>` : ''}<span class="tx">${esc(m.text)}</span>${typeof m.snr === 'number' && !mine ? `<span class="sn">${m.snr.toFixed(1)} dB</span>` : ''}</div>`;
    }).join('') : '<div class="empty">// channel quiet. Transmit something.</div>';
    if (atEnd) box.scrollTop = box.scrollHeight;
  }

  // --- Contacts ---
  function contactForm(vals, id) {
    const dl = `<datalist id="nodeids">${S.nodes.map((n) => `<option value="${esc(n.id)}">${esc(nodeName(n.id))}</option>`).join('')}</datalist>`;
    form(id ? 'Edit contact' : 'New contact', [
      { k: 'name', l: 'Name' }, { k: 'callsign', l: 'Ham callsign', ph: 'optional' },
      { k: 'nodeId', l: 'Meshtastic node ID', list: 'nodeids', ph: '!a1b2c3d4', h: 'Pick one that has been heard, or type it. Leave blank if none.' },
      { k: 'relation', l: 'Relationship / group', ph: 'Family, Friend, Club…' },
      { k: 'phone', l: 'Phone', t: 'tel', ph: 'optional' }, { k: 'email', l: 'Email', t: 'email', ph: 'optional' },
      { k: 'location', l: 'Location', ph: 'Town or area' },
      { k: 'grid', l: 'Grid square', ph: 'EM79 or EM79ab', h: 'Maidenhead locator. With your base position set, Skynet shows how far away they are.' },
      { k: 'freqIds', l: 'Favorite frequencies', t: 'pick', o: freqs.slice().sort((a, b) => (a.group || '').localeCompare(b.group || '') || (a.name || '').localeCompare(b.name || '', undefined, { numeric: true })).map((f) => [f.id, `${f.name || 'Unnamed'} · ${fmtF(f.freq)}`]) },
      { k: 'notes', l: 'Notes', t: 'textarea' }
    ], vals, async (o) => {
      if (o.grid.trim() && !/^[A-Ra-r]{2}\d{2}([A-Xa-x]{2})?$/.test(o.grid.trim())) throw new Error('Grid square should look like EM79 or EM79ab.');
      await api(id ? 'contacts/' + id : 'contacts', { method: id ? 'PUT' : 'POST', body: o }); contacts = await api('contacts'); render(); }, { pre: dl });
  }
  // Maidenhead grid locator -> centre of the square, and distance from the base position in miles.
  function gridCenter(g) {
    if (!/^[A-R]{2}\d{2}([a-x]{2})?$/.test(g || '')) return null;
    let lon = (g.charCodeAt(0) - 65) * 20 - 180 + +g[2] * 2, lat = (g.charCodeAt(1) - 65) * 10 - 90 + +g[3];
    if (g.length === 6) { lon += (g.charCodeAt(4) - 97) * (2 / 24) + 1 / 24; lat += (g.charCodeAt(5) - 97) / 24 + 1 / 48; } else { lon += 1; lat += 0.5; }
    return { lat, lon };
  }
  function distMi(a, b) {
    const r = (d) => d * Math.PI / 180, dl = r(b.lat - a.lat), dn = r(b.lon - a.lon);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(h));
  }
  const baseCall = (s) => String(s || '').toUpperCase().split('/')[0];
  const lastQso = (c) => (c.callsign ? qsos.filter((q) => baseCall(q.call) === baseCall(c.callsign)).reduce((a, q) => Math.max(a, q.ts || 0), 0) : 0);
  function vContacts(v) {
    const q = search.toLowerCase();
    const list = contacts.filter((c) => !q || [c.name, c.callsign, c.relation, c.notes, c.nodeId, c.location, c.grid, c.phone, c.email].join(' ').toLowerCase().includes(q)).sort((a, b) => (a.name || a.callsign).localeCompare(b.name || b.callsign));
    v.innerHTML = `<div class="row" style="margin-bottom:10px"><input id="q" placeholder="Search contacts…" value="${esc(search)}" style="max-width:320px"><div class="grow"></div><button class="btn" id="add">+ Contact</button></div>
      <div class="card tbl">${list.length ? `<table><thead><tr><th>Name</th><th>Callsign</th><th>Mesh node</th><th class="hide-s">Group</th><th></th></tr></thead><tbody>${list.map((c) => {
        const n = c.nodeId && nodeOf(c.nodeId);
        const h = S.settings.home, gc = gridCenter(c.grid), dist = gc && h && h.lat != null && h.lon != null ? ` · ${Math.round(distMi(h, gc))} mi away` : '';
        const where = [c.location, c.grid ? c.grid + dist : ''].filter(Boolean).join(' · '), lq = lastQso(c);
        const favs = (c.freqIds || []).map((id) => freqs.find((f) => f.id === id)).filter(Boolean).map((f) => `<span class="tag" title="${esc(f.name)}">${esc(fmtF(f.freq))}</span>`).join('');
        const sub = [where && `<div class="small dim">${esc(where)}</div>`,
          (c.phone || c.email) && `<div class="small">${c.phone ? `<a href="tel:${esc(c.phone.replace(/[^0-9+]/g, ''))}">${esc(c.phone)}</a>` : ''}${c.phone && c.email ? ' · ' : ''}${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}</div>`,
          favs && `<div class="small">${favs}</div>`, lq && `<div class="small dim">Last QSO ${ago(lq / 1000)}</div>`].filter(Boolean).join('');
        return `<tr><td class="wrap">${esc(c.name || '–')}${c.sample ? '<span class="tag">sample</span>' : ''}${sub}${c.notes ? `<div class="small dim">${esc(c.notes)}</div>` : ''}</td>
        <td>${c.callsign ? `<a href="https://www.qrz.com/db/${encodeURIComponent(c.callsign)}" target="_blank" rel="noopener noreferrer">${esc(c.callsign)}</a>` : '<span class="dim">–</span>'}</td>
        <td>${c.nodeId ? `<span class="dot ${n ? (isStale(n) ? 'stale' : isLow(n) ? 'low' : '') : 'stale'}"></span><span class="mono small">${esc(c.nodeId)}</span>${n ? `<div class="small dim">${ago(n.lastHeard)}</div>` : ''}` : '<span class="dim">–</span>'}</td>
        <td class="hide-s">${esc(c.relation)}</td><td style="white-space:nowrap"><button class="btn sec" data-e="${c.id}">Edit</button> <button class="btn danger" data-d="${c.id}">✕</button></td></tr>`;
      }).join('')}</tbody></table>` : `<div class="empty">${contacts.length ? 'No matches.' : 'No contacts yet. Add family, friends and club members, with their callsign and/or Meshtastic node.'}</div>`}</div>`;
    $('#q').oninput = (e) => { search = e.target.value; const p = e.target.selectionStart; vContacts(v); const nq = $('#q'); nq.focus(); nq.setSelectionRange(p, p); };
    $('#add').onclick = () => contactForm({});
    for (const b of v.querySelectorAll('[data-e]')) b.onclick = () => contactForm(contacts.find((c) => c.id === b.dataset.e), b.dataset.e);
    for (const b of v.querySelectorAll('[data-d]')) b.onclick = async () => { if (confirmBox('Delete this contact?')) { await api('contacts/' + b.dataset.d, { method: 'DELETE' }); contacts = await api('contacts'); render(); } };
  }

  // --- Frequencies ---
  const FF = [
    { k: 'name', l: 'Name', h: 'Radio display name. Baofeng handhelds show 7 characters.' }, { k: 'freq', l: 'Frequency (MHz)', t: 'number', step: 'any' },
    { k: 'mode', l: 'Mode', t: 'select', o: ['FM', 'NFM', 'AM'].map((x) => [x, x]) },
    { k: 'duplex', l: 'Repeater shift', t: 'select', o: [['', 'None (simplex)'], ['+', '+ (transmit above)'], ['-', '− (transmit below)']] },
    { k: 'offset', l: 'Offset (MHz)', t: 'number', step: 'any', h: 'Repeaters: 0.6 on 2 m, 5 on 70 cm' },
    { k: 'tone', l: 'Tone', t: 'select', o: [['', 'None'], ['Tone', 'Tone (encode)'], ['TSQL', 'Tone squelch']] },
    { k: 'rTone', l: 'CTCSS tone (Hz)', t: 'number', step: '0.1' },
    { k: 'service', l: 'Service', t: 'select', o: ['ham', 'GMRS', 'FRS', 'MURS', 'NOAA', 'MARINE', 'AIR', 'PUBLIC', 'other'].map((x) => [x, x]) },
    { k: 'group', l: 'Group', ph: 'Local repeaters, Simplex, Family…' }, { k: 'notes', l: 'Notes', t: 'textarea' },
    { k: 'listenOnly', t: 'checkbox', l: 'Listen only (do not transmit on this with a ham-only radio)' }, { k: 'inRadio', t: 'checkbox', l: 'Include in my radio’s channel list' }
  ];
  const toNum = (o) => ({ ...o, freq: parseFloat(o.freq), offset: parseFloat(o.offset) || 0, rTone: parseFloat(o.rTone) || 88.5 });
  function freqForm(vals, id) {
    form(id ? 'Edit frequency' : 'New frequency', FF, { mode: 'FM', service: 'ham', offset: 0, rTone: 88.5, ...vals }, async (o) => {
      await api(id ? 'freqs/' + id : 'freqs', { method: id ? 'PUT' : 'POST', body: toNum(o) }); freqs = await api('freqs'); render();
    });
  }
  function vFreqs(v) {
    const q = search.toLowerCase();
    const list = freqs.filter((f) => !q || [f.name, f.freq, f.group, f.service, f.notes].join(' ').toLowerCase().includes(q));
    const groups = {}; for (const f of list) (groups[f.group || 'Ungrouped'] = groups[f.group || 'Ungrouped'] || []).push(f);
    const inRadio = freqs.filter((f) => f.inRadio).length;
    v.innerHTML = `<div class="row" style="margin-bottom:10px"><input id="q" placeholder="Search…" value="${esc(search)}" style="max-width:240px"><div class="grow"></div>
      <button class="btn sec" id="pre">Add presets</button><button class="btn sec" id="imp">Import CHIRP</button><button class="btn sec" id="exp">Export for radio</button><button class="btn" id="add">+ Frequency</button></div>
      <input type="file" id="file" accept=".csv,text/csv" hidden>
      <div class="small dim" style="margin-bottom:8px">${inRadio} channel${inRadio === 1 ? '' : 's'} selected for your radio (UV-5R holds 128). Tick the box to include a frequency in the export.</div>
      <div class="small dim" style="margin-bottom:8px">Need local repeaters? CHIRP can pull them from RepeaterBook for your area (look under its Radio menu for the data-source option). Save the result as a CSV and use <b>Import CHIRP</b> here.</div>` +
      (Object.keys(groups).length ? Object.keys(groups).sort().map((g) => { const open = !!q || !folded.has(g); return `<div class="card tbl"><h2><button type="button" class="fold" data-fold="${esc(g)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${esc(g)} <span class="dim small">(${groups[g].length})</span></button></h2>${!open ? '' : `<table><thead><tr><th>Radio</th><th>Name</th><th>MHz</th><th class="hide-s">Mode</th><th class="hide-s">Shift / tone</th><th></th></tr></thead><tbody>${groups[g].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }) || a.freq - b.freq).map((f) =>
        `<tr><td><input type="checkbox" data-in="${f.id}" ${f.inRadio ? 'checked' : ''} aria-label="In radio"></td><td class="wrap">${esc(f.name || '–')}<span class="tag ${f.service === 'ham' ? 'acc' : ''}">${esc(f.service)}</span>${f.listenOnly ? '<span class="tag warn">RX only</span>' : ''}${f.notes ? `<div class="small dim">${esc(f.notes)}</div>` : ''}</td>
        <td class="mono">${fmtF(f.freq)}</td><td class="hide-s">${esc(f.mode)}</td><td class="hide-s small">${f.duplex ? esc(f.duplex) + fmtF(f.offset) : '–'}${f.tone ? ' · ' + f.rTone + ' Hz' : ''}</td>
        <td style="white-space:nowrap"><button class="btn sec" data-e="${f.id}">Edit</button> <button class="btn danger" data-d="${f.id}">✕</button></td></tr>`).join('')}</tbody></table>`}</div>`; }).join('')
        : `<div class="card"><div class="empty">${freqs.length ? 'No matches.' : 'No frequencies yet. Add your local repeaters, or use <b>Add presets</b> for FRS/GMRS, NOAA weather, MURS, ham calling frequencies, and listen-only marine, aviation and public-safety channels.'}</div></div>`);
    $('#q').oninput = (e) => { search = e.target.value; const p = e.target.selectionStart; vFreqs(v); const nq = $('#q'); nq.focus(); nq.setSelectionRange(p, p); };
    $('#add').onclick = () => freqForm({});
    $('#pre').onclick = async () => { const r = await api('freqs/presets', { method: 'POST' }); freqs = await api('freqs'); toast(r.added ? r.added + ' presets added' : 'Presets already added'); render(); };
    $('#imp').onclick = () => $('#file').click();
    $('#file').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const r = await api('freqs/import', { method: 'POST', body: { csv: await f.text() } }); freqs = await api('freqs'); toast(`Imported ${r.added} channels` + (r.skipped ? `, skipped ${r.skipped}` : '')); render(); } catch (err) { toast(err.message); }
    };
    $('#exp').onclick = exportDialog;
    for (const b of v.querySelectorAll('[data-fold]')) b.onclick = () => {
      const g = b.dataset.fold; if (folded.has(g)) folded.delete(g); else folded.add(g);
      try { localStorage.setItem('sk.fold', JSON.stringify([...folded])); } catch (_) {}
      vFreqs(v);
    };
    for (const b of v.querySelectorAll('[data-e]')) b.onclick = () => freqForm(freqs.find((f) => f.id === b.dataset.e), b.dataset.e);
    for (const b of v.querySelectorAll('[data-d]')) b.onclick = async () => { if (confirmBox('Delete this frequency?')) { await api('freqs/' + b.dataset.d, { method: 'DELETE' }); freqs = await api('freqs'); render(); } };
    for (const b of v.querySelectorAll('[data-in]')) b.onchange = async () => { const f = freqs.find((x) => x.id === b.dataset.in); try { await api('freqs/' + f.id, { method: 'PUT', body: { ...f, inRadio: b.checked } }); freqs = await api('freqs'); const n = freqs.filter((x) => x.inRadio).length; v.querySelector('.small.dim').textContent = `${n} channel${n === 1 ? '' : 's'} selected for your radio (UV-5R holds 128). Tick the box to include a frequency in the export.`; } catch (err) { toast(err.message); } };
  }
  async function exportDialog() {
    const p = await api('freqs/preview?name=7');
    const dlg = $('#dlg'), f = $('#dform');
    f.innerHTML = `<h2>Export for your radio</h2><p>${p.count} channel${p.count === 1 ? '' : 's'} will be written as a <b>CHIRP CSV</b>. Open the file in <a href="https://chirpmyradio.com" target="_blank" rel="noopener noreferrer">CHIRP</a>, then upload it to your Baofeng with the programming cable.</p>
      <label for="nl">Radio name length</label><select id="nl"><option value="7">7 (Baofeng UV-5R and most Baofengs)</option><option value="6">6</option><option value="8">8</option><option value="12">12</option></select>
      ${p.warnings.length ? `<div class="small" style="color:var(--warn);margin-top:8px">${p.warnings.map(esc).join('<br>')}</div>` : ''}
      <p class="small dim">Channels marked “RX only” are exported with a comment so you remember not to transmit on them. You are responsible for operating within your license and the rules for each service.</p>
      <div class="row" style="margin-top:14px"><a class="btn" id="dl" href="/api/freqs.chirp.csv?name=7" download>Download CSV</a><button class="btn sec" type="button" id="fcancel">Close</button></div>`;
    $('#nl').onchange = (e) => { $('#dl').href = '/api/freqs.chirp.csv?name=' + e.target.value; };
    $('#fcancel').onclick = () => dlg.close(); f.onsubmit = (e) => e.preventDefault();
    dlg.showModal();
  }

  // --- Logbook ---
  function qsoForm(vals, id) {
    const local = (ts) => { const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
    form(id ? 'Edit entry' : 'Log a contact', [
      { k: 'ts', l: 'Date / time (your local time)', t: 'datetime-local' }, { k: 'call', l: 'Their callsign' }, { k: 'freq', l: 'Frequency (MHz)', t: 'number', step: 'any' },
      { k: 'mode', l: 'Mode', t: 'select', o: ['FM', 'AM', 'SSB', 'CW', 'FT8', 'DMR', 'OTHER'].map((x) => [x, x]) },
      { k: 'rstSent', l: 'Report sent', ph: '59' }, { k: 'rstRcvd', l: 'Report received', ph: '59' }, { k: 'name', l: 'Their name' }, { k: 'qth', l: 'Their location' }, { k: 'notes', l: 'Notes', t: 'textarea' }
    ], { mode: 'FM', rstSent: '59', rstRcvd: '59', ...vals, ts: local(vals.ts || Date.now()) }, async (o) => {
      const body = { ...o, ts: new Date(o.ts).toISOString(), freq: o.freq === '' ? null : parseFloat(o.freq) };
      await api(id ? 'log/' + id : 'log', { method: id ? 'PUT' : 'POST', body }); qsos = await api('log'); render();
    });
  }
  function vLog(v) {
    const list = qsos.slice().sort((a, b) => b.ts - a.ts);
    const uniq = new Set(qsos.filter((q) => !q.sample).map((q) => q.call)).size;
    v.innerHTML = `<div class="row" style="margin-bottom:10px"><div class="stat"><div><b>${qsos.length}</b><span class="dim small">contacts</span></div><div><b>${uniq}</b><span class="dim small">unique calls</span></div></div><div class="grow"></div>
      <a class="btn sec" href="/api/log.adi" download>Export ADIF</a><button class="btn" id="add">+ Log contact</button></div>
      <div class="card tbl">${list.length ? `<table><thead><tr><th>When</th><th>Call</th><th>MHz</th><th class="hide-s">Mode</th><th class="hide-s">RST</th><th class="hide-s">Name / QTH</th><th></th></tr></thead><tbody>${list.map((q) =>
        `<tr><td>${dstr(q.ts)}</td><td class="wrap"><b>${esc(q.call)}</b>${q.sample ? '<span class="tag">sample</span>' : ''}${q.notes ? `<div class="small dim">${esc(q.notes)}</div>` : ''}</td><td class="mono">${q.freq ? fmtF(q.freq) : '–'}</td><td class="hide-s">${esc(q.mode)}</td><td class="hide-s">${esc(q.rstSent)}/${esc(q.rstRcvd)}</td><td class="hide-s">${esc([q.name, q.qth].filter(Boolean).join(' · '))}</td>
        <td style="white-space:nowrap"><button class="btn sec" data-e="${q.id}">Edit</button> <button class="btn danger" data-d="${q.id}">✕</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Your logbook is empty. Log a contact after you work someone on the air.</div>'}</div>`;
    $('#add').onclick = () => qsoForm({});
    for (const b of v.querySelectorAll('[data-e]')) b.onclick = () => qsoForm(qsos.find((q) => q.id === b.dataset.e), b.dataset.e);
    for (const b of v.querySelectorAll('[data-d]')) b.onclick = async () => { if (confirmBox('Delete this entry?')) { await api('log/' + b.dataset.d, { method: 'DELETE' }); qsos = await api('log'); render(); } };
  }

  // --- Settings ---
  function vSettings(v) {
    const s = S.settings, st = S.status || {};
    v.innerHTML = `<div class="grid2 eq"><div>
      <div class="card"><h2>Station</h2><label>Your callsign</label><input id="s_call" value="${esc(s.callsign)}" placeholder="optional" maxlength="12">
        <label>Base station position (optional)</label><div class="row" style="flex-wrap:nowrap"><input id="s_lat" placeholder="latitude" value="${s.home && s.home.lat != null ? s.home.lat : ''}"><input id="s_lon" placeholder="longitude" value="${s.home && s.home.lon != null ? s.home.lon : ''}"></div>
        <div class="small dim">Used for the map and range rings until the base node reports its own GPS position. Stays on your Umbrel.</div>
        <div class="small dim" style="margin-top:6px">Tip: in Google or Apple Maps, right-click (or press and hold) your spot and copy the coordinates, then paste them into the first box and both fill in.</div></div>
      <div class="card"><h2>Meshtastic node</h2>
        <label>Mode</label><select id="s_mode"><option value="demo" ${s.mode === 'demo' ? 'selected' : ''}>Demo mesh (fictional stations)</option><option value="live" ${s.mode === 'live' ? 'selected' : ''}>Live (connect to my node)</option></select>
        <label>Node address</label><div class="row" style="flex-wrap:nowrap"><input id="s_host" value="${esc(s.host)}" placeholder="192.168.1.50 or meshtastic.local"><input id="s_port" value="${s.port}" style="max-width:100px" inputmode="numeric"></div>
        <div class="small dim">Your node needs Wi-Fi or Ethernet and must be on the same network as your Umbrel. Skynet uses the node’s TCP port (default 4403).</div>
        <div style="margin-top:8px">Link: <span class="chip ${st.connected ? 'ok' : s.mode === 'demo' ? 'warn' : 'bad'}">${s.mode === 'demo' ? 'demo' : st.connected ? 'connected' : 'not connected'}${st.error ? ' · ' + esc(st.error) : ''}</span></div></div>
      <div class="card"><h2>Alerts &amp; map</h2><label>Flag a node as silent after (minutes)</label><input id="s_stale" value="${s.staleMinutes}" inputmode="numeric">
        <label>Low battery warning at (%)</label><input id="s_low" value="${s.lowBattery}" inputmode="numeric">
        <label class="chk" style="margin-top:12px"><input type="checkbox" id="s_tiles" ${s.tiles ? 'checked' : ''}> Show OpenStreetMap background on the map</label>
        <div class="small dim">Off by default so the app stays fully private and offline. When on, your browser downloads map tiles from openstreetmap.org.</div></div>
      <div class="card"><h2>Message ping</h2><label class="chk"><input type="checkbox" id="s_ping" ${Ping.on() ? 'checked' : ''}> Play a short chime when a message arrives</label>
        <div class="row" style="margin-top:8px"><button class="btn sec" id="pingtest">Test chime</button></div>
        <div class="small dim">Off by default and set per browser. The Skynet tab has to be open, and your browser only allows sound after you have clicked or tapped the page once. When the tab is in the background, the tab title also shows how many new messages arrived.</div></div>
      <button class="btn" id="save">Save settings</button></div>
    <div><div class="card"><h2>Your data</h2><div class="row"><a class="btn sec" href="/api/backup" download>Download backup</a><button class="btn sec" id="restore">Restore backup</button></div><input type="file" id="rfile" accept=".json,application/json" hidden>
        <div class="small dim" style="margin-top:6px">Backup covers contacts, frequencies, logbook and settings.</div>
        <h3>Sample data</h3><div class="row"><button class="btn sec" id="sample">Add sample data</button><button class="btn sec" id="nosample">Remove sample data</button></div></div>
      <div class="card"><h2>About</h2><p>Skynet <b>v${esc(S.version || '')}</b>: a control room for your Meshtastic mesh and ham radio, running on your own Umbrel.</p>
        <p class="small dim">Independent hobby project. Not affiliated with or endorsed by Meshtastic, Baofeng, CHIRP, Umbrel or any film or TV franchise. “Skynet” here is just a joke name for a radio network that watches the sky. MIT licensed.</p>
        <p class="small dim">Try typing <span class="mono">/skynet</span> in Chat.</p></div></div></div>`;
    // Pasting "39.2412, -84.9501" (as copied from a maps app) fills both boxes.
    $('#s_lat').addEventListener('input', (e) => {
      const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(e.target.value);
      if (m) { e.target.value = m[1]; $('#s_lon').value = m[2]; }
    });
    $('#s_ping').onchange = (e) => { Ping.set(e.target.checked); if (e.target.checked) Ping.play(true); };
    $('#pingtest').onclick = () => Ping.play(true);
    $('#save').onclick = async () => {
      try {
        S.settings = await api('settings', { method: 'PUT', body: { callsign: $('#s_call').value, mode: $('#s_mode').value, host: $('#s_host').value, port: $('#s_port').value, staleMinutes: $('#s_stale').value, lowBattery: $('#s_low').value, tiles: $('#s_tiles').checked, home: { lat: $('#s_lat').value, lon: $('#s_lon').value } } });
        toast('Saved'); setTimeout(async () => { await refreshMesh(); if (view === 'settings') render(); }, 800);
      } catch (err) { toast(err.message); }
    };
    $('#sample').onclick = async () => { await api('sample', { method: 'POST' }); await loadAll(); toast('Sample data added'); };
    $('#nosample').onclick = async () => { await api('sample', { method: 'DELETE' }); await loadAll(); toast('Sample data removed'); };
    $('#restore').onclick = () => $('#rfile').click();
    $('#rfile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (!confirmBox('Restoring replaces your current contacts, frequencies and logbook. Continue?')) return;
      try { const r = await api('restore', { method: 'POST', body: JSON.parse(await f.text()) }); await loadAll(); toast(`Restored ${r.contacts} contacts, ${r.freqs} frequencies, ${r.log} log entries`); } catch (err) { toast(err.message); }
    };
  }

  // ---------- easter egg ----------
  function egg() {
    const e = $('#egg'), n = S.nodes.length, call = S.settings.callsign || 'N0CALL';
    const lines = ['SKYNET v' + (S.version || '0.1') + ' ... BOOT', '> mounting /dev/antenna ........... OK', `> counting nodes .................. ${n} FOUND`, '> threat assessment ............... ONE (1) SQUIRREL ON THE ROOF', '> world domination ................ DEFERRED (net starts at 8 PM)', '> judgment day .................... CANCELLED. COFFEE IS HOT.', '', `SKYNET ONLINE. 73 DE ${call}`, '', '[ tap anywhere to close ]'];
    e.hidden = false; e.innerHTML = '<pre id="eggt"></pre>';
    const gen = ++eggGen; // a new run cancels any older one
    // Build the whole run up front: when each character appears.
    const marks = []; let at = 0, out = '';
    lines.forEach((L, i) => {
      for (let j = 0; j < L.length; j++) { out += L[j]; marks.push({ at, len: out.length }); at += 0.022; }
      out += '\n'; marks.push({ at, len: out.length }); at += lines[i + 1] === '' ? 0.12 : 0.022;
    });
    const full = out, w0 = performance.now();
    let shown = 0;
    const frame = () => {
      if (e.hidden || gen !== eggGen) return;
      const t = (performance.now() - w0) / 1000;
      while (shown < marks.length && marks[shown].at <= t) shown++;
      const el = $('#eggt'); if (el) el.textContent = full.slice(0, shown ? marks[shown - 1].len : 0);
      if (shown < marks.length) requestAnimationFrame(frame);
    };
    frame();
    e.onclick = () => { e.hidden = true; e.innerHTML = ''; eggGen++; };
  }
  let eggGen = 0;
  const VIEWS = ['nodes', 'chat', 'contacts', 'freqs', 'log', 'settings'];
  document.addEventListener('keydown', (e) => {
    const i = /^F([1-6])$/.test(e.key) ? +e.key.slice(1) - 1 : -1;
    if (i >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); view = VIEWS[i]; search = ''; render(); }
  });
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']; let kpos = 0;
  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return;
    kpos = e.key === KONAMI[kpos] ? kpos + 1 : (e.key === KONAMI[0] ? 1 : 0);
    if (kpos === KONAMI.length) { kpos = 0; egg(); }
  });

  // ---------- clock ----------
  function tickClock() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const el = $('#clock'); if (!el) return;
    el.innerHTML = `<b>${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}</b> LOCAL<br><span class="u">${p(d.getUTCHours())}:${p(d.getUTCMinutes())}Z UTC</span>`;
  }
  setInterval(tickClock, 1000); tickClock();

  // ---------- boot ----------
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; view = b.dataset.v; search = ''; render(); };
  $('#skin').onclick = () => {
    const cur = document.documentElement.getAttribute('data-skin'), i = SKINS.findIndex((s) => s[0] === cur), nx = SKINS[(i + 1) % SKINS.length];
    document.documentElement.setAttribute('data-skin', nx[0]); try { localStorage.setItem('sk.skin', nx[0]); } catch (_) {}
    toast('Look: ' + nx[1]); if (map) map.draw();
  };
  let rt = null;
  function connectEvents() {
    const es = new EventSource('/api/events');
    es.addEventListener('change', (e) => {
      let w = []; try { w = JSON.parse(e.data); } catch (_) {}
      if (w.includes('messages')) refreshMsgs();
      if (w.includes('nodes') || w.includes('status') || w.includes('activity')) { clearTimeout(rt); rt = setTimeout(refreshMesh, 300); }
    });
  }
  loadAll().then(() => { header(); render(); connectEvents(); }).catch((e) => { $('#view').innerHTML = '<div class="card"><div class="empty">Could not reach Skynet: ' + esc(e.message) + '</div></div>'; });
  setInterval(() => { if (view === 'nodes' && map) refreshMesh().catch(() => {}); }, 60000); // keep "last heard" fresh
})();
