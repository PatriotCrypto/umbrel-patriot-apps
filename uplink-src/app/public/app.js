'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: { 'X-AG': '1' } };
  if (opts.body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const r = await fetch(path, o);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
const fmtBytes = (n) => { if (n == null) return ''; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1000 && i < 4) { n /= 1000; i++; } return (n >= 100 || i === 0 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i]; };
const fmtDur = (s) => { if (!isFinite(s) || s <= 0) return ''; if (s < 60) return `${Math.ceil(s)} s`; const m = Math.round(s / 60); if (m < 60) return `${m} min`; return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const ago = (t) => { if (!t) return 'never heard'; const s = (Date.now() - t) / 1000; if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return new Date(t).toLocaleDateString(); };

let ST = null, sel = lsGet('ul.peer') || '', lastSig = '', stickBottom = true;
const uploads = []; // files being copied from this browser to this Umbrel

// ---------- rendering ----------
function render() {
  const me = ST.me;
  $('meBox').innerHTML = me.ready ? `<b>${esc(me.callsign)}</b> &nbsp;${esc(me.addr)}${me.port !== 3947 ? ':' + me.port : ''}` : 'Not set up yet';
  if (!ST.peers.find((p) => p.id === sel)) { sel = ST.peers[0] ? ST.peers[0].id : ''; if (sel) { lsSet('ul.peer', sel); setTimeout(poll, 0); } }
  renderStations();
  const p = ST.peers.find((x) => x.id === sel);
  $('ver').textContent = 'v' + ST.version;
  renderSignal(p); renderConsole(p);
  $('logHead').hidden = !p; $('composer').hidden = !p; $('log').hidden = !p;
  if (!p) { $('peerMenu').hidden = true; renderWelcome(); return; }
  $('welcome').hidden = true;
  $('lhDot').className = 'led ' + (p.online ? 'on' : 'off');
  $('lhName').textContent = p.name;
  $('lhMeta').textContent = p.online ? `linked${p.rtt ? ' · ' + p.rtt + ' ms' : ''}` : `out of reach · last heard ${ago(p.lastSeen)}${p.err ? ' · ' + p.err : ''}`;
  $('prompt').textContent = (me.callsign || 'you') + '>';
  $('dropName').textContent = p.name;
  renderLog(p);
}

function renderStations() {
  $('railEmpty').hidden = ST.peers.length > 0;
  $('stations').innerHTML = ST.peers.map((p) => `<li><button type="button" data-peer="${esc(p.id)}" aria-current="${p.id === sel}">
    <i class="led ${p.online ? 'on' : 'off'}"></i><span class="st-name">${esc(p.name)}</span>${p.unread && p.id !== sel ? `<span class="unread">${p.unread}</span>` : '<span></span>'}
    <span class="st-sub">${p.online ? 'linked' + (p.rtt ? ' · ' + p.rtt + ' ms' : '') : 'last heard ' + ago(p.lastSeen)}${p.queued ? ' · ' + p.queued + ' waiting' : ''}</span></button></li>`).join('');
}

function renderWelcome() {
  const w = $('welcome'); w.hidden = false;
  const form = $('linkForm');
  if (!ST.me.ready) {
    if (form.parentNode !== $('linkHome')) $('linkHome').appendChild(form);
    w.innerHTML = `<h2>SET UP THIS STATION</h2><p>Uplink links this Umbrel with another one over Tailscale, so the two of you can message and send files to each other directly. Nothing goes through anyone else's server.</p>
      <ol><li>Install the Tailscale app on this Umbrel and sign in.</li><li>Get the other Umbrel onto the same Tailscale network. See the README for two easy ways.</li><li>Give this station a name, paste its Tailscale address, then make an invite code for the other station.</li></ol>
      <div class="row"><button type="button" class="key go" data-open="setPanel">SET UP THIS STATION</button></div>`;
  } else if (form.parentNode !== w) {
    w.innerHTML = `<h2>LINK A STATION</h2><p>Send an invite code to the other person, or paste the code they sent you.</p>`;
    w.appendChild(form);
    if (ST.invite && !$('inviteCode').textContent) { $('inviteCode').textContent = ST.invite.code; $('inviteBox').hidden = false; }
  }
}

function fileCard(t, m) {
  if (!t) return `<div class="fcard"><div class="fn">File</div><div class="fs">No longer tracked</div></div>`;
  const pct = t.size ? Math.min(100, (t.done / t.size) * 100) : 100;
  const live = t.state === 'sending' || t.state === 'receiving';
  const eta = live && t.rate ? fmtDur((t.size - t.done) / t.rate) : '';
  let status;
  if (t.state === 'done') status = t.dir === 'in' ? `Received${t.savedAs ? ' · saved to ' + esc(t.savedAs) : ''}` : `Delivered${t.savedAs ? ' · saved as ' + esc(t.savedAs) : ''}`;
  else if (live) status = `${pct.toFixed(0)}% · ${fmtBytes(t.done)} of ${fmtBytes(t.size)}${t.rate ? ' · ' + fmtBytes(t.rate) + '/s' : ''}${eta ? ' · about ' + eta + ' left' : ''}`;
  else if (t.state === 'queued') status = t.done ? `Paused at ${pct.toFixed(0)}%, picks up when the link is back` : 'Waiting to send';
  else if (t.state === 'cancelled') status = 'Cancelled';
  else status = 'Failed';
  const acts = [];
  if (t.canOpen) acts.push(`<a class="key sm" href="api/file/${encodeURIComponent(t.id)}" download>DOWNLOAD</a>`);
  if (['queued', 'sending', 'receiving'].includes(t.state)) acts.push(`<button type="button" class="key sm" data-cancel="${esc(t.id)}">CANCEL</button>`);
  return `<div class="fcard"><div class="fn">${esc(t.name)}</div><div class="fs">${fmtBytes(t.size)} · ${status}</div>
    ${t.state !== 'done' && t.state !== 'cancelled' && t.state !== 'failed' ? `<div class="bar"><i data-w="${pct.toFixed(1)}"></i></div>` : ''}
    ${t.err && t.state !== 'done' ? `<div class="err">${esc(t.err)}</div>` : ''}${acts.length ? `<div class="fa">${acts.join('')}</div>` : ''}</div>`;
}

function renderLog(p) {
  const tmap = new Map(ST.transfers.map((t) => [t.id, t]));
  const items = ST.messages.slice();
  for (const u of uploads.filter((u) => u.peer === p.id)) items.push({ id: 'u' + u.n, dir: 'out', kind: 'upload', ts: u.ts, u });
  const sig = JSON.stringify([p.id, p.name, ST.me.callsign, items.map((m) => [m.id, m.state, m.u && Math.round(m.u.pct)]), ST.transfers]);
  if (sig === lastSig) return; lastSig = sig;
  const log = $('log');
  stickBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  let day = '', html = '';
  for (const m of items) {
    const d = new Date(m.ts).toDateString();
    if (d !== day) { day = d; html += `<div class="day">${esc(new Date(m.ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}</div>`; }
    const who = m.dir === 'in' ? p.name : ST.me.callsign || 'you';
    if (m.dir === 'sys') { html += `<div class="ln sys"><time>${hhmm(m.ts)}</time><span class="tag">SYS</span><div class="txt">${esc(m.text)}</div></div>`; continue; }
    let body;
    if (m.kind === 'file') body = fileCard(tmap.get(m.tid), m);
    else if (m.kind === 'upload') body = `<div class="fcard"><div class="fn">${esc(m.u.name)}</div><div class="fs">${m.u.err ? '<span class="err-t">' + esc(m.u.err) + '</span>' : `Copying to this Umbrel · ${m.u.pct.toFixed(0)}% of ${fmtBytes(m.u.size)}`}</div><div class="bar"><i data-w="${m.u.pct.toFixed(1)}"></i></div></div>`;
    else if (cwText(m.text) != null) body = `<span class="txt">${esc(cwText(m.text))}</span><span class="cw" title="Morse code">${esc(SFX.toMorse(cwText(m.text)))}</span>${m.dir === 'out' ? (m.state === 'queued' ? '<span class="st q">waiting for link</span>' : '<span class="st">✓ delivered</span>') : ''}`;
    else body = `<span class="txt">${esc(m.text)}</span>${m.dir === 'out' ? (m.state === 'queued' ? '<span class="st q">waiting for link</span>' : '<span class="st">✓ delivered</span>') : ''}`;
    html += `<div class="ln ${m.dir}"><time>${hhmm(m.ts)}</time><span class="tag">${m.dir === 'in' ? 'RX' : 'TX'}</span><div><span class="who">${esc(who)}</span>${body}</div></div>`;
  }
  log.innerHTML = html || `<div class="ln sys"><time></time><span class="tag">SYS</span><div class="txt">Linked. Say hello.</div></div>`;
  // bar widths without inline styles (the page forbids them)
  log.querySelectorAll('.bar i[data-w]').forEach((i) => { i.style.width = i.dataset.w + '%'; });
  if (stickBottom) log.scrollTop = log.scrollHeight;
}

// ---------- console ----------
const svgNS = 'http://www.w3.org/2000/svg';
function spark(series, opts = {}) {
  // series: [{ data:[...], cls:'rx' }]; draws filled lines on a shared scale
  const W = 300, H = 46, n = Math.max(2, ...series.map((s) => s.data.length));
  const max = Math.max(opts.min || 1, ...series.flatMap((s) => s.data)) * 1.15;
  let out = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`;
  for (let g = 1; g < 4; g++) out += `<line class="g" x1="0" x2="${W}" y1="${(H * g) / 4}" y2="${(H * g) / 4}"/>`;
  for (const s of series) {
    if (!s.data.length) continue;
    const pts = s.data.map((v, i) => [(i + (n - s.data.length)) * (W / (n - 1)), H - 2 - (v / max) * (H - 4)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    out += `<path class="${s.cls}a" d="${line}L${pts[pts.length - 1][0].toFixed(1)} ${H}L${pts[0][0].toFixed(1)} ${H}Z"/><path class="${s.cls}" d="${line}"/>`;
  }
  return out + '</svg>';
}
const segs = (n, on, cls = '') => `<div class="segs ${cls}">${Array.from({ length: n }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</div>`;
const bars = (rtt, online) => (!online || !rtt ? 0 : rtt < 60 ? 5 : rtt < 120 ? 4 : rtt < 250 ? 3 : rtt < 600 ? 2 : 1);
const fmtUp = (s) => { if (!s || s < 0) return '-'; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const tzTime = (tz, sec = true) => { try { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), hourCycle: 'h23', timeZone: tz || undefined }); } catch { return '--:--'; } };
const tzShort = (tz) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName').value; } catch { return tz || ''; } };
const tzOffset = (tz) => { try { const now = new Date(); const a = new Date(now.toLocaleString('en-US', { timeZone: tz })); const b = new Date(now.toLocaleString('en-US')); return Math.round((a - b) / 3600e3); } catch { return 0; } };

function renderSignal(p) {
  const n = p ? bars(p.rtt, p.online) : 0;
  $('topSig').querySelectorAll('i').forEach((i, k) => i.classList.toggle('on', k < n));
}

function renderConsole(p) {
  const C = ST.console; if (!C) return;
  const me = ST.me, cn = C.peer;
  const rtts = cn ? cn.rtts : [];
  const q = bars(p && p.rtt, p && p.online);
  const tr = C.traffic, txNow = tr.length ? tr[tr.length - 1][0] : 0, rxNow = tr.length ? tr[tr.length - 1][1] : 0;
  const memUsed = C.host.mem.total && C.host.mem.avail != null ? C.host.mem.total - C.host.mem.avail : 0;
  const memPct = C.host.mem.total ? memUsed / C.host.mem.total : 0;
  const disk = C.host.disk, diskPct = disk && disk.total ? 1 - disk.free / disk.total : 0;
  const cls = (f) => (f > 0.9 ? 'bad' : f > 0.75 ? 'warn' : '');
  const remoteTz = cn && cn.tz;
  const off = remoteTz ? tzOffset(remoteTz) - tzOffset(C.tz) : 0;
  const w = [];
  const skin = document.documentElement.getAttribute('data-skin');
  const upFor = cn && cn.onlineSince && p && p.online ? (C.now - cn.onlineSince) / 1000 : 0;
  if (skin === 'mars') {
    const st = (ok, hold) => (ok ? '<dd class="go">GO</dd>' : hold ? '<dd class="hold">HOLD</dd>' : '<dd class="nogo">NO-GO</dd>');
    w.push(`<div class="w panel"><div class="ph"><span>FLIGHT</span><em>go / no-go poll</em></div><div class="wb">
      <div class="met"><small>MET</small><span data-met="${cn && cn.onlineSince && p && p.online ? cn.onlineSince : ''}">${upFor ? metStr(upFor) : 'T+ --:--:--'}</span></div>
      <dl class="gonogo"><dt>COMM</dt>${st(p && p.online)}<dt>CRYPTO</dt>${st(!!cn)}<dt>RECOVERY</dt>${st(ST.filesFolder && diskPct < 0.9, diskPct < 0.97)}
      <dt>GUIDANCE</dt>${st(C.host.cpu < 85, C.host.cpu < 97)}<dt>TELMU</dt>${st(memPct < 0.9, memPct < 0.97)}<dt>CAPCOM</dt>${st(!C.queue.msgs && !C.queue.files, true)}</dl>
      <span class="hint">${p && p.online ? 'All stations, ' + esc(me.callsign || 'flight') + ': ' + (p.online && cn ? 'we are go.' : 'standing by.') : 'Loss of signal. Standing by for AOS.'}</span>
    </div></div>`);
  }
  if (window.Radar) {
    Radar.setPeer(p); Radar.flow(txNow, rxNow);
    $('radarSub').textContent = p ? (p.online ? 'contact' : 'contact lost') : 'scanning';
    $('radarKv').innerHTML = p ? `<dt>contact</dt><dd>${esc(p.name)}</dd><dt>bearing</dt><dd>${String(Radar.bearingOf(p.id)).padStart(3, '0')}°</dd><dt>range</dt><dd>${p.online && p.rtt ? p.rtt + ' ms' : '---'}</dd><dt>channel</dt><dd class="${p.online ? 'ok-t' : 'err-t'}">${p.online ? 'SECURE' : 'NO CONTACT'}</dd>` : '<dt>contact</dt><dd>none</dd>';
  }
  w.push(`<div class="w panel"><div class="ph"><span>LINK</span><em>${p ? esc(p.name) : 'no station'}</em></div><div class="wb">
    <div class="row2"><div class="big ${p && p.online ? '' : 'dim'}">${p && p.online && p.rtt ? p.rtt : '---'}<small>ms</small></div>
      <div class="kv"><dt>status</dt><dd class="${p && p.online ? 'ok-t' : 'err-t'}">${p ? (p.online ? WORDS().up : WORDS().down) : 'IDLE'}</dd><dt>up</dt><dd>${cn && cn.onlineSince && p.online ? fmtUp((C.now - cn.onlineSince) / 1000) : '-'}</dd></div></div>
    ${segs(10, q * 2, q <= 2 && q > 0 ? 'warn' : '')}
    ${spark([{ data: rtts, cls: 'rx' }], { min: 50 })}
    <div class="kv"><dt>peer</dt><dd>${p ? esc(p.addr) + ':' + p.port : '-'}</dd><dt>their version</dt><dd>${cn && cn.v ? 'v' + esc(cn.v) : '-'}</dd><dt>linked since</dt><dd>${cn && cn.pairedAt ? new Date(cn.pairedAt).toLocaleDateString() : '-'}</dd></div>
  </div></div>`);
  w.push(`<div class="w panel"><div class="ph"><span>CLOCKS</span><em>${remoteTz ? (off === 0 ? 'same time zone' : (off > 0 ? '+' : '') + off + ' h') : ''}</em></div><div class="wb">
    <div class="clocks"><div><span>${esc(me.callsign || 'THIS STATION')}</span><b data-clock="${esc(C.tz)}">${tzTime(C.tz)}</b><span>${esc(tzShort(C.tz))}</span></div>
    <div class="r"><span>${p ? esc(p.name) : 'REMOTE'}</span><b ${remoteTz ? `data-clock="${esc(remoteTz)}"` : ''}>${remoteTz ? tzTime(remoteTz) : '--:--:--'}</b><span>${remoteTz ? esc(tzShort(remoteTz)) : 'waiting for link'}</span></div></div>
  </div></div>`);
  w.push(`<div class="w panel"><div class="ph"><span>TRAFFIC</span><em>last 2 min</em></div><div class="wb">
    <div class="row2"><div class="big tx">${fmtBytes(txNow)}<small>/s TX</small></div><div class="big">${fmtBytes(rxNow)}<small>/s RX</small></div></div>
    ${spark([{ data: tr.map((x) => x[0]), cls: 'tx' }, { data: tr.map((x) => x[1]), cls: 'rx' }], { min: 2048 })}
    <div class="legend"><span class="t">■ sent</span><span class="r">■ received</span></div>
    <div class="kv"><dt>total sent</dt><dd>${fmtBytes(C.stats.bytesOut)}</dd><dt>total received</dt><dd>${fmtBytes(C.stats.bytesIn)}</dd></div>
  </div></div>`);
  w.push(`<div class="w panel"><div class="ph"><span>LOG</span><em>since ${new Date(C.stats.since).toLocaleDateString()}</em></div><div class="wb">
    <div class="kv"><dt>messages sent</dt><dd>${C.stats.msgsOut}</dd><dt>messages received</dt><dd>${C.stats.msgsIn}</dd>
    <dt>files sent</dt><dd>${C.stats.filesOut} · ${fmtBytes(C.stats.fileBytesOut)}</dd><dt>files received</dt><dd>${C.stats.filesIn} · ${fmtBytes(C.stats.fileBytesIn)}</dd>
    <dt>waiting to send</dt><dd class="${C.queue.msgs + C.queue.files ? 'q' : ''}">${C.queue.msgs} msg · ${C.queue.files} file${C.queue.files === 1 ? '' : 's'}${C.queue.bytes ? ' · ' + fmtBytes(C.queue.bytes) : ''}</dd></div>
  </div></div>`);
  w.push(`<div class="w panel"><div class="ph"><span>HOST</span><em>this Umbrel · up ${fmtUp(C.host.uptime)}</em></div><div class="wb">
    <div class="meter"><span>CPU</span>${segs(12, Math.round((C.host.cpu / 100) * 12), cls(C.host.cpu / 100))}<span>${C.host.cpu}%</span></div>
    <div class="meter"><span>MEM</span>${segs(12, Math.round(memPct * 12), cls(memPct))}<span>${Math.round(memPct * 100)}%</span></div>
    <div class="meter"><span>DISK</span>${segs(12, Math.round(diskPct * 12), cls(diskPct))}<span>${Math.round(diskPct * 100)}%</span></div>
    <div class="kv"><dt>cores · load</dt><dd>${C.host.cores} · ${C.host.load.join('  ')}</dd><dt>memory</dt><dd>${fmtBytes(memUsed)} of ${fmtBytes(C.host.mem.total)}</dd><dt>free space</dt><dd>${disk ? fmtBytes(disk.free) + ' of ' + fmtBytes(disk.total) : '-'}</dd><dt>received files go to</dt><dd>${ST.filesFolder ? 'Files › Uplink' : 'inside the app'}</dd></div>
  </div></div>`);
  w.push(`<div class="w panel"><div class="ph"><span>CRYPTO</span><em>${esc(C.crypto)}</em></div><div class="wb">
    ${cn ? `<span class="hint">Safety number. Read it to each other by phone: if it matches on both screens, nobody is in the middle.</span><div class="safety">${esc(cn.safety || '')}</div>` : '<span class="hint">Link a station to see your safety number.</span>'}
    <div class="kv"><dt>this station</dt><dd>${esc(me.fp)}</dd>${cn ? `<dt>${esc(p.name)}</dt><dd>${esc(cn.fp)}</dd>` : ''}</div>
  </div></div>`);
  const box = $('widgets');
  const html = w.join('');
  if (box._html !== html) { box.innerHTML = html; box._html = html; }
}

function WORDS() { const k = document.documentElement.getAttribute('data-skin'); return k === 'mars' ? { up: 'AOS', down: 'LOS' } : k === 'war' ? { up: 'SECURE', down: 'NO CONTACT' } : k === 'umbrel' || k === 'desk85' ? { up: 'Connected', down: 'Offline' } : { up: 'LINKED', down: 'NO CARRIER' }; }
const metStr = (s) => { s = Math.floor(s); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `T+ ${d ? d + ':' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };

// local and remote clocks tick every second without waiting for the server
setInterval(() => {
  if (!ST || !ST.console) return;
  $('topClock').textContent = tzTime(ST.console.tz);
  document.querySelectorAll('[data-clock]').forEach((b) => { b.textContent = tzTime(b.dataset.clock); });
  document.querySelectorAll('[data-met]').forEach((b) => { if (b.dataset.met) b.textContent = metStr((Date.now() - +b.dataset.met) / 1000); });
}, 1000);

// tabs on narrower screens
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
  $('deck').dataset.tab = b.dataset.tab; lsSet('ul.tab', b.dataset.tab);
  document.querySelectorAll('#tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));
{ const t = lsGet('ul.tab'); if (t === 'console') document.querySelector('#tabs [data-tab="console"]').click(); }

// tell the station which time zone it is in, from this browser
let tzSent = false;
function syncTz() {
  if (tzSent || !ST || !ST.console) return; tzSent = true;
  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
  if (tz && tz !== ST.console.tz) api('api/settings', { method: 'POST', body: { tz } }).catch(() => {});
}

// ---------- sounds ----------
let prevSnd = null;
function sounds() {
  const cur = { sel: ST._sel, peers: {}, msgs: new Set(), sent: new Set(), tr: {} };
  for (const p of ST.peers) cur.peers[p.id] = { on: p.online, unread: p.unread };
  for (const m of ST.messages) { cur.msgs.add(m.id); if (m.dir === 'out' && m.state === 'sent') cur.sent.add(m.id); }
  for (const t of ST.transfers) cur.tr[t.id] = t.state;
  const was = prevSnd; prevSnd = cur;
  // the first look at a conversation is the baseline: no sounds for its history
  if (!was || !window.SFX) return;
  if (was.sel !== cur.sel) { for (const id in cur.peers) { const a = was.peers[id], b = cur.peers[id]; if (a && a.on !== b.on) SFX.play(b.on ? 'linkup' : 'linkdown'); } return; }
  let q = [];
  for (const id in cur.peers) {
    const a = was.peers[id], b = cur.peers[id];
    if (a && a.on !== b.on) q.push(b.on ? 'linkup' : 'linkdown');
    if (a && b.unread > a.unread) q.push('rx');
  }
  for (const m of ST.messages) {
    if (was.msgs.has(m.id)) { if (m.dir === 'out' && cur.sent.has(m.id) && !was.sent.has(m.id)) q.push('ack'); continue; }
    if (m.dir === 'in' && m.kind === 'text') { const cw = cwText(m.text); if (cw != null) { q.push({ cw }); } else q.push('rx'); }
  }
  for (const t of ST.transfers) {
    const a = was.tr[t.id], b = t.state;
    if (a === b) continue;
    if (b === 'receiving' || b === 'sending') q.push('xfer');
    else if (b === 'done' && (a || t.dir === 'in')) q.push(a ? 'done' : 'xfer', 'done');
    else if (b === 'failed' && a) q.push('error');
  }
  if (window.Radar) for (const n of q) { if (n === 'rx' || (n && n.cw)) Radar.push('in'); else if (n === 'ack') Radar.push('in'); }
  const cwq = q.filter((x) => typeof x === 'object'); q = [...new Set(q.filter((x) => typeof x === 'string'))];
  if (cwq.length) { if (q.includes('rx')) SFX.play('rx'); setTimeout(() => playCw(cwq[0].cw), 500); q = q.filter((n) => n !== 'rx'); }
  q.slice(0, 3).forEach((n, i) => setTimeout(() => SFX.play(n), i * 420));
}
// Easter egg: start a message with /cw and it goes out as Morse code (CW), keyed on both stations
function cwText(t) { const m = /^\/cw\s+([\s\S]+)$/i.exec(String(t || '').trim()); return m ? m[1].slice(0, 120) : null; }
function playCw(text) { SFX.morse(text); document.body.classList.remove('cw-flash'); void document.body.offsetWidth; document.body.classList.add('cw-flash'); }

// looks
const SKINS = ['cyber', 'mars', 'desk85', 'umbrel', 'war'];
function applySkin(k, preview) {
  if (!SKINS.includes(k)) k = 'cyber';
  document.documentElement.setAttribute('data-skin', k); lsSet('ul.skin', k); SFX.setTheme(k);
  document.querySelectorAll('#sSkin [data-skin]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.skin === k)));
  const box = $('widgets'); if (box) box._html = ''; lastSig = ''; if (ST) render();
  if (preview) SFX.play('linkup');
}
document.querySelectorAll('#sSkin [data-skin]').forEach((b) => b.addEventListener('click', () => applySkin(b.dataset.skin, true)));
applySkin(lsGet('ul.skin') || 'cyber');

function paintSnd() { const b = $('sndBtn'); b.setAttribute('aria-pressed', String(SFX.on)); b.classList.toggle('off', !SFX.on); }
$('sndBtn').onclick = () => { SFX.setOn(!SFX.on); paintSnd(); if (SFX.on) setTimeout(() => SFX.play('ack'), 30); };
$('sSnd').onchange = () => { SFX.setOn($('sSnd').checked); paintSnd(); };
$('sVol').oninput = () => SFX.setVol($('sVol').value / 100);
let testN = 0;
$('sTest').onclick = () => { const n = SFX.names[testN++ % SFX.names.length]; SFX.setOn(true); paintSnd(); $('sSnd').checked = true; SFX.play(n); $('sTest').textContent = n.toUpperCase(); setTimeout(() => { $('sTest').textContent = 'TEST'; }, 900); };
paintSnd();

// ---------- polling ----------
let timer = null;
async function poll() {
  clearTimeout(timer);
  try {
    const reqSel = sel;
    ST = await api(`api/state?peer=${encodeURIComponent(reqSel)}`);
    { const sp = ST.peers.find((x) => x.id === reqSel); if (sp && sp.unread && !document.hidden) api('api/read', { method: 'POST', body: { peer: reqSel } }).catch(() => {}); } ST._sel = reqSel;
    render(); syncTz(); sounds();
    if (!ST.me.ready && !poll.prompted) { poll.prompted = true; openSheet('setPanel'); }
  } catch (ex) { $('meBox').innerHTML = `<span class="err-t">Lost contact with Uplink: ${esc(ex.message)}</span>`; }
  const busy = ST && (ST.transfers.some((t) => ['sending', 'receiving'].includes(t.state)) || uploads.length);
  timer = setTimeout(poll, busy ? 1200 : 2500);
}

// ---------- actions ----------
$('stations').addEventListener('click', (e) => { const b = e.target.closest('[data-peer]'); if (!b) return; sel = b.dataset.peer; lsSet('ul.peer', sel); lastSig = ''; $('peerMenu').hidden = true; poll(); });
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]'); if (o) openSheet(o.dataset.open);
  const c = e.target.closest('[data-close]'); if (c) c.closest('.sheet').hidden = true;
  const x = e.target.closest('[data-cancel]'); if (x) api('api/transfer/cancel', { method: 'POST', body: { id: x.dataset.cancel } }).then(poll).catch((ex) => alert(ex.message));
});
document.querySelectorAll('.sheet').forEach((s) => s.addEventListener('click', (e) => { if (e.target === s) s.hidden = true; }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.sheet').forEach((s) => { s.hidden = true; }); });

function openSheet(id) {
  if (id === 'setPanel') {
    const m = ST.me;
    $('sSnd').checked = SFX.on; $('sVol').value = Math.round(SFX.vol * 100);
    $('sCall').value = m.callsign; $('sAddr').value = m.addr || (/^100\.\d+\.\d+\.\d+$/.test(location.hostname) ? location.hostname : '');
    $('sPort').value = m.port; $('sMax').value = m.maxGB; $('sMsg').textContent = '';
    $('sFp').textContent = `Station ID ${m.fp}. Version ${ST.version}.`;
    $('sFolder').innerHTML = ST.filesFolder ? 'Files sent to you are saved in the <b>Uplink</b> folder in your Umbrel Files.' : 'The Uplink folder in your Umbrel Files is not reachable, so received files are kept inside the app for now. Restart Uplink, or pick a folder under Storage in this app\'s Umbrel settings.';
  }
  if (id === 'linkPanel') {
    if (!ST.me.ready) { openSheet('setPanel'); $('sMsg').innerHTML = '<span class="err-t">Save a station name and Tailscale address first, then you can make or enter codes.</span>'; return; }
    $('linkMsg').textContent = ''; if (ST.invite && !$('inviteCode').textContent) { $('inviteCode').textContent = ST.invite.code; $('inviteBox').hidden = false; }
    if ($('linkForm').parentNode !== $('linkHome')) $('linkHome').appendChild($('linkForm'));
  }
  $(id).hidden = false;
  const f = $(id).querySelector('input,textarea,button.key:not([data-close])'); if (f) f.focus();
}
$('setBtn').onclick = () => openSheet('setPanel');
$('linkBtn').onclick = () => openSheet('linkPanel');
$('topLink').onclick = () => openSheet('linkPanel');

$('setForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('sMsg').textContent = '';
  try {
    await api('api/settings', { method: 'POST', body: { callsign: $('sCall').value, addr: $('sAddr').value, port: $('sPort').value || 3947, maxGB: $('sMax').value || 50 } });
    $('sMsg').innerHTML = '<span class="ok-t">Saved.</span>'; await poll();
    if (!ST.peers.length) setTimeout(() => { $('setPanel').hidden = true; }, 600);
  } catch (ex) { $('sMsg').innerHTML = `<span class="err-t">${esc(ex.message)}</span>`; }
});
$('mkInvite').onclick = async () => {
  try { const r = await api('api/invite', { method: 'POST' }); $('inviteCode').textContent = r.code; $('inviteBox').hidden = false; } catch (ex) { $('linkMsg').innerHTML = `<span class="err-t">${esc(ex.message)}</span>`; }
};
function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(() => true, () => legacyCopy(t));
  return Promise.resolve(legacyCopy(t));
}
function legacyCopy(t) {
  const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.className = 'offscreen';
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove(); return ok;
}
$('copyInvite').onclick = async () => {
  const b = $('copyInvite'), t = $('inviteCode').textContent;
  const ok = await copyText(t);
  if (ok) b.textContent = 'COPIED';
  else { const r = document.createRange(); r.selectNodeContents($('inviteCode')); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); b.textContent = 'PRESS ⌘C'; }
  setTimeout(() => { b.textContent = 'COPY'; }, 2200);
};
$('useCode').onclick = async () => {
  const b = $('useCode'); b.disabled = true; $('linkMsg').textContent = 'Calling the other station…';
  try { const r = await api('api/link', { method: 'POST', body: { code: $('codeIn').value } }); sel = r.peer; lsSet('ul.peer', sel); $('codeIn').value = ''; $('linkPanel').hidden = true; if ($('linkForm').parentNode !== $('linkHome')) $('linkHome').appendChild($('linkForm')); $('inviteCode').textContent = ''; $('inviteBox').hidden = true; lastSig = ''; await poll(); }
  catch (ex) { $('linkMsg').innerHTML = `<span class="err-t">${esc(ex.message)}</span>`; }
  b.disabled = false;
};

const msg = $('msg');
const grow = () => { msg.style.height = 'auto'; msg.style.height = Math.min(160, msg.scrollHeight) + 'px'; };
msg.addEventListener('input', grow);
msg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); } });
$('composer').addEventListener('submit', async (e) => {
  e.preventDefault(); const text = msg.value; if (!text.trim() || !sel) return;
  msg.value = ''; grow(); stickBottom = true;
  try { await api('api/send', { method: 'POST', body: { peer: sel, text } }); if (window.Radar) Radar.push('out'); if (cwText(text) != null) playCw(cwText(text)); else SFX.play('tx'); lastSig = ''; poll(); } catch (ex) { SFX.play('error'); msg.value = text; alert(ex.message); }
});

