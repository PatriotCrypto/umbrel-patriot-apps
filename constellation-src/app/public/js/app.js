/* Constellation front end. Plain DOM, no framework. No inline style attributes (strict CSP). */
(function () {
  'use strict';

  const THEMES = [
    { id: 'orbit', name: 'Orbit', c: ['#000', '#fff'] },
    { id: 'glass', name: 'Glass', c: ['#1b2450', '#8fb4ff'] },
    { id: 'daylight', name: 'Daylight', c: ['#f4f6f9', '#0b1220'] },
    { id: 'mission', name: 'Mission', c: ['#050a14', '#38d6ff'] },
    { id: 'mars', name: 'Mars', c: ['#0a0504', '#ff7a3d'] },
    { id: 'polar', name: 'Polar', c: ['#03090a', '#7df0d0'] },
  ];
  const TYPE_LABEL = {
    router: 'Router', server: 'Server', computer: 'Computer', phone: 'Phone', tablet: 'Tablet', tv: 'TV',
    speaker: 'Speaker', console: 'Console', camera: 'Camera', printer: 'Printer', iot: 'Smart device', other: 'Other',
  };

  const S = {
    state: null, edit: false, authed: false, route: 'network', filter: 'all', q: '', sort: { k: 'status', dir: 1 },
    range: '24h', history: null, sel: null, detail: null, scene: null, sceneOpts: { labels: true, showOffline: true },
    auth: null, evt: null, busy: false,
  };
  const $app = document.getElementById('app');

  // ---------- helpers ----------
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
        else if (k === 'value') n.value = v;
        else if (k === 'checked') n.checked = !!v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    (Array.isArray(kids) ? kids : kids === undefined ? [] : [kids]).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const pad = (n) => (n < 10 ? '0' : '') + n;
  function ago(t, now) {
    if (!t) return 'never';
    const s = Math.max(0, Math.round(((now || Date.now()) - t) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function dur(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return '<1 min';
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    if (h < 48) return h + ' h ' + (m % 60 ? pad(m % 60) + ' m' : '');
    return Math.floor(h / 24) + ' d ' + (h % 24) + ' h';
  }
  function clock(t) {
    const d = new Date(t);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const pct = (x) => (x === null || x === undefined ? '--' : Math.round(x * 100) + '%');

  let toastTimer = 0;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.appendChild(t); }
    t.textContent = msg;
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function api(method, url, body) {
    const opt = { method, headers: { 'X-CS-Request': '1' }, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, opt); } catch (e) { throw new Error('Cannot reach the app. Is it running?'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (res.status === 401 && S.authed && !/auth\//.test(url)) { S.authed = false; showAuth(); }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
    return data;
  }

  const prefs = {
    get(k, d) { try { const v = localStorage.getItem('cs.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cs.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  function setTheme(id) {
    document.documentElement.setAttribute('data-theme', id);
    try { localStorage.setItem('cs.theme', id); } catch (e) { /* ignore */ }
    if (S.scene && S.scene.applyTheme) S.scene.applyTheme();
    if (S.route === 'charts') renderCharts();
  }

  // ---------- auth ----------
  function logo() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.4');
    const mk = (tag, a) => { const n = document.createElementNS(ns, tag); for (const k in a) n.setAttribute(k, a[k]); svg.appendChild(n); };
    mk('circle', { cx: 12, cy: 12, r: 3.2 });
    mk('ellipse', { cx: 12, cy: 12, rx: 9, ry: 3.6, transform: 'rotate(-24 12 12)', opacity: 0.6 });
    mk('ellipse', { cx: 12, cy: 12, rx: 9, ry: 3.6, transform: 'rotate(38 12 12)', opacity: 0.35 });
    return svg;
  }

  function showAuth(mode) {
    closeStream();
    teardownScene();
    clear($app);
    const st = S.auth || {};
    mode = mode || (st.configured ? 'login' : 'setup');
    const err = el('p', { class: 'err', role: 'alert' });
    const pw = el('input', { class: 'input', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: 'Password' });
    const pw2 = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Repeat password' });
    const rc = el('input', { class: 'input', type: 'text', placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX', autocomplete: 'off' });
    const box = el('div', { class: 'box' });
    box.appendChild(el('div', { class: 'brand' }, [logo(), el('span', { text: 'Constellation' })]));

    async function submit(e) {
      e.preventDefault();
      err.textContent = '';
      try {
        if (mode === 'login') {
          await api('POST', '/api/auth/login', { password: pw.value });
          return enter();
        }
        if (pw.value.length < 8) throw new Error('Use at least 8 characters');
        if (pw.value !== pw2.value) throw new Error('The passwords do not match');
        const r = mode === 'setup'
          ? await api('POST', '/api/auth/setup', { password: pw.value })
          : await api('POST', '/api/auth/reset', { recoveryCode: rc.value, newPassword: pw.value });
        showRecovery(r.recoveryCode);
      } catch (ex) { err.textContent = ex.message; }
    }

    const title = { login: 'Sign in', setup: 'Create a password', reset: 'Reset password' }[mode];
    const sub = {
      login: 'Your network, from above.',
      setup: 'This app has no account system. A password keeps others on your Wi-Fi out. You get a one-time recovery code next.',
      reset: 'Enter the recovery code you saved, then choose a new password.',
    }[mode];
    const form = el('form', { onsubmit: submit }, [
      mode === 'reset' ? el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'Recovery code' }), rc]) : null,
      el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: mode === 'login' ? 'Password' : 'New password' }), pw]),
      mode !== 'login' ? el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'Repeat' }), pw2]) : null,
      err,
      el('button', { class: 'btn primary', type: 'submit', text: mode === 'login' ? 'Sign in' : mode === 'setup' ? 'Create password' : 'Reset password' }),
    ]);
    box.appendChild(el('h1', { text: title }));
    box.appendChild(el('p', { text: sub }));
    box.appendChild(form);
    if (mode === 'login') box.appendChild(el('p', { class: 'note' }, [el('a', { href: '#', class: 'muted', text: 'Forgot password? Use recovery code', onclick: (e) => { e.preventDefault(); showAuth('reset'); } })]));
    if (mode === 'reset') box.appendChild(el('p', { class: 'note' }, [el('a', { href: '#', class: 'muted', text: 'Back to sign in', onclick: (e) => { e.preventDefault(); showAuth('login'); } })]));
    $app.appendChild(el('div', { class: 'gate' }, box));
    setTimeout(() => (mode === 'reset' ? rc : pw).focus(), 30);
  }

  function showRecovery(code) {
    clear($app);
    const done = el('button', { class: 'btn primary', text: 'I saved it', disabled: true, onclick: enter });
    const chk = el('input', { type: 'checkbox', onchange: () => { done.disabled = !chk.checked; } });
    $app.appendChild(el('div', { class: 'gate' }, el('div', { class: 'box' }, [
      el('div', { class: 'brand' }, [logo(), el('span', { text: 'Constellation' })]),
      el('h1', { text: 'Recovery code' }),
      el('p', { text: 'If you forget your password, this code is the only way back in. It is shown once. Save it in your password manager.' }),
      el('div', { class: 'recovery mono', text: code }),
      el('label', { class: 'switch' }, [chk, el('span', { text: 'I have saved this code' })]),
      el('p'),
      done,
    ])));
  }

  async function enter() {
    S.auth = await api('GET', '/api/auth/status');
    S.authed = true;
    clear($app);
    buildShell();
    await refresh();
    openStream();
    route();
  }

  // ---------- data ----------
  let refreshing = false, again = false;
  async function refresh() {
    if (refreshing) { again = true; return; }
    refreshing = true;
    try {
      S.state = await api('GET', '/api/state');
      paintStatus();
      if (S.route === 'network') paintHome();
      else if (S.route === 'devices') paintDevices();
      else if (S.route === 'settings') paintSettingsLive();
      else if (S.route === 'speed') paintSpeed();
      else if (S.route === 'charts') loadCharts(true);
      if (S.sel) refreshDrawer(true);
    } catch (e) { paintStatus(e.message); }
    refreshing = false;
    if (again) { again = false; refresh(); }
  }
  function openStream() {
    closeStream();
    let timer = 0;
    const es = new EventSource('/api/stream');
    S.evt = es;
    es.addEventListener('tick', () => { clearTimeout(timer); timer = setTimeout(refresh, 250); });
    es.onerror = () => paintStatus('Connection lost. Retrying...');
    es.onopen = () => paintStatus();
  }
  function closeStream() { if (S.evt) { S.evt.close(); S.evt = null; } }
  setInterval(() => { if (S.authed && document.visibilityState === 'visible') refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (S.authed && document.visibilityState === 'visible') refresh(); });

  // ---------- shell ----------
  let $top, $view, $dot, $statusTxt, $drawer;
  function buildShell() {
    $dot = el('span', { class: 'dot' });
    $statusTxt = el('span', { class: 'lbl', text: '' });
    const nav = el('nav', { class: 'nav' }, [
      ['network', 'Network'], ['devices', 'Devices'], ['charts', 'Charts'], ['speed', 'Speed'], ['settings', 'Settings'],
    ].map(([id, t]) => el('a', { href: '#/' + id, 'data-r': id, text: t })));
    $top = el('header', { class: 'topbar' }, [
      el('div', { class: 'brand' }, [logo(), el('span', { text: 'Constellation' })]),
      nav, el('div', { class: 'spacer' }),
      el('div', { class: 'status', title: 'Live connection and scanner' }, [$dot, $statusTxt]),
    ]);
    $view = el('main', { id: 'view' });
    $drawer = el('aside', { class: 'drawer', 'aria-label': 'Device details' });
    $app.appendChild($top);
    $app.appendChild($view);
    $app.appendChild($drawer);
  }
  function paintStatus(problem) {
    if (!$dot || !S.state) return;
    const sc = S.state.scanner || {};
    let cls = 'ok', txt = 'Live';
    if (problem) { cls = 'bad'; txt = 'Offline'; }
    else if (sc.lastError) { cls = 'warn'; txt = 'Scan issue'; }
    else if (sc.scanning) { cls = 'ok pulse'; txt = 'Scanning'; }
    $dot.className = 'dot ' + cls;
    $statusTxt.textContent = txt + (S.state.demo ? ' / demo' : '');
  }

  window.addEventListener('hashchange', route);
  function route() {
    if (!S.authed) return;
    const r = (location.hash.replace(/^#\/?/, '') || 'network').split('/')[0];
    S.route = ['network', 'devices', 'charts', 'speed', 'settings'].includes(r) ? r : 'network';
    $top.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === S.route));
    $top.classList.toggle('on-home', S.route === 'network');
    closeDrawer(true);
    teardownScene();
    clear($view);
    $view.className = '';
    ({ network: renderHome, devices: renderDevices, charts: renderCharts, speed: renderSpeed, settings: renderSettings })[S.route]();
    window.scrollTo(0, 0);
  }

  // ---------- home (3D) ----------
  let hud = {};
  function teardownScene() {
    if (S.scene) { try { S.scene.destroy(); } catch (e) { /* ignore */ } S.scene = null; }
    hud = {};
  }
  function renderHome() {
    const o = prefs.get('scene', null);
    if (o) Object.assign(S.sceneOpts, o);
    const stage = el('div', { class: 'stage' });
    const mk = (cls, kids) => el('div', { class: 'hud ' + cls }, kids);
    hud.count = el('div', { class: 'big', text: '--' });
    hud.lines = el('div', { class: 'lines' });
    hud.net = el('div', { class: 'lines' });
    hud.ms = el('div', { class: 'big', text: '--' });
    hud.pill = el('div');
    hud.speed = el('div', { class: 'lines' });
    hud.panel = el('div', { class: 'glass-panel hidden' });
    hud.tip = el('div', { class: 'tooltip hidden' });
    const btn = (text, key, on) => {
      const b = el('button', { class: 'btn sm' + (on ? ' on' : ''), text });
      return b;
    };
    const bLabels = btn('Labels', 'labels', S.sceneOpts.labels);
    const bOff = btn('Offline', 'showOffline', S.sceneOpts.showOffline);
    const bReset = btn('Reset view');
    const bEdit = btn('Arrange', 'edit', S.edit);
    bEdit.addEventListener('click', () => { S.edit = !S.edit; bEdit.classList.toggle('on', S.edit); applyEdit(); });
    const flip = (b, key) => () => {
      S.sceneOpts[key] = !S.sceneOpts[key];
      b.classList.toggle('on', S.sceneOpts[key]);
      prefs.set('scene', S.sceneOpts);
      if (S.scene) S.scene.setOptions(S.sceneOpts);
    };
    bLabels.addEventListener('click', flip(bLabels, 'labels'));
    bOff.addEventListener('click', flip(bOff, 'showOffline'));
    bReset.addEventListener('click', () => S.scene && S.scene.resetView());

    $view.appendChild(stage);
    $view.appendChild(mk('hud-tl', [el('div', { class: 'eyebrow', text: 'Devices online' }), hud.count, hud.lines]));
    $view.appendChild(mk('hud-tr', [el('div', { class: 'eyebrow', text: 'Internet latency' }), hud.ms, hud.net, hud.speed]));
    $view.appendChild(mk('hud-bc', [hud.pill]));
    $view.appendChild(mk('hud-bl', [el('div', { class: 'legend' }, [
      el('span', {}, [el('i', { class: 'dot ok' }), 'Online']),
      el('span', {}, [el('i', { class: 'dot' }), 'Offline']),
      el('span', {}, [el('i', { class: 'dot warn' }), 'New']),
    ]), el('div', { class: 'hint', text: 'Drag to orbit / scroll to zoom / click a device' })]));
    $view.appendChild(mk('hud-br', [bEdit, bLabels, bOff, bReset]));
    $view.appendChild(mk('hud-pl', [hud.panel]));
    document.body.appendChild(hud.tip);

    const mod = window.CSSceneModule;
    let sc = null;
    try {
      sc = mod && mod.create(stage, {
        options: S.sceneOpts,
        umbrelLogo: '/img/umbrel-logo.png',
        bitcoinLogo: '/img/bitcoin-logo.png',
        onShow: showBanner,
        onSelect: (mac) => { if (mac) openDrawer(mac); else closeDrawer(); },
        onReorder: async (list, tags) => {
          try { await api('PUT', '/api/order', { order: list, tags: tags || undefined }); } catch (e) { toast(e.message); }
          refresh();
        },
      });
    } catch (e) { sc = null; }
    if (!sc || sc.supported === false) {
      stage.appendChild(el('div', { class: 'fallback' }, el('div', {}, [
        el('div', { class: 'eyebrow', text: '3D view unavailable' }),
        el('p', { text: 'This browser cannot run WebGL. Everything else still works.' }),
        el('a', { class: 'btn', href: '#/devices', text: 'Open device list' }),
      ])));
    } else { S.scene = sc; if (S.sel) sc.select(S.sel); sc.setEditMode && sc.setEditMode(S.edit); }
    applyEdit();
    paintHome();
  }
  function paintHome() {
    if (!S.state || !hud.count) return;
    const st = S.state, sm = st.summary, now = Date.now();
    hud.count.textContent = '';
    hud.count.appendChild(document.createTextNode(String(sm.online)));
    hud.count.appendChild(el('small', { text: '/ ' + sm.total }));
    clear(hud.lines);
    const n = st.network || {};
    hud.lines.appendChild(el('div', {}, ['Network ', el('b', { text: (n.cidrs && n.cidrs.join(', ')) || 'unknown' })]));
    hud.lines.appendChild(el('div', {}, ['Gateway ', el('b', { text: n.gateway || 'unknown' })]));
    hud.lines.appendChild(el('div', {}, ['Last scan ', el('b', { text: st.scanner.lastScanAt ? ago(st.scanner.lastScanAt, now) : 'pending' })]));
    if (st.scanner.lastError) hud.lines.appendChild(el('div', {}, [el('b', { text: st.scanner.lastError })]));
    const it = st.internet;
    hud.ms.textContent = '';
    hud.ms.appendChild(document.createTextNode(it.wan === null || it.wan === undefined ? (it.state === 'down' ? 'down' : '--') : String(Math.round(it.wan))));
    if (it.wan !== null && it.wan !== undefined) hud.ms.appendChild(el('small', { text: 'ms' }));
    clear(hud.net);
    const word = { ok: 'Connected', degraded: 'Degraded', down: 'No internet', unknown: 'Measuring' }[it.state];
    hud.net.appendChild(el('div', {}, [el('i', { class: 'dot ' + ({ ok: 'ok', degraded: 'warn', down: 'bad' }[it.state] || '') }), ' ', el('b', { text: word })]));
    if (it.avg1h !== null) hud.net.appendChild(el('div', {}, ['1 h average ', el('b', { text: it.avg1h + ' ms' })]));
    clear(hud.pill);
    if (sm.unreviewed > 0 && sm.baselineDone) {
      hud.pill.appendChild(el('div', { class: 'alert-pill', role: 'button', tabindex: 0, onclick: () => { S.filter = 'new'; location.hash = '#/devices'; }, text: sm.unreviewed + (sm.unreviewed === 1 ? ' new device' : ' new devices') + ' / Review' }));
    }
    clear(hud.speed);
    const last = st.speed && st.speed.results && st.speed.results[st.speed.results.length - 1];
    if (st.speed && st.speed.running) hud.speed.appendChild(el('div', {}, ['Speed test ', el('b', { text: st.speed.phase + (st.speed.mbps ? ' ' + st.speed.mbps + ' Mbps' : '...') })]));
    else if (last && !last.error) hud.speed.appendChild(el('div', {}, ['Speed ', el('b', { text: '↓ ' + last.down + '  ↑ ' + last.up + ' Mbps' })]));
    if (S.scene) S.scene.update({ devices: st.devices, internet: st.internet, order: st.order });
  }

  // ---------- arranging the ring ----------
  function currentOrder() {
    const devs = S.state.devices.filter((d) => d.role !== 'gateway');
    const by = new Map(devs.map((d) => [d.mac, d]));
    const out = [];
    for (const m of S.state.order || []) if (by.has(m)) { out.push(m); by.delete(m); }
    [...by.values()].sort((a, b) => a.firstSeen - b.firstSeen).forEach((d) => out.push(d.mac));
    return out;
  }
  async function sortRing(kind) {
    const by = new Map(S.state.devices.map((d) => [d.mac, d]));
    const cur = currentOrder();
    const idx = new Map(cur.map((m, i) => [m, i]));
    const TYPE_ORDER = ['server', 'computer', 'phone', 'tablet', 'tv', 'speaker', 'console', 'camera', 'printer', 'iot', 'router', 'other'];
    const key = {
      tag: (m) => [by.get(m).group ? 0 : 1, (by.get(m).group || '').toLowerCase(), idx.get(m)],
      name: (m) => [0, by.get(m).label.toLowerCase(), 0],
      type: (m) => [TYPE_ORDER.indexOf(by.get(m).type), by.get(m).label.toLowerCase(), 0],
      status: (m) => [by.get(m).online ? 0 : 1, '', idx.get(m)],
    }[kind];
    const next = cur.slice().sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < 3; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return 0; });
    try { await api('PUT', '/api/order', { order: next }); toast('Arranged'); } catch (e) { toast(e.message); }
    refresh();
  }
  function applyEdit() {
    if (S.scene && S.scene.setEditMode) S.scene.setEditMode(S.edit);
    hud.panel.classList.toggle('hidden', !S.edit);
    if (S.edit) renderArrangePanel();
  }
  function renderArrangePanel() {
    const P = clear(hud.panel);
    P.appendChild(el('div', { class: 'eyebrow', text: 'Arrange your constellation' }));
    P.appendChild(el('p', { class: 'note', text: 'Every device sits on one ring. Drag a device to a new spot around it. Give devices a tag (a room or a person) in their details, and tagged runs get a colored arc. Drop a device between two tagged ones to join them.' }));
    P.appendChild(el('div', { class: 'eyebrow', text: 'Sort the ring by' }));
    P.appendChild(el('div', { class: 'sortrow' }, [['tag', 'Tag'], ['type', 'Type'], ['name', 'Name'], ['status', 'Online first']].map(([k, t]) => el('button', { class: 'btn sm', text: t, onclick: () => sortRing(k) }))));
  }

  // ---------- devices ----------
  let $rows, $count;
  function renderDevices() {
    $view.className = 'view';
    const search = el('input', { class: 'input', type: 'search', placeholder: 'Search name, IP, MAC, maker', value: S.q, oninput: (e) => { S.q = e.target.value; paintDevices(); } });
    const seg = el('div', { class: 'seg', role: 'tablist' }, ['all', 'online', 'offline', 'new', 'unnamed'].map((f) =>
      el('button', { 'data-f': f, class: S.filter === f ? 'on' : '', text: f, onclick: () => { S.filter = f; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === f)); paintDevices(); } })));
    $count = el('span', { class: 'muted' });
    const ack = el('button', { class: 'btn sm', text: 'Mark all reviewed', onclick: async () => { await api('POST', '/api/ack-all'); toast('All devices marked as reviewed'); } });
    $view.appendChild(el('h1', { text: 'Devices' }));
    $view.appendChild(el('p', { class: 'sub', text: 'Everything Constellation has seen on your network. Click one to name it.' }));
    $view.appendChild(el('div', { class: 'toolbar' }, [search, seg, el('div', { class: 'spacer' }), $count, ack]));
    const heads = [['status', 'Status'], ['name', 'Device'], ['type', 'Type', 'hide-m'], ['ip', 'IP', 'hide-m'], ['up24', 'Uptime 24h'], ['last', 'Last seen', 'hide-m']];
    const thead = el('tr', {}, heads.map(([k, t, c]) => el('th', { class: c || '', onclick: () => { S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : 1 }; paintDevices(); } }, [t, S.sort.k === k ? el('span', { class: 'arr', text: S.sort.dir > 0 ? '▲' : '▼' }) : null])));
    $rows = el('tbody');
    $view.appendChild(el('div', { class: 'tablewrap' }, el('table', { class: 'devs' }, [el('thead', {}, thead), $rows])));
    paintDevices();
  }
  function ipNum(ip) { return (ip || '').split('.').reduce((a, b) => a * 256 + (+b || 0), 0); }
  function paintDevices() {
    if (!$rows || !S.state) return;
    // header sort arrows
    document.querySelectorAll('.devs th').forEach((th, i) => {
      const k = ['status', 'name', 'type', 'ip', 'up24', 'last'][i];
      const a = th.querySelector('.arr');
      if (a) a.remove();
      if (k === S.sort.k) th.appendChild(el('span', { class: 'arr', text: S.sort.dir > 0 ? '▲' : '▼' }));
    });
    const q = S.q.trim().toLowerCase();
    let list = S.state.devices.filter((d) => !d.hidden || S.filter === 'all');
    list = list.filter((d) => {
      if (S.filter === 'online' && !d.online) return false;
      if (S.filter === 'offline' && d.online) return false;
      if (S.filter === 'new' && d.known) return false;
      if (S.filter === 'unnamed' && (d.name || d.role !== 'device')) return false;
      if (!q) return true;
      return [d.label, d.name, d.hostname, d.ip, d.mac, d.vendor, d.notes].some((x) => x && String(x).toLowerCase().includes(q));
    });
    const key = {
      status: (d) => (d.online ? 0 : 1), name: (d) => d.label.toLowerCase(), type: (d) => d.type, ip: (d) => ipNum(d.ip),
      up24: (d) => -(d.up24.pct === null ? -1 : d.up24.pct), last: (d) => -d.lastSeen,
    }[S.sort.k];
    list.sort((a, b) => {
      const x = key(a), y = key(b);
      const c = x < y ? -1 : x > y ? 1 : a.label.localeCompare(b.label);
      return c * S.sort.dir;
    });
    $count.textContent = list.length + ' of ' + S.state.devices.length;
    clear($rows);
    if (!list.length) {
      $rows.appendChild(el('tr', {}, el('td', { colspan: 6, class: 'empty', text: S.state.devices.length ? 'No devices match.' : 'Nothing found yet. The first scan runs shortly after start.' })));
      return;
    }
    const now = Date.now();
    list.forEach((d) => {
      const bar = d.up24.pct === null ? el('span', { class: 'muted', text: '--' }) : el('div', { class: 'upbar' }, [
        el('div', { class: 'track' }, el('div', { class: 'fill', 'data-w': Math.round(d.up24.pct * 100) })),
        el('span', { class: 'pct', text: pct(d.up24.pct) }),
      ]);
      const tr = el('tr', { class: (d.online ? '' : 'off ') + (S.sel === d.mac ? 'sel' : ''), tabindex: 0, onclick: () => openDrawer(d.mac), onkeydown: (e) => { if (e.key === 'Enter') openDrawer(d.mac); } }, [
        el('td', {}, el('i', { class: 'dot ' + (d.online ? 'ok' : '') })),
        el('td', {}, el('div', { class: 'name' }, el('div', {}, [
          el('div', { class: 't' }, [d.label || d.ip, d.known ? null : el('span', { class: 'chip new', text: 'new' }), d.role !== 'device' ? el('span', { class: 'chip', text: d.role === 'gateway' ? 'gateway' : 'this app' }) : null]),
          el('div', { class: 's', text: d.name ? (d.hostname || d.vendor || '') : (d.vendor && d.label !== d.vendor ? d.vendor : d.random ? 'Private address' : '') }),
        ]))),
        el('td', { class: 'tcell hide-m', text: TYPE_LABEL[d.type] || d.type }),
        el('td', { class: 'num hide-m', text: d.ip || '--' }),
        el('td', {}, bar),
        el('td', { class: 'num hide-m', text: d.online ? 'now' : ago(d.lastSeen, now) }),
      ]);
      $rows.appendChild(tr);
    });
    // widths are set through the CSSOM (inline style attributes are blocked by the CSP)
    $rows.querySelectorAll('.fill').forEach((f) => { f.style.width = f.dataset.w + '%'; });
  }

  // ---------- drawer ----------
  let drawerGen = 0;
  async function openDrawer(mac) {
    S.sel = mac;
    if (S.scene) S.scene.select(mac);
    $drawer.classList.add('open');
    if (S.route === 'devices') paintDevices();
    await refreshDrawer(false);
  }
  function closeDrawer(quiet) {
    S.sel = null; S.detail = null;
    if ($drawer) $drawer.classList.remove('open');
    if (S.scene && !quiet) S.scene.select(undefined);
    if (S.route === 'devices' && !quiet) paintDevices();
  }
  async function refreshDrawer(soft) {
    const mac = S.sel, gen = ++drawerGen;
    if (!mac) return;
    try {
      const d = await api('GET', '/api/devices/' + encodeURIComponent(mac));
      if (gen !== drawerGen || S.sel !== mac) return;
      // do not clobber what the person is typing during a background refresh
      if (soft && $drawer.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { S.detail = d; return; }
      S.detail = d;
      paintDrawer(d);
    } catch (e) { if (!soft) { toast(e.message); closeDrawer(); } }
  }
  function paintDrawer(data) {
    const d = data.device;
    clear($drawer);
    const name = el('input', { class: 'input', value: d.name, placeholder: d.hostname || d.vendor || 'Give it a name', maxlength: 40 });
    const type = el('select', { class: 'input' }, [el('option', { value: '', text: 'Auto (' + (TYPE_LABEL[d.typeAuto] || d.typeAuto) + ')' })]
      .concat((S.state.types || []).map((t) => el('option', { value: t, text: TYPE_LABEL[t] || t }))));
    type.value = d.typeSet || '';
    const tags = [...new Set(S.state.devices.map((x) => x.group).filter(Boolean))].sort();
    const dl = el('datalist', { id: 'tagList' }, tags.map((t) => el('option', { value: t })));
    const grp = el('input', { class: 'input', list: 'tagList', maxlength: 24, value: d.group || '', placeholder: 'Kitchen, Alex, Shop...' });
    const notes = el('textarea', { class: 'input', maxlength: 300, placeholder: 'Where it lives, who uses it...' });
    notes.value = d.notes || '';
    const known = el('input', { type: 'checkbox', checked: d.known });
    const hidden = el('input', { type: 'checkbox', checked: d.hidden });
    const save = el('button', { class: 'btn primary', text: 'Save', onclick: async () => {
      try {
        await api('PATCH', '/api/devices/' + encodeURIComponent(d.mac), { name: name.value, type: type.value, notes: notes.value, known: known.checked, hidden: hidden.checked, group: grp.value });
        toast('Saved');
        await refresh();
        await refreshDrawer(false);
      } catch (e) { toast(e.message); }
    } });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    const forget = el('button', { class: 'btn danger sm', text: 'Forget device', onclick: async () => {
      if (!window.confirm('Forget ' + d.label + '? Its history is removed. It comes back as new if it connects again.')) return;
      try { await api('DELETE', '/api/devices/' + encodeURIComponent(d.mac)); closeDrawer(); toast('Forgotten'); refresh(); } catch (e) { toast(e.message); }
    } });

    $drawer.appendChild(el('div', { class: 'dh' }, [
      el('div', {}, [el('div', { class: 'eyebrow', text: TYPE_LABEL[d.type] || d.type }), el('h2', { text: d.label || d.ip })]),
      el('button', { class: 'x', 'aria-label': 'Close', text: '×', onclick: () => closeDrawer() }),
    ]));
    const body = el('div', { class: 'db' });
    body.appendChild(el('div', { class: 'row' }, [
      el('i', { class: 'dot ' + (d.online ? 'ok' : '') }),
      el('span', { text: d.online ? 'Online for ' + dur(Date.now() - d.since) : 'Offline, last seen ' + ago(d.lastSeen) }),
    ]));
    const strip = el('div', { class: 'sec' });
    body.appendChild(el('div', { class: 'eyebrow sec', text: 'Last 24 hours' }));
    body.appendChild(strip);
    body.appendChild(el('dl', { class: 'kv' }, [
      el('dt', { text: 'Uptime 24h' }), el('dd', { text: pct(d.up24.pct) }),
      el('dt', { text: 'Uptime 7d' }), el('dd', { text: pct(d.up7.pct) }),
      el('dt', { text: 'IP' }), el('dd', { text: d.ip || '--' }),
      el('dt', { text: 'MAC' }), el('dd', { text: d.mac }),
      el('dt', { text: 'Maker' }), el('dd', { text: d.vendor || (d.random ? 'Private address' : 'Unknown') }),
      el('dt', { text: 'Hostname' }), el('dd', { text: d.hostname || '--' }),
      el('dt', { text: 'First seen' }), el('dd', { text: clock(d.firstSeen) }),
    ]));
    if (d.random) body.appendChild(el('p', { class: 'note', text: 'This device uses a private (randomized) Wi-Fi address. Phones may show up as a new device if they rotate it. Turn off "Private Wi-Fi address" for this network on the phone to keep one stable entry.' }));
    body.appendChild(el('div', { class: 'eyebrow sec', text: 'Name it' }));
    body.appendChild(el('label', { class: 'f' }, [name]));
    body.appendChild(el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'Type' }), type]));
    body.appendChild(el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'Tag (room or owner)' }), grp, dl]));
    body.appendChild(el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'Notes' }), notes]));
    body.appendChild(el('label', { class: 'switch' }, [known, el('span', { text: 'I recognize this device' })]));
    body.appendChild(el('p'));
    body.appendChild(el('label', { class: 'switch' }, [hidden, el('span', { text: 'Hide from the 3D view and lists' })]));
    body.appendChild(el('p'));
    body.appendChild(el('div', { class: 'row between' }, [save, d.role === 'device' ? forget : null]));
    body.appendChild(el('div', { class: 'eyebrow sec', text: 'Recent sessions' }));
    const list = el('div', { class: 'list' });
    if (!data.sessions.length) list.appendChild(el('div', {}, ['No sessions yet']));
    data.sessions.slice(0, 12).forEach((s) => {
      list.appendChild(el('div', {}, [clock(s.start), el('b', { text: s.end ? dur(s.end - s.start) : 'online now' })]));
    });
    body.appendChild(list);
    if (data.events.length) {
      body.appendChild(el('div', { class: 'eyebrow sec', text: 'Activity' }));
      const ev = el('div', { class: 'list' });
      data.events.slice(0, 10).forEach((e) => ev.appendChild(el('div', {}, [e.msg, el('b', { text: clock(e.t) })])));
      body.appendChild(ev);
    }
    $drawer.appendChild(body);
    if (window.CSCharts) {
      const now = Date.now();
      window.CSCharts.strip(strip, { from: now - 86400e3, to: now, sessions: data.sessions.map((s) => [s.start, s.end === null ? now : s.end]), watch: [[now - 86400e3, now]] });
    }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sel) closeDrawer(); });

  // ---------- charts ----------
  let $chartRoot;
  function renderCharts() {
    $view.className = 'view';
    const seg = el('div', { class: 'seg' }, ['24h', '7d', '30d'].map((r) => el('button', { 'data-r': r, class: S.range === r ? 'on' : '', text: r, onclick: () => { S.range = r; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.r === r)); loadCharts(); } })));
    $view.appendChild(el('div', { class: 'toolbar' }, [el('div', {}, [el('h1', { text: 'Charts' }), el('p', { class: 'sub', text: 'How busy the network is, how the internet is holding up, and who was around.' })]), el('div', { class: 'spacer' }), seg]));
    $chartRoot = el('div', { class: 'stack' });
    $view.appendChild($chartRoot);
    loadCharts();
  }
  let chartGen = 0, resizeT = 0;
  async function loadCharts() {
    const gen = ++chartGen;
    try {
      const h = await api('GET', '/api/history?range=' + S.range);
      if (gen !== chartGen || S.route !== 'charts') return;
      S.history = h;
      paintCharts();
    } catch (e) { if ($chartRoot) { clear($chartRoot).appendChild(el('div', { class: 'card', text: e.message })); } }
  }
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (S.route === 'charts' && S.history) paintCharts(); }, 150); });
  function paintCharts() {
    const h = S.history, C = window.CSCharts;
    if (!h || !C || !$chartRoot) return;
    clear($chartRoot);
    const span = h.to - h.from;
    const card = (title, desc, kids) => el('section', { class: 'card' }, [el('h2', { text: title }), desc ? el('p', { class: 'desc', text: desc }) : null].concat(kids));
    const stat = (k, v, u) => el('div', { class: 'stat' }, [el('div', { class: 'v' }, [String(v), u ? el('small', { text: u }) : null]), el('div', { class: 'k', text: k })]);

    // devices online
    const c1 = el('div');
    $chartRoot.appendChild(card('Devices online', 'Average number of devices connected over time.', [c1]));
    C.line(c1, { from: h.from, to: h.to, series: [{ pts: h.online, area: true }], yMin: 0, label: 'Devices online', tip: (t, v) => [clock(t), Math.round(v * 10) / 10 + ' devices'] });

    // internet
    const w = h.wanStats, c2 = el('div');
    $chartRoot.appendChild(card('Internet latency', 'Round-trip time to the public internet, measured from this app. Shaded area is the min to max in each interval.', [
      el('div', { class: 'stats' }, [stat('Average', w.avg === null ? '--' : w.avg, 'ms'), stat('95th percentile', w.p95 === null ? '--' : w.p95, 'ms'), stat('Slowest', w.max === null ? '--' : w.max, 'ms'), stat('Lost checks', w.lossPct === null ? '--' : w.lossPct, '%')]),
      c2,
    ]));
    C.line(c2, {
      from: h.from, to: h.to, series: [{ pts: h.wan.map((p) => [p[0], p[1]]) }, { pts: h.wan.map((p) => [p[0], p[5]]), cls: 'faint' }],
      band: h.wan.map((p) => [p[0], p[2], p[3]]), yMin: 0, label: 'Internet latency', tip: (t, v) => [clock(t), Math.round(v) + ' ms'],
    });

    // presence
    const devs = h.devices.filter((d) => d.monitoredMs > 0 && (d.onlineMs > 0 || d.online)).sort((a, b) => (b.pct || 0) - (a.pct || 0));
    const c3 = el('div');
    $chartRoot.appendChild(card('Presence', 'Each row is a device. Filled blocks are the times it was connected. Gaps in monitoring are not counted against anyone.', [c3]));
    C.timeline(c3, { from: h.from, to: h.to, watch: h.watch, rows: devs.map((d) => ({ label: d.label, sessions: d.sessions, pct: d.pct, online: d.online })), onRow: (r) => { const m = devs.find((d) => d.label === r.label); if (m) { S.sel = null; location.hash = '#/devices'; setTimeout(() => openDrawer(m.mac), 50); } } });

    // time online
    const c4 = el('div');
    $chartRoot.appendChild(card('Time online', 'Share of monitored time each device was connected. This is time, not data used. See the note below.', [c4]));
    C.bars(c4, { rows: devs.slice(0, 20).map((d) => ({ label: d.label, value: d.pct || 0, text: pct(d.pct) + ' / ' + dur(d.onlineMs), off: !d.online })) });
    $chartRoot.appendChild(el('div', { class: 'callout', text: 'About data usage: the Starlink router does not report how much data each device uses, so Constellation cannot show it. Usage here means time online and session history. Monitoring is passive, so nothing on your network is changed.' }));

    // activity
    const ev = el('div', { class: 'events' });
    if (!h.events.length) ev.appendChild(el('div', {}, [el('span'), el('span'), el('span', { class: 'muted', text: 'Nothing happened in this period.' })]));
    h.events.slice(0, 60).forEach((e) => ev.appendChild(el('div', {}, [el('span', { class: 'when', text: clock(e.t) }), el('span', { class: 'kind ' + e.kind, text: e.kind }), el('span', { text: e.msg }) ])));
    $chartRoot.appendChild(card('Activity', null, [ev]));
    void span;
  }

  // ---------- speed ----------
  let sp = {};
  function renderSpeed() {
    $view.className = 'view';
    sp = {};
    sp.hero = el('div', { class: 'speed-hero' });
    sp.btn = el('button', { class: 'btn primary', text: 'Run speed test', onclick: async () => { try { await api('POST', '/api/speedtest'); } catch (e) { toast(e.message); } refresh(); } });
    const sched = el('select', { class: 'input sched', 'aria-label': 'Automatic speed tests' }, [[0, 'Off'], [3, 'Every 3 hours'], [6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Every day']].map(([v, t]) => el('option', { value: v, text: t })));
    sched.value = String(S.state.settings.speedEveryHours || 0);
    sched.addEventListener('change', async () => { try { await api('PUT', '/api/settings', { speedEveryHours: +sched.value }); toast('Saved'); } catch (e) { toast(e.message); } });
    sp.chart = el('div');
    sp.table = el('div', { class: 'list' });
    const seg = el('div', { class: 'seg' }, ['24h', '7d', '30d'].map((r) => el('button', { 'data-r': r, class: (S.speedRange || '7d') === r ? 'on' : '', text: r, onclick: () => { S.speedRange = r; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.r === r)); loadSpeedChart(); } })));
    $view.appendChild(el('h1', { text: 'Speed' }));
    $view.appendChild(el('p', { class: 'sub', text: 'Measured from this app to the internet, so it reflects the link your Umbrel itself gets.' }));
    $view.appendChild(el('div', { class: 'stack' }, [
      el('section', { class: 'card' }, [sp.hero, el('div', { class: 'row' }, [sp.btn, el('label', { class: 'row' }, [el('span', { class: 'eyebrow', text: 'Automatic' }), sched])])]),
      el('section', { class: 'card' }, [el('div', { class: 'row between' }, [el('h2', { text: 'History' }), seg]), el('p', { class: 'desc', text: 'Download is the filled line, upload the green one.' }), sp.chart]),
      el('section', { class: 'card' }, [el('h2', { text: 'Recent tests' }), sp.table]),
      el('div', { class: 'callout', text: 'A test uses as much data as your connection can move for about 14 seconds, so a fast link can use a few hundred MB. Other devices streaming during a test lower the result. Internet latency checks pause while a test runs. Speeds come from Cloudflare\'s public test servers.' }),
    ]));
    paintSpeed();
    loadSpeedChart();
  }
  function paintSpeed() {
    if (!sp.hero || !S.state) return;
    const st = S.state.speed || { results: [] };
    const last = st.results[st.results.length - 1];
    clear(sp.hero);
    sp.btn.disabled = !!st.running;
    sp.btn.textContent = st.running ? 'Testing...' : 'Run speed test';
    const big = (v, u, k) => el('div', { class: 'stat' }, [el('div', { class: 'v' }, [v === null || v === undefined ? '--' : String(v), el('small', { text: u })]), el('div', { class: 'k', text: k })]);
    if (st.running) {
      const label = { ping: 'Checking latency', download: 'Download', upload: 'Upload' }[st.phase] || 'Starting';
      sp.hero.appendChild(el('div', { class: 'eyebrow', text: label }));
      sp.hero.appendChild(el('div', { class: 'big', text: st.mbps ? String(st.mbps) : '...' }));
      sp.hero.appendChild(el('div', { class: 'muted mono', text: 'Mbps' }));
    } else if (last && last.error) {
      sp.hero.appendChild(el('div', { class: 'eyebrow', text: ago(last.t) }));
      sp.hero.appendChild(el('p', { class: 'err', text: last.error }));
    } else if (last) {
      sp.hero.appendChild(el('div', { class: 'eyebrow', text: 'Last test / ' + ago(last.t) }));
      sp.hero.appendChild(el('div', { class: 'big' }, [String(last.down), el('small', { text: 'Mbps down' })]));
      sp.hero.appendChild(el('div', { class: 'stats' }, [big(last.up, 'Mbps', 'Upload'), big(last.ping, 'ms', 'Latency'), big(last.jitter, 'ms', 'Jitter')]));
    } else {
      sp.hero.appendChild(el('div', { class: 'eyebrow', text: 'No tests yet' }));
      sp.hero.appendChild(el('p', { class: 'muted', text: 'Run one to see your download, upload and latency.' }));
    }
    clear(sp.table);
    const rows = st.results.slice().reverse().slice(0, 10);
    if (!rows.length) sp.table.appendChild(el('div', {}, ['Nothing yet']));
    rows.forEach((r) => sp.table.appendChild(el('div', {}, [clock(r.t), r.error ? el('b', { text: 'failed' }) : el('b', { text: '↓ ' + r.down + '  ↑ ' + r.up + ' Mbps / ' + r.ping + ' ms' })])));
    if (sp.lastN !== st.results.length) { sp.lastN = st.results.length; loadSpeedChart(); }
  }
  async function loadSpeedChart() {
    if (!sp.chart || !window.CSCharts) return;
    try {
      const h = await api('GET', '/api/history?range=' + (S.speedRange || '7d'));
      if (S.route !== 'speed') return;
      const ok = h.speed.filter((r) => !r.error);
      window.CSCharts.line(sp.chart, {
        from: h.from, to: h.to, label: 'Speed history', yMin: 0,
        series: [{ pts: ok.map((r) => [r.t, r.down]), area: true }, { pts: ok.map((r) => [r.t, r.up]), cls: 'alt' }],
        tip: (t, v) => [clock(t), Math.round(v) + ' Mbps'],
      });
    } catch (e) { /* leave the chart empty */ }
  }

  // ---------- settings ----------
  let setLive = null;
  function renderSettings() {
    $view.className = 'view';
    const st = S.state;
    $view.appendChild(el('h1', { text: 'Settings' }));
    $view.appendChild(el('p', { class: 'sub', text: 'Constellation ' + st.version + ' / monitoring only' }));
    const wrap = el('div', { class: 'stack' });
    $view.appendChild(wrap);

    // theme
    const tg = el('div', { class: 'themes' }, THEMES.map((t) => {
      const sw = el('div', { class: 'sw', 'data-bg': t.c[0], 'data-fg': t.c[1] });
      sw.style.background = t.c[0];
      const dot = el('i'); dot.style.cssText = 'width:10px;height:10px;left:14px;top:14px;background:' + t.c[1];
      sw.appendChild(dot);
      const b = el('button', { class: 'theme' + (document.documentElement.getAttribute('data-theme') === t.id ? ' on' : ''), onclick: () => { setTheme(t.id); tg.querySelectorAll('.theme').forEach((x) => x.classList.toggle('on', x === b)); } }, [sw, el('div', { class: 'nm', text: t.name })]);
      return b;
    }));
    wrap.appendChild(el('section', { class: 'card' }, [el('h2', { text: 'Look' }), el('p', { class: 'desc', text: 'Five looks, including a light one. Your pick is remembered on this device.' }), tg]));

    // scanning
    const s0 = st.settings;
    const interval = el('input', { class: 'input', type: 'number', min: 15, max: 300, value: s0.scanIntervalSec });
    const grace = el('input', { class: 'input', type: 'number', min: 60, max: 1800, value: s0.offlineAfterSec });
    const subnets = el('input', { class: 'input', placeholder: 'Automatic', value: (s0.subnets || []).join(', ') });
    const names = el('input', { type: 'checkbox', checked: s0.resolveNames });
    const msg = el('p', { class: 'err' });
    setLive = el('dl', { class: 'status-grid' });
    wrap.appendChild(el('section', { class: 'card' }, [
      el('h2', { text: 'Scanning' }),
      el('p', { class: 'desc', text: 'Constellation looks for devices on your local network, then tracks when each one comes and goes.' }),
      setLive,
      el('p'),
      el('div', { class: 'grid2' }, [
        el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'Scan every (seconds)' }), interval]),
        el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'Mark offline after (seconds)' }), grace]),
      ]),
      el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'Network override (optional)' }), subnets]),
      el('p', { class: 'note', text: 'Leave empty to detect the network automatically. Example: 192.168.1.0/24. Phones that sleep need a longer offline delay.' }),
      el('label', { class: 'switch' }, [names, el('span', { text: 'Look up device names on the network' })]),
      msg,
      el('div', { class: 'row' }, [
        el('button', { class: 'btn primary', text: 'Save', onclick: async () => {
          msg.textContent = '';
          try {
            await api('PUT', '/api/settings', { scanIntervalSec: +interval.value, offlineAfterSec: +grace.value, resolveNames: names.checked, subnets: subnets.value.split(',').map((x) => x.trim()).filter(Boolean) });
            toast('Settings saved'); refresh();
          } catch (e) { msg.textContent = e.message; }
        } }),
        el('button', { class: 'btn', text: 'Scan now', onclick: async () => { await api('POST', '/api/scan'); toast('Scan started'); } }),
      ]),
    ]));

    // notifications
    const n0 = s0.ntfy || {};
    const nOn = el('input', { type: 'checkbox', checked: n0.enabled });
    const nSrv = el('input', { class: 'input', value: n0.server || 'https://ntfy.sh' });
    const nTop = el('input', { class: 'input', value: n0.topic || '', placeholder: 'a-long-random-topic-name' });
    const nMsg = el('p', { class: 'err' });
    wrap.appendChild(el('section', { class: 'card' }, [
      el('h2', { text: 'New device alerts' }),
      el('p', { class: 'desc', text: 'Get a push message through ntfy when an unfamiliar device joins. The topic acts like a password, so make it long and random.' }),
      el('label', { class: 'switch' }, [nOn, el('span', { text: 'Send alerts' })]),
      el('p'),
      el('div', { class: 'grid2' }, [
        el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'Server' }), nSrv]),
        el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'Topic' }), nTop]),
      ]),
      nMsg,
      el('div', { class: 'row' }, [
        el('button', { class: 'btn primary', text: 'Save', onclick: async () => {
          nMsg.textContent = '';
          try { await api('PUT', '/api/settings', { ntfy: { enabled: nOn.checked, server: nSrv.value, topic: nTop.value } }); toast('Saved'); refresh(); } catch (e) { nMsg.textContent = e.message; }
        } }),
        el('button', { class: 'btn', text: 'Send test', onclick: async () => { nMsg.textContent = ''; try { await api('POST', '/api/notify-test'); toast('Test sent'); } catch (e) { nMsg.textContent = e.message; } } }),
      ]),
    ]));

    // security
    if (!(S.auth && S.auth.noAuth)) {
      const cur = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
      const nw = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
      const pm = el('p', { class: 'err' });
      wrap.appendChild(el('section', { class: 'card' }, [
        el('h2', { text: 'Password' }),
        el('p', { class: 'desc', text: 'Changing it signs out other devices and issues a new recovery code.' }),
        el('div', { class: 'grid2' }, [
          el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'Current' }), cur]),
          el('label', { class: 'f' }, [el('span', { class: 'eyebrow', text: 'New (8+ characters)' }), nw]),
        ]),
        pm,
        el('div', { class: 'row' }, [
          el('button', { class: 'btn primary', text: 'Change password', onclick: async () => {
            pm.textContent = '';
            try { const r = await api('POST', '/api/auth/password', { current: cur.value, password: nw.value }); cur.value = nw.value = ''; showRecovery(r.recoveryCode); } catch (e) { pm.textContent = e.message; }
          } }),
          el('button', { class: 'btn', text: 'Sign out', onclick: async () => { await api('POST', '/api/auth/logout'); S.authed = false; S.auth = await api('GET', '/api/auth/status'); showAuth('login'); } }),
        ]),
      ]));
    }

    // data
    const file = el('input', { type: 'file', accept: 'application/json,.json', class: 'hidden', onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (!window.confirm('Importing replaces everything Constellation currently knows. Continue?')) { file.value = ''; return; }
      try { const r = await api('POST', '/api/import', JSON.parse(await f.text())); toast('Imported ' + r.devices + ' devices'); refresh(); } catch (ex) { toast(ex.message); }
      file.value = '';
    } });
    wrap.appendChild(el('section', { class: 'card' }, [
      el('h2', { text: 'Your data' }),
      el('p', { class: 'desc', text: 'Everything stays on this device, in the app data folder. Nothing is sent anywhere except the optional alerts above.' }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn', text: 'Export backup', onclick: async () => {
          try {
            const res = await fetch('/api/export', { headers: { 'X-CS-Request': '1' }, credentials: 'same-origin' });
            if (!res.ok) throw new Error('Export failed');
            const url = URL.createObjectURL(await res.blob());
            const a = el('a', { href: url, download: 'constellation-backup-' + new Date().toISOString().slice(0, 10) + '.json' });
            document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
          } catch (e) { toast(e.message); }
        } }),
        el('button', { class: 'btn', text: 'Import backup', onclick: () => file.click() }), file,
        el('button', { class: 'btn danger', text: 'Clear history', onclick: async () => {
          if (!window.confirm('Delete all sessions, charts and activity? Device names are kept.')) return;
          await api('POST', '/api/clear-history'); toast('History cleared'); refresh();
        } }),
      ]),
    ]));

    // about
    wrap.appendChild(el('section', { class: 'card' }, [
      el('h2', { text: 'About' }),
      el('p', { class: 'desc', text: 'Constellation watches your local network and shows it as a live 3D map. It finds devices by asking the network who is there (ARP and name lookups). It cannot block devices, set schedules, or see how much data each one uses, because the stock Starlink router does not allow that. Devices with private Wi-Fi addresses can appear as new when the address rotates.' }),
      el('p', { class: 'note', text: 'Independent hobby project by PatriotCrypto. Not affiliated with, endorsed by, or sponsored by Starlink, SpaceX, or Umbrel. Maker names come from the public IEEE registry. 3D by three.js (MIT).' }),
    ]));
    paintSettingsLive();
  }
  function paintSettingsLive() {
    if (!setLive || !S.state) return;
    const st = S.state, n = st.network || {}, sc = st.scanner, now = Date.now();
    clear(setLive);
    const row = (k, v) => { setLive.appendChild(el('dt', { text: k })); setLive.appendChild(el('dd', { text: v })); };
    row('Network', n.ok ? (n.cidrs || []).join(', ') + ' via ' + (n.iface || '?') + (n.source ? ' (' + n.source + ')' : '') : (n.error || 'not detected'));
    row('Gateway', n.gateway || '--');
    row('Last scan', sc.lastScanAt ? ago(sc.lastScanAt, now) + (sc.lastScanMs ? ' / took ' + (sc.lastScanMs / 1000).toFixed(1) + ' s' : '') : 'pending');
    row('Status', sc.scanning ? 'Scanning now' : sc.lastError ? sc.lastError : 'Healthy');
    row('Devices', st.summary.online + ' online / ' + st.summary.total + ' total');
  }

  // ---------- launch show banner (seven taps on the gateway) ----------
  function showBanner() {
    if (document.querySelector('.show-banner')) return;
    const msgs = ['Starlink train overhead', 'Launch sequence: go', 'Liftoff', 'All systems nominal'];
    const b = el('div', { class: 'show-banner', 'aria-hidden': 'true', text: msgs[0] });
    document.body.appendChild(b);
    let i = 0;
    const t = setInterval(() => { i++; if (i < msgs.length) b.textContent = msgs[i]; }, 3600);
    setTimeout(() => { clearInterval(t); b.remove(); }, 15200);
  }

  // ---------- easter egg ----------
  (function egg() {
    const seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let k = 0, typed = '', running = false;
    document.addEventListener('keydown', (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return;
      k = e.key === seq[k] ? k + 1 : (e.key === seq[0] ? 1 : 0);
      typed = (typed + e.key.toLowerCase()).slice(-6);
      if (k === seq.length || typed === 'launch') { k = 0; typed = ''; go(); }
    });
    function go() {
      if (running || !S.authed) return;
      running = true;
      if (S.route !== 'network') location.hash = '#/network';
      setTimeout(() => {
        let n = 5;
        const num = el('div', { class: 'n', text: 'T-' + n });
        const ov = el('div', { class: 'launch', 'aria-hidden': 'true' }, [el('div', {}, [num, el('div', { class: 'l', text: 'All devices nominal' })])]);
        document.body.appendChild(ov);
        const t = setInterval(() => {
          n--;
          if (n > 0) { num.textContent = 'T-' + n; return; }
          clearInterval(t);
          num.textContent = 'Liftoff';
          if (S.scene && S.scene.liftoff) S.scene.liftoff();
          setTimeout(() => { ov.remove(); running = false; }, 2200);
        }, 1000);
      }, 150);
    }
  })();

  // ---------- boot ----------
  (async function init() {
    try {
      S.auth = await api('GET', '/api/auth/status');
      if (S.auth.authed || S.auth.noAuth) { S.authed = true; return enter(); }
      showAuth();
    } catch (e) {
      $app.appendChild(el('div', { class: 'gate' }, el('div', { class: 'box' }, [el('h1', { text: 'Cannot reach Constellation' }), el('p', { text: e.message })])));
    }
  })();
})();
