(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var S = null;            // latest /api/state
  var sched = null;        // editable schedule copy
  var curDay = 'mon';
  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var LBL = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
  var pending = null, pendTimer = null, range = window.__range = 24, activeTab = 'home', schedDirty = false, settingsLoaded = false;

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

  // ---- tabs & skins
  $$('.tabs button').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });
  function showTab(t) {
    activeTab = t;
    $$('.tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === t); });
    $$('.tab').forEach(function (s) { s.classList.toggle('active', s.id === 'tab-' + t); });
    window.scrollTo(0, 0);
    if (t === 'home') setTimeout(homeChart, 0);
    if (t === 'schedule' && !sched) loadSchedule();
    if (t === 'insights') loadInsights();
    if (t === 'settings') fillSettings(true);
    if (t === 'rooms') renderRooms();
  }
  var SK = ['phosphor', 'amber', 'ice', 'nightred', 'paper'];
  $('#skinBtn').onclick = function () {
    var cur = document.documentElement.getAttribute('data-skin'), n = SK[(SK.indexOf(cur) + 1) % SK.length];
    document.documentElement.setAttribute('data-skin', n);
    try { localStorage.setItem('ht.skin', n); } catch (e) { /* ignore */ }
    toast('theme: ' + n);
    renderDial(); if (activeTab === 'insights') loadInsights();
  };

  // ---- home
  function pair() { return pending || (S && S.desired ? { heat: S.desired.heat, cool: S.desired.cool } : (S && S.thermostat ? { heat: S.thermostat.heat, cool: S.thermostat.cool } : null)); }
  function renderDial() {
    if (!S) return;
    var t = S.thermostat, p = pair(), cs = getComputedStyle(document.documentElement);
    var heat = cs.getPropertyValue('--heat').trim(), cool = cs.getPropertyValue('--cool').trim(), line = cs.getPropertyValue('--line').trim(), txt = cs.getPropertyValue('--text').trim(), mute = cs.getPropertyValue('--mute').trim();
    var cx = 150, cy = 150, r = 120, a0 = 135, sweep = 270, lo = 50, hi = 90;
    function pt(v, rr) { var a = (a0 + sweep * (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * Math.PI / 180; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; }
    function arc(v1, v2, col, w) { var s = pt(v1, r), e = pt(v2, r), large = (v2 - v1) / (hi - lo) * sweep > 180 ? 1 : 0; return '<path d="M' + s[0] + ' ' + s[1] + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + e[0] + ' ' + e[1] + '" fill="none" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="butt"/>'; }
    var h = arc(lo, hi, line, 12);
    if (p) { h += arc(lo, Math.max(lo + .1, p.heat), heat, 12).replace('stroke-linecap="butt"', 'stroke-linecap="butt" opacity=".35"'); }
    if (p) { var m1 = pt(p.heat, r), m2 = pt(p.cool, r); h += '<circle cx="' + m1[0] + '" cy="' + m1[1] + '" r="9" fill="' + heat + '"/><circle cx="' + m2[0] + '" cy="' + m2[1] + '" r="9" fill="' + cool + '"/>'; }
    if (t && t.temp != null) { var c = pt(t.temp, r - 22); h += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="4" fill="' + txt + '"/>'; }
    h += '<text x="150" y="160" text-anchor="middle" font-size="64" font-weight="700" fill="' + txt + '">' + fmtT(t && t.temp) + '°</text>';
    h += '<text x="150" y="192" text-anchor="middle" font-size="15" fill="' + mute + '">' + (t && t.humidity != null ? Math.round(t.humidity) + '% humidity' : 'indoor') + '</text>';
    var op = t ? ({ heating: 'Heating', cooling: 'Cooling', fan: 'Fan running', idle: 'Idle' }[t.opState] || '') : '';
    h += '<text x="150" y="112" text-anchor="middle" font-size="15" fill="' + (t && t.opState === 'heating' ? heat : t && t.opState === 'cooling' ? cool : mute) + '">' + op + '</text>';
    $('#dial').innerHTML = '<svg viewBox="0 0 300 260" role="img" aria-label="Indoor temperature">' + h + '</svg>';
  }
  function renderHome() {
    var t = S.thermostat, d = S.desired, p = pair();
    $('#demoBadge').hidden = S.mode !== 'demo';
    $('#heatVal').textContent = p ? p.heat + '°' : '--';
    $('#coolVal').textContent = p ? p.cool + '°' : '--';
    var st = '';
    if (!S.adapter.connected) st = 'Waiting for the Z-Wave server…';
    else if (!t) st = 'No thermostat paired yet';
    else if (S.away) st = 'Away' + (S.away.until ? ' until ' + fmtClock(S.away.until) : '');
    else if (d) st = d.label + (S.next ? ' · next: ' + S.next.name + ' at ' + fmtClock(S.next.at) : '');
    if (d && d.adjust) st += ' · room-adjusted ' + (d.adjust > 0 ? '+' : '') + d.adjust + '°';
    $('#statusLine').textContent = st;
    $$('#modeSeg button').forEach(function (b) { b.classList.toggle('on', t && t.mode === b.dataset.mode); });
    $$('#fanSeg button').forEach(function (b) { b.classList.toggle('on', t && t.fan === b.dataset.fan); });
    $('#awayBtn').textContent = S.away ? 'Back home' : 'Away';
    $('#awayBtn').classList.toggle('on', !!S.away);
    var hb = $('#holdBar'), hi = $('#holdInfo');
    hb.hidden = !pending;
    if (S.hold && !pending) {
      hi.hidden = false;
      hi.innerHTML = '<span>Hold ' + S.hold.heat + '/' + S.hold.cool + (S.hold.until ? ' until ' + esc(fmtClock(S.hold.until)) : ' until cancelled') + '</span><button class="btn" id="clrHold">Resume schedule</button>';
      $('#clrHold').onclick = function () { api('DELETE', '/api/hold').then(refresh).catch(function (e) { toast(e.message); }); };
    } else hi.hidden = true;
    var rs = S.sensors.map(function (r) {
      return '<div class="room' + (r.include ? '' : ' off') + '"><div class="n">' + esc(r.name) + '</div><div class="t">' + fmtT(r.temp) + '°</div><div class="h">' + (r.humidity != null ? Math.round(r.humidity) + '%' : '') + '</div></div>';
    }).join('');
    $('#roomStrip').innerHTML = rs || '<p class="hint">No room sensors yet. Add them on the Rooms tab.</p>';
    var al = S.alerts.map(function (a) { return '<div class="alert ' + esc(a.level) + '">' + esc(a.text) + '</div>'; }).join('');
    $('#alerts').innerHTML = al;
    renderFilter();
    renderDial();
  }
  function renderFilter() {
    var f = S.filter, b = $('#filterBody');
    if (!f.configured) { b.innerHTML = '<p class="hint">No filter date set. Enter the last change date and interval in Settings to get reminders.</p><button class="btn" id="fSet">Set up</button>'; $('#fSet').onclick = function () { showTab('settings'); }; return; }
    var pct = Math.max(0, Math.min(100, Math.round(f.daysSince / f.intervalDays * 100)));
    var msg = f.state === 'overdue' ? 'Overdue by ' + (-f.daysLeft) + ' day' + (f.daysLeft === -1 ? '' : 's') : f.daysLeft === 0 ? 'Due today' : f.daysLeft + ' day' + (f.daysLeft === 1 ? '' : 's') + ' left';
    b.innerHTML = '<div class="fbody ' + esc(f.state) + '"><div class="big">' + esc(msg) + '</div><div class="fbar"><i style="width:' + pct + '%"></i></div><div class="hint">' + esc(f.name) + ' · changed ' + esc(f.lastChanged) + ' · due ' + esc(f.dueDate) + ' · every ' + f.intervalDays + ' days</div></div><button class="btn" id="fDone">Changed today</button>';
    $('#fDone').onclick = markFilter;
  }
  function markFilter() {
    api('POST', '/api/filter/changed', {}).then(function () { toast('Filter marked changed'); settingsLoaded = false; return refresh(); }).then(function () { if (activeTab === 'settings') fillSettings(true); }).catch(function (e) { toast(e.message); });
  }
  $$('[data-step]').forEach(function (b) {
    b.onclick = function () {
      var p = pair(); if (!p) return;
      p = { heat: p.heat, cool: p.cool };
      var k = b.dataset.step, lim = S.settings.limits, gap = lim.minGap;
      p[k] += +b.dataset.d;
      if (k === 'heat') { p.heat = Math.min(lim.heatMax, Math.max(lim.heatMin, p.heat)); if (p.cool < p.heat + gap) p.cool = Math.min(lim.coolMax, p.heat + gap); }
      else { p.cool = Math.min(lim.coolMax, Math.max(lim.coolMin, p.cool)); if (p.heat > p.cool - gap) p.heat = Math.max(lim.heatMin, p.cool - gap); }
      pending = p; renderHome();
      clearTimeout(pendTimer);
      pendTimer = setTimeout(function () { sendHold('next'); }, 1600);
    };
  });
  function sendHold(u) {
    clearTimeout(pendTimer);
    if (!pending) return;
    var p = pending, until = u === 'next' ? 'next' : (+u > 0 ? +u : null);
    api('POST', '/api/setpoints', { heat: p.heat, cool: p.cool, until: until }).then(function () { pending = null; toast('Hold set'); return refresh(); }).catch(function (e) { pending = null; toast(e.message); refresh(); });
  }
  $$('[data-hold]').forEach(function (b) { b.onclick = function () { sendHold(b.dataset.hold === '0' ? null : b.dataset.hold); }; });
  $$('#modeSeg button').forEach(function (b) { b.onclick = function () { api('POST', '/api/mode', { mode: b.dataset.mode }).then(refresh).catch(function (e) { toast(e.message); }); }; });
  $$('#fanSeg button').forEach(function (b) { b.onclick = function () { api('POST', '/api/fan', { fan: b.dataset.fan }).then(refresh).catch(function (e) { toast(e.message); }); }; });
  $('#awayBtn').onclick = function () { api('POST', '/api/away', { on: !S.away }).then(refresh).catch(function (e) { toast(e.message); }); };

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

  // ---- insights
  function loadInsights() {
    Promise.all([api('GET', '/api/history?hours=' + range), api('GET', '/api/insights'), api('GET', '/api/events')]).then(function (a) {
      drawChart(a[0]); drawBars(a[1].daily);
      $('#findings').innerHTML = (a[1].findings.length ? a[1].findings : ['Nothing unusual. Cold Front will flag short cycling, wall changes, humidity and sensor gaps here.']).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('');
      var tt = a[1].totals; $('#totals').textContent = 'Heating ' + Math.round(tt.heatMin / 60 * 10) / 10 + ' h, cooling ' + Math.round(tt.coolMin / 60 * 10) / 10 + ' h' + (tt.cost != null ? ', about $' + tt.cost.toFixed(2) + ' heating' : '') + '.';
      $('#roomStats').innerHTML = a[1].rooms.length ? a[1].rooms.map(function (r) {
        return '<div class="rstat"><b>' + esc(r.name) + '</b><span>avg ' + fmtT(r.avgTemp) + '°</span><span>' + fmtT(r.minTemp) + '–' + fmtT(r.maxTemp) + '°</span><span>' + (r.avgHum != null ? Math.round(r.avgHum) + '%' : '') + '</span></div>';
      }).join('') : '<p class="hint">No room sensors reporting yet.</p>';
      $('#events').innerHTML = a[2].events.map(function (e) { return '<li><time>' + esc(new Date(e.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</time>' + esc(e.msg) + '</li>'; }).join('');
    }).catch(function (e) { toast(e.message); });
  }
  $$('#rangeSeg button').forEach(function (b) { b.onclick = function () { range = window.__range = +b.dataset.h; loadInsights(); }; });
  function setup(c, h) { var dpr = window.devicePixelRatio || 1, w = c.clientWidth; c.width = w * dpr; c.height = h * dpr; var x = c.getContext('2d'); x.scale(dpr, dpr); return { x: x, w: w, h: h }; }
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function drawChart(hist, cv, hrs) {
    var range = hrs || window.__range, c = cv || $('#chart'), ch = window.innerWidth >= 1000 ? 340 : 220, g = setup(c, ch), x = g.x, W = g.w, H = g.h, padL = 34, padB = 20, padT = 8;
    x.clearRect(0, 0, W, H);
    var s = hist.samples; if (!cv) $$('#rangeSeg button').forEach(function (b) { b.classList.toggle('on', +b.dataset.h === range); });
    if (!s.length) { x.fillStyle = css('--mute'); x.fillText('No data yet', 10, 20); return; }
    var t1 = s[s.length - 1].t, t0 = t1 - range * 3600000, vals = [];
    s.forEach(function (p) { [p.in, p.heat, p.cool].forEach(function (v) { if (v != null) vals.push(v); }); });
    var mn = Math.floor(Math.min.apply(null, vals) - 1), mx = Math.ceil(Math.max.apply(null, vals) + 1);
    function X(t) { return padL + (t - t0) / (t1 - t0) * (W - padL - 6); }
    function Y(v) { return padT + (mx - v) / (mx - mn) * (H - padT - padB); }
    x.strokeStyle = css('--line'); x.fillStyle = css('--mute'); x.font = '11px sans-serif'; x.lineWidth = 1;
    var step = (mx - mn) > 20 ? 5 : 2;
    for (var v = Math.ceil(mn / step) * step; v <= mx; v += step) { x.beginPath(); x.moveTo(padL, Y(v)); x.lineTo(W - 6, Y(v)); x.stroke(); x.fillText(v, 4, Y(v) + 4); }
    var ticks = range <= 24 ? 6 : range <= 72 ? 6 : 7;
    for (var i = 0; i <= ticks; i++) { var tt = t0 + (t1 - t0) * i / ticks, d = new Date(tt); x.fillText(range <= 24 ? d.toLocaleTimeString([], { hour: 'numeric' }) : d.toLocaleDateString([], { weekday: 'short' }), X(tt) - 12, H - 4); }
    x.globalAlpha = .18; x.fillStyle = css('--accent');
    hist.runs.forEach(function (r) { if (r.kind === 'fan') return; var a = Math.max(r.start, t0), b = Math.min(r.end || t1, t1); if (b > a) x.fillRect(X(a), padT, Math.max(1, X(b) - X(a)), H - padT - padB); });
    x.globalAlpha = 1;
    function line(key, col, w, dash) { x.strokeStyle = col; x.lineWidth = w; x.setLineDash(dash || []); x.beginPath(); var on = false; s.forEach(function (p) { if (p.t < t0 || p[key] == null) { on = false; return; } if (!on) { x.moveTo(X(p.t), Y(p[key])); on = true; } else x.lineTo(X(p.t), Y(p[key])); }); x.stroke(); x.setLineDash([]); }
    line('heat', css('--heat'), 1.5, [4, 3]); line('cool', css('--cool'), 1.5, [4, 3]); line('in', css('--text'), 2.2);
  }
  function drawBars(daily) {
    var c = $('#bars'), bh = window.innerWidth >= 1000 ? 240 : 170, g = setup(c, bh), x = g.x, W = g.w, H = g.h, d = daily.slice(-7);
    x.clearRect(0, 0, W, H);
    if (!d.length) return;
    var mx = Math.max.apply(null, d.map(function (r) { return Math.max(r.heatMin, r.coolMin, 60); })) / 60, bw = (W - 20) / d.length;
    x.font = '11px sans-serif';
    d.forEach(function (r, i) {
      var bx = 10 + i * bw + bw * .15, w = bw * .7, hh = r.heatMin / 60 / mx * (H - 36), ch = r.coolMin / 60 / mx * (H - 36);
      x.fillStyle = css('--heat'); x.fillRect(bx, H - 22 - hh, w, hh);
      x.fillStyle = css('--cool'); x.fillRect(bx, H - 22 - hh - ch, w, ch);
      x.fillStyle = css('--mute'); x.fillText(r.date.slice(5), bx, H - 6);
      if (r.heatMin + r.coolMin) { x.fillStyle = css('--text'); x.fillText(Math.round((r.heatMin + r.coolMin) / 6) / 10 + 'h', bx, H - 26 - hh - ch); }
    });
  }
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
    $('#setEnforce').checked = s.enforce; $('#setWall').value = s.wallChange;
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
      enforce: $('#setEnforce').checked, wallChange: $('#setWall').value,
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

  // ---- polling
  function refresh() {
    return api('GET', '/api/state').then(function (s) {
      S = s; renderHome();
      if (activeTab === 'rooms' && !document.activeElement.closest('.rrow')) renderRooms();
      if (!settingsLoaded) fillSettings();
    }).catch(function () { $('#statusLine').textContent = 'Cannot reach Cold Front. Retrying…'; });
  }
  function homeChart() {
    if (window.innerWidth < 1000 || activeTab !== 'home') return;
    api('GET', '/api/history?hours=24').then(function (h) { drawChart(h, $('#homeChart'), 24); }).catch(function () {});
  }
  refresh().then(homeChart); setInterval(refresh, 5000); setInterval(homeChart, 30000);
  window.addEventListener('resize', function () { if (activeTab === 'insights') loadInsights(); });
})();