// ---------- files ----------
let upN = 0;
function upload(f) {
  const peer = sel; if (!peer) return;
  const u = { n: ++upN, peer, name: f.name, size: f.size, pct: 0, ts: Date.now(), err: '' }; uploads.push(u);
  const x = new XMLHttpRequest();
  x.open('PUT', `api/upload?peer=${encodeURIComponent(peer)}&name=${encodeURIComponent(f.name)}`);
  x.setRequestHeader('X-AG', '1'); x.setRequestHeader('Content-Type', 'application/octet-stream');
  x.upload.onprogress = (e) => { if (e.lengthComputable) { u.pct = (e.loaded / e.total) * 100; lastSig = ''; if (ST) render(); } };
  x.onload = () => { if (x.status >= 200 && x.status < 300) { uploads.splice(uploads.indexOf(u), 1); } else { try { u.err = JSON.parse(x.responseText).error; } catch { u.err = 'Upload failed.'; } setTimeout(() => { const i = uploads.indexOf(u); if (i >= 0) uploads.splice(i, 1); }, 8000); } lastSig = ''; poll(); };
  x.onerror = () => { u.err = 'Upload failed. Check your connection to the Umbrel.'; lastSig = ''; render(); setTimeout(() => { const i = uploads.indexOf(u); if (i >= 0) uploads.splice(i, 1); }, 8000); };
  x.send(f); stickBottom = true; lastSig = ''; render(); poll();
}
$('attachBtn').onclick = () => $('fileIn').click();
$('fileIn').onchange = () => { for (const f of $('fileIn').files) upload(f); $('fileIn').value = ''; };
let dragDepth = 0;
const wrap = $('logWrap');
wrap.addEventListener('dragenter', (e) => { if (!sel || ![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
wrap.addEventListener('dragover', (e) => { if (sel && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
wrap.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
wrap.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; for (const f of e.dataTransfer.files) upload(f); });
window.addEventListener('beforeunload', (e) => { if (uploads.some((u) => !u.err)) { e.preventDefault(); e.returnValue = ''; } });

// ---------- station menu ----------
$('peerMenuBtn').onclick = () => {
  const m = $('peerMenu'), p = ST.peers.find((x) => x.id === sel); if (!p) return;
  m.hidden = !m.hidden; $('peerMenuBtn').setAttribute('aria-expanded', String(!m.hidden));
  $('pmAddr').value = p.addr; $('pmPort').value = p.port; $('pmErr').textContent = '';
};
$('pmSave').onclick = async () => { try { await api('api/peer/update', { method: 'POST', body: { id: sel, addr: $('pmAddr').value, port: $('pmPort').value } }); $('pmErr').innerHTML = '<span class="ok-t">Saved. Trying it now.</span>'; poll(); } catch (ex) { $('pmErr').innerHTML = `<span class="err-t">${esc(ex.message)}</span>`; } };
$('pmClear').onclick = async () => { if (!confirm('Clear this conversation on this station? Received files stay where they were saved.')) return; await api('api/messages/clear', { method: 'POST', body: { peer: sel } }).catch((ex) => alert(ex.message)); lastSig = ''; poll(); };
$('pmUnlink').onclick = async () => { const p = ST.peers.find((x) => x.id === sel); if (!p || !confirm(`Unlink ${p.name}? You will need a new invite code to link again.`)) return; await api('api/peer/remove', { method: 'POST', body: { id: sel } }).catch((ex) => alert(ex.message)); $('peerMenu').hidden = true; sel = ''; lastSig = ''; poll(); };

poll();
