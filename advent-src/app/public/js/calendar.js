// The calendar: a starry Bethlehem night with 25 doors, the countdown, and the scene player.
(function () {
  'use strict';
  const { h, clear, icon, api, toast, S } = AD;
  const A = () => window.Audio2;
  const EMOJI = ['⭐', '🕯️', '🏘️', '👼', '🕊️', '🎁', '🎵', '🌙', '✨', '💡', '📜', '🐴', '🏠', '🐑', '🌟', '🎉', '👶', '🎶', '🏮', '🏃', '📣', '🐪', '🌠', '🛷', '🎄'];
  // A fixed shuffle so the doors look like a real calendar but stay in the same place every visit.
  const ORDER = [12, 3, 24, 7, 18, 1, 15, 9, 22, 5, 11, 20, 2, 16, 8, 25, 13, 4, 19, 10, 23, 6, 14, 21, 17];
  let bg = null;
  let host = null;
  let tick = null;
  let elfEl = null;

  function child() { return S.state.children.find((c) => c.id === S.child) || S.state.children[0]; }
  function isOpen(n) { const c = child(); return !!(c && c.opened && c.opened[n]); }
  function unlocked(n) { return S.state.day >= n; }

  // ---------- the night-sky background ----------
  function background(canvas) {
    const D = window.Draw;
    const snow = new D.Snow(S.state.settings.snow ? 70 : 0);
    let shoot = null;
    const sc = new D.Scene(canvas, (ctx, W, H, t, dt) => {
      D.sky(ctx, W, H, '#040a26', '#17275e');
      D.starField(ctx, W, H, t, 110, 3);
      if (!shoot && Math.random() < 0.004) shoot = { x: D.rnd(W * 0.2, W), y: D.rnd(0, H * 0.3), life: 1 };
      if (shoot) { shoot.life -= dt; shoot.x -= 600 * dt; shoot.y += 200 * dt; ctx.save(); ctx.globalAlpha = shoot.life; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x + 90, shoot.y - 30); ctx.stroke(); ctx.restore(); if (shoot.life <= 0) shoot = null; }
      D.bethlehemStar(ctx, W * 0.5, H * 0.07, Math.min(W, H) * 0.02, t);
      D.hills(ctx, W, H, '#0e1a44', 0.84, 0.03, 2); D.skyline(ctx, W, H, 0.9, '#0a1030', 6); D.windows(ctx, W, H, 0.88, t, 8);
      D.hills(ctx, W, H, '#060b22', 0.96, 0.02, 9);
      const s = Math.min(W, H) * 0.06; D.stable(ctx, W * 0.5, H * 0.995, s, true); D.manger(ctx, W * 0.5, H * 0.99, s * 0.4, true, true);
      snow.draw(ctx, W, H, dt);
    });
    return sc.start();
  }

  // ---------- countdown ----------
  function countdownText() {
    const d = S.state.day;
    if (d === 0) {
      const now = new Date(S.state.today + 'T12:00:00');
      const dec1 = new Date(now.getFullYear(), 11, 1);
      const days = Math.round((dec1 - now) / 86400000);
      return { big: days + ' days', small: 'until the first door opens on December 1' };
    }
    if (d >= 25) return { big: 'Merry Christmas!', small: d === 25 ? 'Today is the day! Happy birthday, Jesus!' : 'Every door is open. Come back next Advent!' };
    const left = 25 - d;
    return { big: left + (left === 1 ? ' sleep' : ' sleeps'), small: 'until Christmas morning' };
  }
  function clock() {
    const now = new Date();
    const xmas = new Date(now.getFullYear(), 11, 25);
    if (S.state.preview) return S.state.today + ' (parent preview)';
    if (now > xmas) return '';
    const ms = xmas - now;
    const hrs = Math.floor(ms / 3600000) % 24, min = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
    return Math.floor(ms / 86400000) + 'd ' + String(hrs).padStart(2, '0') + ':' + String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  // ---------- doors ----------
  function door(n) {
    const open = isOpen(n), ok = unlocked(n), today = S.state.day === n;
    const el = h('button', { class: 'door' + (open ? ' open' : '') + (ok ? '' : ' locked') + (today ? ' today' : ''), type: 'button', 'aria-label': 'Door ' + n + (ok ? '' : ', locked'), 'data-n': n,
      onclick: () => openDoor(n, el) });
    el.appendChild(h('span', { class: 'door-front' }, h('b', { text: String(n) }), ok ? null : icon('lock', 'small')));
    el.appendChild(h('span', { class: 'door-back' }, h('span', { class: 'emo', text: EMOJI[n - 1] })));
    return el;
  }
  function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

  async function openDoor(n, el) {
    A().unlock();
    if (!unlocked(n)) {
      A().sfx.locked(); shake(el);
      toast(S.state.day === 0 ? 'Not yet! The first door opens on December 1.' : 'Not yet! This door opens on December ' + n + '.', 'warn');
      return;
    }
    const first = !isOpen(n);
    A().sfx.door();
    el.classList.add('open');
    try { const r = await api('POST', '/api/open', { child: child().id, day: n }); child().opened = r.opened; } catch (e) { /* keep going */ }
    setTimeout(() => playDay(n, first), 420);
  }

  // ---------- the scene player ----------
  let player = null;
  async function playDay(n, first) {
    let day;
    try { day = await api('GET', '/api/day/' + n); } catch (e) { toast(e.message, 'warn'); return; }
    closePlayer();
    A().unlock();
    const canvas = h('canvas', { class: 'scene-canvas' });
    const scene = window.Scenes.make(day.scene);
    const verse = h('div', { class: 'verse' }, h('p', { class: 'vt', text: '“' + day.verse + '”' }), h('p', { class: 'vr', text: day.ref + ' (KJV)' }));
    if (day.verse2) verse.appendChild(h('p', { class: 'vt small', text: '“' + day.verse2.text + '” — ' + day.verse2.ref }));
    const card = h('div', { class: 'day-card' },
      h('div', { class: 'day-head' }, h('span', { class: 'day-num', text: 'December ' + day.n }), h('h2', { text: day.title })),
      verse,
      h('p', { class: 'note', text: day.note }),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => { scene.st.clicks = 0; sc.t = 0; if (scene.intro) scene.intro(); } }, icon('refresh'), 'Play again'),
        h('button', { class: 'btn', type: 'button', onclick: () => { const on = A().music.toggle(scene.music); musicBtn.replaceChildren(icon(on ? 'pause' : 'note'), on ? 'Pause music' : 'Play music'); } }, icon('note'), 'Music'),
        h('button', { class: 'btn primary', type: 'button', onclick: closePlayer }, icon('check'), 'Done')));
    const musicBtn = card.querySelectorAll('.btn')[1];
    const wrap = h('div', { class: 'player' }, h('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', onclick: closePlayer }, icon('x')), canvas, card, h('p', { class: 'hint', text: 'Tap the picture for sparkles ✨' }));
    document.body.appendChild(wrap);
    const sc = new window.Draw.Scene(canvas, (ctx, W, H, t, dt) => scene.draw(ctx, W, H, t, dt), { onClick: (x, y) => { if (scene.click) scene.click(x, y); } });
    sc.start();
    player = { wrap, sc };
    requestAnimationFrame(() => wrap.classList.add('show'));
    if (scene.intro) scene.intro();
    if (S.state.settings.music && A().unlocked) A().music.play(scene.music || A().music.forDay(n));
    if (first) setTimeout(() => AD.fun && AD.fun.award('door:' + n, n === 25 ? 'You opened every door. Merry Christmas!' : null), 1500);
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closePlayer(); }
  function closePlayer() {
    if (!player) return;
    document.removeEventListener('keydown', escClose);
    player.sc.stop();
    player.wrap.classList.remove('show');
    const w = player.wrap; setTimeout(() => w.remove(), 300);
    player = null;
    A().music.stop();
    if (host) paintDoors();
  }

  // ---------- the hidden elf ----------
  function placeElf() {
    if (elfEl) elfEl.remove();
    const c = child();
    const key = 'elf:' + S.state.today;
    if (!c || (c.found && c.found[key]) || S.state.day === 0) return;
    // A different hiding spot each day.
    let seed = 0; for (const ch of S.state.today) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    const r = () => { seed = (seed * 16807) % 2147483647; return Math.abs(seed) / 2147483647; };
    elfEl = h('button', { class: 'hidden-elf', type: 'button', 'aria-label': 'A hidden elf!', onclick: async () => {
      A().unlock(); A().sfx.giggle(); A().sfx.sparkle(10, 0.04);
      elfEl.classList.add('found');
      try { const res = await api('POST', '/api/found', { child: c.id, key }); c.found = c.found || {}; c.found[key] = Date.now(); toast('You found the hidden elf! That makes ' + res.count + (res.count === 1 ? ' elf' : ' elves') + ' so far. 🧝', 'ok'); } catch (e) { /* ignore */ }
      setTimeout(() => elfEl && elfEl.remove(), 900);
    } }, h('span', { text: '🧝' }));
    elfEl.style.left = (6 + r() * 86) + '%';
    elfEl.style.top = (8 + r() * 80) + '%';
    host.appendChild(elfEl);
  }

  // ---------- page ----------
  let grid = null, countEl = null, clockEl = null;
  function paintDoors() {
    if (!grid) return;
    clear(grid);
    for (const n of ORDER) grid.appendChild(door(n));
  }
  function render(into) {
    const canvas = h('canvas', { class: 'bg-canvas', 'aria-hidden': 'true' });
    const cd = countdownText();
    countEl = h('div', { class: 'count' }, h('div', { class: 'big', text: cd.big }), h('div', { class: 'small', text: cd.small }), clockEl = h('div', { class: 'clock', text: clock() }));
    grid = h('div', { class: 'doors' });
    const c = child();
    const hello = c ? h('p', { class: 'hello', text: (S.state.day >= 25 ? 'Merry Christmas, ' : 'Welcome back, ') + c.name + '!' }) : null;
    host = h('section', { class: 'calendar' }, canvas, h('div', { class: 'cal-inner' }, hello, countEl, grid,
      h('p', { class: 'muted small center', text: S.state.day > 0 && S.state.day < 26 ? 'Open today\'s door, then look for the hidden elf. 🧝' : 'Every day in December a new door opens with a surprise and a verse from the Christmas story.' })));
    into.appendChild(host);
    bg = background(canvas);
    paintDoors();
    placeElf();
    clearInterval(tick);
    tick = setInterval(() => { if (clockEl) clockEl.textContent = clock(); }, 1000);
    // Christmas Day: a little fanfare on arrival.
    if (S.state.day === 25 && !sessionStorage.getItem('xmasFanfare')) { try { sessionStorage.setItem('xmasFanfare', '1'); } catch (e) { /* ignore */ } setTimeout(() => { if (A().unlocked) A().sfx.hooray(); }, 800); }
  }
  function leave() { clearInterval(tick); if (bg) bg.stop(); bg = null; host = grid = null; closePlayer(); }

  AD.pages.calendar = { render, leave, playDay, closePlayer };
})();
