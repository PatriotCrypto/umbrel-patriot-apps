// Fun & Games: snowball toss, reindeer quiz, the story, and badges.
// Also every secret in the app: Konami code, typed magic words, 5 taps on the star, and more.
(function () {
  'use strict';
  const { h, clear, icon, api, toast, modal, S } = AD;
  const A = () => window.Audio2;
  const D = () => window.Draw;
  const TAU = Math.PI * 2;

  function child() { return S.state.children.find((c) => c.id === S.child) || S.state.children[0]; }
  const BADGES = {
    'door:1': ['🚪', 'First Door', 'Opened the very first door'], 'door:25': ['🎄', 'Christmas Morning', 'Opened the Christmas Day door'],
    wish: ['✉️', 'Dear Santa', 'Sent Santa a wish'], scanner: ['🔍', 'Scanned', 'Used the Nice List Scanner'],
    snowball: ['⛄', 'Snowball Champ', 'Scored 10 in Snowball Toss'], quiz: ['🦌', 'Reindeer Expert', 'Named all the reindeer'], story: ['📖', 'Storyteller', 'Read the whole Christmas story'],
    konami: ['🎮', 'Secret Code', 'Found the secret code'], blizzard: ['🌨️', 'Blizzard', 'Made it snow extra hard'], rudolph: ['🔴', 'Red Nose', 'Found Rudolph'], star7: ['⭐', 'Star Gazer', 'Tapped the star of Bethlehem'],
    elf5: ['🧝', 'Elf Spotter', 'Found 5 hidden elves'], elf25: ['👑', 'Elf Master', 'Found every hidden elf'], midnight: ['🔔', 'Midnight Bells', 'Heard the Christmas Eve bells'], hohoho: ['🎅', 'Ho Ho Ho', 'Made Santa laugh'],
    sing: ['🎤', 'Angel Choir', 'Typed GLORIA'], gift: ['🎁', 'Gift Hunter', 'Found the secret gift'], candy: ['🍬', 'Sweet Tooth', 'Typed CANDY'], cocoa: ['☕', 'Cocoa Break', 'Typed COCOA'],
  };

  async function award(key, msg) {
    const c = child(); if (!c) return;
    try {
      const r = await api('POST', '/api/found', { child: c.id, key, badge: true });
      c.badges = c.badges || {}; c.badges[key] = Date.now();
      if (r.fresh && BADGES[key]) { A().sfx.success(); toast(BADGES[key][0] + ' New badge: ' + BADGES[key][1] + (msg ? '. ' + msg : ''), 'ok'); }
    } catch (e) { /* ignore */ }
  }

  // ---------- snowball toss ----------
  function snowball() {
    const canvas = h('canvas', { class: 'game-canvas' });
    const score = h('p', { class: 'score', text: 'Tap the targets! Score: 0' });
    let pts = 0, targets = [], balls = [], awarded = false, timeLeft = 30;
    const sc = new (D().Scene)(canvas, (ctx, W, H, t, dt) => {
      D().sky(ctx, W, H, '#1a2a6a', '#5a7ab0'); D().snowGround(ctx, W, H, 0.75);
      timeLeft -= dt;
      if (timeLeft <= 0) { ctx.save(); D().glowText(ctx, 'Time! You scored ' + pts, W / 2, H / 2, Math.min(40, W / 10)); ctx.restore(); return; }
      if (targets.length < 3 && Math.random() < 0.04) targets.push({ x: D().rnd(40, W - 40), y: D().rnd(60, H * 0.65), r: D().rnd(16, 28), vx: D().rnd(-60, 60), kind: Math.random() < 0.3 ? 'elf' : Math.random() < 0.5 ? 'snowman' : 'gift', life: 5 });
      for (const tg of targets) { tg.x += tg.vx * dt; if (tg.x < 30 || tg.x > W - 30) tg.vx *= -1; tg.life -= dt; if (tg.kind === 'snowman') D().snowman(ctx, tg.x, tg.y + tg.r, tg.r * 0.7, t); else if (tg.kind === 'elf') D().elf(ctx, tg.x, tg.y + tg.r * 0.4, tg.r * 1.2, t); else D().gift(ctx, tg.x, tg.y + tg.r, tg.r * 1.4); }
      targets = targets.filter((tg) => tg.life > 0);
      ctx.fillStyle = '#fff';
      for (const b of balls) { b.t += dt; const k = b.t / 0.35; b.x = b.x0 + (b.tx - b.x0) * k; b.y = b.y0 + (b.ty - b.y0) * k - Math.sin(Math.min(1, k) * Math.PI) * 60; ctx.beginPath(); ctx.arc(b.x, b.y, 9 - k * 3, 0, TAU); ctx.fill(); if (k >= 1 && !b.done) { b.done = true; const hit = targets.find((tg) => Math.hypot(tg.x - b.tx, tg.y - b.ty) < tg.r + 10); if (hit) { pts += hit.kind === 'elf' ? 3 : 1; targets = targets.filter((x) => x !== hit); sc.sparks.burst(b.tx, b.ty, 20, ['#fff', '#cfe0ff']); A().sfx.pop(); if (hit.kind === 'elf') A().sfx.giggle(); score.textContent = 'Tap the targets! Score: ' + pts + ' · ' + Math.ceil(timeLeft) + 's'; if (pts >= 10 && !awarded) { awarded = true; award('snowball'); } } else A().sfx.crunch(); } }
      balls = balls.filter((b) => b.t < 0.6);
      sc.sparks.draw(ctx, dt);
      ctx.fillStyle = '#fff'; ctx.font = '700 14px system-ui'; ctx.fillText('⏱ ' + Math.ceil(timeLeft) + 's', 10, 22);
    }, { onClick: (x, y, s) => { if (timeLeft <= 0) return; A().unlock(); A().sfx.whoosh(0.25); balls.push({ x0: s.W / 2, y0: s.H - 10, tx: x, ty: y, t: 0 }); } });
    sc.sparks = new (D().Sparks)();
    sc.start();
    modal('Snowball Toss', h('div', { class: 'game' }, score, canvas, h('p', { class: 'muted small', text: 'Snowmen and gifts are 1 point, elves are 3. 30 seconds!' })), (close) => [h('button', { class: 'btn', type: 'button', onclick: close }, 'Done')], { onClose: () => sc.stop(), cls: 'wide' });
  }

  // ---------- reindeer quiz ----------
  function quiz() {
    const Q = [
      ['Which reindeer has a glowing red nose?', ['Rudolph', 'Dasher', 'Comet', 'Cupid'], 0],
      ['How many reindeer pull the sleigh, counting Rudolph?', ['7', '8', '9', '12'], 2],
      ['Which of these is NOT one of Santa\'s reindeer?', ['Vixen', 'Prancer', 'Thunder', 'Blitzen'], 2],
      ['Where was Jesus born?', ['Nazareth', 'Jerusalem', 'Bethlehem', 'Rome'], 2],
      ['Who told the shepherds the good news?', ['A king', 'An angel', 'A wise man', 'A shepherd'], 1],
      ['What did the wise men follow?', ['A map', 'A star', 'A camel', 'A river'], 1],
      ['Who was Jesus\' mother?', ['Martha', 'Ruth', 'Mary', 'Esther'], 2],
      ['Which reindeer\'s name means "lightning" in German?', ['Donner', 'Blitzen', 'Dancer', 'Comet'], 1],
    ];
    let i = 0, right = 0;
    const body = h('div', { class: 'quiz' });
    const paint = () => {
      clear(body);
      if (i >= Q.length) { body.appendChild(h('div', { class: 'center' }, h('p', { class: 'big-emoji', text: right === Q.length ? '🏆' : right >= 5 ? '🦌' : '⛄' }), h('h3', { text: right + ' out of ' + Q.length + '!' }), h('p', { class: 'muted', text: right === Q.length ? 'Perfect! You are a Reindeer Expert.' : 'Good try! Play again to beat your score.' }))); if (right === Q.length) award('quiz'); else A().sfx.chime(); return; }
      const q = Q[i];
      body.appendChild(h('p', { class: 'muted small', text: 'Question ' + (i + 1) + ' of ' + Q.length }));
      body.appendChild(h('h3', { text: q[0] }));
      body.appendChild(h('div', { class: 'choices' }, q[1].map((c, k) => h('button', { class: 'btn block', type: 'button', text: c, onclick: (e) => { A().unlock(); if (k === q[2]) { right++; A().sfx.success(); e.target.classList.add('good'); } else { A().sfx.locked(); e.target.classList.add('bad'); } setTimeout(() => { i++; paint(); }, 700); } }))));
    };
    paint();
    modal('Reindeer Quiz', body, (close) => [h('button', { class: 'btn', type: 'button', onclick: close }, 'Close')]);
  }

  // ---------- the Christmas story ----------
  function story() {
    const parts = S.state.days;
    const body = h('div', { class: 'story' }, h('p', { class: 'muted small', text: 'The whole Christmas story, verse by verse, from the doors you have opened so far.' }));
    const c = child();
    let shown = 0;
    for (const d of parts) {
      if (!(c.opened && c.opened[d.n])) continue;
      shown++;
      body.appendChild(h('div', { class: 'story-row' }, h('b', { text: 'Dec ' + d.n + ' · ' + d.title }), h('p', { class: 'muted small', text: d.ref })));
    }
    if (!shown) body.appendChild(h('p', { class: 'muted', text: 'Open some doors first, and the story will grow here day by day.' }));
    if (shown === 25) award('story');
    modal('The Christmas Story', body, (close) => [h('button', { class: 'btn', type: 'button', onclick: close }, 'Close')]);
  }

  // ---------- badges ----------
  function badges(into) {
    const c = child(); const have = (c && c.badges) || {};
    const elves = Object.keys((c && c.found) || {}).length;
    if (elves >= 5 && !have.elf5) award('elf5'); if (elves >= 25 && !have.elf25) award('elf25');
    const grid = h('div', { class: 'badges' });
    for (const [k, b] of Object.entries(BADGES)) grid.appendChild(h('div', { class: 'badge' + (have[k] ? ' got' : ''), title: b[2] }, h('span', { class: 'bi', text: have[k] ? b[0] : '❔' }), h('small', { text: have[k] ? b[1] : '???' })));
    into.appendChild(h('div', { class: 'card glass' }, h('h3', null, icon('star'), ' ' + c.name + "'s Badges"), h('p', { class: 'muted small', text: Object.keys(have).length + ' of ' + Object.keys(BADGES).length + ' badges · ' + elves + ' hidden elves found. Mystery badges are secrets to discover!' }), grid));
  }

  // ---------- easter eggs ----------
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let ki = 0, typed = '';
  const WORDS = {
    snow() { blizzard(); award('blizzard'); },
    gloria() { A().sfx.angelic(); overlay('✨ Gloria in excelsis Deo! ✨', 'angels'); award('sing'); },
    rudolph() { A().sfx.snort(); overlay('🔴 Rudolph says hi!', 'rudolph'); award('rudolph'); },
    hohoho() { A().sfx.hohoho(); overlay('🎅 HO HO HO!', 'santa'); award('hohoho'); },
    candy() { A().sfx.sparkle(12, 0.04); overlay('🍬 Candy cane rain! 🍬', 'candy'); award('candy'); },
    cocoa() { A().sfx.chime(); overlay('☕ Cocoa break! Marshmallows for everyone.', 'cocoa'); award('cocoa'); },
    jesus() { A().sfx.chime(); overlay('✝️ Jesus is the reason for the season.', 'star'); },
    elf() { A().sfx.giggle(); toast('🧝 The elves heard you! Find the hidden one on the calendar.', 'ok'); },
    bells() { A().sfx.jingle(16, 0.1); },
    gift() { A().sfx.success(); overlay('🎁 You found the secret gift! It is… a hug. Go give one.', 'gift'); award('gift'); },
  };
  function keys(e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    ki = e.key === KONAMI[ki] ? ki + 1 : e.key === KONAMI[0] ? 1 : 0;
    if (ki === KONAMI.length) { ki = 0; stampede(); award('konami'); return; }
    if (e.key.length === 1) { typed = (typed + e.key.toLowerCase()).slice(-12); for (const w of Object.keys(WORDS)) if (typed.endsWith(w)) { typed = ''; A().unlock(); WORDS[w](); } }
  }
  function overlay(text, kind) {
    const canvas = h('canvas', { class: 'fx-canvas' });
    const el = h('div', { class: 'egg' }, canvas, h('h1', { text }));
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const sparks = new (D().Sparks)();
    const sc = new (D().Scene)(canvas, (ctx, W, H, t, dt) => {
      ctx.clearRect(0, 0, W, H);
      if (kind === 'candy') { for (let i = 0; i < 12; i++) D().candyCane(ctx, (i * 97 + t * 60) % W, ((t * 220 + i * 140) % (H + 100)) - 60, 24, t + i); }
      else if (kind === 'rudolph') { D().reindeer(ctx, W / 2 - 60, H * 0.72, Math.min(W, H) * 0.12, t, true); }
      else if (kind === 'santa') { D().santa(ctx, W / 2, H * 0.78, Math.min(W, H) * 0.14, t); }
      else if (kind === 'angels') { for (let i = 0; i < 6; i++) D().angel(ctx, W * (0.1 + i * 0.16), H * 0.3 + Math.sin(t + i) * 20, Math.min(W, H) * 0.07, t + i); }
      else if (kind === 'star') { D().bethlehemStar(ctx, W / 2, H * 0.25, 20, t); }
      else if (kind === 'gift') { for (let i = 0; i < 7; i++) D().gift(ctx, W * (0.1 + i * 0.13), H * 0.75 + Math.sin(t * 3 + i) * 10, 40, ['#d7263d', '#2e9e5b', '#5b9bff', '#ffd36b'][i % 4]); }
      if (Math.random() < 0.4) sparks.burst(Math.random() * W, Math.random() * H, 3, ['#fff', '#ffd36b', '#ff8fd0'], 50, 1.2);
      sparks.draw(ctx, dt);
    }).start();
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => { sc.stop(); el.remove(); }, 500); }, 3800);
  }
  function blizzard() {
    const canvas = h('canvas', { class: 'fx-canvas' });
    const el = h('div', { class: 'egg clear' }, canvas);
    document.body.appendChild(el); requestAnimationFrame(() => el.classList.add('show'));
    const snow = new (D().Snow)(700);
    const sc = new (D().Scene)(canvas, (ctx, W, H, t, dt) => { ctx.clearRect(0, 0, W, H); snow.draw(ctx, W, H, dt, -120 + Math.sin(t) * 60); }).start();
    A().sfx.whoosh(2);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => { sc.stop(); el.remove(); }, 600); }, 7000);
  }
  function stampede() {
    const canvas = h('canvas', { class: 'fx-canvas' });
    const el = h('div', { class: 'egg clear' }, canvas, h('h1', { text: '🦌 REINDEER STAMPEDE! 🦌' }));
    document.body.appendChild(el); requestAnimationFrame(() => el.classList.add('show'));
    const sc = new (D().Scene)(canvas, (ctx, W, H, t, dt) => { ctx.clearRect(0, 0, W, H); for (let i = 0; i < 9; i++) D().reindeer(ctx, ((t * 420 + i * 170) % (W + 300)) - 150, H * (0.35 + (i % 3) * 0.2) + Math.sin(t * 10 + i) * 6, 40 + (i % 3) * 8, t + i, i === 0, true); }).start();
    A().sfx.clops(20, 0.12); setTimeout(() => A().sfx.jingle(10, 0.1), 500);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => { sc.stop(); el.remove(); }, 500); }, 5000);
  }
  // Christmas Eve midnight: the bells toll.
  function midnightWatch() {
    setInterval(() => {
      const n = new Date();
      if (n.getMonth() === 11 && n.getDate() === 25 && n.getHours() === 0 && n.getMinutes() === 0 && n.getSeconds() < 3 && !sessionStorage.getItem('midnight')) {
        try { sessionStorage.setItem('midnight', '1'); } catch (e) { /* ignore */ }
        A().sfx.toll(); setTimeout(() => A().sfx.toll(), 2000); setTimeout(() => A().sfx.toll(), 4000);
        overlay('🔔 It\'s Christmas! Happy birthday, Jesus! 🔔', 'star'); award('midnight');
      }
    }, 1000);
  }
  document.addEventListener('keydown', keys);
  midnightWatch();

  // ---------- page ----------
  function render(into) {
    const c = child();
    const tile = (ic, title, desc, fn) => h('button', { class: 'fun-tile glass', type: 'button', onclick: () => { A().unlock(); A().sfx.click(); fn(); } }, h('span', { class: 'fun-ic', text: ic }), h('b', { text: title }), h('small', { class: 'muted', text: desc }));
    const host = h('section', { class: 'fun-page' },
      h('div', { class: 'page-head' }, h('h2', null, icon('star'), ' Fun & Games'), h('p', { class: 'muted', text: 'Things to do while you wait for Christmas, ' + c.name + '. There are secrets hidden all over this app. Can you find them all?' })),
      h('div', { class: 'fun-grid' },
        tile('⛄', 'Snowball Toss', '30 seconds. Hit the targets!', snowball),
        tile('🦌', 'Reindeer Quiz', 'Do you know your reindeer?', quiz),
        tile('📖', 'The Christmas Story', 'All the verses so far', story),
        tile('🔍', 'Nice List Scanner', 'Are you on the list?', () => AD.pages.santa.scanner()),
        tile('📹', 'North Pole Cams', 'Spy on the elves', () => AD.go('northpole'))));
    badges(host);
    host.appendChild(h('div', { class: 'card glass hints' }, h('h3', null, icon('info'), ' Secret hints'), h('ul', { class: 'plain small muted' },
      h('li', { text: 'Some words are magic. Try typing SNOW anywhere.' }),
      h('li', { text: 'Old video games had a famous secret code. Up, up…' }),
      h('li', { text: 'A hidden elf is on the calendar every day in December.' }),
      h('li', { text: 'The star at the top of the calendar likes to be tapped.' }),
      h('li', { text: 'Stay up for the bells at midnight on Christmas Eve (just kidding, go to sleep!).' }))));
    into.appendChild(host);
  }
  AD.fun = { award, overlay, blizzard, stampede, BADGES };
  AD.pages.fun = { render, leave() {} };
})();
