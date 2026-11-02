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

/* ---------- Insights charts ---------- */
export const PALETTE = ['#2f9e6b', '#3b82c4', '#e0953a', '#9b59b6', '#d6504a', '#17a2b8', '#7aa33a', '#c2569b', '#5c6bc0', '#a1887f', '#26a69a', '#c9a227'];
export const colorFor = (i) => PALETTE[i % PALETTE.length];

/** Donut. slices: [{label, value, color}] */
export function pieChart(slices, { fmt, label }) {
  const S = 220, R = 100, r = 58, c = S / 2;
  const total = slices.reduce((n, x) => n + x.value, 0);
  const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, class: 'chart pie', role: 'img', 'aria-label': label });
  if (!total) {
    svg.append(el('circle', { cx: c, cy: c, r: (R + r) / 2, fill: 'none', 'stroke-width': R - r, style: 'stroke:var(--surface2)' }));
    return svg;
  }
  let a0 = -Math.PI / 2;
  for (const s of slices) {
    if (s.value <= 0) continue;
    const frac = s.value / total;
    const a1 = a0 + Math.min(frac, 0.99999) * 2 * Math.PI;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const P = (rad, a) => `${(c + rad * Math.cos(a)).toFixed(2)} ${(c + rad * Math.sin(a)).toFixed(2)}`;
    const d = `M${P(R, a0)}A${R} ${R} 0 ${big} 1 ${P(R, a1)}L${P(r, a1)}A${r} ${r} 0 ${big} 0 ${P(r, a0)}Z`;
    svg.append(el('path', { d, style: `fill:${s.color}`, stroke: 'var(--surface)', 'stroke-width': 1.5 }, [el('title', {}, [document.createTextNode(`${s.label}: ${fmt(s.value)} (${Math.round(frac * 100)}%)`)])]));
    a0 = a1;
  }
  return svg;
}

function axes(svg, { W, H, L, T, R, B }, max, short) {
  for (let i = 0; i <= 4; i++) {
    const y = T + ((H - T - B) * i) / 4;
    svg.append(el('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'gl' }), txt(L - 8, y + 4, short(max * (1 - i / 4)), { 'text-anchor': 'end' }));
  }
}

/** Stacked monthly bars with an optional dotted average line. series: [{name,color,values}] */
export function stackedBars(labels, series, { short, label, avg = null }) {
  const g = { W: 640, H: 250, L: 58, T: 14, R: 10, B: 26 };
  const totals = labels.map((_, i) => series.reduce((n, s) => n + Math.max(0, s.values[i] || 0), 0));
  const max = niceMax(Math.max(1, avg || 0, ...totals));
  const svg = el('svg', { viewBox: `0 0 ${g.W} ${g.H}`, class: 'chart', role: 'img', 'aria-label': label });
  axes(svg, g, max, short);
  const slot = (g.W - g.L - g.R) / labels.length;
  const bw = Math.min(34, slot - 8);
  const Y = (v) => g.T + ((g.H - g.T - g.B) * (max - v)) / max;
  labels.forEach((lb, i) => {
    let acc = 0;
    const x = g.L + slot * i + (slot - bw) / 2;
    for (const s of series) {
      const v = Math.max(0, s.values[i] || 0);
      if (!v) continue;
      svg.append(el('rect', { x, y: Y(acc + v), width: bw, height: Math.max(1, Y(acc) - Y(acc + v)), style: `fill:${s.color}` }, [el('title', {}, [document.createTextNode(`${lb} · ${s.name}: ${short(v)}`)])]));
      acc += v;
    }
    svg.append(txt(x + bw / 2, g.H - 8, lb, { 'text-anchor': 'middle' }));
  });
  if (avg) {
    svg.append(el('line', { x1: g.L, x2: g.W - g.R, y1: Y(avg), y2: Y(avg), 'stroke-width': 2, 'stroke-dasharray': '2 4', 'stroke-linecap': 'round', style: 'stroke:#e0b72f' }));
    svg.append(el('rect', { x: g.L + 4, y: Y(avg) - 10, width: 86, height: 18, rx: 9, style: 'fill:#f6d55c' }), txt(g.L + 47, Y(avg) + 3, `${short(avg)} avg`, { 'text-anchor': 'middle', style: 'fill:#4a3b00;font-weight:600' }));
  }
  return svg;
}

/** Several lines on one scale, with an optional dotted average. series: [{name,color,values}] */
export function multiLine(labels, series, { short, label, avg = null }) {
  const g = { W: 640, H: 240, L: 58, T: 14, R: 14, B: 26 };
  const max = niceMax(Math.max(1, avg || 0, ...series.flatMap((s) => s.values.map((v) => Math.max(0, v)))));
  const svg = el('svg', { viewBox: `0 0 ${g.W} ${g.H}`, class: 'chart', role: 'img', 'aria-label': label });
  axes(svg, g, max, short);
  const X = (i) => g.L + ((g.W - g.L - g.R) * i) / Math.max(1, labels.length - 1);
  const Y = (v) => g.T + ((g.H - g.T - g.B) * (max - Math.max(0, v))) / max;
  if (avg) svg.append(el('line', { x1: g.L, x2: g.W - g.R, y1: Y(avg), y2: Y(avg), 'stroke-width': 2, 'stroke-dasharray': '2 4', 'stroke-linecap': 'round', style: 'stroke:#e0b72f' }));
  for (const s of series) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
    svg.append(el('path', { d, fill: 'none', 'stroke-width': 2.4, 'stroke-linejoin': 'round', style: `stroke:${s.color}` }));
    s.values.forEach((v, i) => svg.append(el('circle', { cx: X(i), cy: Y(v), r: 3, style: `fill:${s.color}` }, [el('title', {}, [document.createTextNode(`${labels[i]} · ${s.name}: ${short(v)}`)])])));
  }
  const step = Math.ceil(labels.length / 12);
  labels.forEach((lb, i) => (i % step === 0 || i === labels.length - 1) && svg.append(txt(X(i), g.H - 8, lb, { 'text-anchor': 'middle' })));
  return svg;
}
