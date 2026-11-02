const NS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}, kids = []) => {
  const e = document.createElementNS(NS, n);
  for (const [k, v] of Object.entries(a)) e.setAttribute(k, v);
  for (const c of [].concat(kids)) e.append(c);
  return e;
};
const txt = (x, y, s, a = {}) => el('text', { x, y, ...a }, [document.createTextNode(s)]);

function niceMax(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Grouped bars. data: [{label, values:[a,b]}], colors: css colours per series. */
export function barChart(data, { colors, short, label }) {
  const W = 640, H = 240, L = 54, B = 26, T = 10, R = 8;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => d.values)));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': label });
  for (let i = 0; i <= 4; i++) {
    const y = T + ((H - T - B) * i) / 4;
    svg.append(el('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'gl' }), txt(L - 8, y + 4, short(max * (1 - i / 4)), { 'text-anchor': 'end' }));
  }
  const slot = (W - L - R) / data.length;
  const n = data[0]?.values.length || 1;
  const bw = Math.min(22, (slot - 8) / n);
  data.forEach((d, i) => {
    const x0 = L + slot * i + (slot - bw * n - (n - 1) * 2) / 2;
    d.values.forEach((v, j) => {
      const hgt = Math.max(0, ((H - T - B) * Math.max(0, v)) / max);
      svg.append(el('rect', { x: x0 + j * (bw + 2), y: H - B - hgt, width: bw, height: hgt, rx: 3, style: `fill:${colors[j]}` }, [el('title', {}, [document.createTextNode(`${d.label}: ${short(v)}`)])]));
    });
    svg.append(txt(L + slot * i + slot / 2, H - 8, d.label, { 'text-anchor': 'middle' }));
  });
  return svg;
}

/** Single line with area. points: [{label, value}] */
export function lineChart(points, { color = 'var(--accent)', short, label }) {
  const W = 640, H = 230, L = 62, B = 26, T = 12, R = 12;
  const vals = points.map((p) => p.value);
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (hi === lo) hi = lo + 100;
  const span = niceMax(hi - lo);
  hi = lo + span;
  const X = (i) => L + ((W - L - R) * i) / Math.max(1, points.length - 1);
  const Y = (v) => T + ((H - T - B) * (hi - v)) / (hi - lo);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': label });
  for (let i = 0; i <= 4; i++) {
    const v = hi - ((hi - lo) * i) / 4;
    svg.append(el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'gl' }), txt(L - 8, Y(v) + 4, short(v), { 'text-anchor': 'end' }));
  }
  if (points.length > 1) {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.value).toFixed(1)}`).join('');
    svg.append(el('path', { d: `${d}L${X(points.length - 1)} ${Y(Math.max(lo, 0))}L${X(0)} ${Y(Math.max(lo, 0))}Z`, style: `fill:${color};opacity:.12` }));
    svg.append(el('path', { d, fill: 'none', 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', style: `stroke:${color}` }));
  }
  const step = Math.ceil(points.length / 7);
  points.forEach((p, i) => {
    svg.append(el('circle', { cx: X(i), cy: Y(p.value), r: 3, style: `fill:${color}` }, [el('title', {}, [document.createTextNode(`${p.label}: ${short(p.value)}`)])]));
    if (i % step === 0 || i === points.length - 1) svg.append(txt(X(i), H - 8, p.label, { 'text-anchor': 'middle' }));
  });
  return svg;
}
