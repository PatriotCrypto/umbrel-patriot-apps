// The shell: header, child picker, tabs, sound and look controls, routing, first-run setup.
(function () {
  'use strict';
  const { h, clear, icon, api, toast, modal, S } = AD;
  const A = () => window.Audio2;
  const TABS = [['calendar', 'Calendar', 'calendar'], ['northpole', 'North Pole', 'cam'], ['santa', 'Santa', 'mail'], ['fun', 'Fun', 'star'], ['parent', 'Grown-ups', 'lock']];
  let view = null, current = null, tabEls = {}, kidBtn = null, soundBtn = null, starTaps = [];

  AD.refreshState = async () => {
    try { S.state = await api('GET', '/api/state'); } catch (e) { /* keep the old one */ }
    if (S.state) {
      document.documentElement.setAttribute('data-theme', S.state.settings.theme);
      A().setVolume(S.state.settings.volume);
      if (!S.state.children.find((c) => c.id === S.child)) S.child = (S.state.children[0] || {}).id;
      try { localStorage.setItem('advent.child', S.child || ''); } catch (e) { /* ignore */ }
    }
    return S.state;
  };
  AD.go = (page) => { if (location.hash !== '#' + page) location.hash = '#' + page; else route(); };

  function route() {
    if (!S.state || !S.state.setup) return;
    const page = (location.hash || '#calendar').slice(1);
    const name = AD.pages[page] ? page : 'calendar';
    if (current && AD.pages[current] && AD.pages[current].leave) AD.pages[current].leave();
    current = name;
    for (const k of Object.keys(tabEls)) tabEls[k].classList.toggle('on', k === name);
    clear(view);
    AD.pages[name].render(view);
    window.scrollTo(0, 0);
    paintKid();
  }

  function paintKid() {
    if (!kidBtn || !S.state) return;
    const c = S.state.children.find((x) => x.id === S.child);
    clear(kidBtn);
    kidBtn.appendChild(icon('users'));
    kidBtn.appendChild(h('span', { text: c ? c.name : 'Who are you?' }));
    kidBtn.hidden = S.state.children.length < 2;
  }
  function pickKid() {
    A().unlock(); A().sfx.click();
    let close;
    close = modal('Who is here?', h('div', { class: 'kids' }, S.state.children.map((c) => h('button', { class: 'kid-card' + (c.id === S.child ? ' on' : ''), type: 'button', onclick: () => { S.child = c.id; try { localStorage.setItem('advent.child', c.id); } catch (e) { /* ignore */ } A().sfx.chime(); close(); route(); } }, h('span', { class: 'big-emoji', text: ['🧒', '👧', '👦', '🧑', '👶', '🎅', '🧝', '⭐'][S.state.children.indexOf(c) % 8] }), h('b', { text: c.name })))));
  }
  function paintSound() {
    if (!soundBtn) return;
    clear(soundBtn);
    const on = S.state.settings.volume > 0;
    soundBtn.appendChild(icon(on ? 'sound' : 'mute'));
    soundBtn.title = on ? 'Sound is on. Tap for sound and look settings.' : 'Sound is off';
  }
  function lookDialog() {
    A().unlock();
    const s = S.state.settings;
    const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume), oninput: (e) => { A().setVolume(Number(e.target.value)); }, onchange: async (e) => { s.volume = Number(e.target.value); await api('PUT', '/api/look', { volume: s.volume }); paintSound(); A().sfx.jingle(3, 0.1); } });
    const sw = (label, val, fn) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: val, onchange: (e) => fn(e.target.checked) }), h('span', { class: 'sw' }), h('span', { text: label }));
    const body = h('div', { class: 'form' },
      h('label', null, 'Volume', vol),
      sw('Music plays when a door opens', s.music, async (v) => { s.music = v; await api('PUT', '/api/look', { music: v }); }),
      sw('Snow on the calendar', s.snow, async (v) => { s.snow = v; await api('PUT', '/api/look', { snow: v }); }),
      h('p', { class: 'small muted', text: 'Look' }),
      AD.themePicker(s.theme, async (t) => { s.theme = t; document.documentElement.setAttribute('data-theme', t); await api('PUT', '/api/look', { theme: t }); A().sfx.sparkle(); body.querySelectorAll('.theme-card').forEach((el) => el.classList.toggle('on', el.classList.contains('th-' + t))); }));
    modal('Sound & look', body, (close) => [h('button', { class: 'btn primary', type: 'button', onclick: close }, 'Done')]);
  }

  function shell() {
    const app = document.getElementById('app');
    clear(app);
    kidBtn = h('button', { class: 'chip', type: 'button', onclick: pickKid });
    soundBtn = h('button', { class: 'icon-btn', type: 'button', onclick: lookDialog });
    const brand = h('button', { class: 'brand', type: 'button', title: 'Advent', onclick: () => { A().unlock(); const now = Date.now(); starTaps = starTaps.filter((t) => now - t < 3000).concat(now); if (starTaps.length >= 5) { starTaps = []; A().sfx.twinkle(); AD.fun.overlay('⭐ The star shines for you! ⭐', 'star'); AD.fun.award('star7'); } else { A().sfx.sparkle(3, 0.03); AD.go('calendar'); } } }, h('span', { class: 'logo', text: '⭐' }), h('span', null, 'Advent'));
    const nav = h('nav', { class: 'tabs', 'aria-label': 'Main' }, TABS.map(([id, label, ic]) => { const b = h('button', { class: 'tab', type: 'button', onclick: () => { A().unlock(); A().sfx.click(); AD.go(id); } }, icon(ic), h('span', { text: label })); tabEls[id] = b; return b; }));
    view = h('main', { id: 'view' });
    app.appendChild(h('header', { class: 'top glass' }, brand, nav, h('div', { class: 'chips' }, kidBtn, soundBtn)));
    app.appendChild(view);
    paintKid(); paintSound();
  }

  // The first tap anywhere wakes the sound engine.
  function tapToStart() {
    const el = h('div', { class: 'tap-start' }, h('div', { class: 'tap-card glass' }, h('span', { class: 'big-emoji', text: '🔔' }), h('h2', { text: 'Tap to light the tree' }), h('p', { class: 'muted small', text: 'This turns on the music and sounds.' })));
    el.addEventListener('click', () => { A().unlock(); A().sfx.jingle(10, 0.1); el.classList.add('hide'); setTimeout(() => el.remove(), 500); }, { once: true });
    document.body.appendChild(el);
  }

  AD.boot = async function boot() {
    const app = document.getElementById('app');
    if (!S.state) await AD.refreshState();
    if (!S.state) { clear(app); app.appendChild(h('p', { class: 'center muted', text: 'Cannot reach the calendar. Is the app running?' })); return; }
    if (!S.state.setup) { clear(app); document.documentElement.setAttribute('data-theme', 'joy'); AD.setup(app); return; }
    try { S.child = localStorage.getItem('advent.child') || S.child; } catch (e) { /* ignore */ }
    if (!S.state.children.find((c) => c.id === S.child)) S.child = S.state.children[0].id;
    shell();
    if (!A().unlocked) tapToStart();
    route();
  };
  window.addEventListener('hashchange', route);
  setInterval(async () => { const before = S.state && S.state.day; await AD.refreshState(); if (S.state && S.state.day !== before && current === 'calendar') route(); }, 60000);
  AD.boot();
})();
