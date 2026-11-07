// Shell: header, tabs, routing, theme, and one small secret.
(function () {
  'use strict';
  const { h, clear, icon, api, S } = LA;
  const TABS = [
    ['ask', 'Ask', 'chat'], ['files', 'Library', 'folder'], ['apps', 'Apps', 'grid'], ['doctor', 'Server', 'pulse'], ['settings', 'Settings', 'gear'],
  ];
  let view = null;
  let current = null;
  let tabEls = {};
  let providerChip = null;
  let healthChip = null;

  LA.setTheme = (t) => {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('la.theme', t); } catch (e) { /* ignore */ }
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', { liberty: '#070d1f', terminal: '#020a04', glass: '#1a1440', daylight: '#f4f6fb' }[t] || '#070d1f');
  };

  LA.refreshState = async () => {
    try { S.state = await api('GET', '/api/state'); paintChips(); } catch (e) { /* offline: keep the old one */ }
    return S.state;
  };
  LA.refreshChip = LA.refreshState;

  function paintChips() {
    const st = S.state;
    if (!st || !providerChip) return;
    const p = st.provider;
    clear(providerChip);
    providerChip.className = 'chip pill-btn ' + (p.cloud ? 'cloud' : 'local');
    providerChip.appendChild(icon(p.cloud ? 'cloud' : 'home'));
    providerChip.appendChild(h('span', { text: (st.demo ? 'Demo' : p.kind === 'anthropic' ? 'Claude' : p.kind === 'ollama' ? 'Ollama' : 'Server') + ' · ' + (p.cloud ? 'cloud' : 'local') }));
    providerChip.title = st.settings.localOnly ? 'Local-only mode is on' : 'Click to change the AI';
    if (tabEls.doctor) tabEls.doctor.hidden = !st.settings.doctorOn;
    healthChip.hidden = !st.settings.doctorOn;
    clear(healthChip);
    if (st.health) {
      const t = st.health.crit ? 'crit' : st.health.warn ? 'warn' : 'ok';
      healthChip.className = 'chip pill-btn ' + t;
      healthChip.appendChild(h('i', { class: 'dot ' + t }));
      healthChip.appendChild(h('span', { text: 'Health ' + st.health.score }));
    } else { healthChip.className = 'chip pill-btn'; healthChip.appendChild(h('span', { text: 'Checking…' })); }
  }

  LA.go = (page) => { if (location.hash !== '#' + page) location.hash = '#' + page; else route(); };

  function route() {
    const page = (location.hash || '#ask').slice(1);
    const name = LA.pages[page] ? page : 'ask';
    if (current && LA.pages[current] && LA.pages[current].leave) LA.pages[current].leave();
    current = name;
    for (const k of Object.keys(tabEls)) tabEls[k].classList.toggle('on', k === name);
    clear(view);
    LA.pages[name].render(view);
    window.scrollTo(0, 0);
  }

  function shell() {
    const app = document.getElementById('app');
    providerChip = h('button', { class: 'chip pill-btn', type: 'button', onclick: () => LA.go('settings') });
    healthChip = h('button', { class: 'chip pill-btn', type: 'button', onclick: () => LA.go('doctor') });
    let taps = [];
    const brand = h('button', { class: 'brand', type: 'button', title: 'Liberty AI', onclick: () => {
      const now = Date.now();
      taps = taps.filter((t) => now - t < 3000).concat(now);
      if (taps.length >= 7) { taps = []; LA.freedom(); } else LA.go('ask');
    } }, h('img', { src: '/icon.svg', alt: '' }), h('span', null, 'Liberty ', h('b', { text: 'AI' })));
    const nav = h('nav', { class: 'tabs', 'aria-label': 'Main' }, TABS.map(([id, label, ic]) => {
      const b = h('button', { class: 'tab', type: 'button', onclick: () => LA.go(id) }, icon(ic), h('span', { text: label }));
      tabEls[id] = b;
      return b;
    }));
    view = h('main', { id: 'view' });
    app.appendChild(h('header', { class: 'top glass' }, brand, nav, h('div', { class: 'chips' }, healthChip, providerChip)));
    app.appendChild(view);
  }

  // ---------- the secret: Konami code, 7 taps on the logo, or /freedom in the chat ----------
  let busy = false;
  LA.freedom = () => {
    if (busy) return;
    busy = true;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const over = h('div', { class: 'freedom', role: 'status' },
      icon('wifioff', 'big'),
      h('h1', { text: "FREEDOM DOESN'T NEED WI-FI" }),
      h('p', { text: 'Offline mode engaged. Everything you just asked, I answered from your own server.' }));
    document.body.appendChild(over);
    requestAnimationFrame(() => over.classList.add('show'));
    const cv = document.getElementById('fx');
    const done = () => { over.classList.remove('show'); setTimeout(() => { over.remove(); busy = false; const c = cv.getContext('2d'); c && c.clearRect(0, 0, cv.width, cv.height); cv.classList.remove('on'); }, 600); };
    if (reduce || !cv.getContext) { setTimeout(done, 3500); return; }
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    cv.classList.add('on');
    const ctx = cv.getContext('2d');
    const colors = ['#ff4b57', '#ffffff', '#4d8dff', '#ffcf5c'];
    const parts = [];
    const t0 = performance.now();
    let nextBurst = 0;
    function burst() {
      const x = cv.width * (0.15 + Math.random() * 0.7);
      const y = cv.height * (0.12 + Math.random() * 0.4);
      const col = colors[Math.floor(Math.random() * colors.length)];
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 1.2 + Math.random() * 4.2;
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, col });
      }
    }
    (function frame(t) {
      const el = t - t0;
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (el < 6000 && el >= nextBurst) { burst(); nextBurst = el + 380 + Math.random() * 380; }
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.055; p.vx *= 0.99; p.life -= 0.012;
        if (p.life <= 0) continue;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.col;
        ctx.fillRect(p.x, p.y, 3, 3);
      }
      ctx.globalAlpha = 1;
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
      if (el < 7000 || parts.length) requestAnimationFrame(frame); else done();
    })(t0);
    setTimeout(done, 9000);
  };

  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let ki = 0;
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    ki = e.key === KONAMI[ki] ? ki + 1 : e.key === KONAMI[0] ? 1 : 0;
    if (ki === KONAMI.length) { ki = 0; LA.freedom(); }
  });

  // ---------- boot ----------
  async function boot() {
    shell();
    await LA.refreshState();
    window.addEventListener('hashchange', route);
    route();
    setInterval(LA.refreshState, 60000);
    if (!S.state || !S.state.health) { let n = 0; const t = setInterval(async () => { await LA.refreshState(); if ((S.state && S.state.health) || ++n > 6) clearInterval(t); }, 4000); }
  }
  boot();
})();
