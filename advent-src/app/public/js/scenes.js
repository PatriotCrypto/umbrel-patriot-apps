// The 25 advent scenes: a rendered picture for each day that comes alive with light, sparkle,
// snow and fire layers, a slow camera drift, and a cursive title that fades in.
(function () {
  'use strict';
  const D = window.Draw;
  const sfx = () => window.Audio2.sfx;
  const TAU = Math.PI * 2;
  const rnd = D.rnd;
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const SCRIPT = '700 {s}px "Dancing Script", "Brush Script MT", cursive';

  // ---------- pictures ----------
  const cache = {};
  function picture(name) {
    if (cache[name]) return cache[name];
    const img = new Image();
    img.src = '/img/' + name + '.jpg';
    cache[name] = img;
    return img;
  }
  // Cover-fit the picture and drift it slowly (a "Ken Burns" move) so it never feels frozen.
  function drawPicture(ctx, img, W, H, t, move = {}) {
    if (!img.complete || !img.naturalWidth) { ctx.fillStyle = '#0a1230'; ctx.fillRect(0, 0, W, H); return false; }
    const zoom = (move.zoom || 1.06) + Math.sin(t * (move.speed || 0.12)) * (move.breathe || 0.02) + (move.zoomIn ? Math.min(0.25, t * move.zoomIn) : 0);
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom;
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    const px = (W - w) / 2 + Math.sin(t * (move.speed || 0.12) * 0.7) * (move.panX || 18) + (move.driftX ? Math.max(-W * 0.1, t * move.driftX) : 0);
    const py = (H - h) / 2 + Math.cos(t * (move.speed || 0.12) * 0.5) * (move.panY || 10);
    ctx.drawImage(img, Math.min(0, Math.max(W - w, px)), Math.min(0, Math.max(H - h, py)), w, h);
    return true;
  }

  // ---------- light and particle layers ----------
  function glow(ctx, x, y, r, color, a) {
    if (r <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', Math.max(0, a).toFixed(3))); g.addColorStop(1, color.replace('A', '0'));
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
  }
  function rays(ctx, x, y, t, color = 'rgba(255,240,200,A)', n = 14, len = 1.4, speed = 0.06, alpha = 0.16) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(x, y);
    for (let i = 0; i < n; i++) {
      ctx.save(); ctx.rotate(i * TAU / n + t * speed + Math.sin(t * 0.3 + i) * 0.03);
      const w = 0.05 + ((i * 7) % 5) * 0.02;
      const g = ctx.createLinearGradient(0, 0, 0, -3000 * len);
      g.addColorStop(0, color.replace('A', (alpha * (0.6 + 0.4 * Math.sin(t * 1.3 + i))).toFixed(3))); g.addColorStop(1, color.replace('A', '0'));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-Math.tan(w) * 3000, -3000); ctx.lineTo(Math.tan(w) * 3000, -3000); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
  function twinkles(ctx, W, H, t, n = 40, seed = 5, maxY = 0.6, color = '#fff') {
    ctx.save(); ctx.fillStyle = color; ctx.globalCompositeOperation = 'lighter';
    let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < n; i++) { const x = r() * W, y = r() * H * maxY, k = r(); const a = Math.max(0, Math.sin(t * (0.8 + k * 1.5) + i * 2)); ctx.globalAlpha = a * 0.9; const rr = 1 + k * 2.2 * a; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill(); if (a > 0.85) { ctx.globalAlpha = (a - 0.85) * 4; ctx.fillRect(x - rr * 4, y - 0.5, rr * 8, 1); ctx.fillRect(x - 0.5, y - rr * 4, 1, rr * 8); } }
    ctx.restore();
  }
  class Floaters { // sparkles, embers, dust, notes: anything that drifts and fades
    constructor(opts) { this.o = Object.assign({ rate: 6, life: 3, vx: 0, vy: -30, spread: 1, size: 2.5, colors: ['#fff5c0', '#ffd36b', '#fff'], glow: 10, shape: 'dot', area: [0, 0.3, 1, 1] }, opts); this.p = []; this.acc = 0; }
    draw(ctx, W, H, dt, t) {
      const o = this.o; this.acc += o.rate * dt;
      while (this.acc >= 1) { this.acc--; const [ax, ay, aw, ah] = o.area; this.p.push({ x: W * (ax + Math.random() * aw), y: H * (ay + Math.random() * ah), vx: o.vx + rnd(-20, 20) * o.spread, vy: o.vy + rnd(-10, 10) * o.spread, life: o.life * rnd(0.6, 1.2), max: o.life, c: o.colors[Math.floor(Math.random() * o.colors.length)], r: o.size * rnd(0.5, 1.4), ph: Math.random() * 6, ch: o.chars ? o.chars[Math.floor(Math.random() * o.chars.length)] : null }); }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const p of this.p) {
        p.life -= dt; p.x += (p.vx + Math.sin(t * 2 + p.ph) * 12) * dt; p.y += p.vy * dt; if (o.gravity) p.vy += o.gravity * dt;
        if (p.life <= 0) continue;
        const k = p.life / p.max; ctx.globalAlpha = Math.min(1, k * 2) * Math.min(1, (p.max - p.life) * 3) * 0.95;
        ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = o.glow;
        if (p.ch) { ctx.font = '700 ' + (p.r * 9) + 'px system-ui'; ctx.fillText(p.ch, p.x, p.y); }
        else if (o.shape === 'star') D.star(ctx, p.x, p.y, p.r * 2, p.c, 4, 0.35, o.glow);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); }
      }
      ctx.restore(); this.p = this.p.filter((p) => p.life > 0);
    }
  }
  function flicker(ctx, spots, t, color = 'rgba(255,170,70,A)') {
    for (const [x, y, r, ph] of spots) glow(ctx, x, y, r, color, 0.12 + 0.08 * Math.sin(t * 9 + ph) * Math.sin(t * 5.3 + ph * 2) + 0.05 * Math.sin(t * 17 + ph));
  }
  function title(ctx, W, H, t, text, from, to, size, y = 0.14, color = '#fff6cc') {
    if (t < from || t > to) return;
    const a = clamp01(Math.min((t - from) / 1.2, (to - t) / 0.8));
    ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (1 - ease((t - from) / 1.2)) * 14);
    D.glowText(ctx, text, W / 2, H * y, Math.min(size, W / (text.length * 0.42)), color, SCRIPT);
    ctx.restore();
  }
  function flash(ctx, W, H, t, at, color = 'rgba(255,250,230,A)') { const e = t - at; if (e < 0 || e > 1.2) return; ctx.save(); ctx.fillStyle = color.replace('A', (0.9 * (1 - e / 1.2) * (1 - e / 1.2)).toFixed(3)); ctx.fillRect(0, 0, W, H); ctx.restore(); }

  // ---------- the recipes ----------
  // Each day: picture, camera move, sound, music, title, and the layers that bring it alive.
  const DAYS = {
    star: { img: 'day01', music: 'emmanuel', move: { zoom: 1.12, breathe: 0.03 }, words: ['A light is promised', 2, 8, 64, 0.86],
      intro() { sfx().twinkle(); setTimeout(() => sfx().chime(), 1200); },
      layers(st) { st.f = new Floaters({ rate: 8, vy: -22, size: 2, area: [0.3, 0.1, 0.4, 0.6], shape: 'star' }); return (ctx, W, H, t, dt) => { glow(ctx, W * 0.5, H * 0.22, Math.min(W, H) * (0.22 + Math.sin(t * 2) * 0.03), 'rgba(255,240,190,A)', 0.35); rays(ctx, W * 0.5, H * 0.22, t); twinkles(ctx, W, H, t, 50, 3, 0.5); st.f.draw(ctx, W, H, dt, t); }; } },
    candles: { img: 'day02', music: 'emmanuel', move: { zoom: 1.08, panX: 8 }, words: ['God with us', 3, 8.5, 70, 0.14],
      intro() { sfx().chime(); setTimeout(() => sfx().sparkle(6, 0.08), 900); },
      layers(st) { st.f = new Floaters({ rate: 7, vy: -40, size: 1.6, colors: ['#ffb13b', '#fff3b0', '#ff7a1a'], area: [0.2, 0.25, 0.6, 0.3] }); return (ctx, W, H, t, dt) => { flicker(ctx, [[W * 0.27, H * 0.33, W * 0.14, 0], [W * 0.42, H * 0.3, W * 0.14, 1], [W * 0.57, H * 0.3, W * 0.14, 2], [W * 0.72, H * 0.34, W * 0.14, 3]], t); st.f.draw(ctx, W, H, dt, t); }; } },
    bethlehem: { img: 'day03', music: 'emmanuel', move: { zoom: 1.1, panX: 25, speed: 0.08 }, words: ['O little town of Bethlehem', 1.5, 7.5, 60, 0.9],
      intro() { sfx().chime(); },
      layers(st) { return (ctx, W, H, t, dt) => { glow(ctx, W * 0.5, H * 0.12, Math.min(W, H) * 0.2, 'rgba(220,235,255,A)', 0.3 + Math.sin(t * 2) * 0.08); rays(ctx, W * 0.5, H * 0.12, t, 'rgba(220,235,255,A)', 10, 1.2, 0.04, 0.12); twinkles(ctx, W, H, t, 60, 9, 0.45); if (!st.shoot && Math.random() < 0.006) st.shoot = { x: rnd(W * 0.3, W), y: rnd(0, H * 0.25), life: 1 }; if (st.shoot) { st.shoot.life -= dt; st.shoot.x -= 500 * dt; st.shoot.y += 160 * dt; ctx.save(); ctx.globalAlpha = Math.max(0, st.shoot.life); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(st.shoot.x, st.shoot.y); ctx.lineTo(st.shoot.x + 80, st.shoot.y - 26); ctx.stroke(); ctx.restore(); if (st.shoot.life <= 0) st.shoot = null; } }; } },
    angel: { img: 'day04', music: 'gloria', move: { zoom: 1.1, breathe: 0.02 }, words: ['Hail, thou that art highly favoured', 3, 8.5, 48, 0.9],
      intro() { sfx().angelic(); },
      layers(st) { st.f = new Floaters({ rate: 10, vy: -15, vx: 10, size: 2, area: [0.2, 0.1, 0.5, 0.6] }); return (ctx, W, H, t, dt) => { rays(ctx, W * 0.42, H * 0.2, t, 'rgba(255,235,180,A)', 12, 1.5, 0.05, 0.14); glow(ctx, W * 0.42, H * 0.28, Math.min(W, H) * 0.3, 'rgba(255,235,180,A)', 0.22 + Math.sin(t * 1.5) * 0.06); st.f.draw(ctx, W, H, dt, t); }; } },
    dove: { img: 'day05', music: 'silent', move: { zoom: 1.08, panX: 14 }, words: ['Fear not, Mary', 1.5, 7, 76, 0.14],
      intro() { sfx().chime(); setTimeout(() => sfx().sparkle(10, 0.1), 600); },
      layers(st) { st.f = new Floaters({ rate: 9, vy: -10, vx: -40, size: 1.8, colors: ['#fff', '#cfe8ff'], area: [0.25, 0.12, 0.25, 0.2] }); return (ctx, W, H, t, dt) => { glow(ctx, W * 0.71, H * 0.18, Math.min(W, H) * 0.22, 'rgba(200,220,255,A)', 0.25 + Math.sin(t) * 0.05); twinkles(ctx, W, H, t, 40, 21, 0.5); st.f.draw(ctx, W, H, dt, t); }; } },
    nicholas: { img: 'day06', music: 'wenceslas', move: { zoom: 1.08, panX: 10 }, words: ['Give in secret', 2, 7, 72, 0.12],
      intro() { sfx().jingle(6, 0.12); setTimeout(() => sfx().hohoho(), 900); },
      layers(st) { st.f = new Floaters({ rate: 5, vy: 60, gravity: 220, vx: 30, size: 3, colors: ['#ffd36b', '#fff1a8'], area: [0.5, 0.45, 0.15, 0.1], life: 1.6 }); st.e = new Floaters({ rate: 6, vy: -50, size: 1.4, colors: ['#ff9f2e', '#ffd36b'], area: [0.72, 0.55, 0.2, 0.15] }); return (ctx, W, H, t, dt) => { flicker(ctx, [[W * 0.82, H * 0.62, W * 0.2, 0]], t); st.f.draw(ctx, W, H, dt, t); st.e.draw(ctx, W, H, dt, t); if (Math.random() < 0.02) sfx().click(); }; } },
    music: { img: 'day07', music: 'joy', move: { zoom: 1.08, panX: 12 }, words: ['My soul doth magnify the Lord', 1.5, 7.5, 50, 0.1],
      intro() { sfx().chime(); },
      layers(st) { st.n = new Floaters({ rate: 4, vy: -45, size: 3, colors: ['#fff', '#ffd36b', '#ff8fd0'], area: [0.2, 0.25, 0.3, 0.25], chars: ['♪', '♫', '♩'], glow: 8, life: 3.5 }); return (ctx, W, H, t, dt) => { rays(ctx, W * 0.78, H * 0.3, t, 'rgba(255,220,150,A)', 10, 1.3, 0.04, 0.12); st.n.draw(ctx, W, H, dt, t); }; } },
    dream: { img: 'day08', music: 'silent', move: { zoom: 1.08 }, words: ['Joseph, fear not', 3, 8, 70, 0.9],
      intro() { sfx().chime(); setTimeout(() => sfx().angelic(), 1500); },
      layers(st) { st.f = new Floaters({ rate: 6, vy: -12, size: 1.8, area: [0.45, 0.1, 0.35, 0.3] }); return (ctx, W, H, t, dt) => { glow(ctx, W * 0.62, H * 0.25, Math.min(W, H) * 0.3, 'rgba(255,235,190,A)', 0.2 + Math.sin(t * 1.2) * 0.07); twinkles(ctx, W, H, t, 30, 31, 0.4); st.f.draw(ctx, W, H, dt, t); ctx.save(); ctx.font = SCRIPT.replace('{s}', Math.min(W, H) * 0.06); ctx.fillStyle = '#cfe0ff'; for (let i = 0; i < 3; i++) { const ph = (t * 0.5 + i * 0.33) % 1; ctx.globalAlpha = 0.9 - ph; ctx.fillText('z', W * 0.3 + ph * 50 + i * 16, H * 0.55 - ph * 70 - i * 12); } ctx.restore(); }; } },
    name: { img: 'day09', music: 'faithful', move: { zoom: 1.1, breathe: 0.03 }, words: ['for he shall save his people from their sins', 3.5, 9, 40, 0.82],
      intro() { sfx().fanfare(); },
      layers(st) { st.s = new D.Sparks(); return (ctx, W, H, t, dt) => {
        rays(ctx, W * 0.5, H * 0.45, t, 'rgba(255,245,200,A)', 16, 1.4, 0.03, 0.12);
        const letters = 'JESUS'; const size = Math.min(W * 0.17, H * 0.3);
        ctx.save(); ctx.font = '900 ' + size + 'px "Baloo 2", ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const total = ctx.measureText(letters).width; let x = W / 2 - total / 2;
        for (let i = 0; i < letters.length; i++) { const w = ctx.measureText(letters[i]).width; const p = ease((t - 0.4 - i * 0.45) / 0.6); if (p > 0) { if (p < 0.1 && Math.random() < 0.5) { st.s.burst(x + w / 2, H * 0.42, 20, ['#ffd36b', '#fff']); sfx().sparkle(3, 0.03); } ctx.save(); ctx.globalAlpha = p; ctx.translate(x + w / 2, H * 0.42 - (1 - p) * 60); ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p); ctx.shadowColor = '#ffb020'; ctx.shadowBlur = 40; ctx.fillStyle = '#ffd36b'; ctx.fillText(letters[i], 0, 0); ctx.shadowBlur = 0; ctx.fillStyle = '#fff8e0'; ctx.globalAlpha = p * 0.85; ctx.fillText(letters[i], 0, -3); ctx.restore(); } x += w; }
        ctx.restore(); st.s.draw(ctx, dt);
      }; } },
    lights: { img: 'day10', music: 'deck', move: { zoom: 1.08, panX: 16 }, words: ['Jesus is the Light of the world', 2, 7.5, 52, 0.1],
      intro() { sfx().jingle(8, 0.1); },
      layers(st) { st.snow = new D.Snow(80); return (ctx, W, H, t, dt) => { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const cols = ['#ff4d58', '#ffd36b', '#5b9bff', '#3ddc97', '#ff8fd0']; let s = 77; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; for (let i = 0; i < 30; i++) { const x = r() * W, y = H * (0.3 + r() * 0.5), c = cols[i % 5]; const a = Math.max(0, Math.sin(t * 2.5 + i * 1.7)); ctx.globalAlpha = a * 0.5; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 6 + a * 6, 0, TAU); ctx.fill(); } ctx.restore(); st.snow.draw(ctx, W, H, dt); }; } },
    scroll: { img: 'day11', music: 'wenceslas', move: { zoom: 1.1, zoomIn: 0.01 }, words: ['A decree went out', 2.5, 7.5, 70, 0.1],
      intro() { sfx().fanfare(); },
      layers(st) { st.f = new Floaters({ rate: 10, vy: -6, vx: 8, size: 1.2, colors: ['#fff7d0'], glow: 4, life: 5, area: [0, 0, 1, 0.8] }); return (ctx, W, H, t, dt) => { rays(ctx, W * 0.5, -H * 0.1, t, 'rgba(255,240,200,A)', 8, 1.6, 0.02, 0.1); st.f.draw(ctx, W, H, dt, t); }; } },
    journey: { img: 'day12', music: 'emmanuel', move: { zoom: 1.1, driftX: -6, panX: 6 }, words: ['Unto the city of David', 1.5, 7, 66, 0.1],
      intro() { sfx().clops(8, 0.2); },
      layers(st) { st.f = new Floaters({ rate: 8, vy: -8, vx: 25, size: 1.3, colors: ['#ffe2b0'], glow: 3, life: 3, area: [0.3, 0.75, 0.4, 0.15] }); return (ctx, W, H, t, dt) => { glow(ctx, W * 0.87, H * 0.12, Math.min(W, H) * 0.16, 'rgba(255,245,200,A)', 0.3 + Math.sin(t * 2) * 0.1); st.f.draw(ctx, W, H, dt, t); if (Math.floor(t * 2.5) !== st.lc) { st.lc = Math.floor(t * 2.5); if (t > 2.5) sfx().clops(2, 0.2); } }; } },
    inn: { img: 'day13', music: 'silent', move: { zoom: 1.08, panX: 10 }, words: ['No room for them in the inn', 3, 8.5, 54, 0.1],
      intro() { sfx().door(); },
      layers(st) { st.f = new Floaters({ rate: 6, vy: -20, size: 1.8, colors: ['#ffd36b', '#fff5c0'], area: [0.68, 0.45, 0.25, 0.3] }); return (ctx, W, H, t, dt) => { flicker(ctx, [[W * 0.86, H * 0.58, W * 0.22, 0], [W * 0.2, H * 0.4, W * 0.08, 2]], t); glow(ctx, W * 0.72, H * 0.1, Math.min(W, H) * 0.14, 'rgba(220,235,255,A)', 0.3); twinkles(ctx, W, H, t, 30, 41, 0.3); st.f.draw(ctx, W, H, dt, t); }; } },
    shepherds: { img: 'day14', music: 'noel', move: { zoom: 1.08, panX: 10 }, words: ['Keeping watch over their flock by night', 1.5, 7, 48, 0.1],
      intro() { sfx().crunch(); setTimeout(() => sfx().snort(), 800); },
      layers(st) { st.e = new Floaters({ rate: 10, vy: -55, size: 1.5, colors: ['#ff9f2e', '#ffd36b', '#ff5a1a'], area: [0.44, 0.62, 0.12, 0.08], life: 2 }); return (ctx, W, H, t, dt) => { flicker(ctx, [[W * 0.5, H * 0.66, W * 0.22, 0]], t); twinkles(ctx, W, H, t, 60, 51, 0.45); st.e.draw(ctx, W, H, dt, t); }; } },
    glory: { img: 'day15', music: 'gloria', move: { zoom: 1.1, breathe: 0.02 }, words: ['The glory of the Lord shone round about them', 2.5, 8, 44, 0.9],
      intro() { setTimeout(() => { sfx().angelic(); sfx().boom(); }, 1000); },
      layers(st) { st.f = new Floaters({ rate: 14, vy: -20, size: 2, area: [0.3, 0.05, 0.5, 0.5] }); return (ctx, W, H, t, dt) => { flash(ctx, W, H, t, 1); const k = ease((t - 0.8) / 1.5); rays(ctx, W * 0.66, H * 0.2, t, 'rgba(255,240,200,A)', 18, 1.6, 0.08, 0.22 * k); glow(ctx, W * 0.66, H * 0.22, Math.min(W, H) * 0.4 * k, 'rgba(255,245,210,A)', 0.35); st.f.draw(ctx, W, H, dt, t); }; } },
    joy: { img: 'day16', music: 'joy', move: { zoom: 1.08, breathe: 0.02 }, words: ['Good tidings of great joy', 3, 9, 60, 0.9],
      intro() { sfx().fanfare(); setTimeout(() => sfx().fireworks(4), 800); },
      layers(st) { st.fw = new D.Fireworks(); st.fw.onBurst = () => sfx().pop(); st.f = new Floaters({ rate: 12, vy: -30, size: 2.2, shape: 'star', area: [0.2, 0.1, 0.6, 0.5] }); return (ctx, W, H, t, dt) => { rays(ctx, W * 0.5, H * 0.25, t, 'rgba(255,235,170,A)', 12, 1.4, 0.07, 0.14); if (t > 0.8 && Math.random() < 0.04) st.fw.launch(rnd(W * 0.1, W * 0.9), H); st.fw.draw(ctx, dt); st.f.draw(ctx, W, H, dt, t); if (t > 1) { ctx.save(); ctx.globalAlpha = ease((t - 1) / 1); D.glowText(ctx, 'Fear not!', W / 2, H * 0.12, Math.min(72, W / 7), '#fff6cc', SCRIPT); ctx.restore(); } }; } },
    manger: { img: 'day17', music: 'silent', move: { zoom: 1.08, breathe: 0.025, speed: 0.1 }, words: ['Lying in a manger', 1.5, 7, 70, 0.12],
      intro() { sfx().chime(); setTimeout(() => sfx().sparkle(8, 0.1), 800); },
      layers(st) { st.f = new Floaters({ rate: 7, vy: -14, size: 2, colors: ['#fff5c0', '#ffd36b'], area: [0.2, 0.3, 0.6, 0.5], life: 4 }); return (ctx, W, H, t, dt) => { glow(ctx, W * 0.5, H * 0.55, Math.min(W, H) * 0.42, 'rgba(255,220,150,A)', 0.18 + Math.sin(t * 1.1) * 0.06); st.f.draw(ctx, W, H, dt, t); }; } },
    host: { img: 'day18', music: 'gloria', move: { zoom: 1.1, panX: 20, speed: 0.07 }, words: ['Gloria in excelsis Deo', 2, 7, 70, 0.5, '#fff5c0'],
      intro() { sfx().angelic(); setTimeout(() => sfx().angelic(0), 2200); },
      layers(st) { st.f = new Floaters({ rate: 16, vy: -18, size: 2, area: [0, 0, 1, 0.6] }); return (ctx, W, H, t, dt) => { rays(ctx, W * 0.5, H * 0.3, t, 'rgba(255,240,200,A)', 14, 1.5, 0.03, 0.1); twinkles(ctx, W, H, t, 50, 61, 0.7); st.f.draw(ctx, W, H, dt, t); title(ctx, W, H, t, 'Glory to God in the highest', 7, 12, 50, 0.5); }; } },
    lanterns: { img: 'day19', music: 'noel', move: { zoom: 1.1, driftX: -5 }, words: ['Let us now go even unto Bethlehem', 1.5, 7, 48, 0.1],
      intro() { sfx().crunch(); },
      layers(st) { st.f = new Floaters({ rate: 6, vy: -16, size: 1.6, colors: ['#ffd36b', '#fff1a8'], area: [0.15, 0.45, 0.45, 0.2] }); return (ctx, W, H, t, dt) => { flicker(ctx, [[W * 0.22, H * 0.52, W * 0.12, 0], [W * 0.5, H * 0.5, W * 0.12, 1], [W * 0.62, H * 0.55, W * 0.1, 2]], t); glow(ctx, W * 0.84, H * 0.14, Math.min(W, H) * 0.16, 'rgba(220,235,255,A)', 0.3); twinkles(ctx, W, H, t, 50, 71, 0.4); st.f.draw(ctx, W, H, dt, t); if (Math.floor(t * 3) !== st.ls) { st.ls = Math.floor(t * 3); if (t > 1) sfx().crunch(); } }; } },
    haste: { img: 'day20', music: 'jingle', move: { zoom: 1.0, zoomIn: 0.03, panX: 4 }, words: ['They came with haste', 4, 9, 60, 0.3],
      intro() { sfx().whoosh(); setTimeout(() => sfx().fanfare(), 1800); },
      layers(st) { st.f = new Floaters({ rate: 14, vy: -40, size: 2.5, shape: 'star', colors: ['#fff', '#ffd36b', '#ff8fd0'], area: [0, 0.2, 1, 0.6] }); return (ctx, W, H, t, dt) => { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2; for (let i = 0; i < 6; i++) { const yy = H * (0.15 + i * 0.12); const xx = W - ((t * 900 + i * 300) % (W + 200)); ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 140, yy); ctx.stroke(); } ctx.restore(); st.f.draw(ctx, W, H, dt, t); if (t > 2) { ctx.save(); ctx.globalAlpha = ease((t - 2) / 0.6); D.glowText(ctx, '5 more sleeps!', W / 2, H * 0.13, Math.min(80, W / 7), '#fff6cc', SCRIPT); ctx.restore(); } }; } },
    town: { img: 'day21', music: 'wish', move: { zoom: 1.08, panX: 12 }, words: ['They made known abroad the saying', 1.5, 7, 46, 0.08],
      intro() { sfx().chime(); setTimeout(() => sfx().giggle(), 1500); },
      layers(st) { st.b = []; return (ctx, W, H, t, dt) => {
        if (Math.random() < 0.035) st.b.push({ x: W * rnd(0.15, 0.85), y: H * rnd(0.25, 0.5), life: 2.6, txt: ['A Saviour!', 'Born tonight!', 'In a manger!', 'Angels sang!', 'Glory!', 'Come see!'][Math.floor(rnd(0, 6))] });
        const s = Math.min(W, H) * 0.045;
        ctx.save(); ctx.font = '800 ' + s + 'px "Baloo 2", system-ui'; ctx.textAlign = 'center';
        for (const b of st.b) { b.life -= dt; b.y -= 22 * dt; ctx.globalAlpha = clamp01(b.life / 2.6); const w = ctx.measureText(b.txt).width + 24; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(b.x - w / 2, b.y - s * 1.1, w, s * 1.5, 12); ctx.fill(); ctx.fillStyle = '#1a2040'; ctx.fillText(b.txt, b.x, b.y); }
        ctx.restore(); st.b = st.b.filter((b) => b.life > 0);
      }; }, click(st, x, y) { st.b.push({ x, y, life: 2.6, txt: 'Jesus is born!' }); } },
    wisemen: { img: 'day22', music: 'emmanuel', move: { zoom: 1.1, driftX: -5, panX: 8 }, words: ['We have seen his star in the east', 1.5, 7, 48, 0.1],
      intro() { sfx().clops(6, 0.3); },
      layers(st) { st.f = new Floaters({ rate: 10, vy: -6, vx: 40, size: 1.4, colors: ['#ffe2b0'], glow: 3, life: 3, area: [0, 0.65, 1, 0.3] }); return (ctx, W, H, t, dt) => { glow(ctx, W * 0.5, H * 0.12, Math.min(W, H) * 0.18, 'rgba(230,240,255,A)', 0.3 + Math.sin(t * 2) * 0.1); twinkles(ctx, W, H, t, 60, 81, 0.5); st.f.draw(ctx, W, H, dt, t); if (Math.floor(t * 2) !== st.lc) { st.lc = Math.floor(t * 2); if (t > 2) sfx().clops(1, 0.2); } }; } },
    starstop: { img: 'day23', music: 'noel', move: { zoom: 1.1, breathe: 0.02 }, words: ['Exceeding great joy', 3, 8, 70, 0.5],
      intro() { sfx().whoosh(1.2); setTimeout(() => { sfx().chime(); sfx().fireworks(5); }, 2600); },
      layers(st) { st.fw = new D.Fireworks(); st.fw.onBurst = () => sfx().pop(); return (ctx, W, H, t, dt) => { const k = ease(t / 2.6); glow(ctx, W * 0.5, H * 0.08, Math.min(W, H) * 0.25 * k, 'rgba(230,240,255,A)', 0.4); rays(ctx, W * 0.5, H * 0.08, t, 'rgba(230,240,255,A)', 10, 1.4, 0.05, 0.16 * k); twinkles(ctx, W, H, t, 50, 91, 0.4); if (t > 2.6 && Math.random() < 0.05) st.fw.launch(rnd(W * 0.1, W * 0.9), H); st.fw.draw(ctx, dt); }; } },
    eve: { img: 'day24', music: 'jingle', move: { zoom: 1.08, panX: 18, speed: 0.1 }, words: ["It's Christmas Eve!", 1, 6, 80, 0.88],
      intro() { sfx().jingle(12, 0.1); setTimeout(() => sfx().hohoho(), 1200); setTimeout(() => sfx().fireworks(5), 3000); },
      layers(st) { st.snow = new D.Snow(90); st.fw = new D.Fireworks(); st.fw.onBurst = () => sfx().pop(); st.f = new Floaters({ rate: 18, vy: 10, vx: -60, size: 2, shape: 'star', area: [0.1, 0.2, 0.3, 0.1], life: 2 }); return (ctx, W, H, t, dt) => { glow(ctx, W * 0.5, H * 0.3, Math.min(W, H) * 0.3, 'rgba(255,250,230,A)', 0.16); st.f.draw(ctx, W, H, dt, t); if (t > 3 && Math.random() < 0.025) st.fw.launch(rnd(W * 0.1, W * 0.9), H); st.fw.draw(ctx, dt); st.snow.draw(ctx, W, H, dt, -20); title(ctx, W, H, t, 'Gold, frankincense and myrrh', 6, 11, 50, 0.88); }; } },
    nativity: { img: 'day25', music: 'joy', move: { zoom: 1.1, breathe: 0.02, speed: 0.08 }, words: ['Christ the Lord is born!', 4, 11, 60, 0.4],
      intro() { sfx().toll(); setTimeout(() => sfx().fanfare(), 1500); setTimeout(() => sfx().angelic(), 2500); setTimeout(() => sfx().fireworks(8), 4000); },
      layers(st) { st.fw = new D.Fireworks(); st.fw.onBurst = () => sfx().pop(); st.f = new Floaters({ rate: 18, vy: -16, size: 2, shape: 'star', area: [0, 0, 1, 0.7] }); return (ctx, W, H, t, dt) => { rays(ctx, W * 0.5, H * 0.08, t, 'rgba(255,245,210,A)', 16, 1.6, 0.04, 0.14); glow(ctx, W * 0.5, H * 0.55, Math.min(W, H) * 0.45, 'rgba(255,225,160,A)', 0.15 + Math.sin(t) * 0.04); if (t > 4 && Math.random() < 0.05) st.fw.launch(rnd(W * 0.05, W * 0.95), H); st.fw.draw(ctx, dt); st.f.draw(ctx, W, H, dt, t); if (t > 1.2) { ctx.save(); ctx.globalAlpha = ease((t - 1.2) / 0.8); D.glowText(ctx, 'Merry Christmas!', W / 2, H * 0.26, Math.min(96, W / 6.5), '#fff6cc', SCRIPT); ctx.restore(); } }; } },
  };

  function make(name) {
    const d = DAYS[name] || DAYS.star;
    const st = { sparks: new D.Sparks(), clicks: 0, H: 0 };
    const img = picture(d.img);
    const layers = d.layers(st);
    return {
      st, music: d.music, intro: d.intro,
      draw(ctx, W, H, t, dt) {
        st.H = H;
        drawPicture(ctx, img, W, H, t, d.move);
        layers(ctx, W, H, t, dt);
        if (d.words) title(ctx, W, H, t, ...d.words);
        st.sparks.draw(ctx, dt);
      },
      click(x, y) { st.sparks.burst(x, y, 28, ['#fff5c0', '#ffd36b', '#fff']); sfx().sparkle(6, 0.04); st.clicks++; if (d.click) d.click(st, x, y); if (st.fw) { st.fw.launch(x, st.H); sfx().whoosh(0.4); } },
    };
  }
  window.Scenes = { make, names: Object.keys(DAYS), picture, drawPicture, glow, rays, twinkles, Floaters, flicker, title, flash, SCRIPT };
})();
