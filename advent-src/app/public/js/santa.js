// Santa's Letter Desk: chat with Santa, keep a wish list, and the Nice List Scanner.
(function () {
  'use strict';
  const { h, clear, icon, api, toast, S } = AD;
  const A = () => window.Audio2;
  let host = null, thread = null, listEl = null, input = null, busy = false;

  function child() { return S.state.children.find((c) => c.id === S.child) || S.state.children[0]; }

  function bubble(from, text) {
    return h('div', { class: 'msg ' + from }, from === 'santa' ? h('span', { class: 'avatar', text: '🎅' }) : null, h('div', { class: 'bub', text }));
  }
  function scroll() { if (thread) thread.scrollTop = thread.scrollHeight; }

  async function load() {
    try {
      const r = await api('GET', '/api/santa?child=' + child().id);
      if (!thread) return;
      clear(thread);
      if (!r.letters.length) thread.appendChild(bubble('santa', 'Ho ho ho! Hello, ' + child().name + '! This is Santa, writing from the North Pole. You can tell me what you are hoping for this Christmas, ask me a question, or just say hello. What is on your mind?'));
      for (const l of r.letters) thread.appendChild(bubble(l.from, l.text));
      paintWishes(r.wishes);
      scroll();
    } catch (e) { toast(e.message, 'warn'); }
  }
  function paintWishes(w) {
    if (!listEl) return;
    clear(listEl);
    if (!w.length) { listEl.appendChild(h('li', { class: 'muted', text: 'Nothing yet. Tell Santa "I would like..." and it goes on the list.' })); return; }
    for (const item of w) listEl.appendChild(h('li', null, h('span', { text: '🎁 ' + item.text }), h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Remove', onclick: async () => { const r = await api('POST', '/api/wish/remove', { child: child().id, text: item.text }); paintWishes(r.wishes); A().sfx.click(); } }, icon('x'))));
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true; A().unlock(); A().sfx.swoosh();
    input.value = '';
    thread.appendChild(bubble('child', text));
    const typing = h('div', { class: 'msg santa typing' }, h('span', { class: 'avatar', text: '🎅' }), h('div', { class: 'bub' }, h('i'), h('i'), h('i')));
    thread.appendChild(typing); scroll();
    try {
      const r = await api('POST', '/api/santa', { child: child().id, text });
      await new Promise((res) => setTimeout(res, 900 + Math.min(1800, r.reply.length * 12)));
      typing.remove();
      thread.appendChild(bubble('santa', r.reply));
      if (/ho ho ho/i.test(r.reply)) A().sfx.hohoho(); else A().sfx.chime();
      if (r.wish) { A().sfx.sparkle(8, 0.05); paintWishes(r.wishes); AD.fun && AD.fun.award('wish', null); }
      scroll();
    } catch (e) { typing.remove(); toast(e.message, 'warn'); }
    busy = false;
  }

  // ---------- the Nice List Scanner ----------
  function scanner() {
    A().unlock();
    const c = child();
    const canvas = h('canvas', { class: 'scan-canvas' });
    const status = h('p', { class: 'scan-status', text: 'Place your hand on the scanner…' });
    const body = h('div', { class: 'scanner' }, canvas, status);
    let result = null, phase = 0, t0 = null;
    const D = window.Draw;
    const sc = new D.Scene(canvas, (ctx, W, H, t, dt) => {
      ctx.fillStyle = '#031a0a'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(61,220,151,.25)'; for (let y = 0; y < H; y += 14) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      if (phase === 0) { ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.strokeRect(W * 0.25, H * 0.15, W * 0.5, H * 0.7); ctx.setLineDash([]); ctx.font = '700 ' + Math.min(80, W * 0.2) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 0.6 + Math.sin(t * 3) * 0.3; ctx.fillStyle = '#3ddc97'; ctx.fillText('🖐️', W / 2, H / 2); ctx.globalAlpha = 1; }
      if (phase === 1) {
        const e = t - t0; const y = H * (0.15 + ((e * 0.5) % 1) * 0.7);
        ctx.fillStyle = 'rgba(61,220,151,.25)'; ctx.fillRect(W * 0.25, y - 20, W * 0.5, 40); ctx.fillStyle = '#9fffc8'; ctx.fillRect(W * 0.25, y, W * 0.5, 2);
        ctx.font = '700 ' + Math.min(80, W * 0.2) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#3ddc97'; ctx.fillText('🖐️', W / 2, H / 2);
        ctx.font = '700 12px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#c8ffd0'; ctx.fillText('SCANNING ' + c.name.toUpperCase() + '… ' + Math.min(100, Math.floor(e * 25)) + '%', 10, 20);
        if (Math.floor(e * 8) !== sc.lastBeep) { sc.lastBeep = Math.floor(e * 8); A().sfx.beep(); }
        if (e > 4) { phase = 2; t0 = t; if (result === 'naughty') A().sfx.naughty(); else { A().sfx.nice(); A().sfx.hohoho(); } }
      }
      if (phase === 2) {
        const nice = result !== 'naughty'; const e = t - t0;
        ctx.fillStyle = nice ? 'rgba(61,220,151,.15)' : 'rgba(255,77,88,.15)'; ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        D.glowText(ctx, nice ? 'NICE LIST' : 'NAUGHTY LIST', W / 2, H * 0.4, Math.min(52, W / 7), nice ? '#9fffc8' : '#ff8a93');
        ctx.font = '600 15px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText(nice ? c.name + ', you are on the Nice list! ⭐' : c.name + ', hmm… you are on the Naughty list today.', W / 2, H * 0.6);
        ctx.font = '500 13px system-ui'; ctx.fillStyle = '#cfe'; ctx.fillText(nice ? 'Keep being kind and helpful!' : 'Kind words and helping hands move names fast. Try again tomorrow!', W / 2, H * 0.72);
        if (nice && Math.random() < 0.2) { sc.sparks = sc.sparks || new D.Sparks(); sc.sparks.burst(Math.random() * W, Math.random() * H * 0.5, 4, ['#9fffc8', '#ffd36b', '#fff'], 60, 1.2); }
        if (sc.sparks) sc.sparks.draw(ctx, dt);
      }
    }, { onClick: async () => { if (phase !== 0) return; phase = 1; t0 = sc.t; status.textContent = 'Hold still…'; A().sfx.scan(12); try { const r = await api('GET', '/api/list?child=' + c.id); result = r.status; } catch (e) { result = 'nice'; } setTimeout(() => { status.textContent = result === 'naughty' ? 'Santa is still watching. There is time to turn it around!' : 'Santa says: well done!'; }, 4200); } });
    sc.start();
    AD.modal('Nice List Scanner', body, (close) => [h('button', { class: 'btn', type: 'button', onclick: close }, 'Close')], { onClose: () => sc.stop(), cls: 'wide' });
    AD.fun && AD.fun.award('scanner', null);
  }

  function render(into) {
    const c = child();
    thread = h('div', { class: 'thread' });
    listEl = h('ul', { class: 'wishes' });
    input = h('input', { class: 'input', placeholder: 'Dear Santa…', maxlength: '400', onkeydown: (e) => { if (e.key === 'Enter') send(); } });
    host = h('section', { class: 'santa-page' },
      h('div', { class: 'page-head' }, h('h2', null, icon('mail'), " Santa's Letter Desk"), h('p', { class: 'muted', text: 'Write to Santa. He writes back from the North Pole. Tell him what you are hoping for, and it goes on your list.' })),
      h('div', { class: 'santa-grid' },
        h('div', { class: 'chat glass' }, thread, h('div', { class: 'composer' }, input, h('button', { class: 'btn primary', type: 'button', onclick: send }, icon('mail'), 'Send'))),
        h('aside', { class: 'side-col' },
          h('div', { class: 'card glass' }, h('h3', null, icon('gift'), ' ' + c.name + "'s Christmas List"), listEl,
            h('div', { class: 'row' }, h('input', { class: 'input', id: 'wishq', placeholder: 'Add a wish by hand', maxlength: '80', onkeydown: async (e) => { if (e.key === 'Enter') { const r = await api('POST', '/api/wish', { child: c.id, text: e.target.value }); e.target.value = ''; paintWishes(r.wishes); A().sfx.sparkle(); } } }))),
          h('div', { class: 'card glass' }, h('h3', null, icon('eye'), ' Nice List Scanner'), h('p', { class: 'muted small', text: 'Find out if you are on the Nice list today. Santa checks it twice!' }), h('button', { class: 'btn primary block', type: 'button', onclick: scanner }, icon('eye'), 'Scan me')),
          h('div', { class: 'card glass' }, h('h3', null, icon('info'), ' Try asking'), h('ul', { class: 'plain small' }, ['Am I on the nice list?', 'How are the reindeer?', 'Tell me a joke', 'What is Christmas really about?', 'I would like a red bicycle'].map((q) => h('li', null, h('button', { class: 'link', type: 'button', text: q, onclick: () => { input.value = q; send(); } }))))))));
    into.appendChild(host);
    load();
  }
  AD.pages.santa = { render, leave() { host = thread = listEl = input = null; }, scanner };
})();
