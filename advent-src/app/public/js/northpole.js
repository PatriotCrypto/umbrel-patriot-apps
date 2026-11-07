// North Pole Command: "live" security cams on the workshop, the reindeer barn and Santa himself.
// Real-looking footage: night-vision green, grain, static, signal drops, a drifting camera,
// flickering lamps, a timestamp and a blinking REC. On Christmas Eve, the launch and the tracker.
(function () {
  'use strict';
  const { h, clear, icon, toast, S } = AD;
  const D = () => window.Draw;
  const A = () => window.Audio2;
  const SC = () => window.Scenes;
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Santa's route: east to west, so midnight sweeps the world with him.
  const ROUTE = [
    ['Auckland', -36.8, 174.8], ['Sydney', -33.9, 151.2], ['Tokyo', 35.7, 139.7], ['Seoul', 37.6, 127.0], ['Manila', 14.6, 121.0], ['Beijing', 39.9, 116.4], ['Hong Kong', 22.3, 114.2], ['Jakarta', -6.2, 106.8], ['Bangkok', 13.8, 100.5], ['Kolkata', 22.6, 88.4], ['New Delhi', 28.6, 77.2], ['Mumbai', 19.1, 72.9], ['Dubai', 25.2, 55.3], ['Moscow', 55.8, 37.6], ['Nairobi', -1.3, 36.8], ['Jerusalem', 31.8, 35.2], ['Bethlehem', 31.7, 35.2], ['Cairo', 30.0, 31.2], ['Istanbul', 41.0, 29.0], ['Athens', 38.0, 23.7], ['Cape Town', -33.9, 18.4], ['Berlin', 52.5, 13.4], ['Rome', 41.9, 12.5], ['Oslo', 59.9, 10.8], ['Lagos', 6.5, 3.4], ['Paris', 48.9, 2.4], ['London', 51.5, -0.1], ['Madrid', 40.4, -3.7], ['Dublin', 53.3, -6.3], ['Reykjavik', 64.1, -21.9], ['Rio de Janeiro', -22.9, -43.2], ['Buenos Aires', -34.6, -58.4], ['Halifax', 44.6, -63.6], ['Caracas', 10.5, -66.9], ['Boston', 42.4, -71.1], ['New York City', 40.7, -74.0], ['Washington, D.C.', 38.9, -77.0], ['Miami', 25.8, -80.2], ['Atlanta', 33.7, -84.4], ['Cincinnati', 39.1, -84.5], ['HOME', 39.5, -85.0], ['Nashville', 36.2, -86.8], ['Chicago', 41.9, -87.6], ['Dallas', 32.8, -96.8], ['Mexico City', 19.4, -99.1], ['Denver', 39.7, -105.0], ['Phoenix', 33.4, -112.1], ['Los Angeles', 34.1, -118.2], ['Seattle', 47.6, -122.3], ['San Francisco', 37.8, -122.4], ['Vancouver', 49.3, -123.1], ['Anchorage', 61.2, -149.9], ['Honolulu', 21.3, -157.9], ['North Pole', 89.9, 0],
  ];
  const HOME_INDEX = ROUTE.findIndex((r) => r[0] === 'HOME');

  // ---------- Christmas Eve timing, in the family's own clock ----------
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
  const COUNTDOWN_MS = 12000;
  function flightClock() {
    const s = schedule();
    if (sim) { const e = Date.now() - sim.start; return new Date(e < COUNTDOWN_MS ? s.launch.getTime() - COUNTDOWN_MS + e : s.launch.getTime() + (e - COUNTDOWN_MS) * sim.speed); }
    return s.now;
  }
  function sinceLaunch() { const s = schedule(); return sim ? Date.now() - sim.start - COUNTDOWN_MS : s.now - s.launch; }
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

  // ---------- the footage look ----------
  let grainCanvas = null;
  function grain() {
    if (grainCanvas) return grainCanvas;
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const x = c.getContext('2d'); const id = x.createImageData(256, 256);
    for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    x.putImageData(id, 0, 0); grainCanvas = c; return c;
  }
  // Turn a color picture into night-vision footage.
  function nightVision(ctx, W, H, strength) {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#808080'; ctx.globalAlpha = strength; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#7dffa0'; ctx.globalAlpha = 0.9 * strength; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = '#0d3a1a'; ctx.globalAlpha = 0.55 * strength; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  function footage(ctx, W, H, t, st, opts) {
    ctx.save(); ctx.globalAlpha = opts.grain || 0.18; ctx.globalCompositeOperation = 'overlay';
    const g = grain(); const ox = Math.floor(Math.random() * 256), oy = Math.floor(Math.random() * 256);
    for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) ctx.drawImage(g, x, y);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = '#000'; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    const band = ((t * 40) % (H + 120)) - 60; const lg = ctx.createLinearGradient(0, band - 60, 0, band + 60); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,.08)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.globalAlpha = 1; ctx.fillStyle = lg; ctx.fillRect(0, band - 60, W, 120);
    ctx.restore();
    ctx.save(); const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.6)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H); ctx.restore();
    if (Math.random() < 0.03) { ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = '#fff'; ctx.fillRect(0, rnd(0, H), W, rnd(1, 6)); ctx.restore(); }
    if (Math.random() < 0.012) { const y = Math.floor(rnd(0, H - 40)), hh = Math.floor(rnd(8, 40)); const shift = Math.floor(rnd(-30, 30)); try { const slice = ctx.getImageData(0, y, W, hh); ctx.putImageData(slice, shift, y); } catch (e) { /* ignore */ } }
    if (!st.drop && Math.random() < 0.0015) st.drop = { until: t + rnd(0.3, 1.1) };
    if (st.drop) {
      if (t > st.drop.until) st.drop = null;
      else { ctx.save(); ctx.fillStyle = '#000'; ctx.globalAlpha = 0.7; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 0.6; const gg = grain(); for (let y = 0; y < H; y += 256) for (let x = 0; x < W; x += 256) ctx.drawImage(gg, x, y); ctx.globalAlpha = 1; ctx.fillStyle = '#c8ffd0'; ctx.font = '700 ' + Math.max(12, W / 40) + 'px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; if (Math.floor(t * 4) % 2) ctx.fillText('SIGNAL LOST', W / 2, H / 2); ctx.restore(); }
    }
  }
  function hud(ctx, W, H, t, label, cam, live, lines) {
    const small = W < 360;
    ctx.save();
    ctx.font = '600 ' + (small ? 9 : 11) + 'px ui-monospace, Menlo, monospace'; ctx.fillStyle = '#d8ffdf'; ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.textAlign = 'left';
    ctx.fillText('CAM ' + String(cam).padStart(2, '0') + (small ? '' : ' · ' + label.toUpperCase()), 10, 18);
    const now = flightClock();
    ctx.textAlign = 'right'; ctx.fillText(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + (small ? '' : '  NORTH POLE'), W - 10, 18);
    if (!small) ctx.fillText((S.state.today || '').replace(/-/g, '/'), W - 10, H - 10);
    ctx.textAlign = 'left';
    if (live) { if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = '#ff4d58'; ctx.shadowColor = '#ff4d58'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(14, H - 14, 4, 0, TAU); ctx.fill(); ctx.shadowColor = '#000'; ctx.shadowBlur = 4; } ctx.fillStyle = '#d8ffdf'; ctx.fillText('REC', 24, H - 10); }
    else { ctx.fillStyle = '#ffd36b'; ctx.fillText('PLAYBACK', 10, H - 10); }
    if (lines && !small) { ctx.fillStyle = '#ffe9a8'; ctx.font = '700 11px ui-monospace, Menlo, monospace'; lines.forEach((l, i) => ctx.fillText(l, 10, 38 + i * 15)); }
    ctx.restore();
  }
  // A camera that shows a picture with life in it.
  function photoCam(opts) {
    return {
      label: opts.label,
      make(st) {
        const img = SC().picture(opts.img);
        const Fl = SC().Floaters;
        const dust = new Fl({ rate: opts.dust || 4, vy: -6, vx: 4, size: 1, colors: ['#ffffff'], glow: 2, life: 4, area: [0, 0, 1, 1] });
        const snow = opts.snow ? new (D().Snow)(60) : null;
        const extra = opts.extra ? opts.extra(st) : null;
        return (ctx, W, H, t, dt) => {
          SC().drawPicture(ctx, img, W, H, t, Object.assign({ zoom: 1.12, panX: 14, panY: 8, speed: 0.07, breathe: 0.015 }, opts.move || {}));
          if (opts.lamps) SC().flicker(ctx, opts.lamps.map(([x, y, r, ph]) => [W * x, H * y, Math.min(W, H) * r, ph]), t);
          if (snow) snow.draw(ctx, W, H, dt, -10);
          if (extra) extra(ctx, W, H, t, dt);
          if (opts.nv) nightVision(ctx, W, H, opts.nv);
          dust.draw(ctx, W, H, dt, t);
          footage(ctx, W, H, t, st, { grain: opts.nv ? 0.3 : 0.14 });
          hud(ctx, W, H, t, opts.label, st.camNo, true, typeof opts.lines === 'function' ? opts.lines(t, st) : opts.lines);
        };
      },
    };
  }

  const CAMS = {
    workshop: photoCam({ label: 'Toy Workshop', img: 'cam-workshop', lamps: [[0.44, 0.42, 0.12, 0], [0.6, 0.5, 0.12, 2]], lines: (t) => ['TOYS TODAY: ' + (1220 + Math.floor(t * 0.7)).toLocaleString(), 'SHIFT: ELF TEAM B'], extra() { let last = 0; return (ctx, W, H, t) => { if (t - last > 0.7 && Math.random() < 0.04) { last = t; A().sfx.click(); } }; } }),
    barn: photoCam({ label: 'Reindeer Barn', img: 'cam-barn', nv: 0.85, lamps: [[0.38, 0.1, 0.1, 0], [0.5, 0.1, 0.1, 1]], lines: ['REINDEER: 9 PRESENT', 'CARROTS: 48'], extra() { let last = 0; return (ctx, W, H, t) => { if (t - last > 3 && Math.random() < 0.01) { last = t; A().sfx.snort(); } }; } }),
    kitchen: photoCam({ label: 'Cookie Kitchen', img: 'cam-kitchen', lamps: [[0.12, 0.48, 0.16, 0]], lines: (t) => ['COOKIES BAKED: ' + (3400 + Math.floor(t * 2)).toLocaleString(), 'OVEN: 350°F'], extra() { let last = 0; return (ctx, W, H, t) => { if (t - last > 4 && Math.random() < 0.01) { last = t; A().sfx.chime(); } }; } }),
    mail: photoCam({ label: 'Mail Room', img: 'cam-mail', nv: 0.5, lines: (t) => ['LETTERS TODAY: ' + (18200 + Math.floor(t * 3)).toLocaleString(), 'SORTING: ON SCHEDULE'], extra() { let last = 0; return (ctx, W, H, t) => { if (t - last > 2 && Math.random() < 0.02) { last = t; A().sfx.beep(); } }; } }),
    study: photoCam({ label: "Santa's Study", img: 'cam-study', lamps: [[0.08, 0.5, 0.14, 0], [0.42, 0.56, 0.08, 1]], lines: (t) => ['LIST CHECKED: ' + (Math.floor(t / 4) % 2 ? 'TWICE' : 'ONCE'), 'NAMES REVIEWED: ' + (812400 + Math.floor(t * 11)).toLocaleString()], extra() { let last = 0; return (ctx, W, H, t) => { if (t - last > 2.5 && Math.random() < 0.02) { last = t; A().sfx.typing(3); } }; } }),
    wrapping: photoCam({ label: 'Wrapping Room', img: 'cam-wrapping', lines: (t) => ['WRAPPED: ' + (900000 + Math.floor(t * 11)).toLocaleString(), 'RIBBON: 2.1 MILES LEFT'], extra() { let last = 0; return (ctx, W, H, t) => { if (t - last > 2.5 && Math.random() < 0.02) { last = t; A().sfx.swoosh(); } }; } }),
    training: photoCam({ label: 'Reindeer Training', img: 'cam-training', nv: 0.7, snow: true, move: { zoom: 1.12, panX: 30, speed: 0.1 }, lines: (t) => ['TOP SPEED: ' + (640 + Math.floor(Math.sin(t) * 20)) + ' MPH', 'RUNWAY: CLEAR'], extra() { let last = 0; return (ctx, W, H, t) => { if (t - last > 1.5 && Math.random() < 0.03) { last = t; A().sfx.clops(2, 0.14); } }; } }),
    hangar: photoCam({ label: 'Sleigh Hangar', img: 'cam-hangar', nv: 0.4, lamps: [[0.5, 0.2, 0.2, 0]], lines: (t) => ['GIFTS LOADED: ' + (2400000 + Math.floor(t / 2) * 120000).toLocaleString(), 'SLEIGH: 61% FULL'], extra() { let last = 0; return (ctx, W, H, t) => { if (t - last > 2 && Math.random() < 0.02) { last = t; A().sfx.swoosh(); } }; } }),
    harness: photoCam({ label: 'Harness Bay', img: 'cam-harness', nv: 0.9, lines: ['TEAM: 9 OF 9 READY', 'BELLS: POLISHED'], extra() { let last = 0; return (ctx, W, H, t) => { if (t - last > 2 && Math.random() < 0.02) { last = t; A().sfx.jingle(3, 0.1, 0.08); } }; } }),
    weather: { label: 'Weather Station', make(st) { return (ctx, W, H, t) => {
      ctx.fillStyle = '#031a0a'; ctx.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.42;
      ctx.strokeStyle = 'rgba(61,220,151,.35)'; ctx.lineWidth = 1; for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, r * i / 4, 0, TAU); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
      const a = t * 1.5; const g = ctx.createConicGradient ? ctx.createConicGradient(a, cx, cy) : null; if (g) { g.addColorStop(0, 'rgba(61,220,151,.5)'); g.addColorStop(0.15, 'rgba(61,220,151,0)'); g.addColorStop(1, 'rgba(61,220,151,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
      for (let i = 0; i < 7; i++) { const ba = i * 0.9, br = r * (0.3 + (i % 4) * 0.17); const bx = cx + Math.cos(ba) * br, by = cy + Math.sin(ba) * br; const age = ((a - ba) % TAU + TAU) % TAU; ctx.fillStyle = '#9ef'; ctx.globalAlpha = Math.max(0, 1 - age / 4); ctx.beginPath(); ctx.arc(bx, by, 4, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1;
      footage(ctx, W, H, t, st, { grain: 0.1 });
      hud(ctx, W, H, t, 'Weather Station', st.camNo, true, ['SNOW CLOUDS TRACKED: 7', 'FORECAST: CLEAR FOR FLIGHT', 'WIND: ' + (5 + Math.floor(Math.sin(t) * 3)) + ' KT N']);
      if (Math.floor(t / 4.2) !== st.r) { st.r = Math.floor(t / 4.2); A().sfx.radar(); }
    }; } },
    prep: photoCam({ label: 'Launch Pad', img: 'cam-prep', nv: 0.35, snow: true, lines() { const { s } = progress(); const left = Math.max(0, s.launch - flightClock()); const hh = Math.floor(left / 3600000), mm = Math.floor(left / 60000) % 60, ss = Math.floor(left / 1000) % 60; return ['LAUNCH IN ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'), 'STATUS: FINAL CHECKS', 'TEAM: 9 OF 9 HARNESSED']; }, extra(st) { return (ctx, W, H, t) => { for (let i = 0; i < 10; i++) { if (Math.floor(t * 4 + i) % 10 < 3) SC().glow(ctx, W * (0.05 + i * 0.1), H * 0.86, 14, 'rgba(255,60,60,A)', 0.5); } const { s } = progress(); const left = Math.max(0, s.launch - flightClock()); if (left < 11000 && Math.floor(left / 1000) !== st.cb) { st.cb = Math.floor(left / 1000); A().sfx.countdownBeep(st.cb === 0); } }; } }),
    launch: { label: 'Launch Pad', make(st) {
      const img = SC().picture('cam-launch'); const snow = new (D().Snow)(80); const Fl = SC().Floaters; const trail = new Fl({ rate: 60, vy: 40, vx: -70, size: 2, shape: 'star', colors: ['#ffd36b', '#fff', '#ffb13b'], area: [0.3, 0.6, 0.08, 0.06], life: 1.2 }); st.t0 = null;
      return (ctx, W, H, t, dt) => {
        if (st.t0 === null) { st.t0 = t; A().sfx.rumble(4); setTimeout(() => A().sfx.jingle(14, 0.09), 500); setTimeout(() => A().sfx.hohoho(), 2500); setTimeout(() => A().sfx.fireworks(6), 3500); }
        const e = t - st.t0;
        const shake = e < 3 ? Math.sin(e * 60) * 3 * (1 - e / 3) : 0;
        ctx.save(); ctx.translate(shake, Math.cos(e * 50) * shake * 0.5);
        SC().drawPicture(ctx, img, W, H, t, { zoom: 1.05, zoomIn: 0.012, panX: 0, panY: 0, breathe: 0 });
        ctx.restore();
        trail.draw(ctx, W, H, dt, t);
        snow.draw(ctx, W, H, dt, -40);
        st.fw = st.fw || new (D().Fireworks)(); if (e > 3 && Math.random() < 0.06) st.fw.launch(rnd(W * 0.1, W * 0.9), H); st.fw.onBurst = () => A().sfx.pop(); st.fw.draw(ctx, dt);
        nightVision(ctx, W, H, 0.3);
        footage(ctx, W, H, t, st, { grain: 0.2 });
        hud(ctx, W, H, t, 'Launch Pad', st.camNo, true, [e < 2.2 ? 'LIFTOFF SEQUENCE' : 'WE HAVE LIFTOFF!', 'ALTITUDE: ' + Math.floor(Math.max(0, e - 2) * 900).toLocaleString() + ' FT']);
        if (e > 2.2) { ctx.save(); ctx.globalAlpha = Math.min(1, e - 2.2); D().glowText(ctx, 'Santa is on his way!', W / 2, H * 0.3, Math.min(56, W / 10), '#fff6cc', SC().SCRIPT); ctx.restore(); }
      };
    } },
    resting: photoCam({ label: "Santa's Den", img: 'cam-resting', lamps: [[0.14, 0.55, 0.18, 0], [0.85, 0.3, 0.1, 1]], lines: ['MISSION COMPLETE', 'GIFTS DELIVERED: ALL', 'COOKIES EATEN: 2,471,983'], extra() { let last = 0; return (ctx, W, H, t) => { if (t - last > 4 && Math.random() < 0.01) { last = t; A().sfx.snort(); } ctx.save(); ctx.font = SC().SCRIPT.replace('{s}', Math.max(14, W / 30)); ctx.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 3; i++) { const ph = (t * 0.4 + i * 0.33) % 1; ctx.globalAlpha = 0.8 - ph * 0.8; ctx.fillText('z', W * 0.5 + ph * 40 + i * 14, H * 0.3 - ph * 60 - i * 10); } ctx.restore(); }; } }),
    sleeping: photoCam({ label: 'Reindeer Barn', img: 'cam-sleeping', nv: 0.9, lines: ['ALL REINDEER ASLEEP', 'DO NOT DISTURB'] }),
    closed: photoCam({ label: 'Workshop Door', img: 'cam-closed', snow: true, lamps: [[0.3, 0.3, 0.1, 0], [0.7, 0.3, 0.1, 1]], lines: ['WORKSHOP: CLOSED', 'REOPENS: DECEMBER 26'], extra() { return (ctx, W, H) => { ctx.save(); ctx.font = SC().SCRIPT.replace('{s}', Math.max(12, W / 26)); ctx.textAlign = 'center'; ctx.fillStyle = '#5a1a0a'; ctx.fillText('Merry Christmas!', W * 0.5, H * 0.485); ctx.restore(); }; } }),
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
    return (ctx, W, H, t) => {
      ctx.fillStyle = '#020814'; ctx.fillRect(0, 0, W, H);
      D().starField(ctx, W, H, t, 60, 23);
      const { p, s } = progress();
      const done = p >= 1;
      const pos = santaPos(done ? 0.9999 : Math.max(0, p));
      const cx = W * (W > 640 ? 0.36 : 0.5), cy = H * (W > 640 ? 0.52 : 0.4), R = Math.min(W * (W > 640 ? 0.3 : 0.42), H * 0.36);
      const lon0 = pos.lon;
      ctx.save(); const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R); g.addColorStop(0, '#1b3a6a'); g.addColorStop(1, '#061226'); ctx.fillStyle = g; ctx.shadowColor = '#5b9bff'; ctx.shadowBlur = 30; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill(); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
      ctx.strokeStyle = 'rgba(120,170,255,.25)'; ctx.lineWidth = 1;
      for (let lat = -60; lat <= 60; lat += 30) { ctx.beginPath(); let first = true; for (let lon = -180; lon <= 180; lon += 4) { const q = project(lat, lon, lon0, R, cx, cy); if (!q.front) { first = true; continue; } if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y); } ctx.stroke(); }
      for (let lon = -180; lon < 180; lon += 30) { ctx.beginPath(); let first = true; for (let lat = -90; lat <= 90; lat += 4) { const q = project(lat, lon, lon0, R, cx, cy); if (!q.front) { first = true; continue; } if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y); } ctx.stroke(); }
      ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2; ctx.shadowColor = '#ffd36b'; ctx.shadowBlur = 8; ctx.beginPath(); let first = true;
      for (let i = 0; i <= pos.i; i++) { const q = project(ROUTE[i][1], ROUTE[i][2], lon0, R, cx, cy); if (!q.front) { first = true; continue; } if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y); }
      const sq = project(pos.lat, pos.lon, lon0, R, cx, cy); if (!first) ctx.lineTo(sq.x, sq.y); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.font = '600 10px ui-monospace, monospace';
      ROUTE.forEach((c, i) => { const q = project(c[1], c[2], lon0, R, cx, cy); if (!q.front) return; const home = i === HOME_INDEX; const visited = i <= pos.i; ctx.fillStyle = home ? '#ff4d58' : visited ? '#ffd36b' : 'rgba(255,255,255,.5)'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = home || visited ? 8 : 0; ctx.beginPath(); ctx.arc(q.x, q.y, home ? 5 : 3, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; if (home || Math.abs(i - pos.i) <= 2) { ctx.fillStyle = '#e9eef7'; ctx.fillText(home ? (S.state.settings.hometown || 'Home') : c[0], q.x + 7, q.y + 3); } });
      ctx.restore();
      if (!done) { ctx.save(); ctx.translate(sq.x, sq.y); ctx.scale(-1, 1); D().sleigh(ctx, 0, 0, 10, '#ff4d58'); ctx.restore(); ctx.save(); ctx.strokeStyle = '#ff4d58'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6 + Math.sin(t * 4) * 0.3; ctx.beginPath(); ctx.arc(sq.x, sq.y, 16 + Math.sin(t * 4) * 4, 0, TAU); ctx.stroke(); ctx.restore(); }
      const px = W > 640 ? W * 0.68 : 10, py = W > 640 ? H * 0.12 : H * 0.78; const lh = 18;
      ctx.fillStyle = '#c8ffd0'; ctx.font = '700 12px ui-monospace, monospace'; ctx.shadowColor = '#3ddc97'; ctx.shadowBlur = 6;
      const lines = [];
      const gifts = Math.floor(Math.max(0, Math.min(1, p)) * 2100000000);
      if (p < 0) lines.push('STATUS: ON THE LAUNCH PAD');
      else if (done) lines.push('STATUS: HOME AT THE NORTH POLE', 'MISSION COMPLETE', 'GIFTS DELIVERED: ' + gifts.toLocaleString(), 'COOKIES EATEN: 2,471,983', '', 'Merry Christmas!');
      else {
        const homeTs = s.home.getTime(); const nowTs = flightClock().getTime();
        const passedHome = pos.i >= HOME_INDEX;
        lines.push('STATUS: IN FLIGHT', 'LAST STOP: ' + (pos.from[0] === 'HOME' ? (S.state.settings.hometown || 'your house') : pos.from[0]), 'NEXT STOP: ' + (pos.to[0] === 'HOME' ? (S.state.settings.hometown || 'your house') : pos.to[0]), 'SPEED: ' + (4800 + Math.floor(Math.sin(t * 2) * 300)).toLocaleString() + ' MPH', 'GIFTS DELIVERED: ' + gifts.toLocaleString(), 'COOKIES EATEN: ' + Math.floor(gifts / 850).toLocaleString());
        if (!passedHome) { const left = Math.max(0, homeTs - nowTs); lines.push('', 'ETA ' + (S.state.settings.hometown || 'YOUR HOUSE').toUpperCase() + ':', '  ' + String(Math.floor(left / 3600000)).padStart(2, '0') + ':' + String(Math.floor(left / 60000) % 60).padStart(2, '0') + ':' + String(Math.floor(left / 1000) % 60).padStart(2, '0'), '', 'Be asleep before he arrives!'); }
        else lines.push('', 'SANTA HAS VISITED ' + (S.state.settings.hometown || 'YOUR HOUSE').toUpperCase() + '!', 'Were you asleep?');
      }
      lines.forEach((l, i) => ctx.fillText(l, px, py + i * lh));
      ctx.shadowBlur = 0;
      footage(ctx, W, H, t, st, { grain: 0.08 });
      hud(ctx, W, H, t, 'Santa Tracker', st.camNo, true);
      if (Math.floor(t / 3) !== st.pg) { st.pg = Math.floor(t / 3); if (!done && p >= 0) A().sfx.ping(); }
      if (!done && p >= 0 && pos.i !== st.lastStop) { st.lastStop = pos.i; if (st.lastStop > 0) { A().sfx.jingle(4, 0.1, 0.1); if (pos.i === HOME_INDEX) A().sfx.hohoho(); } }
    };
  }

  // ---------- page ----------
  let scenes = [];
  let host = null;
  let mainCanvas = null, mainScene = null, mainTitle = null;
  function quiet(ctx) { return new Proxy(ctx, { get(t, k) { if (k === 'fillText' || k === 'strokeText') return () => {}; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; }, set(t, k, v) { t[k] = v; return true; } }); }
  function makeCam(canvas, key, camNo, tile) {
    const st = { camNo };
    const draw = key === 'tracker' ? trackerDraw(st) : CAMS[key].make(st);
    const sc = new (D().Scene)(canvas, (raw, W, H, t, dt) => { const ctx = tile ? quiet(raw) : raw; draw(ctx, W, H, t, dt); });
    sc.start();
    return sc;
  }
  function label(key) { return key === 'tracker' ? 'Santa Tracker' : CAMS[key].label; }
  function showMain(key, camNo) {
    if (mainScene) mainScene.stop();
    mainScene = makeCam(mainCanvas, key, camNo);
    if (mainTitle) mainTitle.textContent = 'CAM ' + String(camNo).padStart(2, '0') + ' · ' + label(key);
  }
  let lastPhase = null;
  let watcher = null;

  function paint() {
    if (!host) return;
    for (const s of scenes) s.stop(); scenes = [];
    clear(host);
    const ph = phase(); lastPhase = ph;
    const set = camSet();
    const headline = { early: 'Shh… the elves don\'t know we can see them!', list: 'Santa is checking his list. Twice.', loading: 'Loading the sleigh! Christmas is almost here.', prep: 'Christmas Eve: final checks before launch.', launch: 'LIFTOFF!', flight: 'Santa is in the air. Track him live!', done: 'Mission complete. Merry Christmas!' }[ph];
    mainCanvas = h('canvas', { class: 'cam main' });
    mainTitle = h('h3', { class: 'cam-title' });
    const tiles = h('div', { class: 'cam-tiles' });
    host.appendChild(h('div', { class: 'np-head' }, h('div', null, h('h2', { class: 'script' }, 'North Pole Command'), h('p', { class: 'muted', text: headline })),
      S.state.preview && S.state.day === 24 ? h('button', { class: 'btn small', type: 'button', onclick: () => { sim = { start: Date.now(), speed: 90 }; toast('Preview flight started at 90x speed', 'ok'); paint(); } }, icon('sleigh'), 'Preview: launch now') : null));
    host.appendChild(h('div', { class: 'np-main' }, h('div', { class: 'np-bar' }, h('span', { class: 'np-live' }, h('i'), 'LIVE'), mainTitle, h('span', { class: 'np-sig', text: 'SIGNAL ▮▮▮▮▯' })), mainCanvas));
    set.forEach((key, i) => {
      const cv = h('canvas', { class: 'cam' });
      const tile = h('button', { class: 'cam-tile' + (i === 0 ? ' on' : ''), type: 'button', onclick: () => { A().unlock(); A().sfx.beep(); showMain(key, i + 1); tiles.querySelectorAll('.cam-tile').forEach((b) => b.classList.remove('on')); tile.classList.add('on'); } }, cv, h('span', { class: 'cam-label', text: 'CAM ' + String(i + 1).padStart(2, '0') + ' · ' + label(key) }));
      tiles.appendChild(tile);
      scenes.push(makeCam(cv, key, i + 1, true));
    });
    host.appendChild(tiles);
    showMain(set[0], 1);
    host.appendChild(h('p', { class: 'muted small center', text: ph === 'flight' ? 'The red pin is your house. Santa only comes when everyone is asleep!' : ph === 'done' ? 'Santa is home and the reindeer are snoring. Happy birthday, Jesus!' : 'Tap a camera to make it big. The cameras change as Christmas gets closer, so check back every day!' }));
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
