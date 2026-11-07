// The 25 advent scenes. Each one is a small animated picture built from the Draw toolbox,
// with its own sounds. make(name) returns { draw, click, intro } for the scene runner.
(function () {
  'use strict';
  const D = window.Draw;
  const sfx = () => window.Audio2.sfx;
  const TAU = D.TAU;
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const clamp01 = (x) => Math.min(1, Math.max(0, x));

  // Shared bits every scene can use.
  function base() {
    return { snow: new D.Snow(90), sparks: new D.Sparks(), fw: new D.Fireworks(), clicks: 0 };
  }
  function tap(st, x, y, colors) { st.sparks.burst(x, y, 26, colors || ['#fff5c0', '#ffd36b', '#fff']); sfx().sparkle(6, 0.04); st.clicks++; }
  function nightHills(ctx, W, H, t, seed = 1) { D.hills(ctx, W, H, '#0e1a44', 0.72, 0.07, seed); D.hills(ctx, W, H, '#0a1233', 0.8, 0.05, seed + 2); D.hills(ctx, W, H, '#060b22', 0.88, 0.04, seed + 4); }
  function words(ctx, W, H, t, text, from, to, size, y = 0.18, color) {
    if (t < from || t > to) return;
    const a = Math.min(1, (t - from) / 0.8, (to - t) / 0.8);
    ctx.save(); ctx.globalAlpha = clamp01(a); D.glowText(ctx, text, W / 2, H * y, Math.min(size, W / (text.length * 0.62)), color); ctx.restore();
  }
  // Scroll the landscape left to right for travelling scenes.
  function parallax(ctx, W, H, t, speed, seed = 1) {
    const off = (t * speed) % W;
    for (const [color, y, amp, sp] of [['#0e1a44', 0.7, 0.06, 0.4], ['#0a1233', 0.79, 0.05, 0.7], ['#060b22', 0.88, 0.04, 1]]) {
      ctx.save(); ctx.translate(-((off * sp) % W), 0); D.hills(ctx, W * 2, H, color, y, amp, seed); ctx.restore();
    }
  }

  const SCENES = {
    star(st) {
      return {
        music: 'emmanuel',
        intro() { sfx().twinkle(); setTimeout(() => sfx().chime(), 1200); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#040a26', '#1a2a66'); D.starField(ctx, W, H, t, 90, 11);
          nightHills(ctx, W, H, t);
          const rise = ease(t / 3.5);
          D.bethlehemStar(ctx, W * 0.5, H * (0.95 - rise * 0.75), 14 + rise * 14, t);
          if (t > 2.5 && t < 2.55) st.sparks.burst(W / 2, H * 0.2, 40);
          words(ctx, W, H, t, 'A light is promised', 3, 8, 44, 0.86);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y); sfx().twinkle(); },
      };
    },
    candles(st) {
      return {
        music: 'emmanuel',
        intro() { sfx().chime(); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#140a06', '#3a1d0e');
          const cx = W / 2, cy = H * 0.62, r = Math.min(W, H) * 0.3;
          ctx.save(); ctx.strokeStyle = '#1f6b3a'; ctx.lineWidth = r * 0.28; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
          ctx.strokeStyle = '#2a8a4a'; ctx.lineWidth = r * 0.12; ctx.setLineDash([r * 0.1, r * 0.08]); ctx.beginPath(); ctx.arc(cx, cy, r, t * 0.05, TAU + t * 0.05); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#d7263d'; for (let i = 0; i < 10; i++) { const a = i * TAU / 10 + 0.3; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * 0.06, 0, TAU); ctx.fill(); }
          ctx.restore();
          const pos = [[-0.45, 0.1], [-0.15, -0.05], [0.15, -0.05], [0.45, 0.1]];
          pos.forEach(([px, py], i) => { const lit = t > 0.8 + i * 0.9; D.candle(ctx, cx + px * r * 2.1, cy + py * r + r * 0.55, r * 0.14, r * (0.9 - Math.abs(px) * 0.4), lit ? t : -100, i === 2 ? '#f6b7c7' : '#f0d9b0'); if (!lit) { ctx.fillStyle = '#140a06'; ctx.fillRect(cx + px * r * 2.1 - r * 0.2, cy + py * r + r * 0.55 - r * 1.5, r * 0.4, r * 0.65); } if (lit && t - (0.8 + i * 0.9) < 0.05) { st.sparks.burst(cx + px * r * 2.1, cy + py * r - r * 0.45, 14, ['#ffb13b', '#fff3b0']); sfx().sparkle(3, 0.05); } });
          words(ctx, W, H, t, 'God with us', 4.5, 9, 46, 0.14);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#ffb13b', '#fff3b0', '#ff7a1a']); },
      };
    },
    bethlehem(st) {
      return {
        music: 'emmanuel',
        intro() { sfx().chime(); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#07133a', '#2a2a6a'); D.starField(ctx, W, H, t, 80, 5);
          D.bethlehemStar(ctx, W * 0.62, H * 0.16, 12 + Math.sin(t) * 1.5, t);
          D.hills(ctx, W, H, '#162457', 0.66, 0.05, 2);
          D.skyline(ctx, W, H, 0.74, '#0b1030', 4);
          if (t > 1.5) D.windows(ctx, W, H, 0.7, t - 1.5, 8);
          D.hills(ctx, W, H, '#070b22', 0.9, 0.03, 9);
          words(ctx, W, H, t, 'O little town of Bethlehem', 2, 7, 40, 0.5);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y); },
      };
    },
    angel(st) {
      return {
        music: 'gloria',
        intro() { sfx().angelic(); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#0b0e33', '#2b2f7a'); D.starField(ctx, W, H, t, 60, 21);
          const p = ease(t / 3);
          const cx = W / 2, cy = H * (-0.2 + 0.65 * p);
          ctx.save(); const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(W, H) * 0.5 * p); g.addColorStop(0, 'rgba(255,245,200,.55)'); g.addColorStop(1, 'rgba(255,245,200,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
          nightHills(ctx, W, H, t, 3);
          D.angel(ctx, cx, cy, Math.min(W, H) * 0.14, t);
          if (t > 2 && Math.random() < 0.15) st.sparks.burst(cx + D.rnd(-80, 80), cy + D.rnd(-60, 80), 3, ['#fff', '#fff5c0'], 40, 1.5);
          words(ctx, W, H, t, 'Hail, thou that art highly favoured', 3.2, 8, 32, 0.9);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y); sfx().chime(); },
      };
    },
    dove(st) {
      return {
        music: 'silent',
        intro() { sfx().chime(); setTimeout(() => sfx().sparkle(10, 0.1), 600); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#0e1a44', '#3a4a9a'); D.starField(ctx, W, H, t, 50, 2);
          D.moon(ctx, W * 0.82, H * 0.18, Math.min(W, H) * 0.07);
          nightHills(ctx, W, H, t, 6);
          D.person(ctx, W * 0.5, H * 0.72, Math.min(W, H) * 0.16, '#3b5bd6', '#9ec5ff', true);
          const a = t * 1.2; const r = Math.min(W, H) * 0.22;
          D.dove(ctx, W * 0.5 + Math.cos(a) * r, H * 0.38 + Math.sin(a * 2) * r * 0.3, Math.min(W, H) * 0.09, t);
          words(ctx, W, H, t, 'Fear not, Mary', 1.5, 7, 48, 0.15);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#fff', '#cfe8ff']); },
      };
    },
    nicholas(st) {
      st.coins = [];
      return {
        music: 'wenceslas',
        intro() { sfx().jingle(6, 0.12); setTimeout(() => sfx().hohoho(), 900); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#1a0f0a', '#4a2a16');
          const s = Math.min(W, H) * 0.18;
          D.fireplace(ctx, W * 0.5, H * 0.86, s * 1.3, t);
          ['#d7263d', '#2e9e5b', '#ffd36b'].forEach((c, i) => D.stocking(ctx, W * 0.5 + (i - 1) * s * 0.75, H * 0.86 - s * 1.5, s * 0.35, c, t));
          // St. Nicholas in his bishop's robe and mitre
          const nx = W * 0.2, ny = H * 0.82;
          D.person(ctx, nx, ny, s * 1.1, '#b3202f', null);
          ctx.fillStyle = '#ffd36b'; ctx.beginPath(); ctx.moveTo(nx - s * 0.22, ny - s * 1.05); ctx.lineTo(nx, ny - s * 1.6); ctx.lineTo(nx + s * 0.22, ny - s * 1.05); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(nx, ny - s * 0.72, s * 0.22, s * 0.3, 0, 0, Math.PI); ctx.fill();
          if (Math.random() < 0.08 && t > 1) st.coins.push({ x: nx + s * 0.4, y: ny - s * 0.8, vx: D.rnd(60, 160), vy: D.rnd(-120, -60), r: s * 0.06 });
          ctx.fillStyle = '#ffd36b'; ctx.shadowColor = '#ffd36b'; ctx.shadowBlur = 10;
          for (const c of st.coins) { c.vy += 300 * dt; c.x += c.vx * dt; c.y += c.vy * dt; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.fill(); if (c.y > H * 0.86 - s * 1.2 && c.y < H * 0.86 - s * 1.1) { sfx().click(); } }
          ctx.shadowBlur = 0;
          st.coins = st.coins.filter((c) => c.y < H);
          D.gift(ctx, W * 0.8, H * 0.86, s * 0.5, '#2e9e5b'); D.gift(ctx, W * 0.9, H * 0.86, s * 0.35, '#5b9bff');
          words(ctx, W, H, t, 'Give in secret', 2, 7, 44, 0.14);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#ffd36b', '#fff']); st.coins.push({ x, y, vx: D.rnd(-40, 40), vy: -150, r: 8 }); },
      };
    },
    music(st) {
      st.notes = [];
      return {
        music: 'joy',
        intro() { sfx().chime(); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#1a0a33', '#4a2a7a'); D.starField(ctx, W, H, t, 60, 13);
          nightHills(ctx, W, H, t, 8);
          const s = Math.min(W, H) * 0.16;
          D.person(ctx, W * 0.5, H * 0.78, s, '#3b5bd6', '#9ec5ff');
          [[0.2, 0.3], [0.8, 0.3]].forEach(([px, py], i) => D.bell(ctx, W * px, H * py, s * 0.5, Math.sin(t * 3 + i) * 0.4));
          if (Math.random() < 0.12) st.notes.push({ x: W * 0.5 + D.rnd(-20, 20), y: H * 0.62, vy: D.rnd(-90, -50), vx: D.rnd(-40, 40), life: 3, c: ['#ffd36b', '#ff8fd0', '#5b9bff', '#fff'][Math.floor(D.rnd(0, 4))], ch: ['♪', '♫', '♩'][Math.floor(D.rnd(0, 3))] });
          ctx.save(); ctx.font = '700 ' + s * 0.45 + 'px system-ui'; ctx.textAlign = 'center';
          for (const n of st.notes) { n.life -= dt; n.y += n.vy * dt; n.x += Math.sin(n.life * 4) * 30 * dt; ctx.globalAlpha = clamp01(n.life / 3); ctx.fillStyle = n.c; ctx.shadowColor = n.c; ctx.shadowBlur = 10; ctx.fillText(n.ch, n.x, n.y); }
          ctx.restore(); st.notes = st.notes.filter((n) => n.life > 0);
          words(ctx, W, H, t, 'My soul doth magnify the Lord', 1.5, 7, 34, 0.14);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y); sfx().chime(); },
      };
    },
    dream(st) {
      return {
        music: 'silent',
        intro() { sfx().chime(); setTimeout(() => sfx().angelic(), 1500); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#050a20', '#1a2050'); D.starField(ctx, W, H, t, 70, 17);
          D.moon(ctx, W * 0.15, H * 0.2, Math.min(W, H) * 0.06);
          const s = Math.min(W, H) * 0.16;
          D.hills(ctx, W, H, '#0c1540', 0.78, 0.03, 3);
          // Joseph asleep
          ctx.save(); ctx.translate(W * 0.35, H * 0.86); ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.ellipse(0, 0, s * 1.3, s * 0.3, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#e0b48c'; ctx.beginPath(); ctx.arc(-s * 1.2, -s * 0.15, s * 0.22, 0, TAU); ctx.fill(); ctx.restore();
          ctx.save(); ctx.font = '700 ' + s * 0.4 + 'px system-ui'; ctx.fillStyle = '#cfe0ff'; ctx.globalAlpha = 0.8; for (let i = 0; i < 3; i++) { const ph = (t * 0.6 + i * 0.33) % 1; ctx.globalAlpha = 0.9 - ph; ctx.fillText('z', W * 0.2 + ph * 40 + i * 14, H * 0.8 - ph * 60 - i * 10); } ctx.restore();
          // dream cloud with angel
          const p = ease((t - 1) / 2);
          if (p > 0) { ctx.save(); ctx.globalAlpha = p; ctx.fillStyle = 'rgba(255,255,255,.14)'; const cx = W * 0.65, cy = H * 0.4, cr = s * 1.2 * p; for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * cr * 0.6, cy + Math.sin(a) * cr * 0.35, cr * 0.55, 0, TAU); ctx.fill(); } ctx.beginPath(); ctx.arc(cx, cy, cr * 0.8, 0, TAU); ctx.fill(); ctx.restore(); D.angel(ctx, W * 0.65, H * 0.4, s * 0.6 * p, t); }
          words(ctx, W, H, t, 'Joseph, fear not', 3, 8, 42, 0.12);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#cfe0ff', '#fff']); },
      };
    },
    name(st) {
      return {
        music: 'faithful',
        intro() { sfx().fanfare(); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#1a1030', '#4a2060'); D.starField(ctx, W, H, t, 60, 23);
          const letters = 'JESUS'; const size = Math.min(W * 0.17, H * 0.3);
          ctx.save(); ctx.font = '900 ' + size + 'px ui-rounded, "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const total = ctx.measureText(letters).width; let x = W / 2 - total / 2;
          for (let i = 0; i < letters.length; i++) { const w = ctx.measureText(letters[i]).width; const p = ease((t - 0.4 - i * 0.45) / 0.6); if (p > 0) { if (p < 0.1 && Math.random() < 0.5) { st.sparks.burst(x + w / 2, H * 0.42, 20, ['#ffd36b', '#fff']); sfx().sparkle(3, 0.03); } ctx.save(); ctx.globalAlpha = p; ctx.translate(x + w / 2, H * 0.42 - (1 - p) * 60); ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p); ctx.shadowColor = '#ffd36b'; ctx.shadowBlur = 40; ctx.fillStyle = '#ffd36b'; ctx.fillText(letters[i], 0, 0); ctx.shadowBlur = 0; ctx.fillStyle = '#fff8e0'; ctx.globalAlpha = p * 0.85; ctx.fillText(letters[i], 0, -3); ctx.restore(); } x += w; }
          ctx.restore();
          for (let i = 0; i < 16; i++) { const a = i * TAU / 16 + t * 0.3; const rr = size * 1.7 + Math.sin(t * 2 + i) * 10; D.star(ctx, W / 2 + Math.cos(a) * rr, H * 0.42 + Math.sin(a) * rr * 0.55, 4 + (i % 3) * 2, '#fff', 4, 0.4, 8); }
          words(ctx, W, H, t, 'for he shall save his people from their sins', 3.2, 9, 30, 0.8);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#ffd36b', '#fff']); sfx().chime(); },
      };
    },
    lights(st) {
      return {
        music: 'deck',
        intro() { sfx().jingle(8, 0.1); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#040a26', '#142257'); D.starField(ctx, W, H, t, 60, 31);
          D.snowGround(ctx, W, H, 0.78);
          const s = Math.min(W, H) * 0.2; const hx = W * 0.5, hy = H * 0.8;
          ctx.fillStyle = '#2a1c3a'; ctx.fillRect(hx - s * 1.3, hy - s * 1.3, s * 2.6, s * 1.3);
          ctx.fillStyle = '#4a2a4a'; ctx.beginPath(); ctx.moveTo(hx - s * 1.5, hy - s * 1.3); ctx.lineTo(hx, hy - s * 2.4); ctx.lineTo(hx + s * 1.5, hy - s * 1.3); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ffd36b'; ctx.globalAlpha = 0.85; ctx.fillRect(hx - s * 0.9, hy - s * 1.0, s * 0.5, s * 0.5); ctx.fillRect(hx + s * 0.4, hy - s * 1.0, s * 0.5, s * 0.5); ctx.globalAlpha = 1;
          ctx.fillStyle = '#7a3a1a'; ctx.fillRect(hx - s * 0.25, hy - s * 0.7, s * 0.5, s * 0.7);
          const roof = []; for (let i = 0; i <= 16; i++) { const f = i / 16; roof.push([hx - s * 1.5 + f * s * 3, hy - s * 1.3 - (f < 0.5 ? f * 2 : (1 - f) * 2) * s * 1.1]); }
          const eave = []; for (let i = 0; i <= 12; i++) eave.push([hx - s * 1.3 + (i / 12) * s * 2.6, hy - s * 1.3 + Math.sin(i * Math.PI) * 0]);
          D.lightString(ctx, roof, t, undefined, s * 0.04, 3); D.lightString(ctx, eave, t + 1, undefined, s * 0.035, 4);
          D.tree(ctx, W * 0.14, hy, s * 0.7, t); D.tree(ctx, W * 0.86, hy, s * 0.55, t + 1);
          D.snowman(ctx, W * 0.3, hy + s * 0.05, s * 0.3, t);
          st.snow.draw(ctx, W, H, dt);
          words(ctx, W, H, t, 'Jesus is the Light of the world', 2, 7.5, 34, 0.12);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#ff4d58', '#ffd36b', '#5b9bff', '#3ddc97']); sfx().jingle(3, 0.08); },
      };
    },
    scroll(st) {
      return {
        music: 'wenceslas',
        intro() { sfx().fanfare(); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#2a1a0a', '#6a3a1a');
          const s = Math.min(W, H);
          D.skyline(ctx, W, H, 0.8, '#1a0f08', 12);
          const p = ease((t - 0.5) / 1.6);
          D.scroll(ctx, W / 2, H * 0.48, s * 0.55, s * 0.5 * Math.max(0.02, p));
          if (p >= 1) { ctx.save(); ctx.fillStyle = '#4a2a0a'; ctx.textAlign = 'center'; ctx.font = '700 ' + s * 0.05 + 'px Georgia, serif'; const lines = ['DECREE', 'of Caesar Augustus', '', 'All the world', 'shall be taxed.', '', 'Every man to his', 'own city.']; lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.48 - s * 0.19 + i * s * 0.052)); ctx.restore(); }
          if (t > 0.4 && t < 0.5 && !st.trump) { st.trump = true; }
          words(ctx, W, H, t, 'A decree went out', 3, 7.5, 42, 0.1);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#ffd36b', '#fff']); sfx().fanfare(); },
      };
    },
    journey(st) {
      return {
        music: 'emmanuel',
        intro() { sfx().clops(8, 0.2); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#07103a', '#2a2a6a'); D.starField(ctx, W, H, t, 80, 41);
          D.moon(ctx, W * 0.8, H * 0.15, Math.min(W, H) * 0.06);
          parallax(ctx, W, H, t, 40, 2);
          const s = Math.min(W, H) * 0.15; const gy = H * 0.86;
          // donkey carrying Mary, Joseph walking
          const bob = Math.abs(Math.sin(t * 5)) * s * 0.05;
          ctx.save(); ctx.translate(W * 0.5, gy - bob); ctx.fillStyle = '#8a8a9a'; for (const [lx, ph] of [[-s * 0.4, 1], [-s * 0.2, -1], [s * 0.25, -1], [s * 0.45, 1]]) { ctx.save(); ctx.translate(lx, 0); ctx.rotate(Math.sin(t * 5) * 0.4 * ph); ctx.fillRect(-s * 0.05, 0, s * 0.1, s * 0.5); ctx.restore(); } ctx.beginPath(); ctx.ellipse(0, -s * 0.15, s * 0.65, s * 0.3, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(s * 0.75, -s * 0.5, s * 0.25, s * 0.18, -0.4, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(s * 0.7, -s * 0.65); ctx.lineTo(s * 0.8, -s * 0.95); ctx.lineTo(s * 0.9, -s * 0.65); ctx.fill(); ctx.restore();
          D.person(ctx, W * 0.5, gy - s * 0.4 - bob, s * 0.6, '#3b5bd6', '#9ec5ff');
          D.shepherd(ctx, W * 0.5 - s * 1.0, gy, s * 0.6, '#7a5230', t);
          if (Math.random() < 0.1) { st.sparks.burst(W * 0.5 + D.rnd(-s, s * 0.5), gy, 2, ['#c9b48c'], 25, 0.6); }
          if (Math.floor(t * 2.5) !== st.lastClop) { st.lastClop = Math.floor(t * 2.5); if (t > 2.5) sfx().clops(2, 0.2); }
          words(ctx, W, H, t, 'Unto the city of David', 1.5, 7, 40, 0.1);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y); sfx().clops(3, 0.15); },
      };
    },
    inn(st) {
      return {
        music: 'silent',
        intro() { sfx().door(); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#07103a', '#1a2050'); D.starField(ctx, W, H, t, 60, 51);
          D.bethlehemStar(ctx, W * 0.82, H * 0.14, 10, t);
          D.hills(ctx, W, H, '#0a1233', 0.82, 0.02, 1);
          const s = Math.min(W, H) * 0.2; const gy = H * 0.86;
          // the inn
          ctx.fillStyle = '#5a4030'; ctx.fillRect(W * 0.1, gy - s * 2.2, s * 2.2, s * 2.2); ctx.fillStyle = '#3a2a1a'; ctx.fillRect(W * 0.1 - s * 0.1, gy - s * 2.35, s * 2.4, s * 0.2);
          ctx.fillStyle = '#2a1a0a'; ctx.fillRect(W * 0.1 + s * 0.8, gy - s * 1.3, s * 0.6, s * 1.3);
          ctx.fillStyle = '#ffd36b'; ctx.globalAlpha = 0.8; ctx.fillRect(W * 0.1 + s * 0.2, gy - s * 1.8, s * 0.4, s * 0.4); ctx.fillRect(W * 0.1 + s * 1.6, gy - s * 1.8, s * 0.4, s * 0.4); ctx.globalAlpha = 1;
          ctx.save(); ctx.translate(W * 0.1 + s * 1.1, gy - s * 1.55); ctx.rotate(Math.sin(t * 2) * 0.05); ctx.fillStyle = '#f3e3b8'; ctx.fillRect(-s * 0.45, -s * 0.15, s * 0.9, s * 0.3); ctx.fillStyle = '#6a2a1a'; ctx.font = '700 ' + s * 0.16 + 'px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('NO ROOM', 0, 0); ctx.restore();
          D.lantern(ctx, W * 0.1 + s * 0.6, gy - s * 1.4, s * 0.22, t);
          // the stable, glowing
          const glow = ease((t - 2) / 2);
          D.stable(ctx, W * 0.78, gy, s * 0.9, glow > 0.2);
          if (glow > 0.5) D.manger(ctx, W * 0.78, gy - s * 0.05, s * 0.45, false);
          D.person(ctx, W * 0.5, gy, s * 0.55, '#3b5bd6', '#9ec5ff'); D.shepherd(ctx, W * 0.42, gy, s * 0.55, '#7a5230');
          words(ctx, W, H, t, 'No room for them in the inn', 4, 9, 36, 0.1);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#ffb13b', '#fff3b0']); },
      };
    },
    shepherds(st) {
      return {
        music: 'noel',
        intro() { sfx().crunch(); setTimeout(() => sfx().snort(), 800); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#040a26', '#101a4a'); D.starField(ctx, W, H, t, 110, 61);
          D.moon(ctx, W * 0.2, H * 0.18, Math.min(W, H) * 0.05);
          nightHills(ctx, W, H, t, 7);
          const s = Math.min(W, H) * 0.14; const gy = H * 0.84;
          D.fire(ctx, W * 0.5, gy, s * 0.6, t);
          ctx.fillStyle = '#4a2a10'; ctx.fillRect(W * 0.5 - s * 0.4, gy - s * 0.08, s * 0.8, s * 0.1);
          D.shepherd(ctx, W * 0.3, gy, s * 0.8, '#7a5230', t); D.shepherd(ctx, W * 0.68, gy - s * 0.1, s * 0.7, '#5a4a7a', t);
          for (let i = 0; i < 6; i++) D.sheep(ctx, W * (0.1 + i * 0.16) + Math.sin(t * 0.5 + i) * 6, gy + s * (0.15 + (i % 2) * 0.1), s * 0.35, t + i);
          words(ctx, W, H, t, 'Keeping watch over their flock by night', 1.5, 7, 32, 0.1);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#fff', '#eee']); sfx().snort(); },
      };
    },
    glory(st) {
      return {
        music: 'gloria',
        intro() { setTimeout(() => sfx().angelic(), 1200); setTimeout(() => sfx().boom(), 1200); },
        draw(ctx, W, H, t, dt) {
          const flash = t > 1.2 ? ease((t - 1.2) / 0.5) : 0;
          D.sky(ctx, W, H, '#040a26', '#101a4a'); D.starField(ctx, W, H, t, 110, 61);
          if (flash > 0) { ctx.save(); const cx = W * 0.5, cy = H * 0.3; const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(W, H) * 0.8); g.addColorStop(0, 'rgba(255,250,220,' + 0.95 * flash + ')'); g.addColorStop(0.4, 'rgba(255,230,160,' + 0.5 * flash + ')'); g.addColorStop(1, 'rgba(255,230,160,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 0.35 * flash; ctx.strokeStyle = '#fff'; for (let i = 0; i < 24; i++) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(i * TAU / 24 + t * 0.1); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, Math.max(W, H)); ctx.lineWidth = 3 + (i % 3) * 4; ctx.stroke(); ctx.restore(); } ctx.restore(); }
          nightHills(ctx, W, H, t, 7);
          const s = Math.min(W, H) * 0.14; const gy = H * 0.84;
          if (flash > 0) D.angel(ctx, W * 0.5, H * 0.3, s * 1.3 * flash, t);
          D.shepherd(ctx, W * 0.25, gy, s * 0.8, '#7a5230', t); D.shepherd(ctx, W * 0.72, gy - s * 0.1, s * 0.7, '#5a4a7a', t);
          for (let i = 0; i < 5; i++) D.sheep(ctx, W * (0.1 + i * 0.2), gy + s * 0.2, s * 0.35, t + i);
          words(ctx, W, H, t, 'The glory of the Lord shone round about them', 2.5, 8, 30, 0.9);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y); sfx().chime(); },
      };
    },
    joy(st) {
      return {
        music: 'joy',
        intro() { sfx().fanfare(); setTimeout(() => sfx().fireworks(4), 800); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#0b1a44', '#2a3a8a'); D.starField(ctx, W, H, t, 70, 71);
          nightHills(ctx, W, H, t, 9);
          if (t > 0.8 && Math.random() < 0.05) st.fw.launch(D.rnd(W * 0.1, W * 0.9), H);
          st.fw.onBurst = () => sfx().pop();
          st.fw.draw(ctx, dt);
          const s = Math.min(W, H) * 0.14;
          D.angel(ctx, W * 0.5, H * 0.42, s * 1.1, t);
          const p = ease((t - 1) / 1);
          if (p > 0) { ctx.save(); ctx.globalAlpha = p; D.glowText(ctx, 'Fear not!', W / 2, H * 0.14, Math.min(58, W / 7)); ctx.restore(); }
          words(ctx, W, H, t, 'Good tidings of great joy to all people', 3, 9, 30, 0.9);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { st.fw.launch(x, H); sfx().whoosh(0.5); },
      };
    },
    manger(st) {
      return {
        music: 'silent',
        intro() { sfx().chime(); setTimeout(() => sfx().sparkle(8, 0.1), 800); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#1a1208', '#3a2a12');
          const s = Math.min(W, H) * 0.3;
          ctx.save(); const g = ctx.createRadialGradient(W / 2, H * 0.55, 10, W / 2, H * 0.55, s * 2); g.addColorStop(0, 'rgba(255,220,140,.35)'); g.addColorStop(1, 'rgba(255,220,140,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
          ctx.fillStyle = '#c99a3a'; for (let i = 0; i < 40; i++) { const a = (i * 2.4) % TAU; ctx.save(); ctx.translate(W / 2 + Math.cos(a) * s * (1 + (i % 5) * 0.2), H * 0.78 + Math.sin(a) * s * 0.25); ctx.rotate(a); ctx.fillRect(-s * 0.15, -1.5, s * 0.3, 3); ctx.restore(); }
          D.manger(ctx, W / 2, H * 0.72, s * 1.1, true, true);
          if (Math.random() < 0.2) st.sparks.burst(W / 2 + D.rnd(-s * 0.5, s * 0.5), H * 0.55 + D.rnd(-20, 20), 2, ['#fff5c0', '#ffd36b'], 25, 1.6);
          words(ctx, W, H, t, 'Lying in a manger', 1.5, 7, 44, 0.14);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#fff5c0', '#ffd36b']); },
      };
    },
    host(st) {
      st.angels = []; for (let i = 0; i < 14; i++) st.angels.push({ x: Math.random(), y: 0.1 + Math.random() * 0.5, s: 0.4 + Math.random() * 0.7, ph: Math.random() * 6 });
      return {
        music: 'gloria',
        intro() { sfx().angelic(); setTimeout(() => sfx().angelic(0), 2200); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#1a1a4a', '#4a3a8a'); D.starField(ctx, W, H, t, 90, 81);
          ctx.save(); const g = ctx.createRadialGradient(W / 2, H * 0.3, 10, W / 2, H * 0.3, Math.max(W, H) * 0.7); g.addColorStop(0, 'rgba(255,245,200,.35)'); g.addColorStop(1, 'rgba(255,245,200,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
          nightHills(ctx, W, H, t, 12);
          const s = Math.min(W, H) * 0.09;
          st.angels.forEach((a, i) => { const p = ease((t - i * 0.2) / 1.5); if (p > 0) D.angel(ctx, W * a.x, H * a.y - (1 - p) * 80, s * a.s * p, t + a.ph); });
          const sh = Math.min(W, H) * 0.12; D.shepherd(ctx, W * 0.3, H * 0.86, sh * 0.8, '#7a5230', t); D.shepherd(ctx, W * 0.7, H * 0.86, sh * 0.7, '#5a4a7a', t);
          words(ctx, W, H, t, 'Gloria in excelsis Deo', 2, 7, 46, 0.5, '#fff5c0');
          words(ctx, W, H, t, 'Glory to God in the highest', 7, 12, 34, 0.5);
          if (Math.random() < 0.2) st.sparks.burst(D.rnd(0, W), D.rnd(0, H * 0.6), 2, ['#fff', '#fff5c0'], 30, 1.5);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y); sfx().chime(); },
      };
    },
    lanterns(st) {
      return {
        music: 'noel',
        intro() { sfx().crunch(); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#040a26', '#101a4a'); D.starField(ctx, W, H, t, 100, 91);
          D.bethlehemStar(ctx, W * 0.85, H * 0.12, 11, t);
          parallax(ctx, W, H, t, 60, 5);
          const s = Math.min(W, H) * 0.14; const gy = H * 0.86;
          const step = Math.abs(Math.sin(t * 6)) * s * 0.05;
          D.shepherd(ctx, W * 0.35, gy - step, s * 0.8, '#7a5230', t); D.lantern(ctx, W * 0.35 + s * 0.7, gy - s * 0.9, s * 0.28, t);
          D.shepherd(ctx, W * 0.6, gy - step * 0.6, s * 0.7, '#5a4a7a', t); D.lantern(ctx, W * 0.6 + s * 0.6, gy - s * 0.8, s * 0.25, t + 1);
          for (let i = 0; i < 3; i++) D.sheep(ctx, W * (0.12 + i * 0.1), gy + s * 0.15, s * 0.3, t + i);
          if (Math.floor(t * 3) !== st.lastStep) { st.lastStep = Math.floor(t * 3); if (t > 1) sfx().crunch(); }
          words(ctx, W, H, t, 'Let us now go even unto Bethlehem', 1.5, 7, 32, 0.1);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#ffb13b', '#fff3b0']); },
      };
    },
    haste(st) {
      return {
        music: 'jingle',
        intro() { sfx().whoosh(); setTimeout(() => sfx().fanfare(), 1800); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#040a26', '#1a2a6a'); D.starField(ctx, W, H, t, 80, 101);
          parallax(ctx, W, H, t, 220, 8);
          const s = Math.min(W, H) * 0.14; const gy = H * 0.86;
          const run = Math.abs(Math.sin(t * 12)) * s * 0.1;
          ctx.save(); ctx.translate(0, -run); D.shepherd(ctx, W * 0.3, gy, s * 0.8, '#7a5230', t); ctx.restore();
          ctx.save(); ctx.translate(0, -run * 0.7); D.shepherd(ctx, W * 0.5, gy, s * 0.7, '#5a4a7a', t); ctx.restore();
          for (let i = 0; i < 4; i++) D.sheep(ctx, W * (0.62 + i * 0.1), gy + s * 0.1 - Math.abs(Math.sin(t * 12 + i)) * s * 0.1, s * 0.3, t + i);
          for (let i = 0; i < 6; i++) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.beginPath(); const yy = H * (0.2 + i * 0.1); const xx = (W - ((t * 900 + i * 300) % (W + 200))); ctx.moveTo(xx, yy); ctx.lineTo(xx + 120, yy); ctx.stroke(); }
          const sleeps = 5;
          if (t > 2) { ctx.save(); const p = ease((t - 2) / 0.6); ctx.globalAlpha = p; D.glowText(ctx, sleeps + ' more sleeps!', W / 2, H * 0.14, Math.min(60, W / 8)); ctx.restore(); }
          words(ctx, W, H, t, 'They came with haste', 4, 9, 32, 0.3);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y); sfx().whoosh(0.3); },
      };
    },
    town(st) {
      st.bubbles = [];
      return {
        music: 'wish',
        intro() { sfx().chime(); setTimeout(() => sfx().giggle(), 1500); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#1a2a6a', '#4a6ab0'); D.starField(ctx, W, H, t, 40, 111);
          D.hills(ctx, W, H, '#2a3a7a', 0.6, 0.04, 2);
          D.skyline(ctx, W, H, 0.7, '#1a2040', 14); D.windows(ctx, W, H, 0.68, t, 15);
          D.hills(ctx, W, H, '#c9b48c', 0.86, 0.01, 1);
          const s = Math.min(W, H) * 0.13; const gy = H * 0.9;
          D.shepherd(ctx, W * 0.2, gy, s * 0.8, '#7a5230', t);
          const cols = ['#b3202f', '#2a7a4a', '#5b9bff', '#c98b3a', '#8a4aa0'];
          for (let i = 0; i < 5; i++) D.person(ctx, W * (0.4 + i * 0.12), gy - (i % 2) * s * 0.05, s * (0.55 + (i % 2) * 0.1), cols[i], i % 2 ? '#f3e3b8' : null);
          if (Math.random() < 0.04) st.bubbles.push({ x: W * D.rnd(0.35, 0.95), y: gy - s * 1.3, life: 2.5, txt: ['A Saviour!', 'Born tonight!', 'In a manger!', 'Angels sang!', 'Glory!', 'Come see!'][Math.floor(D.rnd(0, 6))] });
          ctx.save(); ctx.font = '700 ' + s * 0.22 + 'px system-ui'; ctx.textAlign = 'center';
          for (const b of st.bubbles) { b.life -= dt; b.y -= 20 * dt; ctx.globalAlpha = clamp01(b.life / 2.5); const w = ctx.measureText(b.txt).width + 16; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(b.x - w / 2, b.y - s * 0.3, w, s * 0.36, 8); ctx.fill(); ctx.fillStyle = '#1a2040'; ctx.fillText(b.txt, b.x, b.y - s * 0.04); }
          ctx.restore(); st.bubbles = st.bubbles.filter((b) => b.life > 0);
          words(ctx, W, H, t, 'They made known abroad the saying', 1.5, 7, 32, 0.1);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y); st.bubbles.push({ x, y, life: 2.5, txt: 'Jesus is born!' }); },
      };
    },
    wisemen(st) {
      return {
        music: 'emmanuel',
        intro() { sfx().clops(6, 0.3); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#1a0a3a', '#6a2a5a'); D.starField(ctx, W, H, t, 90, 121);
          D.bethlehemStar(ctx, W * 0.18, H * 0.14, 12, t);
          const off = (t * 30) % W;
          for (const [c, y, sp] of [['#3a1a4a', 0.68, 0.3], ['#2a1030', 0.78, 0.6], ['#1a0a20', 0.88, 1]]) { ctx.save(); ctx.translate(((off * sp) % W), 0); D.hills(ctx, W * 2, H, c, y, 0.05, 7); ctx.translate(-W * 2, 0); D.hills(ctx, W * 2, H, c, y, 0.05, 7); ctx.restore(); }
          const s = Math.min(W, H) * 0.2; const gy = H * 0.84;
          for (let i = 0; i < 3; i++) { ctx.save(); ctx.scale(-1, 1); D.camel(ctx, -(W * (0.72 - i * 0.22)), gy - (i % 2) * s * 0.08, s * (1 - i * 0.12), t + i); ctx.restore(); }
          if (Math.floor(t * 2) !== st.lastClop) { st.lastClop = Math.floor(t * 2); if (t > 2) sfx().clops(1, 0.2); }
          words(ctx, W, H, t, 'We have seen his star in the east', 1.5, 7, 32, 0.12);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { tap(st, x, y, ['#ffd36b', '#fff']); },
      };
    },
    starstop(st) {
      return {
        music: 'noel',
        intro() { sfx().whoosh(1.2); setTimeout(() => { sfx().chime(); sfx().fireworks(5); }, 2600); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#07103a', '#2a2a6a'); D.starField(ctx, W, H, t, 90, 131);
          const p = ease(t / 2.6);
          D.bethlehemStar(ctx, W * (0.1 + 0.55 * p), H * (0.12 + 0.08 * p), 12 + 6 * p, t);
          D.hills(ctx, W, H, '#0e1a44', 0.72, 0.05, 2);
          const s = Math.min(W, H) * 0.18; const gy = H * 0.86;
          ctx.fillStyle = '#5a4030'; ctx.fillRect(W * 0.65 - s, gy - s * 1.4, s * 2, s * 1.4); ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.moveTo(W * 0.65 - s * 1.15, gy - s * 1.4); ctx.lineTo(W * 0.65, gy - s * 2.1); ctx.lineTo(W * 0.65 + s * 1.15, gy - s * 1.4); ctx.fill();
          ctx.fillStyle = '#ffd36b'; ctx.globalAlpha = 0.8; ctx.fillRect(W * 0.65 - s * 0.3, gy - s * 0.9, s * 0.6, s * 0.9); ctx.globalAlpha = 1;
          const cs = s * 0.55;
          for (let i = 0; i < 3; i++) { ctx.save(); ctx.scale(-1, 1); D.camel(ctx, -(W * (0.12 + i * 0.13)), gy, cs, p >= 1 ? 0 : t + i, p < 1); ctx.restore(); if (p >= 1) D.person(ctx, W * (0.3 + i * 0.1), gy, cs * 0.9, ['#b3202f', '#2a7a4a', '#8a4aa0'][i], null, true); }
          if (p >= 1) { if (Math.random() < 0.05) st.fw.launch(D.rnd(W * 0.1, W * 0.9), H); st.fw.onBurst = () => sfx().pop(); st.fw.draw(ctx, dt); }
          words(ctx, W, H, t, 'Exceeding great joy', 3, 8, 46, 0.5);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { st.fw.launch(x, H); sfx().whoosh(0.5); },
      };
    },
    eve(st) {
      return {
        music: 'jingle',
        intro() { sfx().jingle(12, 0.1); setTimeout(() => sfx().hohoho(), 1200); setTimeout(() => sfx().fireworks(5), 3000); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#040a26', '#1a2a6a'); D.starField(ctx, W, H, t, 90, 141);
          D.moon(ctx, W * 0.72, H * 0.22, Math.min(W, H) * 0.11);
          D.snowGround(ctx, W, H, 0.8);
          const s = Math.min(W, H) * 0.12;
          D.tree(ctx, W * 0.12, H * 0.82, s * 0.8, t); D.tree(ctx, W * 0.3, H * 0.84, s * 0.6, t + 1); D.tree(ctx, W * 0.88, H * 0.83, s * 0.7, t + 2);
          // three gifts for the King
          ['#ffd36b', '#b3202f', '#5b9bff'].forEach((c, i) => D.gift(ctx, W * (0.42 + i * 0.09), H * 0.86, s * 0.45, c, i === 0 ? '#fff' : '#ffd36b'));
          // the sleigh crossing the moon
          const fx = ((t * 110) % (W + 400)) - 200; const fy = H * 0.26 + Math.sin(t * 1.5) * 12;
          ctx.save(); ctx.translate(fx, fy);
          for (let i = 0; i < 4; i++) D.reindeer(ctx, s * 1.3 + i * s * 1.25, -s * 0.2 + Math.sin(t * 10 + i) * 4, s * 0.45, t, i === 3, true);
          ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-s * 0.2, -s * 0.3); ctx.lineTo(s * 1.3 + 3 * s * 1.25, -s * 0.5); ctx.stroke();
          D.sleigh(ctx, -s * 0.6, 0, s * 0.7); D.santa(ctx, -s * 0.5, -s * 0.5, s * 0.4, t);
          ctx.restore();
          if (Math.random() < 0.3) st.sparks.burst(fx - s * 1.5, fy, 2, ['#ffd36b', '#fff'], 30, 1);
          if (t > 3 && Math.random() < 0.03) st.fw.launch(D.rnd(W * 0.1, W * 0.9), H);
          st.fw.onBurst = () => sfx().pop(); st.fw.draw(ctx, dt);
          st.snow.draw(ctx, W, H, dt, -20);
          words(ctx, W, H, t, "It's Christmas Eve!", 1, 6, 52, 0.6);
          words(ctx, W, H, t, 'Gold, frankincense and myrrh', 6, 11, 34, 0.6);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { st.fw.launch(x, H); sfx().jingle(4, 0.08); },
      };
    },
    nativity(st) {
      st.angels = []; for (let i = 0; i < 8; i++) st.angels.push({ x: 0.1 + i * 0.11, y: 0.1 + Math.sin(i) * 0.05, s: 0.5 + (i % 3) * 0.15 });
      return {
        music: 'joy',
        intro() { sfx().toll(); setTimeout(() => sfx().fanfare(), 1500); setTimeout(() => sfx().angelic(), 2500); setTimeout(() => sfx().fireworks(8), 4000); },
        draw(ctx, W, H, t, dt) {
          D.sky(ctx, W, H, '#07103a', '#2a3a8a'); D.starField(ctx, W, H, t, 120, 151);
          ctx.save(); const g = ctx.createRadialGradient(W / 2, H * 0.6, 10, W / 2, H * 0.6, Math.max(W, H) * 0.6); g.addColorStop(0, 'rgba(255,220,140,.35)'); g.addColorStop(1, 'rgba(255,220,140,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
          D.bethlehemStar(ctx, W * 0.5, H * 0.1, 16, t);
          nightHills(ctx, W, H, t, 20);
          const s = Math.min(W, H) * 0.15; const gy = H * 0.86;
          const as = Math.min(W, H) * 0.07; st.angels.forEach((a, i) => { const p = ease((t - 2 - i * 0.15) / 1.2); if (p > 0) D.angel(ctx, W * a.x, H * a.y + 30, as * a.s * p, t + i); });
          D.stable(ctx, W * 0.5, gy, s * 1.6, true);
          D.person(ctx, W * 0.38, gy, s * 0.8, '#3b5bd6', '#9ec5ff', true); D.shepherd(ctx, W * 0.62, gy, s * 0.8, '#7a5230');
          D.manger(ctx, W * 0.5, gy - s * 0.05, s * 0.6, true, true);
          D.shepherd(ctx, W * 0.16, gy, s * 0.7, '#5a4a7a', t); D.sheep(ctx, W * 0.08, gy + s * 0.15, s * 0.3, t); D.sheep(ctx, W * 0.24, gy + s * 0.2, s * 0.28, t + 1);
          for (let i = 0; i < 3; i++) { ctx.save(); ctx.scale(-1, 1); D.camel(ctx, -(W * (0.78 + i * 0.08)), gy - s * 0.1 - i * 4, s * 0.5, 0, false); ctx.restore(); D.person(ctx, W * (0.73 + i * 0.07), gy + s * 0.05, s * 0.55, ['#b3202f', '#2a7a4a', '#8a4aa0'][i], null, true); }
          if (t > 4 && Math.random() < 0.05) st.fw.launch(D.rnd(W * 0.05, W * 0.95), H);
          st.fw.onBurst = () => sfx().pop(); st.fw.draw(ctx, dt);
          if (Math.random() < 0.3) st.sparks.burst(D.rnd(0, W), D.rnd(0, H * 0.5), 2, ['#fff', '#ffd36b'], 30, 1.4);
          if (t > 1.2) { ctx.save(); const p = ease((t - 1.2) / 0.8); ctx.globalAlpha = p; D.glowText(ctx, 'Merry Christmas!', W / 2, H * 0.3, Math.min(64, W / 8.5)); ctx.restore(); }
          words(ctx, W, H, t, 'Christ the Lord is born!', 4, 11, 36, 0.4);
          st.sparks.draw(ctx, dt);
        },
        click(x, y) { st.fw.launch(x, H); sfx().whoosh(0.4); },
      };
    },
  };

  function make(name) {
    const st = base();
    const fn = SCENES[name] || SCENES.star;
    const sc = fn(st);
    return { st, draw: sc.draw, click: sc.click, intro: sc.intro, music: sc.music };
  }
  window.Scenes = { make, names: Object.keys(SCENES) };
})();
