// A little canvas toolbox: a scene runner, particle systems, and cut-paper style drawings
// of everything Christmas: stars, angels, shepherds, sheep, camels, Santa, reindeer, elves...
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- scene runner ----------
  class Scene {
    constructor(canvas, draw, opts = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.draw = draw;
      this.opts = opts;
      this.t = 0;
      this.running = false;
      this.last = 0;
      this.W = 0; this.H = 0;
      this._resize = () => this.resize();
      this._frame = (ts) => this.frame(ts);
      this._click = (e) => { if (!opts.onClick) return; const r = canvas.getBoundingClientRect(); opts.onClick((e.clientX - r.left), (e.clientY - r.top), this); };
      canvas.addEventListener('pointerdown', this._click);
      window.addEventListener('resize', this._resize);
      this.resize();
    }
    resize() {
      const r = this.cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = Math.max(1, Math.round(r.width));
      this.H = Math.max(1, Math.round(r.height));
      this.cv.width = Math.round(this.W * dpr);
      this.cv.height = Math.round(this.H * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.opts.onResize) this.opts.onResize(this);
    }
    start() { if (this.running) return this; this.running = true; this.last = performance.now(); requestAnimationFrame(this._frame); return this; }
    stop() { this.running = false; window.removeEventListener('resize', this._resize); this.cv.removeEventListener('pointerdown', this._click); }
    frame(ts) {
      if (!this.running) return;
      if (!this.cv.isConnected) { this.stop(); return; }
      const dt = Math.min(0.05, (ts - this.last) / 1000);
      this.last = ts;
      this.t += dt;
      if (this.W !== Math.round(this.cv.getBoundingClientRect().width)) this.resize();
      this.draw(this.ctx, this.W, this.H, this.t, dt, this);
      requestAnimationFrame(this._frame);
    }
  }

  // ---------- particles ----------
  class Snow {
    constructor(n = 120) { this.n = n; this.p = []; }
    draw(ctx, W, H, dt, wind = 0) {
      while (this.p.length < this.n) this.p.push({ x: rnd(0, W), y: rnd(-H, H), r: rnd(1, 3.4), v: rnd(18, 55), w: rnd(0, TAU), a: rnd(0.4, 0.95) });
      ctx.save();
      ctx.fillStyle = '#fff';
      for (const f of this.p) {
        f.y += f.v * dt; f.w += dt; f.x += Math.sin(f.w) * 12 * dt + wind * dt;
        if (f.y > H + 5) { f.y = -5; f.x = rnd(0, W); }
        if (f.x > W + 5) f.x = -5; if (f.x < -5) f.x = W + 5;
        ctx.globalAlpha = f.a;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }
  class Sparks {
    constructor() { this.p = []; }
    burst(x, y, n = 30, colors = ['#fff5c0', '#ffd36b', '#fff'], speed = 160, life = 1.1) {
      for (let i = 0; i < n; i++) { const a = rnd(0, TAU); const v = rnd(speed * 0.2, speed); this.p.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, c: colors[i % colors.length], r: rnd(1.5, 3.5), g: rnd(0, 220) }); }
    }
    draw(ctx, dt) {
      ctx.save();
      for (const p of this.p) {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 0.985;
        if (p.life <= 0) continue;
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      }
      ctx.restore();
      this.p = this.p.filter((p) => p.life > 0);
    }
  }
  class Fireworks {
    constructor() { this.rockets = []; this.sparks = new Sparks(); this.onBurst = null; }
    launch(x, y, color) { this.rockets.push({ x, y0: y, y: y, ty: rnd(y * 0.25, y * 0.55), v: rnd(380, 520), c: color || ['#ff4d58', '#ffd36b', '#5b9bff', '#fff', '#3ddc97'][Math.floor(rnd(0, 5))] }); }
    draw(ctx, dt) {
      ctx.save();
      for (const r of this.rockets) {
        r.y -= r.v * dt; r.v *= 0.99;
        ctx.strokeStyle = r.c; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(r.x, r.y + 18); ctx.lineTo(r.x, r.y); ctx.stroke();
        if (r.y <= r.ty) { this.sparks.burst(r.x, r.y, 70, [r.c, '#fff', r.c], 230, 1.5); r.done = true; if (this.onBurst) this.onBurst(); }
      }
      ctx.restore();
      this.rockets = this.rockets.filter((r) => !r.done);
      this.sparks.draw(ctx, dt);
    }
  }

  // ---------- backgrounds ----------
  function sky(ctx, W, H, top = '#061034', bottom = '#1b2a5c') {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function starField(ctx, W, H, t, n = 70, seed = 7) {
    ctx.save(); ctx.fillStyle = '#fff';
    let s = seed;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = r() * H * 0.7, k = r();
      ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * (0.6 + k) + i));
      ctx.beginPath(); ctx.arc(x, y, 0.6 + k * 1.4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function hills(ctx, W, H, color = '#0b1a3a', y = 0.72, amp = 0.08, seed = 1) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, H * y + Math.sin(x / W * 4 + seed) * H * amp + Math.sin(x / W * 11 + seed * 2) * H * amp * 0.3);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }
  function snowGround(ctx, W, H, y = 0.8) { hills(ctx, W, H, '#e9f1ff', y, 0.03, 3); hills(ctx, W, H, '#cfe0ff', y + 0.08, 0.02, 5); }
  function moon(ctx, x, y, r) { ctx.save(); ctx.shadowColor = '#fff8d6'; ctx.shadowBlur = 40; ctx.fillStyle = '#fff6d1'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore(); }

  // ---------- shapes ----------
  function star(ctx, x, y, r, color = '#ffd36b', points = 5, inner = 0.45, glow = 18) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = glow;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / points; const rr = i % 2 ? r * inner : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function bethlehemStar(ctx, x, y, size, t, color = '#fff2b0') {
    ctx.save(); ctx.translate(x, y);
    const pulse = 1 + Math.sin(t * 2) * 0.06;
    ctx.globalAlpha = 0.25; ctx.strokeStyle = color; ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate(i * TAU / 12 + t * 0.05); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -size * (i % 3 === 0 ? 3.2 : 1.6) * pulse); ctx.stroke(); ctx.restore(); }
    ctx.globalAlpha = 1;
    star(ctx, 0, 0, size * pulse, color, 4, 0.22, 40);
    star(ctx, 0, 0, size * 0.55 * pulse, '#fff', 4, 0.25, 30);
    ctx.restore();
    // long beam down
    ctx.save(); const g = ctx.createLinearGradient(x, y, x, y + size * 12); g.addColorStop(0, 'rgba(255,242,176,.5)'); g.addColorStop(1, 'rgba(255,242,176,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - size * 0.4, y); ctx.lineTo(x + size * 0.4, y); ctx.lineTo(x + size * 3, y + size * 12); ctx.lineTo(x - size * 3, y + size * 12); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function candle(ctx, x, y, w, hgt, t, color = '#f7f0dd') {
    ctx.save();
    ctx.fillStyle = color; ctx.fillRect(x - w / 2, y - hgt, w, hgt);
    ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(x, y - hgt, w / 2, hgt);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - hgt); ctx.lineTo(x, y - hgt - w * 0.4); ctx.stroke();
    const fl = Math.sin(t * 13 + x) * 0.15 + Math.sin(t * 7.3) * 0.1;
    ctx.translate(x + fl * w * 0.4, y - hgt - w * 0.4);
    ctx.shadowColor = '#ffb13b'; ctx.shadowBlur = 25;
    const fh = w * 1.6 * (1 + fl * 0.5);
    ctx.fillStyle = '#ff9f2e'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(w * 0.7, -fh * 0.4, 0, -fh); ctx.quadraticCurveTo(-w * 0.7, -fh * 0.4, 0, 0); ctx.fill();
    ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(w * 0.35, -fh * 0.3, 0, -fh * 0.55); ctx.quadraticCurveTo(-w * 0.35, -fh * 0.3, 0, 0); ctx.fill();
    ctx.restore();
  }
  function angel(ctx, x, y, s, t, opts = {}) {
    ctx.save(); ctx.translate(x, y + Math.sin(t * 1.5) * s * 0.08);
    const flap = Math.sin(t * 2.2) * 0.12;
    ctx.fillStyle = opts.wing || 'rgba(255,255,255,.85)'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 20;
    for (const d of [-1, 1]) { ctx.save(); ctx.scale(d, 1); ctx.rotate(-flap); ctx.beginPath(); ctx.moveTo(s * 0.15, -s * 0.2); ctx.quadraticCurveTo(s * 1.2, -s * 1.0, s * 1.05, s * 0.1); ctx.quadraticCurveTo(s * 0.9, s * 0.5, s * 0.2, s * 0.35); ctx.closePath(); ctx.fill(); ctx.restore(); }
    ctx.shadowBlur = 0;
    ctx.fillStyle = opts.robe || '#f6f3ff'; ctx.beginPath(); ctx.moveTo(0, -s * 0.45); ctx.lineTo(s * 0.55, s * 1.1); ctx.quadraticCurveTo(0, s * 1.3, -s * 0.55, s * 1.1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f2c9a0'; ctx.beginPath(); ctx.arc(0, -s * 0.62, s * 0.22, 0, TAU); ctx.fill();
    ctx.fillStyle = opts.hair || '#c98b3a'; ctx.beginPath(); ctx.arc(0, -s * 0.7, s * 0.23, Math.PI, TAU); ctx.fill();
    ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = s * 0.06; ctx.shadowColor = '#ffd36b'; ctx.shadowBlur = 12; ctx.beginPath(); ctx.ellipse(0, -s * 0.95, s * 0.26, s * 0.08, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  function shepherd(ctx, x, y, s, color = '#8b5a2b', t = 0) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, -s * 0.9); ctx.lineTo(s * 0.4, s); ctx.lineTo(-s * 0.4, s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e0b48c'; ctx.beginPath(); ctx.arc(0, -s * 0.95, s * 0.18, 0, TAU); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, -s * 1.02, s * 0.22, Math.PI * 0.9, Math.PI * 2.1); ctx.fill();
    ctx.strokeStyle = '#c9a26a'; ctx.lineWidth = s * 0.07; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(s * 0.5, s); ctx.lineTo(s * 0.5, -s * 1.1); ctx.quadraticCurveTo(s * 0.5, -s * 1.45, s * 0.25, -s * 1.35); ctx.stroke();
    ctx.restore();
  }
  function sheep(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#333'; for (const lx of [-s * 0.5, -s * 0.2, s * 0.2, s * 0.5]) ctx.fillRect(lx - s * 0.06, 0, s * 0.12, s * 0.45);
    ctx.fillStyle = '#f4f4f8'; ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = 6;
    for (let i = 0; i < 7; i++) { const a = i * TAU / 7; ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.45, -s * 0.3 + Math.sin(a) * s * 0.25, s * 0.3, 0, TAU); ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(0, -s * 0.3, s * 0.7, s * 0.45, 0, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.ellipse(s * 0.7, -s * 0.45 + Math.sin(t * 2 + x) * s * 0.03, s * 0.28, s * 0.22, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * 0.8, -s * 0.5, s * 0.05, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function camel(ctx, x, y, s, t, rider = true) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#1a1230';
    const step = Math.sin(t * 4 + x) * 0.15;
    for (const [lx, ph] of [[-s * 0.5, 1], [-s * 0.3, -1], [s * 0.3, -1], [s * 0.5, 1]]) { ctx.save(); ctx.translate(lx, 0); ctx.rotate(step * ph); ctx.fillRect(-s * 0.06, 0, s * 0.12, s * 0.7); ctx.restore(); }
    ctx.beginPath(); ctx.ellipse(0, -s * 0.1, s * 0.75, s * 0.32, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-s * 0.15, -s * 0.5, s * 0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s * 0.55, -s * 0.25); ctx.quadraticCurveTo(s * 0.9, -s * 0.7, s * 0.95, -s * 1.05); ctx.lineTo(s * 1.15, -s * 1.0); ctx.quadraticCurveTo(s * 1.05, -s * 0.6, s * 0.7, -s * 0.1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 1.08, -s * 1.08, s * 0.22, s * 0.12, -0.3, 0, TAU); ctx.fill();
    if (rider) { ctx.fillStyle = '#2a1f4a'; ctx.beginPath(); ctx.moveTo(-s * 0.35, -s * 0.6); ctx.lineTo(-s * 0.05, -s * 1.3); ctx.lineTo(s * 0.25, -s * 0.6); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(-s * 0.05, -s * 1.35, s * 0.13, 0, TAU); ctx.fill(); star(ctx, -s * 0.05, -s * 1.6, s * 0.08, '#ffd36b', 5, 0.5, 6); }
    ctx.restore();
  }
  function stable(ctx, x, y, s, lit = true) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#3b2412'; ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(-s, -s * 0.9); ctx.lineTo(0, -s * 1.5); ctx.lineTo(s, -s * 0.9); ctx.lineTo(s, 0); ctx.closePath(); ctx.fill();
    if (lit) { const g = ctx.createRadialGradient(0, -s * 0.3, s * 0.1, 0, -s * 0.3, s * 0.9); g.addColorStop(0, 'rgba(255,200,110,.55)'); g.addColorStop(1, 'rgba(255,200,110,0)'); ctx.fillStyle = g; ctx.fillRect(-s, -s * 1.5, s * 2, s * 1.5); }
    ctx.strokeStyle = '#6b4423'; ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.moveTo(-s, -s * 0.9); ctx.lineTo(0, -s * 1.5); ctx.lineTo(s, -s * 0.9); ctx.moveTo(-s * 0.9, 0); ctx.lineTo(-s * 0.9, -s * 0.85); ctx.moveTo(s * 0.9, 0); ctx.lineTo(s * 0.9, -s * 0.85); ctx.stroke();
    ctx.restore();
  }
  function manger(ctx, x, y, s, baby = true, glow = true) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#b07a3a'; ctx.beginPath(); ctx.moveTo(-s * 0.7, -s * 0.5); ctx.lineTo(s * 0.7, -s * 0.5); ctx.lineTo(s * 0.45, 0); ctx.lineTo(-s * 0.45, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7a4f22'; ctx.lineWidth = s * 0.07; ctx.beginPath(); ctx.moveTo(-s * 0.55, s * 0.35); ctx.lineTo(s * 0.55, -s * 0.5); ctx.moveTo(s * 0.55, s * 0.35); ctx.lineTo(-s * 0.55, -s * 0.5); ctx.stroke();
    ctx.fillStyle = '#e8c45c'; for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.ellipse(-s * 0.55 + i * s * 0.14, -s * 0.52, s * 0.08, s * 0.04, (i % 3) * 0.4, 0, TAU); ctx.fill(); }
    if (baby) { if (glow) { ctx.shadowColor = '#fff1b8'; ctx.shadowBlur = 30; } ctx.fillStyle = '#f7f1e3'; ctx.beginPath(); ctx.ellipse(0, -s * 0.62, s * 0.38, s * 0.16, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#f0c8a0'; ctx.beginPath(); ctx.arc(-s * 0.3, -s * 0.66, s * 0.11, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  function person(ctx, x, y, s, robe, veil, kneel = false) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = robe; ctx.beginPath(); ctx.moveTo(0, -s * 0.8); ctx.lineTo(s * 0.45, kneel ? s * 0.5 : s); ctx.lineTo(-s * 0.45, kneel ? s * 0.5 : s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e0b48c'; ctx.beginPath(); ctx.arc(0, -s * 0.9, s * 0.17, 0, TAU); ctx.fill();
    if (veil) { ctx.fillStyle = veil; ctx.beginPath(); ctx.moveTo(-s * 0.25, -s * 0.95); ctx.quadraticCurveTo(0, -s * 1.35, s * 0.25, -s * 0.95); ctx.lineTo(s * 0.35, -s * 0.2); ctx.lineTo(-s * 0.35, -s * 0.2); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#e0b48c'; ctx.beginPath(); ctx.arc(0, -s * 0.9, s * 0.14, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  function santa(ctx, x, y, s, t, wave = true) {
    ctx.save(); ctx.translate(x, y);
    const bob = Math.sin(t * 3) * s * 0.03;
    ctx.fillStyle = '#d7263d'; ctx.beginPath(); ctx.ellipse(0, bob, s * 0.62, s * 0.75, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(-s * 0.62, bob + s * 0.05, s * 1.24, s * 0.16);
    ctx.fillStyle = '#ffd36b'; ctx.fillRect(-s * 0.1, bob + s * 0.04, s * 0.2, s * 0.18);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, bob - s * 0.45, s * 0.42, s * 0.42, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#f6c9a2'; ctx.beginPath(); ctx.arc(0, bob - s * 0.72, s * 0.34, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, bob - s * 0.42, s * 0.42, s * 0.3, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#e8a4a0'; ctx.beginPath(); ctx.arc(0, bob - s * 0.66, s * 0.08, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-s * 0.12, bob - s * 0.78, s * 0.035, 0, TAU); ctx.arc(s * 0.12, bob - s * 0.78, s * 0.035, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d7263d'; ctx.beginPath(); ctx.moveTo(-s * 0.36, bob - s * 0.92); ctx.quadraticCurveTo(0, bob - s * 1.5, s * 0.55, bob - s * 1.35); ctx.lineTo(s * 0.36, bob - s * 0.92); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, bob - s * 0.92, s * 0.4, s * 0.1, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(s * 0.56, bob - s * 1.36, s * 0.1, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d7263d'; ctx.save(); ctx.translate(s * 0.6, bob - s * 0.1); if (wave) ctx.rotate(-0.8 + Math.sin(t * 5) * 0.3); ctx.fillRect(-s * 0.1, -s * 0.55, s * 0.2, s * 0.55); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -s * 0.6, s * 0.13, 0, TAU); ctx.fill(); ctx.restore();
    ctx.restore();
  }
  function reindeer(ctx, x, y, s, t, nose = false, run = false) {
    ctx.save(); ctx.translate(x, y);
    const gallop = run ? Math.sin(t * 10 + x) : 0;
    ctx.fillStyle = '#8a5a2b';
    for (const [lx, ph] of [[-s * 0.45, 1], [-s * 0.25, -1], [s * 0.3, -1], [s * 0.5, 1]]) { ctx.save(); ctx.translate(lx, s * 0.05); ctx.rotate(gallop * 0.5 * ph); ctx.fillRect(-s * 0.07, 0, s * 0.14, s * 0.6); ctx.restore(); }
    ctx.beginPath(); ctx.ellipse(0, -s * 0.15 + gallop * s * 0.04, s * 0.75, s * 0.38, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#a56d38'; ctx.beginPath(); ctx.ellipse(-s * 0.1, -s * 0.05, s * 0.45, s * 0.22, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a5a2b'; ctx.beginPath(); ctx.moveTo(s * 0.55, -s * 0.35); ctx.lineTo(s * 0.85, -s * 0.9); ctx.lineTo(s * 1.05, -s * 0.85); ctx.lineTo(s * 0.8, -s * 0.25); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 1.05, -s * 0.95, s * 0.3, s * 0.2, -0.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f0e6d8'; ctx.beginPath(); ctx.ellipse(-s * 0.72, -s * 0.2, s * 0.08, s * 0.14, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5a3a18'; ctx.lineWidth = s * 0.06; ctx.lineCap = 'round';
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 0.95 + d * s * 0.1, -s * 1.1); ctx.lineTo(s * 0.95 + d * s * 0.3, -s * 1.6); ctx.moveTo(s * 0.95 + d * s * 0.2, -s * 1.35); ctx.lineTo(s * 0.95 + d * s * 0.45, -s * 1.5); ctx.stroke(); }
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(s * 1.1, -s * 1.0, s * 0.04, 0, TAU); ctx.fill();
    if (nose) { ctx.shadowColor = '#ff2a2a'; ctx.shadowBlur = 18 + Math.sin(t * 6) * 8; ctx.fillStyle = '#ff2a2a'; } else ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(s * 1.33, -s * 0.95, s * 0.09, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function elf(ctx, x, y, s, t, color = '#2e9e5b', skin = '#f3c9a3') {
    ctx.save(); ctx.translate(x, y);
    const bob = Math.sin(t * 6 + x) * s * 0.05;
    ctx.fillStyle = color; ctx.fillRect(-s * 0.3, bob - s * 0.3, s * 0.6, s * 0.75);
    ctx.fillStyle = '#d7263d'; ctx.fillRect(-s * 0.3, bob + s * 0.2, s * 0.6, s * 0.1);
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, bob - s * 0.55, s * 0.27, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s * 0.27, bob - s * 0.6); ctx.lineTo(-s * 0.45, bob - s * 0.75); ctx.lineTo(-s * 0.22, bob - s * 0.5); ctx.fill(); ctx.beginPath(); ctx.moveTo(s * 0.27, bob - s * 0.6); ctx.lineTo(s * 0.45, bob - s * 0.75); ctx.lineTo(s * 0.22, bob - s * 0.5); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-s * 0.3, bob - s * 0.7); ctx.quadraticCurveTo(0, bob - s * 1.4, s * 0.45, bob - s * 1.15); ctx.lineTo(s * 0.3, bob - s * 0.7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * 0.46, bob - s * 1.16, s * 0.08, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-s * 0.09, bob - s * 0.58, s * 0.03, 0, TAU); ctx.arc(s * 0.09, bob - s * 0.58, s * 0.03, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#a33'; ctx.lineWidth = s * 0.03; ctx.beginPath(); ctx.arc(0, bob - s * 0.5, s * 0.1, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.fillRect(-s * 0.28, bob + s * 0.45, s * 0.22, s * 0.1); ctx.fillRect(s * 0.06, bob + s * 0.45, s * 0.22, s * 0.1);
    ctx.restore();
  }
  function gift(ctx, x, y, s, color = '#d7263d', ribbon = '#ffd36b') {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = color; ctx.fillRect(-s / 2, -s * 0.8, s, s * 0.8);
    ctx.fillStyle = ribbon; ctx.fillRect(-s * 0.09, -s * 0.8, s * 0.18, s * 0.8); ctx.fillRect(-s / 2, -s * 0.5, s, s * 0.14);
    ctx.beginPath(); ctx.ellipse(-s * 0.18, -s * 0.9, s * 0.17, s * 0.1, -0.5, 0, TAU); ctx.ellipse(s * 0.18, -s * 0.9, s * 0.17, s * 0.1, 0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function bellShape(ctx, x, y, s, angle = 0, color = '#ffd36b') {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(-s * 0.55, s * 0.6); ctx.quadraticCurveTo(-s * 0.5, -s * 0.2, 0, -s * 0.7); ctx.quadraticCurveTo(s * 0.5, -s * 0.2, s * 0.55, s * 0.6); ctx.closePath(); ctx.fill();
    ctx.fillRect(-s * 0.65, s * 0.55, s * 1.3, s * 0.14);
    ctx.fillStyle = '#b8862b'; ctx.beginPath(); ctx.arc(0, s * 0.75, s * 0.13, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -s * 0.75, s * 0.1, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function tree(ctx, x, y, s, t, lights = true) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#6b4423'; ctx.fillRect(-s * 0.12, -s * 0.1, s * 0.24, s * 0.35);
    for (let i = 0; i < 3; i++) { const w = s * (0.9 - i * 0.2), top = -s * (0.6 + i * 0.55), base = -s * (0.05 + i * 0.5); ctx.fillStyle = i % 2 ? '#1f7a3f' : '#2a9152'; ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(w, base); ctx.lineTo(-w, base); ctx.closePath(); ctx.fill(); }
    if (lights) { const cols = ['#ff4d58', '#ffd36b', '#5b9bff', '#3ddc97', '#ff8fd0']; for (let i = 0; i < 14; i++) { const yy = -s * (0.15 + (i / 14) * 1.5); const w = s * (0.85 - (i / 14) * 0.75); const xx = Math.sin(i * 2.4) * w * 0.8; const c = cols[i % cols.length]; const on = Math.sin(t * 3 + i) > -0.2; ctx.fillStyle = c; ctx.globalAlpha = on ? 1 : 0.35; ctx.shadowColor = c; ctx.shadowBlur = on ? 12 : 0; ctx.beginPath(); ctx.arc(xx, yy, s * 0.05, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1; ctx.shadowBlur = 0; }
    star(ctx, 0, -s * 1.78, s * 0.14, '#ffd36b', 5, 0.5, 16);
    ctx.restore();
  }
  function snowman(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.15)'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(0, -s * 0.45, s * 0.5, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(0, -s * 1.15, s * 0.36, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(0, -s * 1.68, s * 0.27, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#222'; for (const yy of [-s * 1.3, -s * 1.12, -s * 0.94]) { ctx.beginPath(); ctx.arc(0, yy, s * 0.035, 0, TAU); ctx.fill(); }
    ctx.beginPath(); ctx.arc(-s * 0.09, -s * 1.74, s * 0.035, 0, TAU); ctx.arc(s * 0.09, -s * 1.74, s * 0.035, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff8c1a'; ctx.beginPath(); ctx.moveTo(0, -s * 1.66); ctx.lineTo(s * 0.35, -s * 1.6); ctx.lineTo(0, -s * 1.58); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillRect(-s * 0.32, -s * 1.95, s * 0.64, s * 0.06); ctx.fillRect(-s * 0.22, -s * 2.3, s * 0.44, s * 0.36);
    ctx.fillStyle = '#d7263d'; ctx.fillRect(-s * 0.3, -s * 1.45, s * 0.6, s * 0.1); ctx.fillRect(s * 0.1, -s * 1.42, s * 0.12, s * 0.35);
    ctx.strokeStyle = '#6b4423'; ctx.lineWidth = s * 0.05; ctx.beginPath(); ctx.moveTo(-s * 0.34, -s * 1.15); ctx.lineTo(-s * 0.8, -s * 1.5 + Math.sin(t * 2) * s * 0.08); ctx.moveTo(s * 0.34, -s * 1.15); ctx.lineTo(s * 0.8, -s * 1.4); ctx.stroke();
    ctx.restore();
  }
  function candyCane(ctx, x, y, s, angle = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.lineCap = 'round';
    const path = () => { ctx.beginPath(); ctx.moveTo(0, s); ctx.lineTo(0, -s * 0.6); ctx.arc(s * 0.3, -s * 0.6, s * 0.3, Math.PI, 0); };
    ctx.strokeStyle = '#fff'; ctx.lineWidth = s * 0.22; path(); ctx.stroke();
    ctx.strokeStyle = '#d7263d'; ctx.lineWidth = s * 0.22; ctx.setLineDash([s * 0.18, s * 0.18]); path(); ctx.stroke();
    ctx.restore();
  }
  function gingerbread(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y + Math.sin(t * 4 + x) * s * 0.04); ctx.fillStyle = '#b5651d'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -s * 0.75, s * 0.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#b5651d'; ctx.lineWidth = s * 0.3; ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.lineTo(0, s * 0.25); ctx.moveTo(-s * 0.45, -s * 0.2); ctx.lineTo(s * 0.45, -s * 0.2); ctx.moveTo(0, s * 0.2); ctx.lineTo(-s * 0.3, s * 0.75); ctx.moveTo(0, s * 0.2); ctx.lineTo(s * 0.3, s * 0.75); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = s * 0.05; ctx.beginPath(); ctx.arc(0, -s * 0.72, s * 0.14, 0.3, Math.PI - 0.3); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-s * 0.1, -s * 0.82, s * 0.04, 0, TAU); ctx.arc(s * 0.1, -s * 0.82, s * 0.04, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d7263d'; for (const yy of [-s * 0.3, -s * 0.05]) { ctx.beginPath(); ctx.arc(0, yy, s * 0.06, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  function stocking(ctx, x, y, s, color = '#d7263d', t = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 1.5 + x) * 0.04);
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-s * 0.3, 0); ctx.lineTo(-s * 0.3, s * 0.9); ctx.quadraticCurveTo(-s * 0.3, s * 1.3, s * 0.1, s * 1.3); ctx.lineTo(s * 0.5, s * 1.3); ctx.quadraticCurveTo(s * 0.7, s * 1.2, s * 0.55, s * 1.0); ctx.lineTo(s * 0.3, s * 0.9); ctx.lineTo(s * 0.3, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(-s * 0.36, -s * 0.05, s * 0.72, s * 0.3); ctx.restore();
  }
  function fire(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) { const ph = t * 5 + i * 1.3; const fx = Math.sin(ph) * s * 0.25 + (i - 4) * s * 0.1; const fh = s * (0.5 + Math.abs(Math.sin(ph * 0.7 + i)) * 0.6); const c = i % 3 === 0 ? '#ffd36b' : i % 3 === 1 ? '#ff7a1a' : '#ff3b1a'; ctx.fillStyle = c; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(fx - s * 0.2, 0); ctx.quadraticCurveTo(fx, -fh * 1.2, fx + s * 0.2, 0); ctx.fill(); }
    ctx.restore();
  }
  function fireplace(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#5a3a2a'; ctx.fillRect(-s, -s * 1.1, s * 2, s * 1.1);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) { ctx.fillStyle = (r + c) % 2 ? '#7a4a36' : '#6a3f2e'; ctx.fillRect(-s + c * s * 0.34 + (r % 2) * s * 0.17, -s * 1.1 + r * s * 0.22, s * 0.3, s * 0.18); }
    ctx.fillStyle = '#111'; ctx.fillRect(-s * 0.6, -s * 0.75, s * 1.2, s * 0.75);
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-s * 1.1, -s * 1.2, s * 2.2, s * 0.12);
    fire(ctx, 0, -s * 0.02, s * 0.5, t);
    ctx.fillStyle = '#4a2a10'; ctx.fillRect(-s * 0.45, -s * 0.12, s * 0.9, s * 0.1);
    ctx.restore();
  }
  function skyline(ctx, W, H, y, color = '#0a0f2a', seed = 3) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, H);
    let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    let x = 0;
    while (x < W) { const w = 30 + r() * 70; const hh = H * y - r() * H * 0.12; ctx.lineTo(x, hh); if (r() > 0.6) { ctx.lineTo(x + w * 0.5, hh - w * 0.4); } ctx.lineTo(x + w, hh); x += w; }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }
  function windows(ctx, W, H, y, t, seed = 9) {
    let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    ctx.fillStyle = '#ffd36b';
    for (let i = 0; i < 40; i++) { const x = r() * W, yy = H * y + r() * H * 0.15; ctx.globalAlpha = Math.sin(t * (0.5 + r()) + i) > -0.3 ? 0.9 : 0.2; ctx.fillRect(x, yy, 4, 5); }
    ctx.globalAlpha = 1;
  }
  function sleigh(ctx, x, y, s, color = '#d7263d') {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(-s * 0.85, -s * 0.55); ctx.lineTo(s * 0.45, -s * 0.55); ctx.quadraticCurveTo(s * 0.9, -s * 0.55, s * 1.0, -s * 1.05); ctx.lineTo(s * 0.75, -s * 1.0); ctx.quadraticCurveTo(s * 0.7, -s * 0.7, s * 0.4, -s * 0.7); ctx.lineTo(s * 0.4, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = s * 0.08; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-s * 1.2, s * 0.2); ctx.lineTo(s * 0.7, s * 0.2); ctx.quadraticCurveTo(s * 1.1, s * 0.2, s * 1.1, -s * 0.2); ctx.stroke();
    ctx.fillStyle = '#8b5a2b'; ctx.fillRect(-s * 0.3, -s * 1.1, s * 0.6, s * 0.1);
    ctx.restore();
  }
  function dove(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 16;
    const flap = Math.sin(t * 6) * 0.5;
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.5, s * 0.22, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.5, -s * 0.12, s * 0.15, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s * 0.1, -s * 0.05); ctx.quadraticCurveTo(-s * 0.2, -s * 0.9 * (0.4 + flap), s * 0.35, -s * 0.5 * (0.5 + flap)); ctx.lineTo(s * 0.1, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s * 0.5, 0); ctx.lineTo(-s * 0.85, -s * 0.2); ctx.lineTo(-s * 0.85, s * 0.2); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#f0a020'; ctx.beginPath(); ctx.moveTo(s * 0.62, -s * 0.12); ctx.lineTo(s * 0.78, -s * 0.08); ctx.lineTo(s * 0.62, -s * 0.04); ctx.fill();
    ctx.fillStyle = '#2e9e5b'; ctx.beginPath(); ctx.ellipse(s * 0.8, -s * 0.02, s * 0.12, s * 0.05, 0.4, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function lightString(ctx, pts, t, cols = ['#ff4d58', '#ffd36b', '#5b9bff', '#3ddc97', '#ff8fd0'], r = 5, speed = 2) {
    ctx.save(); ctx.strokeStyle = '#1a2a1a'; ctx.lineWidth = 1.5; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    pts.forEach((p, i) => { const c = cols[i % cols.length]; const on = Math.sin(t * speed + i * 0.8) > -0.3; ctx.fillStyle = c; ctx.globalAlpha = on ? 1 : 0.25; ctx.shadowColor = c; ctx.shadowBlur = on ? 14 : 0; ctx.beginPath(); ctx.arc(p[0], p[1] + r, r, 0, TAU); ctx.fill(); });
    ctx.restore();
  }
  function glowText(ctx, text, x, y, size, color = '#fff2b0', font = '700 {s}px ui-rounded, "Segoe UI", system-ui, sans-serif', align = 'center') {
    ctx.save(); ctx.font = font.replace('{s}', size); ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.shadowColor = color; ctx.shadowBlur = 24; ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9; ctx.fillText(text, x, y); ctx.restore();
  }
  function scroll(ctx, x, y, w, hgt) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#f3e3b8'; ctx.fillRect(-w / 2, -hgt / 2, w, hgt);
    ctx.fillStyle = '#c9a26a'; ctx.fillRect(-w / 2 - 8, -hgt / 2 - 10, w + 16, 14); ctx.fillRect(-w / 2 - 8, hgt / 2 - 4, w + 16, 14);
    ctx.strokeStyle = '#8b6b3a'; ctx.lineWidth = 1.5; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-w * 0.38, -hgt * 0.3 + i * hgt * 0.12); ctx.lineTo(w * (0.38 - (i === 5 ? 0.3 : 0)), -hgt * 0.3 + i * hgt * 0.12); ctx.stroke(); }
    ctx.restore();
  }
  function lantern(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y + Math.sin(t * 2 + x) * s * 0.1);
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-s * 0.3, -s * 0.9, s * 0.6, s * 0.1); ctx.fillRect(-s * 0.3, s * 0.3, s * 0.6, s * 0.1); ctx.fillRect(-s * 0.05, -s * 1.15, s * 0.1, s * 0.25);
    ctx.shadowColor = '#ffb13b'; ctx.shadowBlur = 30; ctx.fillStyle = 'rgba(255,190,90,.85)'; ctx.fillRect(-s * 0.25, -s * 0.8, s * 0.5, s * 1.1);
    ctx.shadowBlur = 0; ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-s * 0.04, -s * 0.8, s * 0.08, s * 1.1);
    ctx.restore();
  }

  window.Draw = { Scene, Snow, Sparks, Fireworks, sky, starField, hills, snowGround, moon, star, bethlehemStar, candle, angel, shepherd, sheep, camel, stable, manger, person, santa, reindeer, elf, gift, bell: bellShape, tree, snowman, candyCane, gingerbread, stocking, fire, fireplace, skyline, windows, sleigh, dove, lightString, glowText, scroll, lantern, TAU, rnd };
})();
