// Two hidden extras. Try typing /manna or /cw in the command bar (or the Konami code).
import { toast } from './ui.js';

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Exodus 16: it rained bread from heaven. */
export function manna() {
  toast('“It is manna: for they wist not what it was.” — Exodus 16:15');
  if (reduced()) return;
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const W = cv.width = innerWidth, H = cv.height = innerHeight;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--hi').trim() || '#fff';
  const flakes = Array.from({ length: 140 }, () => ({ x: Math.random() * W, y: -Math.random() * H, r: 1.5 + Math.random() * 3.5, v: 0.8 + Math.random() * 2.2, d: Math.random() * 6.28 }));
  const t0 = performance.now();
  (function frame(t) {
    const age = t - t0;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = color;
    ctx.globalAlpha = Math.max(0, Math.min(0.85, (7500 - age) / 1500));
    for (const f of flakes) {
      f.y += f.v; f.d += 0.03; f.x += Math.sin(f.d) * 0.6;
      if (f.y > H + 10) { f.y = -10; f.x = Math.random() * W; }
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill();
    }
    if (age < 7500) requestAnimationFrame(frame); else cv.remove();
  })(t0);
}

const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..' };

/** "GOD IS LOVE" (1 John 4:8) in Morse, as light and sound. */
export function cw(text = 'GOD IS LOVE') {
  const words = text.toUpperCase().split(' ');
  const panel = document.createElement('div');
  panel.setAttribute('role', 'status');
  panel.style.cssText = 'position:fixed;left:50%;top:5rem;transform:translateX(-50%);background:var(--panel);border:1px solid var(--accent);border-radius:4px;padding:.8rem 1.2rem;z-index:9;text-align:center;max-width:92vw';
  panel.innerHTML = `<div class="muted" style="font-size:.8em">1 John 4:8</div><div id="cwtxt" style="font-size:1.4em;letter-spacing:.3em;min-height:1.6em">&nbsp;</div><div id="cwlamp" style="font-size:2em;opacity:.2;color:var(--hi)">●</div>`;
  document.body.appendChild(panel);
  const out = panel.querySelector('#cwtxt'), lamp = panel.querySelector('#cwlamp');
  let ac = null;
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* silent is fine */ }
  const dit = 0.075; // about 16 words per minute
  let t = (ac ? ac.currentTime : 0) + 0.2;
  const events = []; // [startSec, lenSec, char]
  let shown = '';
  words.forEach((w, wi) => {
    [...w].forEach(ch => {
      for (const s of MORSE[ch] || '') { events.push([t, s === '.' ? dit : dit * 3]); t += (s === '.' ? dit : dit * 3) + dit; }
      events.push([t, 0, ch]); t += dit * 2;
    });
    if (wi < words.length - 1) { events.push([t, 0, ' ']); t += dit * 4; }
  });
  const start = performance.now() + 200;
  if (ac) {
    for (const [s, len] of events) {
      if (!len) continue;
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 620; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.12, s + 0.005); g.gain.setValueAtTime(0.12, s + len - 0.005); g.gain.linearRampToValueAtTime(0, s + len);
      o.start(s); o.stop(s + len + 0.01);
    }
  }
  const t00 = ac ? ac.currentTime : 0;
  for (const [s, len, ch] of events) {
    const at = (s - (ac ? t00 : 0)) * 1000 + 200;
    if (len) { setTimeout(() => { lamp.style.opacity = '1'; }, at); setTimeout(() => { lamp.style.opacity = '.2'; }, at + len * 1000); }
    else setTimeout(() => { shown += ch; out.textContent = shown; }, at);
  }
  void start;
  setTimeout(() => { panel.remove(); if (ac) ac.close().catch(() => {}); }, (t - (ac ? t00 : 0)) * 1000 + 2500);
}

/** Konami code anywhere on the page. */
export function watchKonami(fn) {
  const seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let i = 0;
  document.addEventListener('keydown', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    i = k === seq[i] ? i + 1 : (k === seq[0] ? 1 : 0);
    if (i === seq.length) { i = 0; fn(); }
  });
}
