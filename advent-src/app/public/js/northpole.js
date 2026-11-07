// North Pole Command: "live" spy cams on the workshop, the reindeer barn and Santa himself,
// changing as Christmas gets closer, and on Christmas Eve the launch and the Santa tracker.
(function () {
  'use strict';
  const { h, clear, icon, api, toast, S } = AD;
  const D = () => window.Draw;
  const A = () => window.Audio2;
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

  // Santa's route: east to west, so the sun's shadow of midnight sweeps with him.
  const ROUTE = [
    ['Auckland', -36.8, 174.8], ['Sydney', -33.9, 151.2], ['Tokyo', 35.7, 139.7], ['Seoul', 37.6, 127.0], ['Manila', 14.6, 121.0], ['Beijing', 39.9, 116.4], ['Hong Kong', 22.3, 114.2], ['Jakarta', -6.2, 106.8], ['Bangkok', 13.8, 100.5], ['Kolkata', 22.6, 88.4], ['New Delhi', 28.6, 77.2], ['Mumbai', 19.1, 72.9], ['Dubai', 25.2, 55.3], ['Moscow', 55.8, 37.6], ['Nairobi', -1.3, 36.8], ['Jerusalem', 31.8, 35.2], ['Bethlehem', 31.7, 35.2], ['Cairo', 30.0, 31.2], ['Istanbul', 41.0, 29.0], ['Athens', 38.0, 23.7], ['Cape Town', -33.9, 18.4], ['Berlin', 52.5, 13.4], ['Rome', 41.9, 12.5], ['Oslo', 59.9, 10.8], ['Lagos', 6.5, 3.4], ['Paris', 48.9, 2.4], ['London', 51.5, -0.1], ['Madrid', 40.4, -3.7], ['Dublin', 53.3, -6.3], ['Reykjavik', 64.1, -21.9], ['Rio de Janeiro', -22.9, -43.2], ['Buenos Aires', -34.6, -58.4], ['Halifax', 44.6, -63.6], ['Caracas', 10.5, -66.9], ['Boston', 42.4, -71.1], ['New York City', 40.7, -74.0], ['Washington, D.C.', 38.9, -77.0], ['Miami', 25.8, -80.2], ['Atlanta', 33.7, -84.4], ['Cincinnati', 39.1, -84.5], ['HOME', 39.5, -85.0], ['Nashville', 36.2, -86.8], ['Chicago', 41.9, -87.6], ['Dallas', 32.8, -96.8], ['Mexico City', 19.4, -99.1], ['Denver', 39.7, -105.0], ['Phoenix', 33.4, -112.1], ['Los Angeles', 34.1, -118.2], ['Seattle', 47.6, -122.3], ['San Francisco', 37.8, -122.4], ['Vancouver', 49.3, -123.1], ['Anchorage', 61.2, -149.9], ['Honolulu', 21.3, -157.9], ['North Pole', 89.9, 0],
  ];
  const HOME_INDEX = ROUTE.findIndex((r) => r[0] === 'HOME');

  // When things happen on Christmas Eve, in the family's own clock.
  function schedule() {
    const now = new Date();
    const y = now.getFullYear();
    const bt = (S.state.settings.bedtime || '21:00').split(':').map(Number);
    const launch = new Date(y, 11, 24, 17, 0, 0);
    const home = new Date(y, 11, 24, bt[0], bt[1], 0);
    if (home <= launch) home.setTime(launch.getTime() + 3 * 3600000);
    const done = new Date(y, 11, 25, 6, 0, 0);
    return { launch, home, done, now };
  }
  let sim = null; // preview flight: { start, speed }
  const COUNTDOWN_MS = 12000; // a preview flight counts down for 12 real seconds, then runs fast
  function flightClock() {
    const s = schedule();
    if (sim) { const e = Date.now() - sim.start; return new Date(e < COUNTDOWN_MS ? s.launch.getTime() - COUNTDOWN_MS + e : s.launch.getTime() + (e - COUNTDOWN_MS) * sim.speed); }
    return s.now;
  }
  // Real seconds since liftoff, so the launch film plays for a moment whatever the speed.
  function sinceLaunch() {
    const s = schedule();
    if (sim) return Date.now() - sim.start - COUNTDOWN_MS;
    return s.now - s.launch;
  }
  // Where Santa is: 0 before launch, 0..1 along the route, >=1 when done.
  function progress() {
    const s = schedule();
    const t = flightClock().getTime();
    if (t < s.launch) return { p: -1, s };
    if (t >= s.done) return { p: 1, s };
    const f1 = HOME_INDEX / (ROUTE.length - 1);
    if (t < s.home) return { p: f1 * (t - s.launch) / (s.home - s.launch), s };
    return { p: f1 + (1 - f1) * (t - s.home) / (s.done - s.home), s };
  }
  function phase() {
    const d = S.state.day;
    if (d >= 25) return 'done';
    if (d === 24) { const { p } = progress(); if (p < 0) return 'prep'; if (sinceLaunch() < 22000) return 'launch'; return 'flight'; }
    if (d >= 21) return 'loading';
    if (d >= 16) return 'list';
    return 'early';
  }

  // ---------- the CRT look shared by every cam ----------
  function crt(ctx, W, H, t, label, cam, live = true) {
    ctx.save();
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#000'; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (Math.random() < 0.02) { ctx.globalAlpha = 0.15; ctx.fillStyle = '#fff'; const y = rnd(0, H); ctx.fillRect(0, y, W, rnd(2, 12)); ctx.globalAlpha = 1; }
    ctx.font = '600 11px ui-monospace, Menlo, monospace'; ctx.fillStyle = '#c8ffd0'; ctx.shadowColor = '#3ddc97'; ctx.shadowBlur = 6;
    ctx.fillText('CAM ' + String(cam).padStart(2, '0') + ' · ' + label.toUpperCase(), 10, 18);
    const now = flightClock();
    ctx.textAlign = 'right'; ctx.fillText(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '  NP', W - 10, 18);
    ctx.fillText('NORTH POLE · ' + (S.state.today || ''), W - 10, H - 10);
    ctx.textAlign = 'left';
    if (live) { if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = '#ff4d58'; ctx.shadowColor = '#ff4d58'; ctx.beginPath(); ctx.arc(14, H - 14, 4, 0, TAU); ctx.fill(); } ctx.fillStyle = '#c8ffd0'; ctx.fillText('LIVE', 24, H - 10); }
    else { ctx.fillStyle = '#ffd36b'; ctx.fillText('RECORDED', 10, H - 10); }
    ctx.restore();
  }
  function room(ctx, W, H, wall = '#1d2a4a', floor = '#2a1c12') { ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H); ctx.fillStyle = floor; ctx.fillRect(0, H * 0.72, W, H * 0.28); ctx.fillStyle = 'rgba(255,255,255,.05)'; for (let x = 0; x < W; x += 40) ctx.fillRect(x, 0, 1, H * 0.72); }
  function window_(ctx, x, y, w, hgt, t) { ctx.fillStyle = '#0a1a3a'; ctx.fillRect(x, y, w, hgt); ctx.fillStyle = '#fff'; for (let i = 0; i < 6; i++) ctx.fillRect(x + ((i * 37 + t * 20) % w), y + ((i * 53 + t * 40) % hgt), 2, 2); ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, hgt); ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + hgt); ctx.moveTo(x, y + hgt / 2); ctx.lineTo(x + w, y + hgt / 2); ctx.stroke(); }
  function bench(ctx, x, y, w) { ctx.fillStyle = '#6b4423'; ctx.fillRect(x, y, w, 8); ctx.fillRect(x + 6, y + 8, 8, 40); ctx.fillRect(x + w - 14, y + 8, 8, 40); }
  function hay(ctx, x, y, w, hgt) { ctx.fillStyle = '#c9a23a'; for (let i = 0; i < 30; i++) { ctx.save(); ctx.translate(x + ((i * 7919) % w), y + ((i * 104729) % hgt)); ctx.rotate(((i * 13) % 7) - 3); ctx.fillRect(-10, -1, 20, 2); ctx.restore(); } }

  // ---------- the cams ----------
  const CAMS = {
    workshop: { label: 'Toy Workshop', make(st) { st.gifts = 3; st.last = 0; return (ctx, W, H, t, dt) => {
      room(ctx, W, H); window_(ctx, W * 0.72, H * 0.12, W * 0.2, H * 0.3, t);
      const s = Math.min(W, H) * 0.13;
      for (let i = 0; i < 3; i++) { const ex = W * (0.18 + i * 0.17); D().elf(ctx, ex, H * 0.62, s * 0.9, t + i, ['#2e9e5b', '#d7263d', '#2e9e5b'][i]); const ham = Math.sin(t * 8 + i) > 0.7; ctx.save(); ctx.translate(ex + s * 0.4, H * 0.52); ctx.rotate(ham ? 0.6 : -0.3); ctx.fillStyle = '#555'; ctx.fillRect(-3, -s * 0.5, 6, s * 0.5); ctx.fillStyle = '#777'; ctx.fillRect(-s * 0.15, -s * 0.6, s * 0.3, s * 0.15); ctx.restore(); if (ham && Math.floor(t * 8 + i) !== st['h' + i]) { st['h' + i] = Math.floor(t * 8 + i); if (Math.random() < 0.3) A().sfx.click(); } }
      bench(ctx, W * 0.08, H * 0.7, W * 0.55);
      if (t - st.last > 4) { st.last = t; st.gifts = Math.min(14, st.gifts + 1); }
      for (let i = 0; i < st.gifts; i++) D().gift(ctx, W * 0.7 + (i % 5) * s * 0.55, H * 0.95 - Math.floor(i / 5) * s * 0.5, s * 0.45, ['#d7263d', '#2e9e5b', '#5b9bff', '#ffd36b'][i % 4]);
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('TOYS TODAY: ' + (1200 + Math.floor(t * 0.7) + st.gifts * 7), W * 0.1, 36);
    }; } },
    barn: { label: 'Reindeer Barn', make(st) { return (ctx, W, H, t, dt) => {
      room(ctx, W, H, '#3a2a18', '#5a4a2a'); hay(ctx, 0, H * 0.75, W, H * 0.2);
      const s = Math.min(W, H) * 0.14;
      ctx.fillStyle = '#2a1c12'; for (let i = 0; i < 4; i++) ctx.fillRect(W * (0.05 + i * 0.3), H * 0.15, 6, H * 0.6);
      for (let i = 0; i < 3; i++) D().reindeer(ctx, W * (0.15 + i * 0.3), H * 0.74 + Math.sin(t + i) * 2, s, t + i, i === 1);
      D().elf(ctx, W * 0.92, H * 0.7, s * 0.8, t, '#d7263d');
      ctx.fillStyle = '#ff8c1a'; ctx.save(); ctx.translate(W * 0.86, H * 0.5 + Math.sin(t * 3) * 4); ctx.rotate(0.3); ctx.fillRect(-3, 0, 6, s * 0.4); ctx.fillStyle = '#2e9e5b'; ctx.fillRect(-6, -6, 12, 8); ctx.restore();
      if (Math.floor(t / 3) !== st.sn) { st.sn = Math.floor(t / 3); if (Math.random() < 0.5) A().sfx.snort(); }
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('CARROTS: ' + (48 - Math.floor(t / 7) % 20), W * 0.05, 36);
    }; } },
    kitchen: { label: 'Cookie Kitchen', make(st) { return (ctx, W, H, t, dt) => {
      room(ctx, W, H, '#4a2a3a', '#3a2020');
      const s = Math.min(W, H) * 0.14;
      ctx.fillStyle = '#333'; ctx.fillRect(W * 0.65, H * 0.4, W * 0.28, H * 0.4); ctx.fillStyle = '#ff7a1a'; ctx.globalAlpha = 0.6 + Math.sin(t * 4) * 0.2; ctx.fillRect(W * 0.68, H * 0.5, W * 0.22, H * 0.22); ctx.globalAlpha = 1;
      bench(ctx, W * 0.08, H * 0.62, W * 0.5);
      // Mrs. Claus
      D().person(ctx, W * 0.3, H * 0.62, s * 1.0, '#d7263d', '#fff');
      ctx.fillStyle = '#fff'; ctx.fillRect(W * 0.3 - s * 0.3, H * 0.62 - s * 0.3, s * 0.6, s * 0.5);
      for (let i = 0; i < 6; i++) { const yy = H * 0.6 - 2; const bob = (t * 30 + i * 40) % (W * 0.5); ctx.fillStyle = '#b5651d'; ctx.beginPath(); ctx.arc(W * 0.08 + bob, yy, 7, 0, TAU); ctx.fill(); ctx.fillStyle = '#5a2a1a'; ctx.beginPath(); ctx.arc(W * 0.08 + bob - 2, yy - 2, 1.5, 0, TAU); ctx.arc(W * 0.08 + bob + 3, yy + 1, 1.5, 0, TAU); ctx.fill(); }
      D().gingerbread(ctx, W * 0.55, H * 0.56, s * 0.3, t);
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('COOKIES BAKED: ' + (3400 + Math.floor(t * 2)), W * 0.05, 36);
      if (Math.floor(t / 5) !== st.k) { st.k = Math.floor(t / 5); if (Math.random() < 0.4) A().sfx.chime(); }
    }; } },
    mail: { label: 'Mail Room', make(st) { st.letters = []; return (ctx, W, H, t, dt) => {
      room(ctx, W, H, '#1a3a2a', '#2a2a2a');
      const s = Math.min(W, H) * 0.14;
      ctx.fillStyle = '#8a6a3a'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(W * (0.2 + i * 0.3), H * 0.82, s * 0.7, s * 0.5, 0, 0, TAU); ctx.fill(); }
      if (Math.random() < 0.2) st.letters.push({ x: rnd(W * 0.1, W * 0.9), y: -10, v: rnd(60, 140), r: rnd(0, TAU) });
      for (const l of st.letters) { l.y += l.v * dt; l.r += dt; ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.r); ctx.fillStyle = '#fff'; ctx.fillRect(-9, -6, 18, 12); ctx.fillStyle = '#d7263d'; ctx.fillRect(4, -4, 3, 3); ctx.restore(); }
      st.letters = st.letters.filter((l) => l.y < H * 0.78);
      D().elf(ctx, W * 0.5, H * 0.74, s * 0.9, t, '#5b9bff');
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('LETTERS TODAY: ' + (18200 + Math.floor(t * 3)), W * 0.05, 36);
      if (Math.floor(t / 2) !== st.m) { st.m = Math.floor(t / 2); if (Math.random() < 0.4) A().sfx.beep(); }
    }; } },
    study: { label: "Santa's Study", make(st) { return (ctx, W, H, t, dt) => {
      room(ctx, W, H, '#3a1a1a', '#2a1a10');
      const s = Math.min(W, H) * 0.16;
      D().fireplace(ctx, W * 0.8, H * 0.78, s * 0.9, t);
      bench(ctx, W * 0.15, H * 0.62, W * 0.4);
      D().santa(ctx, W * 0.35, H * 0.72, s * 0.9, t, false);
      D().scroll(ctx, W * 0.25, H * 0.55, s * 1.1, s * 0.9);
      ctx.fillStyle = '#333'; ctx.font = '600 9px ui-monospace, monospace'; const names = ['Emma ✓', 'Liam ✓', 'Olivia ✓', 'Noah ✓', (S.state.children[0] || {}).name || 'Ava', 'Mia ✓'];
      names.forEach((n, i) => { ctx.globalAlpha = i < Math.floor(t / 2) % 7 ? 1 : 0.3; ctx.fillText(n, W * 0.25 - s * 0.45, H * 0.55 - s * 0.3 + i * 11); }); ctx.globalAlpha = 1;
      const qx = W * 0.25 + s * 0.3, qy = H * 0.55 - s * 0.3 + (Math.floor(t / 2) % 7) * 11; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(qx + 14, qy - 22 + Math.sin(t * 9) * 3); ctx.stroke();
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('LIST CHECKED: ' + (Math.floor(t / 2) % 2 ? 'TWICE' : 'ONCE'), W * 0.05, 36);
      if (Math.floor(t / 2) !== st.q) { st.q = Math.floor(t / 2); A().sfx.typing(3); }
    }; } },
    wrapping: { label: 'Wrapping Room', make(st) { return (ctx, W, H, t, dt) => {
      room(ctx, W, H, '#2a1a3a', '#1a1a2a');
      const s = Math.min(W, H) * 0.13;
      ctx.fillStyle = '#444'; ctx.fillRect(0, H * 0.66, W, 10); ctx.fillStyle = '#222'; for (let x = (t * 60) % 30 - 30; x < W; x += 30) ctx.fillRect(x, H * 0.66, 15, 10);
      for (let i = 0; i < 6; i++) { const gx = ((t * 60 + i * 150) % (W + 100)) - 50; D().gift(ctx, gx, H * 0.66, s * 0.5, ['#d7263d', '#2e9e5b', '#5b9bff', '#ffd36b'][i % 4]); }
      for (let i = 0; i < 3; i++) D().elf(ctx, W * (0.2 + i * 0.3), H * 0.9, s * 1.0, t + i, ['#d7263d', '#2e9e5b', '#5b9bff'][i]);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = ['#d7263d', '#2e9e5b', '#5b9bff', '#ffd36b'][i]; ctx.fillRect(W * (0.1 + i * 0.22), H * 0.15, 20, H * 0.3); }
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('WRAPPED: ' + (900000 + Math.floor(t * 11)).toLocaleString(), W * 0.05, 36);
      if (Math.floor(t / 2.5) !== st.w) { st.w = Math.floor(t / 2.5); if (Math.random() < 0.5) A().sfx.swoosh(); }
    }; } },
    training: { label: 'Reindeer Training', make(st) { return (ctx, W, H, t, dt) => {
      D().sky(ctx, W, H, '#040a26', '#101a4a'); D().starField(ctx, W, H, t, 50, 77); D().snowGround(ctx, W, H, 0.7);
      const s = Math.min(W, H) * 0.12;
      for (let i = 0; i < 8; i++) { const on = Math.floor(t * 6 + i) % 8 < 2; ctx.fillStyle = on ? '#ffd36b' : '#664'; ctx.shadowColor = '#ffd36b'; ctx.shadowBlur = on ? 10 : 0; ctx.beginPath(); ctx.arc(W * (0.05 + i * 0.13), H * 0.9, 4, 0, TAU); ctx.fill(); } ctx.shadowBlur = 0;
      for (let i = 0; i < 4; i++) { const rx = ((t * 160 + i * 140) % (W + 200)) - 100; const lift = Math.max(0, Math.sin(rx / W * Math.PI)) * H * 0.35; D().reindeer(ctx, rx, H * 0.78 - lift, s, t + i, i === 0, true); }
      if (Math.floor(t / 1.5) !== st.c) { st.c = Math.floor(t / 1.5); A().sfx.clops(2, 0.14); }
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('TOP SPEED: ' + (640 + Math.floor(Math.sin(t) * 20)) + ' MPH', W * 0.05, 36);
    }; } },
    hangar: { label: 'Sleigh Hangar', make(st) { st.n = 0; return (ctx, W, H, t, dt) => {
      room(ctx, W, H, '#1a2a3a', '#222'); window_(ctx, W * 0.05, H * 0.1, W * 0.2, H * 0.3, t);
      const s = Math.min(W, H) * 0.14;
      D().sleigh(ctx, W * 0.6, H * 0.78, s * 1.6);
      const loaded = Math.min(12, Math.floor(t / 2)); for (let i = 0; i < loaded; i++) D().gift(ctx, W * 0.5 + (i % 4) * s * 0.45, H * 0.72 - Math.floor(i / 4) * s * 0.4, s * 0.4, ['#d7263d', '#2e9e5b', '#5b9bff', '#ffd36b'][i % 4]);
      for (let i = 0; i < 2; i++) { const ex = W * (0.15 + i * 0.12) + Math.sin(t * 2 + i) * 20; D().elf(ctx, ex, H * 0.88, s * 0.9, t + i, i ? '#d7263d' : '#2e9e5b'); D().gift(ctx, ex, H * 0.88 - s * 1.2, s * 0.35, '#5b9bff'); }
      if (Math.floor(t / 2) !== st.n) { st.n = Math.floor(t / 2); if (loaded < 12) A().sfx.swoosh(); }
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('GIFTS LOADED: ' + (2400000 + loaded * 120000).toLocaleString(), W * 0.05, 36);
    }; } },
    harness: { label: 'Harness Bay', make(st) { return (ctx, W, H, t, dt) => {
      room(ctx, W, H, '#2a2a18', '#4a3a1a'); hay(ctx, 0, H * 0.8, W, H * 0.15);
      const s = Math.min(W, H) * 0.11;
      for (let i = 0; i < 4; i++) D().reindeer(ctx, W * (0.12 + i * 0.22), H * 0.78, s, t + i, i === 0);
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(W * 0.05, H * 0.6); ctx.lineTo(W * 0.95, H * 0.6); ctx.stroke();
      for (let i = 0; i < 8; i++) { ctx.fillStyle = '#ffd36b'; ctx.shadowColor = '#ffd36b'; ctx.shadowBlur = 6; ctx.beginPath(); ctx.arc(W * (0.08 + i * 0.12), H * 0.6 + Math.sin(t * 4 + i) * 3, 4, 0, TAU); ctx.fill(); } ctx.shadowBlur = 0;
      D().elf(ctx, W * 0.9, H * 0.88, s * 0.9, t, '#5b9bff');
      if (Math.floor(t / 2) !== st.j) { st.j = Math.floor(t / 2); if (Math.random() < 0.6) A().sfx.jingle(3, 0.1, 0.08); }
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('TEAM: 9 OF 9 READY', W * 0.05, 36);
    }; } },
    weather: { label: 'Weather Station', make(st) { return (ctx, W, H, t, dt) => {
      ctx.fillStyle = '#031a0a'; ctx.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.42;
      ctx.strokeStyle = 'rgba(61,220,151,.35)'; ctx.lineWidth = 1; for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, r * i / 4, 0, TAU); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
      const a = t * 1.5; const g = ctx.createConicGradient ? ctx.createConicGradient(a, cx, cy) : null; if (g) { g.addColorStop(0, 'rgba(61,220,151,.5)'); g.addColorStop(0.15, 'rgba(61,220,151,0)'); g.addColorStop(1, 'rgba(61,220,151,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
      for (let i = 0; i < 7; i++) { const ba = i * 0.9, br = r * (0.3 + (i % 4) * 0.17); const bx = cx + Math.cos(ba) * br, by = cy + Math.sin(ba) * br; const age = ((a - ba) % TAU + TAU) % TAU; ctx.fillStyle = '#9ef'; ctx.globalAlpha = Math.max(0, 1 - age / 4); ctx.beginPath(); ctx.arc(bx, by, 4, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1;
      ctx.fillStyle = '#c8ffd0'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('SNOW CLOUDS TRACKED: 7', 10, 36); ctx.fillText('FORECAST: CLEAR SKIES FOR FLIGHT', 10, 52); ctx.fillText('WIND: ' + (5 + Math.floor(Math.sin(t) * 3)) + ' KT N', 10, 68);
      if (Math.floor(t / 4.2) !== st.r) { st.r = Math.floor(t / 4.2); A().sfx.radar(); }
    }; } },
    prep: { label: 'Launch Pad', make(st) { return (ctx, W, H, t, dt) => {
      D().sky(ctx, W, H, '#040a26', '#1a1a4a'); D().starField(ctx, W, H, t, 70, 99); D().snowGround(ctx, W, H, 0.72);
      const s = Math.min(W, H) * 0.12;
      for (let i = 0; i < 10; i++) { const on = Math.floor(t * 4 + i) % 10 < 3; ctx.fillStyle = on ? '#ff4d58' : '#533'; ctx.shadowColor = '#ff4d58'; ctx.shadowBlur = on ? 10 : 0; ctx.beginPath(); ctx.arc(W * (0.03 + i * 0.105), H * 0.92, 4, 0, TAU); ctx.fill(); } ctx.shadowBlur = 0;
      ctx.save(); ctx.translate(W * 0.1, H * 0.8); for (let i = 0; i < 4; i++) D().reindeer(ctx, s * 1.8 + i * s * 1.3, 0, s * 0.5, t + i, i === 3); D().sleigh(ctx, 0, s * 0.1, s * 0.8); for (let i = 0; i < 6; i++) D().gift(ctx, -s * 0.3 + (i % 3) * s * 0.3, -s * 0.4 - Math.floor(i / 3) * s * 0.3, s * 0.28, ['#d7263d', '#2e9e5b', '#5b9bff'][i % 3]); ctx.restore();
      D().elf(ctx, W * 0.9, H * 0.86, s * 0.9, t, '#2e9e5b');
      const { s: sch } = progress(); const left = Math.max(0, sch.launch - flightClock());
      const hh = Math.floor(left / 3600000), mm = Math.floor(left / 60000) % 60, ss = Math.floor(left / 1000) % 60;
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 14px ui-monospace, monospace'; ctx.fillText('LAUNCH IN ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'), 10, 36);
      ctx.fillText('STATUS: FINAL CHECKS', 10, 54);
      if (left < 11000 && Math.floor(left / 1000) !== st.cb) { st.cb = Math.floor(left / 1000); A().sfx.countdownBeep(st.cb === 0); }
    }; } },
    launch: { label: 'Launch Pad', make(st) { st.t0 = null; return (ctx, W, H, t, dt) => {
      if (st.t0 === null) { st.t0 = t; A().sfx.rumble(4); setTimeout(() => A().sfx.jingle(14, 0.09), 500); setTimeout(() => A().sfx.hohoho(), 2500); setTimeout(() => A().sfx.fireworks(6), 3500); }
      const e = t - st.t0;
      D().sky(ctx, W, H, '#040a26', '#1a1a4a'); D().starField(ctx, W, H, t, 70, 99); D().snowGround(ctx, W, H, 0.72);
      const s = Math.min(W, H) * 0.12;
      const x = W * 0.05 + ease(e / 4) * W * 0.9; const lift = Math.max(0, e - 2.2) * H * 0.18;
      const shake = e < 2.5 ? Math.sin(e * 60) * 2 : 0;
      ctx.save(); ctx.translate(x, H * 0.8 - lift + shake); ctx.rotate(e > 2.2 ? -0.25 : 0); for (let i = 0; i < 4; i++) D().reindeer(ctx, s * 1.8 + i * s * 1.3, Math.sin(t * 10 + i) * 3, s * 0.5, t + i, i === 3, true); D().sleigh(ctx, 0, s * 0.1, s * 0.8); D().santa(ctx, 0, -s * 0.45, s * 0.45, t); ctx.restore();
      if (e < 3) for (let i = 0; i < 8; i++) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(x - s * 0.8 - i * 12 - rnd(0, 10), H * 0.86 + rnd(-6, 6), rnd(3, 9), 0, TAU); ctx.fill(); }
      st.fw = st.fw || new (D().Fireworks)(); if (e > 3 && Math.random() < 0.06) st.fw.launch(rnd(W * 0.1, W * 0.9), H); st.fw.onBurst = () => A().sfx.pop(); st.fw.draw(ctx, dt);
      ctx.fillStyle = '#3ddc97'; ctx.font = '700 14px ui-monospace, monospace'; ctx.fillText(e < 2.2 ? 'LIFTOFF SEQUENCE' : 'WE HAVE LIFTOFF!', 10, 36);
      if (e > 2.2) { ctx.save(); ctx.globalAlpha = Math.min(1, e - 2.2); D().glowText(ctx, 'SANTA IS ON HIS WAY!', W / 2, H * 0.35, Math.min(36, W / 12)); ctx.restore(); }
    }; } },
    resting: { label: "Santa's Den", make(st) { return (ctx, W, H, t, dt) => {
      room(ctx, W, H, '#3a1a1a', '#2a1a10');
      const s = Math.min(W, H) * 0.16;
      D().fireplace(ctx, W * 0.75, H * 0.78, s * 1.0, t);
      D().santa(ctx, W * 0.3, H * 0.76, s * 1.0, t, false);
      ctx.save(); ctx.font = '700 ' + s * 0.4 + 'px system-ui'; ctx.fillStyle = '#cfe0ff'; for (let i = 0; i < 3; i++) { const ph = (t * 0.5 + i * 0.33) % 1; ctx.globalAlpha = 0.9 - ph; ctx.fillText('z', W * 0.38 + ph * 40 + i * 12, H * 0.45 - ph * 50 - i * 8); } ctx.restore();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(W * 0.5, H * 0.8, s * 0.25, 0, TAU); ctx.fill(); ctx.fillStyle = '#b5651d'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(W * 0.5 + (i - 1) * 10, H * 0.78, 6, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('MISSION COMPLETE · ALL GIFTS DELIVERED', 10, 36); ctx.fillText('COOKIES EATEN: 2,471,983', 10, 52);
      if (Math.floor(t / 4) !== st.z) { st.z = Math.floor(t / 4); if (Math.random() < 0.5) A().sfx.snort(); }
    }; } },
    sleeping: { label: 'Reindeer Barn', make(st) { return (ctx, W, H, t, dt) => {
      room(ctx, W, H, '#1a1a10', '#3a3020'); hay(ctx, 0, H * 0.75, W, H * 0.2);
      const s = Math.min(W, H) * 0.14;
      for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(W * (0.15 + i * 0.3), H * 0.82); ctx.scale(1, 0.55); D().reindeer(ctx, 0, 0, s, 0, i === 1); ctx.restore(); }
      ctx.save(); ctx.font = '700 ' + s * 0.3 + 'px system-ui'; ctx.fillStyle = '#cfe0ff'; for (let i = 0; i < 4; i++) { const ph = (t * 0.4 + i * 0.25) % 1; ctx.globalAlpha = 0.9 - ph; ctx.fillText('z', W * (0.2 + i * 0.2) + ph * 30, H * 0.6 - ph * 50); } ctx.restore();
      ctx.fillStyle = '#ffd36b'; ctx.font = '700 12px ui-monospace, monospace'; ctx.fillText('ALL REINDEER ASLEEP · DO NOT DISTURB', 10, 36);
    }; } },
    closed: { label: 'Workshop Door', make(st) { return (ctx, W, H, t, dt) => {
      D().sky(ctx, W, H, '#040a26', '#101a4a'); D().starField(ctx, W, H, t, 60, 55); D().snowGround(ctx, W, H, 0.78);
      const s = Math.min(W, H) * 0.2;
      ctx.fillStyle = '#5a1a1a'; ctx.fillRect(W / 2 - s * 1.5, H * 0.8 - s * 2, s * 3, s * 2); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(W / 2 - s * 1.7, H * 0.8 - s * 2); ctx.lineTo(W / 2, H * 0.8 - s * 3); ctx.lineTo(W / 2 + s * 1.7, H * 0.8 - s * 2); ctx.fill();
      ctx.fillStyle = '#2a1a0a'; ctx.fillRect(W / 2 - s * 0.45, H * 0.8 - s * 1.3, s * 0.9, s * 1.3);
      ctx.save(); ctx.translate(W / 2, H * 0.8 - s * 1.45); ctx.rotate(Math.sin(t) * 0.04); ctx.fillStyle = '#f3e3b8'; ctx.fillRect(-s * 0.7, -s * 0.2, s * 1.4, s * 0.4); ctx.fillStyle = '#6a2a1a'; ctx.font = '700 ' + s * 0.16 + 'px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('CLOSED', 0, -s * 0.07); ctx.font = '600 ' + s * 0.1 + 'px Georgia, serif'; ctx.fillText('Merry Christmas!', 0, s * 0.1); ctx.restore();
      const wr = []; for (let i = 0; i <= 10; i++) wr.push([W / 2 - s * 1.5 + i * s * 0.3, H * 0.8 - s * 2]); D().lightString(ctx, wr, t);
      st.snow = st.snow || new (D().Snow)(40); st.snow.draw(ctx, W, H, dt);
    }; } },
  };
  function camSet() {
    switch (phase()) {
      case 'early': return ['workshop', 'barn', 'kitchen', 'mail'];
      case 'list': return ['study', 'wrapping', 'training', 'mail'];
      case 'loading': return ['hangar', 'harness', 'study', 'weather'];
      case 'prep': return ['prep', 'hangar', 'harness', 'weather'];
      case 'launch': return ['launch', 'weather', 'harness', 'hangar'];
      case 'flight': return ['tracker', 'weather', 'closed', 'kitchen'];
      default: return ['resting', 'sleeping', 'closed', 'kitchen'];
    }
  }

  // ---------- the tracker ----------
  function project(lat, lon, lon0, R, cx, cy) {
    const la = lat * Math.PI / 180, lo = (lon - lon0) * Math.PI / 180, tilt = 0.35;
    const x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt), z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
    return { x: cx + x * R, y: cy - y2 * R, front: z2 > -0.02, z: z2 };
  }
  function santaPos(p) {
    const f = Math.max(0, Math.min(0.9999, p)) * (ROUTE.length - 1);
    const i = Math.floor(f), k = f - i;
    const a = ROUTE[i], b = ROUTE[Math.min(ROUTE.length - 1, i + 1)];
    let dl = b[2] - a[2]; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    return { lat: a[1] + (b[1] - a[1]) * k, lon: a[2] + dl * k, i, k, from: a, to: b };
  }
  function trackerDraw(st) {
    return (ctx, W, H, t, dt) => {
      ctx.fillStyle = '#020814'; ctx.fillRect(0, 0, W, H);
      D().starField(ctx, W, H, t, 60, 23);
      const { p, s } = progress();
      const done = p >= 1;
      const pos = santaPos(done ? 0.9999 : Math.max(0, p));
      const cx = W * (W > 640 ? 0.36 : 0.5), cy = H * (W > 640 ? 0.52 : 0.4), R = Math.min(W * (W > 640 ? 0.3 : 0.42), H * 0.36);
      const lon0 = pos.lon;
      // globe
      ctx.save(); const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R); g.addColorStop(0, '#1b3a6a'); g.addColorStop(1, '#061226'); ctx.fillStyle = g; ctx.shadowColor = '#5b9bff'; ctx.shadowBlur = 30; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill(); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
      ctx.strokeStyle = 'rgba(120,170,255,.25)'; ctx.lineWidth = 1;
      for (let lat = -60; lat <= 60; lat += 30) { ctx.beginPath(); let first = true; for (let lon = -180; lon <= 180; lon += 4) { const q = project(lat, lon, lon0, R, cx, cy); if (!q.front) { first = true; continue; } if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y); } ctx.stroke(); }
      for (let lon = -180; lon < 180; lon += 30) { ctx.beginPath(); let first = true; for (let lat = -90; lat <= 90; lat += 4) { const q = project(lat, lon, lon0, R, cx, cy); if (!q.front) { first = true; continue; } if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y); } ctx.stroke(); }
      // the trail
      ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2; ctx.shadowColor = '#ffd36b'; ctx.shadowBlur = 8; ctx.beginPath(); let first = true;
      for (let i = 0; i <= pos.i; i++) { const q = project(ROUTE[i][1], ROUTE[i][2], lon0, R, cx, cy); if (!q.front) { first = true; continue; } if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y); }
      const sq = project(pos.lat, pos.lon, lon0, R, cx, cy); if (!first) ctx.lineTo(sq.x, sq.y); ctx.stroke(); ctx.shadowBlur = 0;
      // cities
      ctx.font = '600 10px ui-monospace, monospace';
      ROUTE.forEach((c, i) => { const q = project(c[1], c[2], lon0, R, cx, cy); if (!q.front) return; const home = i === HOME_INDEX; const visited = i <= pos.i; ctx.fillStyle = home ? '#ff4d58' : visited ? '#ffd36b' : 'rgba(255,255,255,.5)'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = home || visited ? 8 : 0; ctx.beginPath(); ctx.arc(q.x, q.y, home ? 5 : 3, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; if (home || Math.abs(i - pos.i) <= 2) { ctx.fillStyle = '#e9eef7'; ctx.fillText(home ? (S.state.settings.hometown || 'Home') : c[0], q.x + 7, q.y + 3); } });
      ctx.restore();
      // Santa
      if (!done) { ctx.save(); ctx.translate(sq.x, sq.y); ctx.scale(-1, 1); D().sleigh(ctx, 0, 0, 10, '#ff4d58'); ctx.restore(); ctx.save(); ctx.strokeStyle = '#ff4d58'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6 + Math.sin(t * 4) * 0.3; ctx.beginPath(); ctx.arc(sq.x, sq.y, 16 + Math.sin(t * 4) * 4, 0, TAU); ctx.stroke(); ctx.restore(); }
      // panel
      const px = W > 640 ? W * 0.68 : 10, py = W > 640 ? H * 0.12 : H * 0.78; const lh = 18;
      ctx.fillStyle = '#c8ffd0'; ctx.font = '700 12px ui-monospace, monospace'; ctx.shadowColor = '#3ddc97'; ctx.shadowBlur = 6;
      const lines = [];
      const gifts = Math.floor(Math.max(0, Math.min(1, p)) * 2100000000);
      if (p < 0) { lines.push('STATUS: ON THE LAUNCH PAD'); }
      else if (done) { lines.push('STATUS: HOME AT THE NORTH POLE', 'MISSION COMPLETE', 'GIFTS DELIVERED: ' + gifts.toLocaleString(), 'COOKIES EATEN: 2,471,983', '', 'Merry Christmas!'); }
      else {
        const homeTs = s.home.getTime(); const nowTs = flightClock().getTime();
        const passedHome = pos.i >= HOME_INDEX;
        lines.push('STATUS: IN FLIGHT', 'LAST STOP: ' + (pos.from[0] === 'HOME' ? (S.state.settings.hometown || 'your house') : pos.from[0]), 'NEXT STOP: ' + (pos.to[0] === 'HOME' ? (S.state.settings.hometown || 'your house') : pos.to[0]), 'SPEED: ' + (4800 + Math.floor(Math.sin(t * 2) * 300)).toLocaleString() + ' MPH', 'GIFTS DELIVERED: ' + gifts.toLocaleString(), 'COOKIES EATEN: ' + Math.floor(gifts / 850).toLocaleString());
        if (!passedHome) { const left = Math.max(0, homeTs - nowTs); lines.push('', 'ETA ' + (S.state.settings.hometown || 'YOUR HOUSE').toUpperCase() + ':', '  ' + String(Math.floor(left / 3600000)).padStart(2, '0') + ':' + String(Math.floor(left / 60000) % 60).padStart(2, '0') + ':' + String(Math.floor(left / 1000) % 60).padStart(2, '0'), '', 'Be asleep before he arrives!'); }
        else lines.push('', 'SANTA HAS VISITED ' + (S.state.settings.hometown || 'YOUR HOUSE').toUpperCase() + '!', 'Were you asleep? 😴');
      }
      lines.forEach((l, i) => ctx.fillText(l, px, py + i * lh));
      ctx.shadowBlur = 0;
      if (Math.floor(t / 3) !== st.pg) { st.pg = Math.floor(t / 3); if (!done && p >= 0) A().sfx.ping(); }
      if (!done && p >= 0 && pos.i !== st.lastStop) { st.lastStop = pos.i; if (st.lastStop > 0) { A().sfx.jingle(4, 0.1, 0.1); if (pos.i === HOME_INDEX) { A().sfx.hohoho(); } } }
    };
  }

  // ---------- page ----------
  let scenes = [];
  let host = null;
  let mainCanvas = null, mainScene = null, mainKey = null;
  // Small tiles skip all text: the label sits under the tile instead.
  function quiet(ctx) {
    return new Proxy(ctx, { get(t, k) { if (k === 'fillText' || k === 'strokeText') return () => {}; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; }, set(t, k, v) { t[k] = v; return true; } });
  }
  function makeCam(canvas, key, camNo, tile) {
    const st = {};
    const draw = key === 'tracker' ? trackerDraw(st) : CAMS[key].make(st);
    const label = key === 'tracker' ? 'Santa Tracker' : CAMS[key].label;
    const sc = new (D().Scene)(canvas, (raw, W, H, t, dt) => { const ctx = tile ? quiet(raw) : raw; draw(ctx, W, H, t, dt); crt(ctx, W, H, t, label, camNo, phase() !== 'done' || key === 'tracker'); });
    sc.start();
    return sc;
  }
  function showMain(key, camNo) {
    if (mainScene) mainScene.stop();
    mainKey = key;
    mainScene = makeCam(mainCanvas, key, camNo);
    if (mainTitle) mainTitle.textContent = key === 'tracker' ? 'Santa Tracker' : CAMS[key].label;
  }
  let mainTitle = null;
  let lastPhase = null;
  let watcher = null;

  function paint() {
    if (!host) return;
    for (const s of scenes) s.stop(); scenes = [];
    clear(host);
    const ph = phase(); lastPhase = ph;
    const set = camSet();
    const headline = { early: 'The elves are busy. Keep an eye on them!', list: 'Santa is checking his list. Twice.', loading: 'Loading the sleigh! Christmas is almost here.', prep: 'Christmas Eve: final checks before launch.', launch: 'LIFTOFF!', flight: 'Santa is in the air. Track him live!', done: 'Mission complete. Merry Christmas!' }[ph];
    mainCanvas = h('canvas', { class: 'cam main' });
    mainTitle = h('h3', { class: 'cam-title' });
    const tiles = h('div', { class: 'cam-tiles' });
    host.appendChild(h('div', { class: 'np-head' }, h('div', null, h('h2', null, icon('cam'), ' North Pole Command'), h('p', { class: 'muted', text: headline })),
      S.state.preview && S.state.day === 24 ? h('button', { class: 'btn small', type: 'button', onclick: () => { sim = { start: Date.now(), speed: 90 }; toast('Preview flight started at 90x speed', 'ok'); paint(); } }, icon('sleigh'), 'Preview: launch now') : null));
    host.appendChild(h('div', { class: 'np-main glass' }, mainTitle, mainCanvas));
    set.forEach((key, i) => {
      const cv = h('canvas', { class: 'cam' });
      const tile = h('button', { class: 'cam-tile' + (i === 0 ? ' on' : ''), type: 'button', onclick: () => { A().unlock(); A().sfx.beep(); showMain(key, i + 1); tiles.querySelectorAll('.cam-tile').forEach((b) => b.classList.remove('on')); tile.classList.add('on'); } }, cv, h('span', { class: 'cam-label', text: 'CAM ' + String(i + 1).padStart(2, '0') + ' · ' + (key === 'tracker' ? 'Santa Tracker' : CAMS[key].label) }));
      tiles.appendChild(tile);
      scenes.push(makeCam(cv, key, i + 1, true));
    });
    host.appendChild(tiles);
    showMain(set[0], 1);
    if (ph === 'flight' || ph === 'done') host.appendChild(h('p', { class: 'muted small center', text: ph === 'flight' ? 'The red pin is your house. Santa only comes when everyone is asleep!' : 'Santa is home and the reindeer are snoring. Happy birthday, Jesus!' }));
    else host.appendChild(h('p', { class: 'muted small center', text: 'Tap a camera to make it big. The cameras change as Christmas gets closer, so check back every day!' }));
  }
  function render(into) {
    host = h('section', { class: 'northpole' });
    into.appendChild(host);
    paint();
    clearInterval(watcher);
    watcher = setInterval(() => { if (host && phase() !== lastPhase) paint(); }, 2000);
  }
  function leave() { clearInterval(watcher); for (const s of scenes) s.stop(); scenes = []; if (mainScene) mainScene.stop(); mainScene = null; host = null; }
  AD.pages.northpole = { render, leave, phase, progress, ROUTE };
})();
