(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var S = null;            // latest /api/state
  var sched = null;        // editable schedule copy
  var curDay = 'mon';
  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var LBL = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
  var pending = null, pendTimer = null, range = 24, activeTab = 'dashboard', schedDirty = false, settingsLoaded = false;
  var INS = null, EVT = null;
  var FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, Roboto, sans-serif';
  var THEMES = {
    dark: { heat: '#ffb347', cool: '#5fd0ff', ink: '#ffffff', mute: 'rgba(255,255,255,.62)', faint: 'rgba(255,255,255,.38)', grid: 'rgba(255,255,255,.08)', grid2: 'rgba(255,255,255,.05)', lane: 'rgba(255,255,255,.07)', dialTrack: 'rgba(255,255,255,.12)', dialBand: 'rgba(255,255,255,.3)', fillTop: 'rgba(255,255,255,.22)', fillBot: 'rgba(255,255,255,0)', halo: 'rgba(255,255,255,.3)', hover: 'rgba(255,255,255,.4)', pillFg: '#08203f', tipBg: 'rgba(10,24,50,.96)', tipEdge: 'rgba(255,255,255,.2)', tipText: '#ffffff', base: 'rgba(255,255,255,.12)' },
    light: { heat: '#e07a00', cool: '#1388d4', ink: '#0f2440', mute: 'rgba(15,36,64,.66)', faint: 'rgba(15,36,64,.42)', grid: 'rgba(15,36,64,.09)', grid2: 'rgba(15,36,64,.05)', lane: 'rgba(15,36,64,.08)', dialTrack: 'rgba(15,36,64,.10)', dialBand: 'rgba(31,111,255,.22)', fillTop: 'rgba(31,111,255,.20)', fillBot: 'rgba(31,111,255,0)', halo: 'rgba(31,111,255,.25)', hover: 'rgba(15,36,64,.4)', pillFg: '#ffffff', tipBg: 'rgba(255,255,255,.97)', tipEdge: 'rgba(15,36,64,.18)', tipText: '#0f2440', base: 'rgba(15,36,64,.14)' }
  };
  var COL = {};
  function applyTheme(t) {
    if (!THEMES[t]) t = 'light';
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', t === 'light' ? '#eaf4ff' : '#060d1c');
    Object.keys(THEMES[t]).forEach(function (k) { COL[k] = THEMES[t][k]; });
    COL.text = COL.ink;
  }
  applyTheme(document.documentElement.getAttribute('data-theme'));

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600); }
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
  var TITLES = { dashboard: 'Dashboard', schedule: 'Schedule', rooms: 'Rooms', insights: 'Insights', future: 'Future features', settings: 'Settings' };
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
    h += '<text x="150" y="188" text-anchor="middle" font-size="14" fill="' + COL.mute + '">' + (t && t.humidity != null ? Math.round(t.humidity) + '% humidity' : 'indoor') + '</text>';
    return '<svg viewBox="22 18 256 202" role="img" aria-label="Indoor temperature">' + h + '</svg>';
  }
  function sendHold(u) {
    clearTimeout(pendTimer);
    if (!pending) return;
    var p = pending, until = u === 'next' ? 'next' : (+u > 0 ? +u : null);
    api('POST', '/api/setpoints', { heat: p.heat, cool: p.cool, until: until }).then(function () { pending = null; toast('Hold set'); return refresh(); }).catch(function (e) { pending = null; toast(e.message); refresh(); });
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
          '<div class="holdbar" hidden><span>Hold for</span><button data-hold="next">Until next period</button><button data-hold="2">2 h</button><button data-hold="8">8 h</button><button data-hold="0">Until I cancel</button></div>' +
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
            pendTimer = setTimeout(function () { sendHold('next'); }, 1600);
          };
        });
        $$('[data-hold]', b).forEach(function (btn) { btn.onclick = function () { sendHold(btn.dataset.hold === '0' ? null : btn.dataset.hold); }; });
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
        else if (d) st = d.label + (S.next ? ' · next: ' + S.next.name + ' at ' + fmtClock(S.next.at) : '');
        if (d && d.adjust) st += ' · room-adjusted ' + (d.adjust > 0 ? '+' : '') + d.adjust + '°';
        $('.status', b).textContent = st;
        $('.holdbar', b).hidden = !pending;
        var hi = $('.holdinfo', b);
        if (S.hold && !pending) {
          hi.hidden = false;
          hi.innerHTML = '<span>Hold ' + S.hold.heat + '/' + S.hold.cool + (S.hold.until ? ' until ' + esc(fmtClock(S.hold.until)) : ' until cancelled') + '</span><button class="btn">Resume schedule</button>';
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
        $$('[data-mode]', b).forEach(function (x) { x.onclick = function () { api('POST', '/api/mode', { mode: x.dataset.mode }).then(refresh).catch(function (e) { toast(e.message); }); }; });
        $$('[data-fan]', b).forEach(function (x) { x.onclick = function () { api('POST', '/api/fan', { fan: x.dataset.fan }).then(refresh).catch(function (e) { toast(e.message); }); }; });
        $('.awayBtn', b).onclick = function () { api('POST', '/api/away', { on: !S.away }).then(refresh).catch(function (e) { toast(e.message); }); };
      },
      update: function (b) {
        var t = S.thermostat;
        $$('[data-mode]', b).forEach(function (x) { x.classList.toggle('on', !!t && t.mode === x.dataset.mode); });
        $$('[data-fan]', b).forEach(function (x) { x.classList.toggle('on', !!t && t.fan === x.dataset.fan); });
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
        if (!d) { el.innerHTML = '<p class="hint">No runtime yet.</p>'; return; }
        el.innerHTML = '<div class="pair"><div><b class="big sm heatt">' + hrs1(d.heatMin) + '</b><span class="k">Heating</span></div><div><b class="big sm coolt">' + hrs1(d.coolMin) + '</b><span class="k">Cooling</span></div></div>' +
          '<p class="hint" style="margin:4px 0 0;font-size:.78rem">' + d.cycles + ' cycle' + (d.cycles === 1 ? '' : 's') + (d.cost != null ? ' · about $' + d.cost.toFixed(2) : '') + '</p>';
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
          return '<div class="room' + (r.include ? '' : ' off') + '"><div class="n">' + esc(r.name) + '</div><div class="t">' + fmtT(r.temp) + '°' + (r.humidity != null ? '<span class="h">' + Math.round(r.humidity) + '%</span>' : '') + '</div></div>';
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
      var i = inst[e.id] = { card: card, body: $('.wbody', card), extra: $('.wextra', card) };
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
    return api('GET', '/api/schedule').then(function (r) { sched = r.schedule; schedDirty = false; renderSchedule(r.wall); });
  }
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
    api('PUT', '/api/schedule', { schedule: sched }).then(function (r) { sched = r.schedule; schedDirty = false; renderSchedule(r.wall); toast('Schedule saved'); refresh(); }).catch(function (e) { toast(e.message); });
  };

  // ---- rooms
  function renderRooms() {
    if (!S) return;
    $('#roomList').innerHTML = S.sensors.map(function (r) {
      return '<div class="rrow" data-id="' + esc(r.nodeId) + '"><div class="top2"><input type="text" value="' + esc(r.name) + '" maxlength="30" aria-label="Room name"><label class="check" style="margin:0"><input type="checkbox" ' + (r.include ? 'checked' : '') + '> Show</label></div>' +
        '<div class="meta">' + fmtT(r.temp) + '°F' + (r.humidity != null ? ' · ' + Math.round(r.humidity) + '% RH' : '') + (r.battery != null ? ' · battery ' + r.battery + '%' : '') + ' · node ' + esc(r.nodeId) + '</div></div>';
    }).join('') || '<p class="hint">No sensors yet. Any Z-Wave node that reports temperature and is not the thermostat shows up here on its own.</p>';
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
  var insChart = null;
  function loadInsights() {
    Promise.all([api('GET', '/api/history?hours=' + range), api('GET', '/api/insights'), api('GET', '/api/events')]).then(function (a) {
      INS = a[1]; EVT = a[2];
      insChart = insChart || makeChart($('#chart'), $('#chartLegend'));
      insChart.setMode(S && S.thermostat && S.thermostat.mode); insChart.set(a[0], range);
      $$('#rangeSeg button').forEach(function (b) { b.classList.toggle('on', +b.dataset.h === range); });
      drawBars(a[1].daily);
      $('#findings').innerHTML = (a[1].findings.length ? a[1].findings : ['Nothing unusual. Cold Front will flag short cycling, wall changes, humidity and sensor gaps here.']).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('');
      var tt = a[1].totals; $('#totals').textContent = 'Heating ' + Math.round(tt.heatMin / 60 * 10) / 10 + ' h, cooling ' + Math.round(tt.coolMin / 60 * 10) / 10 + ' h' + (tt.cost != null ? ', about $' + tt.cost.toFixed(2) + ' heating' : '') + '.';
      $('#roomStats').innerHTML = a[1].rooms.length ? a[1].rooms.map(function (r) {
        return '<div class="rstat"><b>' + esc(r.name) + '</b><span>avg ' + fmtT(r.avgTemp) + '°</span><span>' + fmtT(r.minTemp) + '–' + fmtT(r.maxTemp) + '°</span><span>' + (r.avgHum != null ? Math.round(r.avgHum) + '%' : '') + '</span></div>';
      }).join('') : '<p class="hint">No room sensors reporting yet.</p>';
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
    $('#setName').value = s.name || ''; $('#setEnforce').checked = s.enforce; $('#setWall').value = s.wallChange;
    $('#setRA').checked = s.roomAware.enabled; $('#setMax').value = s.roomAware.maxOffset;
    $('#setRoom').innerHTML = S.sensors.map(function (r) { return '<option value="' + esc(r.nodeId) + '"' + (String(s.roomAware.roomId) === String(r.nodeId) ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('') || '<option value="">(no sensors yet)</option>';
    $('#limHeatMin').value = l.heatMin; $('#limHeatMax').value = l.heatMax; $('#limCoolMin').value = l.coolMin; $('#limCoolMax').value = l.coolMax; $('#limGap').value = l.minGap;
    $('#humMin').value = s.humidity.min; $('#humMax').value = s.humidity.max; $('#setCost').value = s.costPerHour; $('#setTz').value = s.tz;
    var fl = s.filter; $('#fName').value = fl.name; $('#fLast').value = fl.lastChanged || ''; $('#fEvery').value = fl.intervalDays; $('#fLead').value = fl.remindDaysBefore;
    var n = s.ntfy; $('#nEnabled').checked = n.enabled; $('#nServer').value = n.server; $('#nTopic').value = n.topic; $('#nToken').value = ''; $('#nToken').placeholder = n.hasToken ? '(saved, leave blank to keep)' : '';
    $('#nTriggers').innerHTML = Object.keys(S.triggers).map(function (k) { return '<label class="check"><input type="checkbox" data-trig="' + esc(k) + '"' + (n.triggers[k] ? ' checked' : '') + '> ' + esc(S.triggers[k]) + '</label>'; }).join('');
    $('#ver').textContent = 'v' + S.version;
    var a = S.adapter;
    $('#conn').innerHTML = '<p>' + (S.mode === 'demo' ? 'Demo mode: a built-in simulator is standing in for the thermostat.' : a.connected ? 'Live: connected to the Z-Wave JS server.' : 'Live: not connected. ' + esc(a.error || '')) + '</p>';
    var mt = $('#modeToggle'); mt.textContent = S.mode === 'demo' ? 'Switch to Live' : 'Switch to Demo'; mt.disabled = S.mode === 'demo' && !S.zwaveConfigured;
  }
  $('#modeToggle').onclick = function () {
    api('PUT', '/api/settings', { mode: S.mode === 'demo' ? 'live' : 'demo' }).then(function () { toast('Switched'); return refresh(); }).then(function () { fillSettings(true); }).catch(function (e) { toast(e.message); });
  };
  $('#saveSettings').onclick = function () {
    var body = {
      name: $('#setName').value.trim(), enforce: $('#setEnforce').checked, wallChange: $('#setWall').value,
      roomAware: { enabled: $('#setRA').checked, roomId: $('#setRoom').value || null, maxOffset: +$('#setMax').value },
      limits: { heatMin: +$('#limHeatMin').value, heatMax: +$('#limHeatMax').value, coolMin: +$('#limCoolMin').value, coolMax: +$('#limCoolMax').value, minGap: +$('#limGap').value },
      humidity: { min: +$('#humMin').value, max: +$('#humMax').value }, costPerHour: +$('#setCost').value, tz: $('#setTz').value.trim()
    };
    if (S.sensors.length && body.roomAware.enabled && !body.roomAware.roomId) return toast('Pick a room for room-aware');
    api('PUT', '/api/settings', body).then(function () { $('#settingsMsg').textContent = 'Saved'; setTimeout(function () { $('#settingsMsg').textContent = ''; }, 2500); return refresh(); }).catch(function (e) { toast(e.message); });
  };
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
  $('#themeBtn').onclick = function () {
    var t = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(t);
    try { localStorage.setItem('cf.theme', t); } catch (e) { /* storage blocked */ }
    updateWidgets();
    if (inst.chart && inst.chart.chart) inst.chart.chart.draw();
    if (insChart) insChart.draw();
    drawBars(lastDaily);
  };

  // ---- polling
  function renderGlobal() {
    $('#demoBadge').hidden = S.mode !== 'demo'; $('#demoBadge2').hidden = S.mode !== 'demo'; greet();
    $('#alerts').innerHTML = S.alerts.map(function (a) { return '<div class="alert ' + esc(a.level) + '">' + esc(a.text) + '</div>'; }).join('');
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
  window.addEventListener('resize', function () { if (activeTab === 'insights') { if (insChart) insChart.draw(); drawBars(lastDaily); } });
})();
