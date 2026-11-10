/* The hidden bit. Type /ghost in the word box, or enter the Konami code. */
import { h } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
function ghostSvg() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 150');
  svg.setAttribute('class', 'ghost');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); };
  add('path', { d: 'M20 70a40 40 0 0 1 80 0v62l-13-11-13 11-14-11-14 11-13-11-13 11z', fill: '#f2f2f2', opacity: '.93' });
  add('circle', { cx: '46', cy: '66', r: '6', fill: '#080808' });
  add('circle', { cx: '74', cy: '66', r: '6', fill: '#080808' });
  add('ellipse', { cx: '60', cy: '88', rx: '8', ry: '11', fill: '#080808' });
  add('rect', { x: '88', y: '84', width: '8', height: '34', rx: '4', fill: '#7d7d7d', transform: 'rotate(-28 92 100)' });
  add('circle', { cx: '82', cy: '82', r: '9', fill: '#dc2626' });
  return svg;
}

let showing = false;
export function ghost() {
  if (showing) return;
  showing = true;
  const eq = h('div', { class: 'eq' });
  for (let i = 0; i < 48; i++) {
    const bar = h('i');
    bar.style.animationDuration = (0.45 + ((i * 37) % 11) / 14).toFixed(2) + 's';
    bar.style.animationDelay = (-(i % 7) / 9).toFixed(2) + 's';
    eq.append(bar);
  }
  const el = h('div', { class: 'egg', role: 'dialog', 'aria-label': 'Ghost singer' }, ghostSvg(), h('p', null, 'The voice is artificial. The soul isn’t.'), eq);
  const done = () => { el.remove(); showing = false; document.removeEventListener('keydown', done); };
  el.addEventListener('click', done);
  document.addEventListener('keydown', done);
  document.body.append(el);
  setTimeout(done, 9500);
}

const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let pos = 0;
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') { pos = 0; return; }
  pos = e.key === CODE[pos] ? pos + 1 : (e.key === CODE[0] ? 1 : 0);
  if (pos === CODE.length) { pos = 0; setTimeout(ghost, 0); }
});
