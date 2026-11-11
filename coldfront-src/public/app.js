(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var S = null;            // latest /api/state
  var sched = null;        // editable schedule copy
  var curDay = 'mon';
  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var LBL = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
  var pending = null, pendSaving = false, pendTimer = null, range = 24, activeTab = 'dashboard', schedDirty = false, settingsLoaded = false;
  var INS = null, EVT = null;
  var FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, Roboto, sans-serif';
  var THEMES = {
    dark: { heat: '#ffb347', cool: '#5fd0ff', ink: '#ffffff', mute: 'rgba(255,255,255,.62)', faint: 'rgba(255,255,255,.38)', grid: 'rgba(255,255,255,.08)', grid2: 'rgba(255,255,255,.05)', lane: 'rgba(255,255,255,.07)', dialTrack: 'rgba(255,255,255,.12)', dialBand: 'rgba(255,255,255,.3)', fillTop: 'rgba(255,255,255,.22)', fillBot: 'rgba(255,255,255,0)', halo: 'rgba(255,255,255,.3)', hover: 'rgba(255,255,255,.4)', pillFg: '#08203f', tipBg: 'rgba(10,24,50,.96)', tipEdge: 'rgba(255,255,255,.2)', tipText: '#ffffff', base: 'rgba(255,255,255,.12)' },
    light: { heat: '#e07a00', cool: '#1388d4', ink: '#0f2440', mute: 'rgba(15,36,64,.66)', faint: 'rgba(15,36,64,.42)', grid: 'rgba(15,36,64,.09)', grid2: 'rgba(15,36,64,.05)', lane: 'rgba(15,36,64,.08)', dialTrack: 'rgba(15,36,64,.10)', dialBand: 'rgba(31,111,255,.22)', fillTop: 'rgba(31,111,255,.20)', fillBot: 'rgba(31,111,255,0)', halo: 'rgba(31,111,255,.25)', hover: 'rgba(15,36,64,.4)', pillFg: '#ffffff', tipBg: 'rgba(255,255,255,.97)', tipEdge: 'rgba(15,36,64,.18)', tipText: '#0f2440', base: 'rgba(15,36,64,.14)' }
  };
  ['umbrel', 'aurora', 'dusk', 'graphite'].forEach(function (k) { THEMES[k] = THEMES.dark; });
  var THEME_LIST = [
    { id: 'light', name: 'Daylight', a: '#7cc4ff', b: '#ffd3a1', c: '#c3b3ff', bg: '#e6f1ff' },
    { id: 'dark', name: 'Midnight', a: '#2f6bff', b: '#27b9ff', c: '#7a4dff', bg: '#07112a' },
    { id: 'umbrel', name: 'Umbrel', a: '#6a4dff', b: '#c04dff', c: '#3d9bff', bg: '#120c2e' },
    { id: 'aurora', name: 'Aurora', a: '#14e0b0', b: '#3d7bff', c: '#a64dff', bg: '#04201f' },
    { id: 'dusk', name: 'Dusk', a: '#ff6a3d', b: '#ff3d8b', c: '#8a3dff', bg: '#26101f' },
    { id: 'graphite', name: 'Graphite', a: '#5b6478', b: '#3d63d9', c: '#7a7a8c', bg: '#121217' }
  ];
  var COL = {};
  function applyTheme(t) {
    if (!THEMES[t]) t = 'light';
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', (THEME_LIST.filter(function (x) { return x.id === t; })[0] || THEME_LIST[1]).bg);
    Object.keys(THEMES[t]).forEach(function (k) { COL[k] = THEMES[t][k]; });
    COL.text = COL.ink;
  }
  applyTheme(document.documentElement.getAttribute('data-theme'));

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600); }
  var PEND = {};
  function api(method, url, body) {
    var o = { method: method, headers: {} };
    if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    else if (method !== 'GET') { o.headers['Content-Type'] = 'application/json'; o.body = '{}'; }
    return fetch(url, o).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); });
  }
  function fmtT(v) { return v == null ? '--' : String(Math.round(v * 10) / 10).replace(/\.0$/, ''); }
  function fmtTime(hhmm) { var p = hhmm.split(':'), h = +p[0]; return ((h % 12) || 12) + ':' + p[1] + (h < 12 ? ' AM' : ' PM'); }
  function fmtClock(iso) { var d = new Date(iso); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function hrs1(min) { return (Math.round(min / 6) / 10) + ' h'; }

  // ---- tabs
  var TITLES = { dashboard: 'Dashboard', schedule: 'Comfort', rooms: 'Rooms', insights: 'Insights', settings: 'Settings' };
  $$('.tabs button').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });
  function showTab(t) {
    if (t !== 'dashboard' && editing) stopEdit();
    activeTab = t;
    $$('.tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === t); });
    $$('.tab').forEach(function (s) { s.classList.toggle('active', s.id === 'tab-' + t); });
    $('#pageTitle').textContent = TITLES[t];
    $('#hero').hidden = t !== 'dashboard'; $('#pagehead').hidden = t === 'dashboard';
    document.body.classList.toggle('onDash', t === 'dashboard');
    greet();
    window.scrollTo(0, 0);
    if (t === 'dashboard') setTimeout(function () { if (inst.chart) inst.chart.chart.draw(); }, 0);
    if (t === 'schedule' && !sched) loadSchedule();
    if (t === 'insights') loadInsights();
    if (t === 'settings') fillSettings(true);
    if (t === 'rooms') renderRooms();
  }

  function greet() {
    var d = new Date(), h = d.getHours(), g = h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening';
    var n = S && S.settings && S.settings.name;
    $('#greet').textContent = g + (n ? ', ' + n : '') + '.';
    $('#heroDate').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  setInterval(greet, 60000);

  // ---- thermostat helpers
  function pair() { return pending || (S && S.desired ? { heat: S.desired.heat, cool: S.desired.cool } : (S && S.thermostat ? { heat: S.thermostat.heat, cool: S.thermostat.cool } : null)); }
  function dialSvg() {
    var t = S.thermostat, p = pair();
    var cx = 150, cy = 136, r = 108, a0 = 135, sweep = 270, lo = 50, hi = 90;
    function pt(v, rr) { var a = (a0 + sweep * (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * Math.PI / 180; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; }
    function arc(v1, v2, col, w) { var s = pt(v1, r), e = pt(v2, r), large = (v2 - v1) / (hi - lo) * sweep > 180 ? 1 : 0; return '<path d="M' + s[0].toFixed(1) + ' ' + s[1].toFixed(1) + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + e[0].toFixed(1) + ' ' + e[1].toFixed(1) + '" fill="none" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round"/>'; }
    var h = arc(lo, hi, COL.dialTrack, 14);
    if (p && p.heat < p.cool) h += arc(p.heat, p.cool, COL.dialBand, 14);
    if (p) { var m1 = pt(p.heat, r), m2 = pt(p.cool, r); h += '<circle cx="' + m1[0].toFixed(1) + '" cy="' + m1[1].toFixed(1) + '" r="11" fill="' + COL.heat + '" stroke="#fff" stroke-width="3"/><circle cx="' + m2[0].toFixed(1) + '" cy="' + m2[1].toFixed(1) + '" r="11" fill="' + COL.cool + '" stroke="#fff" stroke-width="3"/>'; }
    if (t && t.temp != null) { var c = pt(t.temp, r - 28); h += '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="5" fill="' + COL.ink + '"/>'; }
    var op = t ? ({ heating: 'Heating', cooling: 'Cooling', fan: 'Fan running', idle: 'Idle' }[t.opState] || '') : '';
    var opc = t && t.opState === 'heating' ? COL.heat : t && t.opState === 'cooling' ? COL.cool : COL.mute;
    h += '<text x="150" y="112" text-anchor="middle" font-size="15" font-weight="600" fill="' + opc + '">' + op + '</text>';
    h += '<text x="150" y="162" text-anchor="middle" font-size="58" font-weight="700" fill="' + COL.ink + '" letter-spacing="-2">' + fmtT(t && t.temp) + '°</text>';
    h += '<text x="150" y="188" text-anchor="middle" font-size="14" fill="' + COL.mute + '">' + (t && t.humidity != null ? Math.round(t.humidity) + '% humidity' + (function () { var L = humLevel(t.humidity); return L ? ' <tspan fill="' + L.c + '" font-weight="650">\u25CF ' + L.label + '</tspan>' : ''; })() : 'indoor') + '</text>';
    return '<svg viewBox="22 18 256 202" role="img" aria-label="Indoor temperature">' + h + '</svg>';
  }
  // Humidity: 30-50% is the comfortable range; inside your Settings floor/ceiling but outside that is "Fair"; beyond them is a problem.
  var WX = { data: null, at: 0, busy: false, loaded: false };
  function loadWeather(force) {
    if (WX.busy || (!force && Date.now() - WX.at < 5 * 60000)) return;
    WX.busy = true; WX.at = Date.now();
    api('GET', '/api/weather').then(function (w) { WX.data = w; WX.loaded = true; }).catch(function () { WX.loaded = true; }).then(function () { WX.busy = false; if (typeof updateWidgets === 'function') updateWidgets(); });
  }
  var HUMC = { good: '#34c98a', fair: '#f0b429', bad: '#ef5b5b' };
  function humLevel(h) {
    if (h == null) return null;
    var lim = (S && S.settings && S.settings.humidity) || { min: 25, max: 60 };
    if (h < lim.min) return { k: 'dry', label: 'Too dry', c: HUMC.bad, tip: 'Below your ' + lim.min + '% floor. Dry air feels cold and irritates skin and throat.' };
    if (h > lim.max) return { k: 'wet', label: 'Too humid', c: HUMC.bad, tip: 'Above your ' + lim.max + '% ceiling. Mold and dust mites thrive here.' };
    if (h >= 30 && h <= 50) return { k: 'good', label: 'Good', c: HUMC.good, tip: 'Comfortable range (30 to 50%).' };
    return { k: 'fair', label: h < 30 ? 'A bit dry' : 'A bit humid', c: HUMC.fair, tip: 'Acceptable, but outside the ideal 30 to 50% range.' };
  }
  function ranged() { return !S || !S.settings || S.settings.plan !== 'schedule'; }
  function saveRange() {
    clearTimeout(pendTimer);
    if (!pending) return;
    var p = pending, key = S.away ? 'away' : 'home', body = { comfort: {} };
    body.comfort[key] = { heat: p.heat, cool: p.cool };
    pendSaving = true; updateWidgets();
    api('PUT', '/api/settings', body).then(function (r) { S.settings = r.settings; pending = null; pendSaving = false; toast('Saved'); return refresh(); })
      .catch(function (e) { pending = null; pendSaving = false; toast(e.message); refresh(); });
  }
  function cancelPending() { clearTimeout(pendTimer); pending = null; updateWidgets(); }
  function sendHold(u) {
    clearTimeout(pendTimer);
    if (!pending) return;
    var p = pending, until = u === 'next' ? 'next' : (+u > 0 ? +u : null);
    api('POST', '/api/setpoints', { heat: p.heat, cool: p.cool, until: until }).then(function () { pending = null; toast('Hold set'); return refresh(); }).catch(function (e) { pending = null; toast(e.message); refresh(); });
  }
  function setModeAuto(btn) {
    if (btn) btn.disabled = true;
    PEND.mode = { v: 'auto', at: Date.now() };
    api('POST', '/api/mode', { mode: 'auto' }).then(function () { toast('Auto sent to thermostat'); setTimeout(refresh, 4000); setTimeout(refresh, 12000); }).catch(function (e) { delete PEND.mode; toast(e.message); }).then(function () { if (btn) btn.disabled = false; });
  }
  function markFilter() {
    api('POST', '/api/filter/changed', {}).then(function () { toast('Filter marked changed'); settingsLoaded = false; return refresh(); }).then(function () { if (activeTab === 'settings') fillSettings(true); }).catch(function (e) { toast(e.message); });
  }

  // ---- widgets
  var WIDGETS = {
    thermostat: {
      title: 'Thermostat', sizes: ['2x3', '4x3'],
      init: function (b) {
        b.innerHTML = '<div class="tstat"><div class="dial"></div><div class="tctl"><div class="status"></div><div class="stepgroup">' +
          '<div class="stepper heatc"><span class="lbl">Heat to</span><button data-step="heat" data-d="-1" aria-label="Heat down">−</button><b class="hv">--</b><button data-step="heat" data-d="1" aria-label="Heat up">+</button></div>' +
          '<div class="stepper coolc"><span class="lbl">Cool to</span><button data-step="cool" data-d="-1" aria-label="Cool down">−</button><b class="cv">--</b><button data-step="cool" data-d="1" aria-label="Cool up">+</button></div></div>' +
          '<div class="holdbar" hidden><span class="hbq">How long should this last?</span><button data-hold="next">Until next period</button><button data-hold="2">2 hours</button><button data-hold="8">8 hours</button><button data-hold="0">Until I cancel</button><button data-hold="x" class="hbx">Cancel</button></div>' +
          '<div class="savebar" hidden><span></span><button data-sv="x">Undo</button></div>' +
          '<div class="modewarn" hidden><span></span><button type="button">Switch to Auto</button></div>' +
          '<div class="holdinfo" hidden></div></div></div>';
        $$('[data-step]', b).forEach(function (btn) {
          btn.onclick = function () {
            var p = pair(); if (!p) return;
            p = { heat: p.heat, cool: p.cool };
            var k = btn.dataset.step, lim = S.settings.limits, gap = lim.minGap;
            p[k] += +btn.dataset.d;
            if (k === 'heat') { p.heat = Math.min(lim.heatMax, Math.max(lim.heatMin, p.heat)); if (p.cool < p.heat + gap) p.cool = Math.min(lim.coolMax, p.heat + gap); }
            else { p.cool = Math.min(lim.coolMax, Math.max(lim.coolMin, p.cool)); if (p.heat > p.cool - gap) p.heat = Math.max(lim.heatMin, p.cool - gap); }
            pending = p; updateWidgets();
            clearTimeout(pendTimer);
            // range mode: just save the new low/high shortly after the last tap. Schedule mode: wait until you pick how long.
            if (ranged()) pendTimer = setTimeout(saveRange, 900);
          };
        });
        $$('[data-hold]', b).forEach(function (btn) { btn.onclick = function () { if (btn.dataset.hold === 'x') return cancelPending(); sendHold(btn.dataset.hold === '0' ? null : btn.dataset.hold); }; });
        $('.savebar button', b).onclick = cancelPending;
        $('.modewarn button', b).onclick = function () { setModeAuto(this); };
      },
      update: function (b) {
        var t = S.thermostat, d = S.desired, p = pair();
        $('.dial', b).innerHTML = dialSvg();
        $('.hv', b).textContent = p ? p.heat + '°' : '--';
        $('.cv', b).textContent = p ? p.cool + '°' : '--';
        var st = '';
        if (!S.adapter.connected) st = 'Waiting for the Z-Wave server…';
        else if (!t) st = 'No thermostat paired yet';
        else if (S.away) st = 'Away' + (S.away.until ? ' until ' + fmtClock(S.away.until) : '');
        else if (d && ranged() && d.source === 'schedule') st = 'Keeps the house between ' + d.heat + '° and ' + d.cool + '°';
        else if (d && d.source === 'hold') st = 'Hold · ' + d.heat + '–' + d.cool + '°';
        else if (d) st = d.label + (S.next ? ' · next: ' + S.next.name + ' at ' + fmtClock(S.next.at) : '');
        if (S.away && t) st = 'Away · keeps ' + (S.away.heat) + '–' + (S.away.cool) + '°' + (S.away.until ? ' until ' + fmtClock(S.away.until) : '');
        if (d && d.adjust) st += ' · room-adjusted ' + (d.adjust > 0 ? '+' : '') + d.adjust + '°';
        $('.status', b).textContent = st;
        var rg = ranged();
        $('.heatc .lbl', b).textContent = rg ? 'Low' : 'Heat to'; $('.coolc .lbl', b).textContent = rg ? 'High' : 'Cool to';
        $('.holdbar', b).hidden = !pending || rg;
        var sv = $('.savebar', b);
        sv.hidden = !(pending && rg);
        $('span', sv).textContent = pendSaving ? 'Saving…' : 'Saving ' + (pending ? pending.heat + '–' + pending.cool + '°' : '') + ' for ' + (S.away ? 'Away' : 'Home') + '…';
        var mw = $('.modewarn', b);
        var wrongMode = !!t && (t.mode === 'heat' || t.mode === 'cool') && !PEND.mode;
        mw.hidden = !wrongMode;
        if (wrongMode) $('span', mw).textContent = 'Thermostat is in ' + (t.mode === 'heat' ? 'Heat' : 'Cool') + ' mode, so it will only ' + t.mode + '. Auto holds both the low and the high.';
        var hi = $('.holdinfo', b);
        if (S.hold && !pending) {
          hi.hidden = false;
          hi.innerHTML = '<span>Hold ' + S.hold.heat + '/' + S.hold.cool + (S.hold.until ? ' until ' + esc(fmtClock(S.hold.until)) : ' until cancelled') + '</span><button class="btn">' + (ranged() ? 'Back to my range' : 'Resume schedule') + '</button>';
          $('button', hi).onclick = function () { api('DELETE', '/api/hold').then(refresh).catch(function (e) { toast(e.message); }); };
        } else hi.hidden = true;
      }
    },
    controls: {
      title: 'Mode and fan', sizes: ['1x2', '2x1'],
      init: function (b) {
        b.innerHTML = '<div class="ctl"><div class="seg modeSeg" role="group" aria-label="Mode"><button data-mode="off">Off</button><button data-mode="heat">Heat</button><button data-mode="cool">Cool</button><button data-mode="auto">Auto</button></div>' +
          '<div class="seg fanSeg" role="group" aria-label="Fan"><button data-fan="auto">Fan auto</button><button data-fan="on">Fan on</button></div>' +
          '<button class="btn awayBtn">Away</button></div>';
        var ctl = function (kind, val) {
          PEND[kind] = { v: val, at: Date.now() };
          WIDGETS.controls.update(b);
          api('POST', '/api/' + kind, kind === 'mode' ? { mode: val } : { fan: val }).then(function () { toast((kind === 'mode' ? 'Mode ' : 'Fan ') + val + ' sent to thermostat'); setTimeout(refresh, 4000); setTimeout(refresh, 12000); }).catch(function (e) { delete PEND[kind]; WIDGETS.controls.update(b); toast(e.message); });
        };
        $$('[data-mode]', b).forEach(function (x) { x.onclick = function () { ctl('mode', x.dataset.mode); }; });
        $$('[data-fan]', b).forEach(function (x) { x.onclick = function () { ctl('fan', x.dataset.fan); }; });
        $('.awayBtn', b).onclick = function () { api('POST', '/api/away', { on: !S.away }).then(refresh).catch(function (e) { toast(e.message); }); };
      },
      update: function (b) {
        var t = S.thermostat;
        var cur = function (kind) {
          var p = PEND[kind], real = t && t[kind];
          if (p && (real === p.v || Date.now() - p.at > 30000)) { delete PEND[kind]; p = null; }
          return { v: p ? p.v : real, busy: !!p };
        };
        var m = cur('mode'), f = cur('fan');
        $$('[data-mode]', b).forEach(function (x) { x.classList.toggle('on', !!t && m.v === x.dataset.mode); x.classList.toggle('busy', m.busy && m.v === x.dataset.mode); });
        $$('[data-fan]', b).forEach(function (x) { x.classList.toggle('on', !!t && f.v === x.dataset.fan); x.classList.toggle('busy', f.busy && f.v === x.dataset.fan); });
        var a = $('.awayBtn', b); a.textContent = S.away ? 'Back home' : 'Away'; a.classList.toggle('on', !!S.away);
      }
    },
    nextup: {
      title: 'Schedule', sizes: ['2x1', '1x1'],
      init: function (b) { b.innerHTML = '<div class="kvgrid"></div>'; },
      update: function (b) {
        var d = S.desired, n = S.next, h;
        if (S.away) h = '<div class="kv"><span class="k">Now</span><b>Away</b></div>';
        else if (S.hold) h = '<div class="kv"><span class="k">Holding</span><b>' + S.hold.heat + '° / ' + S.hold.cool + '°</b></div>';
        else h = '<div class="kv"><span class="k">Now</span><b>' + esc(d ? d.label : '--') + '</b></div>';
        if (n) h += '<div class="kv"><span class="k">Next</span><b>' + esc(n.name) + ' · ' + esc(fmtClock(n.at)) + '</b></div><div class="kv"><span class="k">Then set to</span><b><span class="heatt">' + n.heat + '°</span> / <span class="coolt">' + n.cool + '°</span></b></div>';
        $('.kvgrid', b).innerHTML = h;
      }
    },
    runtime: {
      title: 'Runtime today', sizes: ['1x1', '2x1'],
      init: function (b) { b.innerHTML = '<div class="rt"></div>'; },
      update: function (b) {
        var el = $('.rt', b);
        if (!INS) { el.innerHTML = '<p class="hint">Loading…</p>'; return; }
        var d = INS.daily && INS.daily[INS.daily.length - 1];
        if (!d) { el.innerHTML = '<p class="hint">Nothing has run yet today. Heating and cooling time appears here once the system has run.</p>'; return; }
        el.innerHTML = '<div class="pair"><div><b class="big sm heatt">' + hrs1(d.heatMin) + '</b><span class="k">Heating</span></div><div><b class="big sm coolt">' + hrs1(d.coolMin) + '</b><span class="k">Cooling</span></div></div>' +
          '<p class="hint" style="margin:4px 0 0;font-size:.78rem">' + d.cycles + ' cycle' + (d.cycles === 1 ? '' : 's') + (d.cost != null ? ' · about $' + d.cost.toFixed(2) : '') + '</p>';
      }
    },
    weather: {
      title: 'Weather', sizes: ['2x1', '2x2', '1x1'],
      init: function (b) { b.innerHTML = '<div class="wx"></div>'; },
      update: function (b, i) {
        var el = $('.wx', b);
        loadWeather();
        var w = WX.data;
        if (!w) { el.innerHTML = '<p class="hint">' + (WX.loaded ? 'Weather is off.' : 'Loading…') + '</p>'; return; }
        if (!w.configured) { el.innerHTML = '<p class="hint">Pick your location in Settings → Weather to see the outdoor weather here.</p>'; return; }
        if (w.error && !w.now) { el.innerHTML = '<p class="hint">Weather is not reachable right now.</p>'; return; }
        var n = w.now, wide = !!(i && /^[2-4]x/.test(i.size)), tall = !!(i && /^[2-4]x[2-4]$/.test(i.size));
        el.classList.toggle('wide', !!wide);
        var h = '<div class="wxl"><div class="wxtop"><span class="wxi" aria-hidden="true">' + n.icon + '</span><div><b class="big sm">' + Math.round(n.temp) + '°</b><span class="k">' + esc(n.label) + '</span></div></div>';
        if (!wide || tall) h += '<p class="hint" style="margin:6px 0 0;font-size:.8rem">Feels ' + Math.round(n.feels) + '° · wind ' + Math.round(n.wind) + ' mph · ' + Math.round(n.humidity) + '% humidity</p>';
        if (tall && w.name) h += '<p class="hint" style="margin:4px 0 0;font-size:.74rem">' + esc(w.name) + (w.stale ? ' · offline, showing the last reading' : '') + '</p>';
        h += '</div>';
        var d = (w.days || []).slice(0, wide ? 4 : 0);
        if (d.length) h += '<div class="wxdays">' + d.map(function (x, k) {
          var nm = k === 0 ? 'Today' : new Date(x.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' });
          return '<div><span class="k">' + nm + '</span><span class="wxi sm" aria-hidden="true">' + x.icon + '</span><span class="hl"><b>' + Math.round(x.hi) + '°</b> <span class="lo">' + Math.round(x.lo) + '°</span></span>' + (tall && x.pop >= 20 ? '<span class="pop">' + x.pop + '% rain</span>' : '') + '</div>';
        }).join('') + '</div>';
        el.innerHTML = h;
      }
    },
    filter: {
      title: 'Filter', sizes: ['1x1', '1x2', '2x1'],
      init: function (b) { b.innerHTML = '<div class="fil"></div>'; },
      update: function (b, i) {
        var f = S.filter, el = $('.fil', b), tiny = i.card.classList.contains('h1') && i.card.classList.contains('w1');
        if (!f.configured) { el.innerHTML = '<p class="hint" style="margin-top:0">Set a change date.</p><button class="btn sm">Set up</button>'; $('button', el).onclick = function () { showTab('settings'); }; return; }
        var pct = Math.max(0, Math.min(100, Math.round(f.daysSince / f.intervalDays * 100)));
        var msg = f.state === 'overdue' ? 'Overdue ' + (-f.daysLeft) + ' d' : f.daysLeft === 0 ? 'Due today' : f.daysLeft + ' day' + (f.daysLeft === 1 ? '' : 's') + ' left';
        el.innerHTML = '<div class="fbody ' + esc(f.state) + '"><div class="big">' + esc(msg) + '</div><div class="fbar"></div></div>'.replace('<div class="fbar"></div>', '<div class="fbar"><i style="width:' + pct + '%"></i></div><div class="hint" style="margin:0 0 ' + (tiny ? 0 : 10) + 'px">' + esc(f.name) + ' · due ' + esc(f.dueDate) + '</div>') + (tiny ? '' : '<button class="btn sm">Changed today</button>');
        if (!tiny) $('button', el).onclick = markFilter;
      }
    },
    chart: {
      title: 'Temperature', sizes: ['4x3', '4x2', '2x2'],
      init: function (b, i) {
        i.extra.innerHTML = '<div class="seg small"><button data-h="24">24 h</button><button data-h="72">3 d</button><button data-h="168">7 d</button></div>';
        b.innerHTML = '<div class="chartbox"><canvas></canvas></div><div class="legend"></div>';
        i.chart = makeChart($('canvas', b), $('.legend', b)); i.hrs = i.hrs || 24;
        i.fetch = function () {
          $$('[data-h]', i.extra).forEach(function (x) { x.classList.toggle('on', +x.dataset.h === i.hrs); });
          return api('GET', '/api/history?hours=' + i.hrs).then(function (h) { i.chart.set(h, i.hrs); }).catch(function () {});
        };
        $$('[data-h]', i.extra).forEach(function (x) { x.onclick = function () { i.hrs = +x.dataset.h; i.fetch(); }; });
        i.fetch();
      },
      update: function (b, i) { i.chart.setMode(S.thermostat && S.thermostat.mode); }
    },
    rooms: {
      title: 'Rooms', sizes: ['2x1', '2x2', '4x1'],
      init: function (b) { b.innerHTML = '<div class="roomstrip"></div>'; },
      update: function (b) {
        $('.roomstrip', b).innerHTML = S.sensors.map(function (r) {
          return '<div class="room' + (r.include ? '' : ' off') + '"><div class="n">' + esc(r.name) + '</div><div class="t">' + fmtT(r.temp) + '°' + (r.humidity != null ? '<span class="h" style="color:' + humLevel(r.humidity).c + '" title="' + esc(humLevel(r.humidity).label) + '">' + Math.round(r.humidity) + '%</span>' : '') + '</div></div>';
        }).join('') || '<p class="hint">No room sensors yet. Any Z-Wave temperature sensor shows up here on its own once paired.</p>';
      }
    },
    notes: {
      title: 'What I noticed', sizes: ['2x1', '2x2', '1x2'],
      init: function (b) { b.innerHTML = '<ul class="findings tight"></ul>'; },
      update: function (b) {
        var f = INS ? (INS.findings.length ? INS.findings : ['Nothing unusual. Cold Front flags short cycling, wall changes, humidity and sensor gaps here.']) : ['Loading…'];
        $('.findings', b).innerHTML = f.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      }
    },
    log: {
      title: 'Recent activity', sizes: ['2x2', '1x2'],
      init: function (b) { b.innerHTML = '<ul class="events" style="max-height:none;margin:0"></ul>'; },
      update: function (b) {
        $('.events', b).innerHTML = EVT ? EVT.events.slice(0, 12).map(function (e) { return '<li><time>' + esc(new Date(e.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</time>' + esc(e.msg) + '</li>'; }).join('') || '<li class="hint">Nothing yet.</li>' : '<li class="hint">Loading…</li>';
      }
    }
  };
  var DEFAULT_LAYOUT = [
    { id: 'thermostat', size: '2x3' }, { id: 'controls', size: '1x2' }, { id: 'filter', size: '1x1' }, { id: 'runtime', size: '1x1' },
    { id: 'nextup', size: '2x1' }, { id: 'chart', size: '4x3' }, { id: 'rooms', size: '2x1' }, { id: 'notes', size: '2x1' }
  ];
  var layout = null, editing = false, inst = {}, saveT = null;

  function sizeOf(id, size) { return WIDGETS[id].sizes.indexOf(size) >= 0 ? size : WIDGETS[id].sizes[0]; }
  function loadLayout() {
    var d = S && S.settings.dashboard, src = Array.isArray(d) ? d : DEFAULT_LAYOUT;
    layout = [];
    src.forEach(function (e) { if (WIDGETS[e.id] && !layout.some(function (l) { return l.id === e.id; })) layout.push({ id: e.id, size: sizeOf(e.id, e.size) }); });
  }
  function persist() {
    clearTimeout(saveT);
    saveT = setTimeout(function () { api('PUT', '/api/settings', { dashboard: layout }).catch(function (e) { toast(e.message); }); }, 400);
  }
  function editBar(e) {
    return '<div class="wedit"><button data-a="prev" aria-label="Move earlier">‹</button><button data-a="next" aria-label="Move later">›</button>' +
      (WIDGETS[e.id].sizes.length > 1 ? '<button data-a="size" title="Change size">' + e.size.replace('x', '×') + '</button>' : '') +
      '<button data-a="rm" class="rm" aria-label="Remove widget">✕</button></div>';
  }
  function move(id, toIdx) {
    var a = layout.findIndex(function (l) { return l.id === id; }); if (a < 0) return;
    toIdx = Math.max(0, Math.min(layout.length - 1, toIdx));
    var it = layout.splice(a, 1)[0]; layout.splice(toIdx, 0, it); persist(); buildDash();
  }
  function wireEdit(card, e) {
    $$('.wedit button', card).forEach(function (btn) {
      btn.onclick = function () {
        var i = layout.findIndex(function (l) { return l.id === e.id; }), a = btn.dataset.a;
        if (a === 'prev') move(e.id, i - 1);
        else if (a === 'next') move(e.id, i + 1);
        else if (a === 'rm') { layout.splice(i, 1); persist(); buildDash(); }
        else if (a === 'size') { var sz = WIDGETS[e.id].sizes; layout[i].size = sz[(sz.indexOf(e.size) + 1) % sz.length]; persist(); buildDash(); }
      };
    });
    card.draggable = true;
    card.ondragstart = function (ev) { ev.dataTransfer.setData('text/plain', e.id); ev.dataTransfer.effectAllowed = 'move'; card.classList.add('drag'); };
    card.ondragend = function () { card.classList.remove('drag'); $$('.widget.over').forEach(function (c) { c.classList.remove('over'); }); };
    card.ondragover = function (ev) { ev.preventDefault(); card.classList.add('over'); };
    card.ondragleave = function () { card.classList.remove('over'); };
    card.ondrop = function (ev) {
      ev.preventDefault();
      var from = ev.dataTransfer.getData('text/plain');
      if (from && from !== e.id) move(from, layout.findIndex(function (l) { return l.id === e.id; }));
    };
  }
  function buildDash() {
    var dash = $('#dash');
    dash.innerHTML = ''; inst = {};
    dash.classList.toggle('editing', editing);
    layout.forEach(function (e) {
      var W = WIDGETS[e.id], dims = e.size.split('x'), card = document.createElement('article');
      card.className = 'widget w' + dims[0] + ' h' + dims[1]; card.dataset.id = e.id;
      card.innerHTML = '<div class="whead"><h4>' + esc(W.title) + '</h4><span class="wextra"></span></div><div class="wbody"></div>' + (editing ? editBar(e) : '');
      dash.appendChild(card);
      var i = inst[e.id] = { card: card, body: $('.wbody', card), extra: $('.wextra', card), size: e.size };
      W.init(i.body, i);
      if (editing) wireEdit(card, e);
    });
    if (!layout.length) dash.innerHTML = '<div class="card" style="grid-column:1/-1">Your dashboard is empty. Press <b>Customize</b> to add widgets.</div>';
    renderTray(); updateWidgets();
  }
  function renderTray() {
    var tray = $('#addTray');
    tray.hidden = !editing;
    if (!editing) return;
    var have = {}; layout.forEach(function (l) { have[l.id] = 1; });
    var left = Object.keys(WIDGETS).filter(function (k) { return !have[k]; });
    tray.innerHTML = '<b>Add a widget</b>' + (left.length ? left.map(function (k) { return '<button class="btn" data-add="' + k + '">+ ' + esc(WIDGETS[k].title) + '</button>'; }).join('') : '<span class="hint" style="margin:0">Every widget is on your dashboard. Drag cards to reorder, or use ‹ › and the size button.</span>');
    $$('[data-add]', tray).forEach(function (btn) { btn.onclick = function () { var k = btn.dataset.add; layout.push({ id: k, size: WIDGETS[k].sizes[0] }); persist(); buildDash(); }; });
  }
  function updateWidgets() {
    if (!S || !layout) return;
    Object.keys(inst).forEach(function (k) { try { WIDGETS[k].update(inst[k].body, inst[k]); } catch (e) { /* one bad widget must not blank the rest */ } });
  }
  function startEdit() { editing = true; $('#editDash').textContent = 'Done'; $('#editDash').classList.add('primary'); $('#resetDash').hidden = false; buildDash(); }
  function stopEdit() { editing = false; $('#editDash').textContent = 'Customize'; $('#editDash').classList.remove('primary'); $('#resetDash').hidden = true; if (layout) buildDash(); }
  $('#editDash').onclick = function () { if (editing) stopEdit(); else startEdit(); };
  $('#resetDash').onclick = function () {
    clearTimeout(saveT);
    api('PUT', '/api/settings', { dashboard: null }).then(function () { S.settings.dashboard = null; loadLayout(); buildDash(); toast('Layout reset'); }).catch(function (e) { toast(e.message); });
  };
  function loadExtras() {
    return Promise.all([api('GET', '/api/insights'), api('GET', '/api/events')]).then(function (a) { INS = a[0]; EVT = a[1]; updateWidgets(); }).catch(function () {});
  }

  // ---- schedule
  function loadSchedule() {
    renderPlan();
    return api('GET', '/api/schedule').then(function (r) { sched = r.schedule; schedDirty = false; renderSchedule(r.wall); });
  }
  // ---- comfort range (the simple way)
  var rgSave = null;
  function renderPlan() {
    if (!S || !S.settings) return;
    var st = S.settings, rg = st.plan !== 'schedule', c = st.comfort;
    $$('#planPick button').forEach(function (b) { b.classList.toggle('on', b.dataset.plan === (rg ? 'range' : 'schedule')); });
    $('#rangeEditor').hidden = !rg;
    $('#schedCard').hidden = rg; $('#wallCard').hidden = rg;
    $('#rg-home-heat').textContent = c.home.heat + '°'; $('#rg-home-cool').textContent = c.home.cool + '°';
    $('#rg-away-heat').textContent = c.away.heat + '°'; $('#rg-away-cool').textContent = c.away.cool + '°';
    $('#planHint').textContent = rg
      ? 'Home: the heat comes on below ' + c.home.heat + '° and the AC above ' + c.home.cool + '°. Between the two nothing runs. Tap Away on the dashboard when nobody is home and it uses the Away range instead. Changes apply right away.'
      : 'Cold Front follows the weekly schedule below. A hold or Away overrides it.';
  }
  $$('#planPick button').forEach(function (b) {
    b.onclick = function () {
      api('PUT', '/api/settings', { plan: b.dataset.plan }).then(function (r) { S.settings = r.settings; renderPlan(); toast(b.dataset.plan === 'range' ? 'Using your comfort range' : 'Using the weekly schedule'); return refresh(); }).catch(function (e) { toast(e.message); });
    };
  });
  $$('#rangeEditor [data-rg]').forEach(function (b) {
    b.onclick = function () {
      var k = b.dataset.rg.split('.'), c = S.settings.comfort, lim = S.settings.limits, gap = lim.minGap;
      var v = c[k[0]][k[1]] + (+b.dataset.d), o = c[k[0]];
      if (k[1] === 'heat') { v = Math.min(lim.heatMax, Math.max(lim.heatMin, v)); o.heat = v; if (o.cool < v + gap) o.cool = Math.min(lim.coolMax, v + gap); }
      else { v = Math.min(lim.coolMax, Math.max(lim.coolMin, v)); o.cool = v; if (o.heat > v - gap) o.heat = Math.max(lim.heatMin, v - gap); }
      renderPlan();
      clearTimeout(rgSave);
      rgSave = setTimeout(function () { api('PUT', '/api/settings', { comfort: S.settings.comfort }).then(function (r) { S.settings = r.settings; renderPlan(); toast('Saved'); return refresh(); }).catch(function (e) { toast(e.message); refresh(); }); }, 700);
    };
  });
  function renderSchedule(wall) {
    $('#dayTabs').innerHTML = DAYS.map(function (d) { return '<button data-d="' + d + '" class="' + (d === curDay ? 'on' : '') + '">' + LBL[d] + '</button>'; }).join('');
    $$('#dayTabs button').forEach(function (b) { b.onclick = function () { curDay = b.dataset.d; renderSchedule(); }; });
    var list = sched.days[curDay];
    $('#periods').innerHTML = list.map(function (p, i) {
      return '<div class="period" data-i="' + i + '"><label class="nm">Name<input type="text" data-f="name" value="' + esc(p.name) + '" maxlength="20"></label>' +
        '<label>Time<input type="time" data-f="time" value="' + esc(p.time) + '"></label>' +
        '<label>Heat °F<input type="number" data-f="heat" value="' + p.heat + '"></label>' +
        '<label>Cool °F<input type="number" data-f="cool" value="' + p.cool + '"></label>' +
        '<button class="x" data-del="' + i + '" aria-label="Delete period">×</button></div>';
    }).join('');
    $$('#periods input').forEach(function (inp) {
      inp.onchange = function () {
        var i = +inp.closest('.period').dataset.i, f = inp.dataset.f;
        sched.days[curDay][i][f] = (f === 'heat' || f === 'cool') ? +inp.value : inp.value; schedDirty = true; hint();
      };
    });
    $$('#periods [data-del]').forEach(function (b) { b.onclick = function () { if (list.length <= 1) return toast('Keep at least one period'); list.splice(+b.dataset.del, 1); schedDirty = true; renderSchedule(); }; });
    hint();
    if (wall) renderWall(wall); else if (!$('#wall').innerHTML) api('GET', '/api/schedule').then(function (r) { renderWall(r.wall); });
  }
  function hint() {
    var l = sched.days[curDay];
    $('#schedHint').textContent = (schedDirty ? 'Unsaved changes. ' : '') + (l.length >= 4 ? 'The thermostat itself holds four periods a day; Cold Front can use more.' : '');
  }
  function renderWall(wall) {
    var w = wall.lines.map(function (ln) {
      return '<div class="rstat"><b>' + esc(ln.label) + '</b><span style="grid-column:2/-1">' + ln.periods.map(function (p) { return esc(p.slot) + ' ' + esc(fmtTime(p.time)) + ' ' + p.heat + '/' + p.cool; }).join(' · ') + '</span></div>';
    }).join('');
    if (wall.warnings && wall.warnings.length) w += '<p class="hint">' + wall.warnings.map(esc).join('<br>') + '</p>';
    $('#wall').innerHTML = w;
  }
  $('#addPeriod').onclick = function () {
    var l = sched.days[curDay], last = l[l.length - 1], h = Math.min(23, +last.time.slice(0, 2) + 1);
    l.push({ id: 'n', name: 'Period', time: ('0' + h).slice(-2) + ':00', heat: last.heat, cool: last.cool }); schedDirty = true; renderSchedule();
  };
  function copyTo(days) { var src = JSON.parse(JSON.stringify(sched.days[curDay])); days.forEach(function (d) { if (d !== curDay) sched.days[d] = JSON.parse(JSON.stringify(src)); }); schedDirty = true; renderSchedule(); toast('Copied. Press Save to apply.'); }
  $('#copyWeekdays').onclick = function () { copyTo(['mon', 'tue', 'wed', 'thu', 'fri']); };
  $('#copyAll').onclick = function () { copyTo(DAYS); };
  $('#saveSched').onclick = function () {
    var sb = $('#saveSched'); sb.disabled = true; var old = sb.textContent; sb.textContent = 'Saving…';
    api('PUT', '/api/schedule', { schedule: sched }).then(function (r) { sched = r.schedule; schedDirty = false; renderSchedule(r.wall); toast('Schedule saved'); refresh(); }).catch(function (e) { toast(e.message); }).then(function () { sb.disabled = false; sb.textContent = old; });
  };

  // ---- rooms
  $('#leakTest').onclick = function () {
    var on = !(S && S.leaks && S.leaks[0] && S.leaks[0].wet);
    api('POST', '/api/demo/leak', { wet: on }).then(function () { toast(on ? 'Pretend leak on' : 'Pretend leak cleared'); setTimeout(refresh, 300); }).catch(function (e) { toast(e.message); });
  };
  function renderRooms() {
    if (!S) return;
    $('#roomList').innerHTML = S.sensors.map(function (r) {
      return '<div class="rrow" data-id="' + esc(r.nodeId) + '"><div class="top2"><input type="text" value="' + esc(r.name) + '" maxlength="30" aria-label="Room name"><label class="check" style="margin:0"><input type="checkbox" ' + (r.include ? 'checked' : '') + '> Show</label></div>' +
        '<div class="meta">' + fmtT(r.temp) + '°F' + (r.humidity != null ? ' · ' + Math.round(r.humidity) + '% RH' : '') + (r.battery != null ? ' · battery ' + r.battery + '%' : '') + ' · node ' + esc(r.nodeId) + '</div></div>';
    }).join('') || '<p class="hint">No sensors yet. Any Z-Wave node that reports temperature and is not the thermostat shows up here on its own.</p>';
    var leaks = S.leaks || [];
    $('#leakList').innerHTML = leaks.map(function (l) {
      return '<div class="rrow" data-id="' + esc(l.nodeId) + '"><div class="top2"><input type="text" value="' + esc(l.name) + '" maxlength="30" aria-label="Water sensor name"><span class="leakbadge ' + (l.wet ? 'wet' : 'dry') + '">' + (l.wet ? 'WET' : 'Dry') + '</span></div>' +
        '<div class="meta">' + (l.battery != null ? 'battery ' + l.battery + '% · ' : '') + 'node ' + esc(l.nodeId) + '</div></div>';
    }).join('') || '<p class="hint">No water sensor yet. Pair a Z-Wave water leak sensor and it shows up here on its own. A leak shows an alert on every page and can send an ntfy notification (Settings → Notifications).</p>';
    $$('#leakList .rrow').forEach(function (row) {
      $('input[type=text]', row).onchange = function () { api('PUT', '/api/rooms/' + encodeURIComponent(row.dataset.id), { name: this.value, include: true }).then(refresh).catch(function (e) { toast(e.message); }); };
    });
    $('#leakDemo').hidden = S.mode === 'live';
    $$('#roomList .rrow').forEach(function (row) {
      var save = function () { api('PUT', '/api/rooms/' + encodeURIComponent(row.dataset.id), { name: $('input[type=text]', row).value, include: $('input[type=checkbox]', row).checked }).then(refresh).catch(function (e) { toast(e.message); }); };
      $('input[type=text]', row).onchange = save; $('input[type=checkbox]', row).onchange = save;
    });
  }


  // ---- charts
  function niceStep(raw) { var c = [1, 2, 5, 10, 20, 50]; for (var i = 0; i < c.length; i++) if (c[i] >= raw) return c[i]; return 50; }
  function rr(x, px, py, w, h, r) { x.beginPath(); if (x.roundRect) x.roundRect(px, py, w, h, r); else x.rect(px, py, w, h); }
  function hourLabel(d) { var h = d.getHours(); return (h % 12 || 12) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function xticks(t0, t1, hrs) {
    var out = [], d = new Date(t0);
    if (hrs <= 36) {
      var sh = hrs <= 8 ? 1 : hrs <= 14 ? 2 : hrs <= 26 ? 4 : 6;
      d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
      while (d.getHours() % sh !== 0) d.setHours(d.getHours() + 1);
      for (; d.getTime() <= t1; d.setHours(d.getHours() + sh)) out.push({ t: d.getTime(), l: hourLabel(d) });
    } else {
      d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
      for (; d.getTime() <= t1; d.setDate(d.getDate() + 1)) out.push({ t: d.getTime(), l: d.toLocaleDateString([], { weekday: 'short' }) });
    }
    return out;
  }
  /** One readable chart: indoor temperature as the hero line, the target you care about as a dashed step line,
   *  and a thin lane underneath showing when the furnace or AC ran. Hover or touch for exact values. */
  function makeChart(canvas, legend) {
    var st = { hist: null, hrs: 24, mode: 'auto', hx: null };
    function targets() { return st.mode === 'heat' ? ['heat'] : st.mode === 'cool' ? ['cool'] : st.mode === 'off' ? [] : ['heat', 'cool']; }
    function drawLegend() {
      if (!legend) return;
      var tg = targets(), h = '<span class="k">Indoor</span>';
      if (tg.indexOf('heat') >= 0) h += '<span class="k tgt">Heat target</span>';
      if (tg.indexOf('cool') >= 0) h += '<span class="k tgtc">Cool target</span>';
      var runs = (st.hist && st.hist.runs) || [];
      if (runs.some(function (r) { return r.kind === 'heating'; })) h += '<span class="k runh">Furnace on</span>';
      if (runs.some(function (r) { return r.kind === 'cooling'; })) h += '<span class="k runc">AC on</span>';
      legend.innerHTML = h;
    }
    function draw() {
      var W = canvas.clientWidth, H = canvas.clientHeight; if (!W || !H) return;
      var dpr = window.devicePixelRatio || 1; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      var x = canvas.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
      var h = st.hist;
      if (!h || !h.samples.length) { x.fillStyle = COL.mute; x.font = '14px ' + FONT; x.fillText('No data yet', 12, 24); return; }
      var s = h.samples, t1 = s[s.length - 1].t, t0 = t1 - st.hrs * 3600000, tg = targets();
      var vis = s.filter(function (p) { return p.t >= t0; }); if (vis.length < 2) vis = s.slice(-2);
      var vals = [];
      vis.forEach(function (p) { if (p.in != null) vals.push(p.in); tg.forEach(function (k) { if (p[k] != null) vals.push(p[k]); }); });
      if (!vals.length) return;
      var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), pad = Math.max(mx - mn, 4) * .15; mn -= pad; mx += pad;
      var step = niceStep((mx - mn) / 4); mn = Math.floor(mn / step) * step; mx = Math.ceil(mx / step) * step;
      var L = 44, R = 16, T = 14, B = 46, pw = W - L - R, ph = H - T - B; if (pw < 60 || ph < 40) return;
      function X(t) { return L + (t - t0) / (t1 - t0) * pw; }
      function Y(v) { return T + (mx - v) / (mx - mn) * ph; }
      x.font = '11px ' + FONT; x.lineWidth = 1;
      // horizontal grid + degree labels
      for (var v = mn; v <= mx + 1e-6; v += step) {
        var gy = Math.round(Y(v)) + .5;
        x.strokeStyle = COL.grid; x.beginPath(); x.moveTo(L, gy); x.lineTo(W - R, gy); x.stroke();
        x.fillStyle = COL.mute; x.textAlign = 'right'; x.fillText(Math.round(v) + '°', L - 8, gy + 4);
      }
      // time ticks
      x.textAlign = 'center';
      xticks(t0, t1, st.hrs).forEach(function (k) {
        var px = X(k.t), w = x.measureText(k.l).width;
        x.strokeStyle = COL.grid2; x.beginPath(); x.moveTo(Math.round(px) + .5, T); x.lineTo(Math.round(px) + .5, T + ph); x.stroke();
        x.fillStyle = COL.mute; x.fillText(k.l, Math.max(L + w / 2, Math.min(W - R - w / 2, px)), H - 8);
      });
      // run lane
      var sy = T + ph + 10;
      x.fillStyle = COL.lane; rr(x, L, sy, pw, 8, 4); x.fill();
      h.runs.forEach(function (r) {
        if (r.kind === 'fan') return;
        var a = Math.max(r.start, t0), b = Math.min(r.end || t1, t1); if (b <= a) return;
        x.fillStyle = r.kind === 'cooling' ? COL.cool : COL.heat; rr(x, X(a), sy, Math.max(3, X(b) - X(a)), 8, 4); x.fill();
      });
      x.fillStyle = COL.faint; x.textAlign = 'right'; x.font = '10px ' + FONT; x.fillText('on', L - 8, sy + 8); x.font = '11px ' + FONT;
      // target step lines
      tg.forEach(function (k) {
        x.strokeStyle = k === 'cool' ? COL.cool : COL.heat; x.lineWidth = 2; x.setLineDash([6, 5]); x.beginPath();
        var py = null, on = false;
        vis.forEach(function (p) { if (p[k] == null) return; var px = X(p.t), yy = Y(p[k]); if (!on) { x.moveTo(px, yy); on = true; } else { x.lineTo(px, py); x.lineTo(px, yy); } py = yy; });
        if (on) x.lineTo(X(t1), py);
        x.stroke(); x.setLineDash([]);
      });
      // indoor line + soft fill
      var pts = vis.filter(function (p) { return p.in != null; });
      if (pts.length > 1) {
        var gr = x.createLinearGradient(0, T, 0, T + ph); gr.addColorStop(0, COL.fillTop); gr.addColorStop(1, COL.fillBot);
        x.beginPath(); pts.forEach(function (p, i) { if (i) x.lineTo(X(p.t), Y(p.in)); else x.moveTo(X(p.t), Y(p.in)); });
        x.lineTo(X(pts[pts.length - 1].t), T + ph); x.lineTo(X(pts[0].t), T + ph); x.closePath(); x.fillStyle = gr; x.fill();
        x.strokeStyle = COL.ink; x.lineWidth = 2.6; x.lineJoin = 'round'; x.lineCap = 'round'; x.beginPath();
        pts.forEach(function (p, i) { if (i) x.lineTo(X(p.t), Y(p.in)); else x.moveTo(X(p.t), Y(p.in)); }); x.stroke();
        var last = pts[pts.length - 1], lx = X(last.t), ly = Y(last.in);
        x.fillStyle = COL.halo; x.beginPath(); x.arc(lx, ly, 8, 0, 7); x.fill();
        x.fillStyle = COL.ink; x.beginPath(); x.arc(lx, ly, 4.5, 0, 7); x.fill();
        if (st.hx == null) {
          var lab = fmtT(last.in) + '°', lw = x.measureText(lab).width + 16, bx = Math.min(lx - lw / 2, W - R - lw), by = Math.max(T, ly - 34);
          x.fillStyle = COL.ink; rr(x, Math.max(L, bx), by, lw, 22, 11); x.fill();
          x.fillStyle = COL.pillFg; x.font = '600 12px ' + FONT; x.textAlign = 'center'; x.fillText(lab, Math.max(L, bx) + lw / 2, by + 15); x.font = '11px ' + FONT;
        }
      }
      // hover readout
      if (st.hx != null && pts.length) {
        var tt = t0 + (st.hx - L) / pw * (t1 - t0), best = pts[0];
        pts.forEach(function (p) { if (Math.abs(p.t - tt) < Math.abs(best.t - tt)) best = p; });
        var hx = X(best.t);
        x.strokeStyle = COL.hover; x.lineWidth = 1; x.beginPath(); x.moveTo(Math.round(hx) + .5, T); x.lineTo(Math.round(hx) + .5, T + ph); x.stroke();
        x.fillStyle = COL.ink; x.beginPath(); x.arc(hx, Y(best.in), 5, 0, 7); x.fill();
        var lines = [new Date(best.t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }), 'Indoor  ' + fmtT(best.in) + '°'];
        tg.forEach(function (k) { if (best[k] != null) lines.push((k === 'heat' ? 'Heat target  ' : 'Cool target  ') + fmtT(best[k]) + '°'); });
        var run = h.runs.filter(function (r) { return r.kind !== 'fan' && r.start <= best.t && (r.end || t1) >= best.t; })[0];
        if (run) lines.push(run.kind === 'cooling' ? 'AC running' : 'Furnace running');
        x.font = '12px ' + FONT; var bw = 0; lines.forEach(function (l) { bw = Math.max(bw, x.measureText(l).width); }); bw += 22;
        var bh = lines.length * 18 + 14, bx2 = hx + 14 + bw > W - R ? hx - 14 - bw : hx + 14;
        x.fillStyle = COL.tipBg; x.strokeStyle = COL.tipEdge; rr(x, bx2, T + 6, bw, bh, 12); x.fill(); x.stroke();
        x.textAlign = 'left';
        lines.forEach(function (l, i) { x.fillStyle = i === 0 ? COL.mute : (i === lines.length - 1 && run ? (run.kind === 'cooling' ? COL.cool : COL.heat) : COL.tipText); x.fillText(l, bx2 + 11, T + 6 + 19 + i * 18); });
      }
    }
    function pos(e) { var r = canvas.getBoundingClientRect(); st.hx = e.clientX - r.left; draw(); }
    canvas.addEventListener('pointermove', pos); canvas.addEventListener('pointerdown', pos);
    function off() { st.hx = null; draw(); }
    canvas.addEventListener('pointerleave', off); canvas.addEventListener('pointercancel', off);
    if (window.ResizeObserver) new ResizeObserver(function () { draw(); }).observe(canvas.parentNode);
    return {
      set: function (hist, hrs) { st.hist = hist; st.hrs = hrs; drawLegend(); draw(); },
      setMode: function (m) { if (m && m !== st.mode) { st.mode = m; drawLegend(); draw(); } },
      draw: draw
    };
  }

  var lastDaily = [];
  function drawBars(daily) {
    var c = $('#bars'); if (!c || !c.clientWidth) return;
    lastDaily = daily;
    var W = c.clientWidth, H = c.clientHeight, dpr = window.devicePixelRatio || 1; c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    var x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    var d = daily.slice(-7); if (!d.length) return;
    var mx = Math.max.apply(null, d.map(function (r) { return r.heatMin + r.coolMin; }).concat([60])) / 60, bw = (W - 20) / d.length, base = H - 26, top = 24;
    x.strokeStyle = COL.base; x.beginPath(); x.moveTo(10, base + .5); x.lineTo(W - 10, base + .5); x.stroke();
    d.forEach(function (r, i) {
      var w = Math.min(bw * .5, 54), bx = 10 + i * bw + (bw - w) / 2, hh = r.heatMin / 60 / mx * (base - top), ch = r.coolMin / 60 / mx * (base - top);
      if (hh > 0) { x.fillStyle = COL.heat; rr(x, bx, base - hh, w, hh, Math.min(8, hh / 2)); x.fill(); }
      if (ch > 0) { x.fillStyle = COL.cool; rr(x, bx, base - hh - ch - (hh > 0 ? 2 : 0), w, ch, Math.min(8, ch / 2)); x.fill(); }
      x.textAlign = 'center'; x.font = '12px ' + FONT; x.fillStyle = COL.mute;
      x.fillText(new Date(r.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' }), bx + w / 2, H - 8);
      var tot = r.heatMin + r.coolMin;
      if (tot) { x.fillStyle = COL.ink; x.font = '600 12px ' + FONT; x.fillText(hrs1(tot), bx + w / 2, base - hh - ch - 8); }
    });
  }

  // ---- insights tab
  var lastHist = null;
  var HUMLINES = ['#5ac8fa', '#f0a24b', '#b48cf0', '#7ad7a8'];
  function humSeries() {
    var h = lastHist; if (!h || !h.samples) return [];
    var out = [];
    var th = h.samples.filter(function (p) { return p.hum != null; });
    if (th.length) out.push({ name: 'Thermostat', color: COL.ink, pts: th.map(function (p) { return { t: p.t, v: p.hum }; }) });
    ((INS && INS.rooms) || []).forEach(function (r, i) {
      var pts = [];
      h.samples.forEach(function (p) { var v = p.rooms && p.rooms[r.id] && p.rooms[r.id].h; if (v != null) pts.push({ t: p.t, v: v }); });
      if (pts.length) out.push({ name: r.name, color: HUMLINES[i % HUMLINES.length], pts: pts });
    });
    return out;
  }
  function drawHumidity() {
    var canvas = $('#humchart'); if (!canvas) return;
    var series = humSeries(), lim = (S && S.settings && S.settings.humidity) || { min: 25, max: 60 };
    var cur = series.length ? series[0].pts[series[0].pts.length - 1].v : null, L = humLevel(cur);
    $('#humNow').innerHTML = L ? '<b style="color:' + L.c + '">\u25CF ' + esc(L.label) + '</b> <span>' + Math.round(cur) + '% now. ' + esc(L.tip) + '</span>' : '<span class="hint">No humidity readings yet.</span>';
    $('#humLegend').innerHTML = series.map(function (s) { return '<span class="k" style="--c:' + s.color + '">' + esc(s.name) + '</span>'; }).join('') + (series.length ? '<span class="k" style="--c:' + HUMC.good + '">Ideal 30 to 50%</span>' : '');
    $('#humStats').textContent = series.length ? series.map(function (s) {
      var vs = s.pts.filter(function (p) { return p.t >= Date.now() - range * 3600000; }).map(function (p) { return p.v; }); if (!vs.length) return '';
      var avg = vs.reduce(function (a, b) { return a + b; }, 0) / vs.length;
      return s.name + ': average ' + Math.round(avg) + '%, low ' + Math.round(Math.min.apply(null, vs)) + '%, high ' + Math.round(Math.max.apply(null, vs)) + '%.';
    }).filter(Boolean).join(' ') : '';
    var W = canvas.clientWidth, H = canvas.clientHeight; if (!W || !H) return;
    var dpr = window.devicePixelRatio || 1; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    var x = canvas.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    if (!series.length) { x.fillStyle = COL.mute; x.font = '14px ' + FONT; x.fillText('No data yet', 12, 24); return; }
    var t1 = Math.max.apply(null, series.map(function (s) { return s.pts[s.pts.length - 1].t; })), t0 = t1 - range * 3600000;
    var vals = [lim.min, lim.max, 30, 50];
    series.forEach(function (s) { s.pts.forEach(function (p) { if (p.t >= t0) vals.push(p.v); }); });
    var mn = Math.max(0, Math.floor((Math.min.apply(null, vals) - 3) / 10) * 10), mx = Math.min(100, Math.ceil((Math.max.apply(null, vals) + 3) / 10) * 10);
    var Lf = 44, R = 16, T = 12, B = 28, pw = W - Lf - R, ph = H - T - B; if (pw < 60 || ph < 40) return;
    function X(t) { return Lf + (t - t0) / (t1 - t0) * pw; }
    function Y(v) { return T + (mx - v) / (mx - mn) * ph; }
    x.font = '11px ' + FONT;
    x.fillStyle = HUMC.good; x.globalAlpha = .13; x.fillRect(Lf, Y(50), pw, Y(30) - Y(50)); x.globalAlpha = 1;
    for (var v = mn; v <= mx + 1e-6; v += 10) {
      var gy = Math.round(Y(v)) + .5; x.strokeStyle = COL.grid; x.lineWidth = 1; x.beginPath(); x.moveTo(Lf, gy); x.lineTo(W - R, gy); x.stroke();
      x.fillStyle = COL.mute; x.textAlign = 'right'; x.fillText(v + '%', Lf - 8, gy + 4);
    }
    [lim.min, lim.max].forEach(function (v) { x.strokeStyle = HUMC.bad; x.globalAlpha = .6; x.lineWidth = 1.5; x.setLineDash([5, 5]); x.beginPath(); x.moveTo(Lf, Y(v)); x.lineTo(W - R, Y(v)); x.stroke(); x.setLineDash([]); x.globalAlpha = 1; });
    x.textAlign = 'center';
    xticks(t0, t1, range).forEach(function (k) {
      var px = X(k.t), w = x.measureText(k.l).width;
      x.fillStyle = COL.mute; x.fillText(k.l, Math.max(Lf + w / 2, Math.min(W - R - w / 2, px)), H - 8);
    });
    series.forEach(function (s) {
      var pts = s.pts.filter(function (p) { return p.t >= t0; }); if (pts.length < 2) return;
      x.strokeStyle = s.color; x.lineWidth = 2.4; x.lineJoin = 'round'; x.lineCap = 'round'; x.beginPath();
      pts.forEach(function (p, i) { if (i) x.lineTo(X(p.t), Y(p.v)); else x.moveTo(X(p.t), Y(p.v)); }); x.stroke();
    });
  }
  // ---- command center
  function ago(min) { if (min == null) return 'never'; if (min < 2) return 'just now'; if (min < 90) return min + ' min ago'; if (min < 2880) return Math.round(min / 60) + ' h ago'; return Math.round(min / 1440) + ' d ago'; }
  function deltaColor(d) { var a = Math.abs(d); return a <= 1 ? HUMC.good : a <= 2.5 ? HUMC.fair : HUMC.bad; }
  function tile(label, val, sub, color) { return '<div class="kpi"><span class="kl">' + esc(label) + '</span><b class="kv"' + (color ? ' style="color:' + color + '"' : '') + '>' + val + '</b><span class="ks">' + sub + '</span></div>'; }
  function renderCommand(ins) {
    var h = ins.house; if (!h) return;
    var n = h.now, d = h.day, e = h.equipment, t = S && S.thermostat, L = humLevel(n.humidity);
    var k = '';
    k += tile('Indoor now', n.thermostat != null ? fmtT(n.thermostat) + '°' : '--', t ? esc(t.opState === 'idle' ? 'Idle' : t.opState) + ' · ' + esc(t.mode) : '');
    k += tile('House average', n.average != null ? fmtT(n.average) + '°' : '--', n.counted + (n.counted === 1 ? ' reading' : ' readings') + ' counted');
    k += tile('Spread', n.spread != null ? fmtT(n.spread) + '°' : '--', n.warmest && n.coolest ? esc(n.coolest.name) + ' ' + fmtT(n.coolest.temp) + '° to ' + esc(n.warmest.name) + ' ' + fmtT(n.warmest.temp) + '°' : 'add room sensors', n.spread != null ? deltaColor(n.spread / 2) : null);
    k += tile('Humidity', n.humidity != null ? Math.round(n.humidity) + '%' : '--', L ? esc(L.label) : '', L ? L.c : null);
    k += tile('Equipment, 24 h', e.duty + '%', 'duty cycle · ' + hrs1(e.heatMin + e.coolMin) + ' · ' + e.cycles + (e.cycles === 1 ? ' cycle' : ' cycles'));
    k += tile('In comfort, 24 h', d.comfortPct != null && d.band ? d.comfortPct + '%' : '--', d.band ? 'between ' + d.band.lo + '° and ' + d.band.hi + '°' + (d.houseComfortPct != null && h.data.rooms ? ' · house ' + d.houseComfortPct + '%' : '') : 'schedule mode', d.comfortPct != null && d.band ? (d.comfortPct >= 80 ? HUMC.good : d.comfortPct >= 50 ? HUMC.fair : HUMC.bad) : null);
    var w = WX && WX.data && WX.data.now;
    if (w && w.temp != null) k += tile('Outside', Math.round(w.temp) + '°', n.thermostat != null ? (Math.round(n.thermostat - w.temp) >= 0 ? '+' : '') + Math.round(n.thermostat - w.temp) + '° inside vs out' : esc(w.label || ''));
    $('#kpis').innerHTML = k;

    var a = h.advice;
    $('#advisor').innerHTML = a
      ? '<div class="adv-l"><span class="kl">Balance advisor</span><p>' + esc(a.text) + '</p></div>' + (a.needed && S.settings.plan !== 'schedule' ? '<div class="adv-r"><div class="adv-pair"><span>Now ' + a.current.heat + '–' + a.current.cool + '°</span><b>' + a.suggest.heat + '–' + a.suggest.cool + '°</b></div><button class="btn primary" id="advApply">Apply</button></div>' : '')
      : '<div class="adv-l"><span class="kl">Balance advisor</span><p>With one or more room sensors reporting, this compares every room to the thermostat and suggests the low and high that keep the whole house equally comfortable. Four more sensors will make it much sharper.</p></div>';
    var ap = $('#advApply');
    if (ap) ap.onclick = function () { ap.disabled = true; api('PUT', '/api/settings', { comfort: { home: a.suggest } }).then(function (r) { S.settings = r.settings; toast('Home range set to ' + a.suggest.heat + '–' + a.suggest.cool + '°'); return refresh(); }).then(loadInsights).catch(function (er) { toast(er.message); ap.disabled = false; }); };

    var stats = {}; (ins.rooms || []).forEach(function (r) { stats[r.id] = r; });
    var rows = '';
    if (n.thermostat != null) rows += '<div class="rm"><div class="rm-top"><b>Thermostat</b><span class="rm-t">' + fmtT(n.thermostat) + '°</span></div><div class="rm-sub">' + (n.humidity != null ? Math.round(n.humidity) + '% humidity · ' : '') + 'the wall unit</div></div>';
    h.rooms.forEach(function (r) {
      var st = stats[r.id], dl = r.delta, off = r.ageMin != null && r.ageMin > 14 * 60;
      var track = dl != null ? '<div class="rm-track"><i style="left:' + Math.max(2, Math.min(98, 50 + dl * 12)) + '%;background:' + deltaColor(dl) + '"></i></div>' : '';
      rows += '<div class="rm' + (r.counted ? '' : ' dim') + '"><div class="rm-top"><b>' + esc(r.name) + '</b><span class="rm-t">' + (r.temp != null ? fmtT(r.temp) + '°' : '--') + (dl != null ? ' <em style="color:' + deltaColor(dl) + '">' + (dl > 0 ? '+' : '') + fmtT(dl) + '</em>' : '') + '</span></div>' + track +
        '<div class="rm-sub">' + (r.humidity != null ? Math.round(r.humidity) + '% · ' : '') + (st && st.minTemp != null ? '24 h ' + fmtT(st.minTemp) + '–' + fmtT(st.maxTemp) + '° · ' : '') + (r.battery != null ? 'battery ' + r.battery + '% · ' : '') + '<span' + (off ? ' class="warnt"' : '') + '>heard ' + ago(r.ageMin) + '</span>' + (r.include ? '' : ' · not counted') + '</div></div>';
    });
    if (!h.rooms.length) rows += '<p class="hint">No room sensors reporting yet. New sensors show up here on their own once they are paired; name them on the Rooms tab.</p>';
    else rows += '<p class="hint rm-foot">The dot shows each room against the house average (centre). Green is within 1°.</p>';
    $('#roomMap').innerHTML = rows;

    var dd = h.data;
    $('#nerd').innerHTML = [
      ['Thermostat avg, 24 h', d.avgThermostat != null ? fmtT(d.avgThermostat) + '°' : '--'],
      ['House avg, 24 h', d.avgHouse != null ? fmtT(d.avgHouse) + '°' : '--'],
      ['Low / high, 24 h', d.min != null ? fmtT(d.min) + '° / ' + fmtT(d.max) + '°' : '--'],
      ['Heat runtime', hrs1(e.heatMin)], ['Cool runtime', hrs1(e.coolMin)],
      ['Cycles', e.cycles + (e.avgRunMin != null ? ' · avg ' + Math.round(e.avgRunMin) + ' min' : '')],
      ['Duty cycle', e.duty + '%'],
      ['Sensors', dd.rooms + ' room' + (dd.rooms === 1 ? '' : 's') + ' + thermostat'],
      ['Samples stored', dd.samples + ' (every 5 min)'],
      ['Data window', dd.hours >= 48 ? Math.round(dd.hours / 24) + ' days' : dd.hours + ' h']
    ].map(function (r) { return '<div class="nr"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('');
    $('#ccSub').textContent = n.counted > 1 ? 'Averaging the thermostat and ' + (n.counted - 1) + ' room sensor' + (n.counted === 2 ? '' : 's') + '.' : 'Every sensor, the whole house, and what to do about it.';
  }
  var insChart = null;
  function loadInsights() {
    Promise.all([api('GET', '/api/history?hours=' + range), api('GET', '/api/insights'), api('GET', '/api/events')]).then(function (a) {
      INS = a[1]; EVT = a[2];
      insChart = insChart || makeChart($('#chart'), $('#chartLegend'));
      insChart.setMode(S && S.thermostat && S.thermostat.mode); insChart.set(a[0], range);
      $$('#rangeSeg button').forEach(function (b) { b.classList.toggle('on', +b.dataset.h === range); });
      drawBars(a[1].daily); lastHist = a[0]; drawHumidity();
      $('#findings').innerHTML = (a[1].findings.length ? a[1].findings : ['Nothing unusual. Cold Front will flag short cycling, wall changes, humidity and sensor gaps here.']).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('');
      var tt = a[1].totals; $('#totals').textContent = (!tt.heatMin && !tt.coolMin) ? 'The system has not run in this window yet, or the thermostat has only just been added. Totals build up as it heats and cools.' : 'Heating ' + Math.round(tt.heatMin / 60 * 10) / 10 + ' h, cooling ' + Math.round(tt.coolMin / 60 * 10) / 10 + ' h' + (tt.cost != null ? ', about $' + tt.cost.toFixed(2) + ' heating' : '') + '.';
      renderCommand(a[1]);
      $('#events').innerHTML = a[2].events.map(function (e) { return '<li><time>' + esc(new Date(e.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</time>' + esc(e.msg) + '</li>'; }).join('');
      updateWidgets();
    }).catch(function (e) { toast(e.message); });
  }
  $$('#rangeSeg button').forEach(function (b) { b.onclick = function () { range = +b.dataset.h; loadInsights(); }; });
  $('#noteForm').onsubmit = function (e) {
    e.preventDefault();
    var v = $('#noteIn').value.trim(); if (!v) return;
    if (egg(v)) { $('#noteIn').value = ''; return; }
    api('POST', '/api/events', { text: v }).then(function () { $('#noteIn').value = ''; loadInsights(); }).catch(function (er) { toast(er.message); });
  };

  // ---- settings
  function fillSettings(force) {
    if (!S || (settingsLoaded && !force)) return;
    settingsLoaded = true;
    var s = S.settings, l = s.limits;
    renderWxSetting();
    $('#setName').value = s.name || ''; $('#setEnforce').checked = s.enforce; $('#setKeepAuto').checked = s.keepAuto !== false; $('#pinVal').value = s.pin || ''; $('#setWall').value = s.wallChange;
    $('#setRA').checked = s.roomAware.enabled; $('#setMax').value = s.roomAware.maxOffset;
    $('#setRoom').innerHTML = '<option value="avg"' + (s.roomAware.roomId === 'avg' ? ' selected' : '') + '>All rooms (average)</option>' + S.sensors.map(function (r) { return '<option value="' + esc(r.nodeId) + '"' + (String(s.roomAware.roomId) === String(r.nodeId) ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('') || '<option value="">(no sensors yet)</option>';
    $('#limHeatMin').value = l.heatMin; $('#limHeatMax').value = l.heatMax; $('#limCoolMin').value = l.coolMin; $('#limCoolMax').value = l.coolMax; $('#limGap').value = l.minGap;
    $('#humMin').value = s.humidity.min; $('#humMax').value = s.humidity.max; $('#setCost').value = s.costPerHour; $('#setTz').value = s.tz;
    var fl = s.filter; $('#fName').value = fl.name; $('#fLast').value = fl.lastChanged || ''; $('#fEvery').value = fl.intervalDays; $('#fLead').value = fl.remindDaysBefore;
    var n = s.ntfy; $('#nEnabled').checked = n.enabled; $('#nServer').value = n.server; $('#nTopic').value = n.topic; $('#nToken').value = ''; $('#nToken').placeholder = n.hasToken ? '(saved, leave blank to keep)' : '';
    $('#nTriggers').innerHTML = Object.keys(S.triggers).map(function (k) { return '<label class="check"><input type="checkbox" data-trig="' + esc(k) + '"' + (n.triggers[k] ? ' checked' : '') + '> ' + esc(S.triggers[k]) + '</label>'; }).join('');
    $('#ver').textContent = 'v' + S.version;
    var a = S.adapter;
    $('#conn').innerHTML = '<p>' + (S.mode === 'demo' ? 'Demo mode: a built-in simulator is standing in for the thermostat.' : a.connected ? 'Live: connected to the Z-Wave JS server.' : 'Live: not connected. ' + esc(a.error || '')) + '</p>';
    $('#reconnectBtn').hidden = S.mode !== 'live';
    var mt = $('#modeToggle'); mt.textContent = S.mode === 'demo' ? 'Switch to Live' : 'Switch to Demo'; mt.disabled = S.mode === 'demo' && !S.zwaveConfigured;
  }
  function reconnect(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Reconnecting…'; }
    api('POST', '/api/reconnect', {}).then(function () { toast('Reconnecting to Z-Wave…'); setTimeout(function () { refresh().then(function () { fillSettings(true); }); }, 3500); })
      .catch(function (e) { toast(e.message); }).then(function () { setTimeout(function () { if (btn) { btn.disabled = false; btn.textContent = 'Reconnect'; } }, 4000); });
  }
  $('#reconnectBtn').onclick = function () { reconnect(this); };
  $('#modeToggle').onclick = function () {
    api('PUT', '/api/settings', { mode: S.mode === 'demo' ? 'live' : 'demo' }).then(function () { toast('Switched'); return refresh(); }).then(function () { fillSettings(true); }).catch(function (e) { toast(e.message); });
  };
  $('#saveSettings').onclick = function () {
    var body = {
      name: $('#setName').value.trim(), enforce: $('#setEnforce').checked, keepAuto: $('#setKeepAuto').checked, wallChange: $('#setWall').value,
      roomAware: { enabled: $('#setRA').checked, roomId: $('#setRoom').value || null, maxOffset: +$('#setMax').value },
      limits: { heatMin: +$('#limHeatMin').value, heatMax: +$('#limHeatMax').value, coolMin: +$('#limCoolMin').value, coolMax: +$('#limCoolMax').value, minGap: +$('#limGap').value },
      humidity: { min: +$('#humMin').value, max: +$('#humMax').value }, costPerHour: +$('#setCost').value, tz: $('#setTz').value.trim()
    };
    if (S.sensors.length && body.roomAware.enabled && !body.roomAware.roomId) return toast('Pick a room for room-aware');
    api('PUT', '/api/settings', body).then(function () { $('#settingsMsg').textContent = 'Saved'; setTimeout(function () { $('#settingsMsg').textContent = ''; }, 2500); return refresh(); }).catch(function (e) { toast(e.message); });
  };
  $('#pinShow').onclick = function () { var i = $('#pinVal'); var show = i.type === 'password'; i.type = show ? 'text' : 'password'; this.textContent = show ? 'Hide' : 'Show'; };
  $('#pinSave').onclick = function () {
    var v = $('#pinVal').value.trim();
    api('PUT', '/api/settings', { pin: v }).then(function (r) { S.settings = r.settings; $('#pinMsg').textContent = v ? 'Saved' : 'Cleared'; setTimeout(function () { $('#pinMsg').textContent = ''; }, 2500); }).catch(function (e) { toast(e.message); });
  };
  function renderWxSetting() {
    var w = S && S.settings && S.settings.weather;
    $('#wxCurrent').textContent = w && w.lat != null ? 'Using ' + (w.name || (w.lat + ', ' + w.lon)) : 'No location set.';
    $('#wxClear').style.display = w && w.lat != null ? '' : 'none';
  }
  $('#wxSearch').onclick = function () {
    var q = $('#wxQuery').value.trim(); if (q.length < 2) { toast('Type a town or city'); return; }
    $('#wxResults').innerHTML = '<p class="hint">Searching…</p>';
    api('GET', '/api/weather/search?q=' + encodeURIComponent(q)).then(function (r) {
      $('#wxResults').innerHTML = r.results.length ? r.results.map(function (x, i) { return '<button class="btn wxpick" data-i="' + i + '">' + esc(x.name) + '</button>'; }).join('') : '<p class="hint">No match. Try the town name alone.</p>';
      $$('#wxResults .wxpick').forEach(function (btn) {
        btn.onclick = function () {
          var x = r.results[+btn.dataset.i];
          api('PUT', '/api/settings', { weather: { lat: x.lat, lon: x.lon, name: x.name } }).then(function (r2) { S.settings = r2.settings; $('#wxResults').innerHTML = ''; renderWxSetting(); loadWeather(true); toast('Weather location saved'); }).catch(function (e) { toast(e.message); });
        };
      });
    }).catch(function (e) { $('#wxResults').innerHTML = ''; toast(e.message); });
  };
  $('#wxQuery').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#wxSearch').click(); } };
  $('#wxClear').onclick = function () { api('PUT', '/api/settings', { weather: null }).then(function (r) { S.settings = r.settings; renderWxSetting(); WX.data = { configured: false }; updateWidgets(); toast('Weather location cleared'); }).catch(function (e) { toast(e.message); }); };
  $('#saveFilter').onclick = function () {
    api('PUT', '/api/settings', { filter: { name: $('#fName').value, lastChanged: $('#fLast').value || null, intervalDays: +$('#fEvery').value, remindDaysBefore: +$('#fLead').value } })
      .then(function () { $('#filterMsg').textContent = 'Saved'; setTimeout(function () { $('#filterMsg').textContent = ''; }, 2500); return refresh(); }).catch(function (e) { toast(e.message); });
  };
  $('#filterToday').onclick = markFilter;
  function ntfyBody() {
    var tr = {}; $$('#nTriggers [data-trig]').forEach(function (c) { tr[c.dataset.trig] = c.checked; });
    var b = { enabled: $('#nEnabled').checked, server: $('#nServer').value.trim(), topic: $('#nTopic').value.trim(), triggers: tr };
    if ($('#nToken').value.trim()) b.token = $('#nToken').value.trim();
    return b;
  }
  $('#saveNtfy').onclick = function () {
    api('PUT', '/api/settings', { ntfy: ntfyBody() }).then(function () { $('#ntfyMsg').textContent = 'Saved'; setTimeout(function () { $('#ntfyMsg').textContent = ''; }, 2500); return refresh(); }).then(function () { fillSettings(true); }).catch(function (e) { toast(e.message); });
  };
  $('#testNtfy').onclick = function () {
    api('PUT', '/api/settings', { ntfy: ntfyBody() }).then(function () { return api('POST', '/api/ntfy/test', {}); }).then(function () { toast('Test sent. Check your phone.'); return refresh(); }).catch(function (e) { toast(e.message); });
  };
  $('#nClearTok').onclick = function () { api('PUT', '/api/settings', { ntfy: { clearToken: true } }).then(function () { toast('Token cleared'); return refresh(); }).then(function () { fillSettings(true); }).catch(function (e) { toast(e.message); }); };
  $('#restoreFile').onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(function (t) { return api('POST', '/api/restore', JSON.parse(t)); }).then(function () { toast('Restored'); sched = null; settingsLoaded = false; return refresh(); }).catch(function (er) { toast(er.message || 'Not a Cold Front backup'); });
    e.target.value = '';
  };

  // ---- easter egg: /cw or /coldfront in the note box, or the Konami code there
  var FIRE = [
    '        )  (        ', '       (    )       ', '      ) \\  / (      ', '     (   )(   )     ', '    ) (  )(  ) (    ',
    '   (   \\ || /   )   ', '    )   \\||/   (    ', '  ____\\_||_/____    ', ' |  _   __   _  |   ', ' | |_| |__| |_| |   ', ' |_______________|   '];
  var MORSE = { S: '...', T: '-', A: '.-', Y: '-.--', W: '.--', R: '.-.', M: '--' };
  function egg(v) {
    var k = v.toLowerCase();
    if (k !== '/cw' && k !== '/coldfront' && k !== '/konami') return false;
    var e = $('#egg'), m = '';
    if (k === '/cw') {
      'STAY WARM'.split('').forEach(function (ch) { if (ch === ' ') { m += '<span style="width:24px"></span>'; return; } MORSE[ch].split('').forEach(function (s) { m += '<i class="' + (s === '.' ? 'dot' : 'dash') + '"></i>'; }); m += '<span style="width:12px"></span>'; });
    }
    e.innerHTML = '<pre>' + FIRE.join('\n') + '</pre>' + (m ? '<div class="morse">' + m + '</div><small>... - .- -.--   .-- .- .-. --</small>' : '<small>Stay warm.</small>') + '<small>tap to close</small>';
    e.hidden = false; e.onclick = function () { e.hidden = true; };
    return true;
  }
  var KON = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'], kp = 0;
  $('#noteIn').addEventListener('keydown', function (e) { kp = (e.key === KON[kp]) ? kp + 1 : (e.key === KON[0] ? 1 : 0); if (kp === KON.length) { kp = 0; egg('/coldfront'); } });


  // ---- light / dark toggle
  function setTheme(t) {
    applyTheme(t);
    try { localStorage.setItem('cf.theme', t); if (t !== 'light') localStorage.setItem('cf.dark', t); } catch (e) { /* storage blocked */ }
    updateWidgets();
    if (inst.chart && inst.chart.chart) inst.chart.chart.draw();
    if (insChart) insChart.draw();
    drawHumidity();
    renderThemePicker();
  }
  function renderThemePicker() {
    var cur = document.documentElement.getAttribute('data-theme');
    $('#themeList').innerHTML = THEME_LIST.map(function (t) {
      return '<button type="button" class="themeopt' + (t.id === cur ? ' on' : '') + '" data-t="' + t.id + '" aria-pressed="' + (t.id === cur) + '"><span class="sw" style="background:' + t.bg + '"><i style="background:' + t.a + '"></i><i style="background:' + t.b + '"></i><i style="background:' + t.c + '"></i><em></em></span>' + t.name + '</button>';
    }).join('');
    $$('#themeList .themeopt').forEach(function (b) { b.onclick = function () { setTheme(b.dataset.t); }; });
  }
  $('#themeBtn').onclick = function () {
    var dark = 'dark'; try { dark = localStorage.getItem('cf.dark') || 'dark'; } catch (e) { /* storage blocked */ }
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? dark : 'light');
  };
  renderThemePicker();

  // ---- polling
  function renderGlobal() {
    $('#demoBadge').hidden = S.mode !== 'demo'; $('#demoBadge2').hidden = S.mode !== 'demo'; greet();
    $('#alerts').innerHTML = S.alerts.map(function (a) { return '<div class="alert ' + esc(a.level) + '">' + esc(a.text) + (a.key === 'link' && S.mode === 'live' ? ' <button type="button" class="btn sm" data-reconnect>Reconnect</button>' : '') + (a.key === 'modeauto' ? ' <button type="button" class="btn sm" data-auto>Switch to Auto</button>' : '') + '</div>'; }).join('');
    $$('#alerts [data-auto]').forEach(function (b) { b.onclick = function () { setModeAuto(b); }; });
    $$('#alerts [data-reconnect]').forEach(function (b) { b.onclick = function () { reconnect(b); }; });
  }
  function refresh() {
    return api('GET', '/api/state').then(function (s) {
      var first = !S; S = s;
      if (first) { loadLayout(); buildDash(); }
      renderGlobal(); updateWidgets();
      if (activeTab === 'rooms' && !document.activeElement.closest('.rrow')) renderRooms();
      if (!settingsLoaded) fillSettings();
    }).catch(function () { var s = $('.status'); if (s) s.textContent = 'Cannot reach Cold Front. Retrying…'; });
  }
  showTab('dashboard');
  refresh().then(loadExtras); setInterval(refresh, 5000); setInterval(loadExtras, 60000);
  setInterval(function () { if (activeTab === 'dashboard' && inst.chart && inst.chart.fetch) inst.chart.fetch(); }, 30000);
  window.addEventListener('resize', function () { if (activeTab === 'insights') { if (insChart) insChart.draw(); drawBars(lastDaily); drawHumidity(); } });
})();
