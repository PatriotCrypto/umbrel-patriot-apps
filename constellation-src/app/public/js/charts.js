// Small dependency-free SVG charts. Colours come from CSS classes, so every theme works.
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function s(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function niceStep(range, ticks) {
    const raw = range / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  }

  function timeLabel(ms, span) {
    const d = new Date(ms);
    if (span <= 36 * 3600e3) return d.toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '').toLowerCase();
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function makeTip(container) {
    let tip = container.querySelector(':scope > .ch-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'ch-tip';
      container.appendChild(tip);
    }
    tip.style.display = 'none';
    return tip;
  }

  function showTip(tip, container, clientX, clientY, lines) {
    tip.textContent = '';
    lines.forEach((l, i) => {
      const d = document.createElement('div');
      if (i === 0) d.className = 'ch-tip-h';
      d.textContent = l;
      tip.appendChild(d);
    });
    tip.style.display = 'block';
    const r = container.getBoundingClientRect();
    let x = clientX - r.left + 14;
    if (x + tip.offsetWidth > r.width - 4) x = clientX - r.left - tip.offsetWidth - 14;
    tip.style.left = Math.max(4, x) + 'px';
    tip.style.top = Math.max(4, clientY - r.top - 12 - tip.offsetHeight / 2) + 'px';
  }

  // ---- line / area chart ----
  // o: { from, to, series:[{pts:[[t,v|null]], cls}], band:[[t,min,max]], yMin, yMax, unit, decimals, height, tip(t)->lines }
  function line(container, o) {
    container.textContent = '';
    container.classList.add('ch-wrap');
    const w = Math.max(260, container.clientWidth || 600);
    const h = o.height || 190;
    const m = { l: 38, r: 10, t: 10, b: 22 };
    const svg = s('svg', { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, class: 'ch', role: 'img', 'aria-label': o.label || 'chart' }, container);
    const span = o.to - o.from;
    const x = (t) => m.l + ((t - o.from) / span) * (w - m.l - m.r);

    let vmax = 0;
    for (const se of o.series) for (const p of se.pts) if (p[1] !== null && p[1] > vmax) vmax = p[1];
    if (o.band) for (const b of o.band) if (b[2] !== null && b[2] > vmax) vmax = b[2];
    const ymin = o.yMin !== undefined ? o.yMin : 0;
    const step = niceStep(Math.max(o.yMax !== undefined ? o.yMax : vmax * 1.1, 1) - ymin, 4);
    const ymax = o.yMax !== undefined ? o.yMax : Math.ceil((vmax * 1.08) / step) * step || step;
    const y = (v) => h - m.b - ((v - ymin) / (ymax - ymin || 1)) * (h - m.t - m.b);

    for (let v = ymin; v <= ymax + 1e-9; v += step) {
      s('line', { x1: m.l, x2: w - m.r, y1: y(v), y2: y(v), class: 'grid' }, svg);
      const tx = s('text', { x: m.l - 6, y: y(v) + 3, 'text-anchor': 'end' }, svg);
      tx.textContent = (Math.round(v * 10) / 10) + '';
    }
    const ticks = Math.max(3, Math.min(7, Math.floor((w - m.l) / 90)));
    for (let i = 0; i <= ticks; i++) {
      const t = o.from + (span * i) / ticks;
      const tx = s('text', { x: x(t), y: h - 6, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' }, svg);
      tx.textContent = timeLabel(t, span);
    }

    if (o.band && o.band.length > 1) {
      let up = '';
      let dn = '';
      const ok = o.band.filter((b) => b[1] !== null && b[2] !== null);
      ok.forEach((b, i) => { up += (i ? 'L' : 'M') + x(b[0]).toFixed(1) + ' ' + y(b[2]).toFixed(1); });
      for (let i = ok.length - 1; i >= 0; i--) dn += 'L' + x(ok[i][0]).toFixed(1) + ' ' + y(ok[i][1]).toFixed(1);
      if (ok.length > 1) s('path', { d: up + dn + 'Z', class: 'band' }, svg);
    }

    o.series.forEach((se) => {
      let d = '';
      let pen = false;
      let firstX = null;
      let lastX = null;
      for (const p of se.pts) {
        if (p[1] === null) { pen = false; continue; }
        const px = x(p[0]).toFixed(1);
        d += (pen ? 'L' : 'M') + px + ' ' + y(p[1]).toFixed(1);
        if (firstX === null) firstX = px;
        lastX = px;
        pen = true;
      }
      if (!d) return;
      if (se.area && firstX !== null) s('path', { d: d + 'L' + lastX + ' ' + y(ymin) + 'L' + firstX + ' ' + y(ymin) + 'Z', class: 'ar' }, svg);
      s('path', { d, class: 'ln ' + (se.cls || '') }, svg);
    });

    const guide = s('line', { y1: m.t, y2: h - m.b, class: 'guide', visibility: 'hidden' }, svg);
    const dot = s('circle', { r: 3.5, class: 'dot', visibility: 'hidden' }, svg);
    const tip = makeTip(container);
    const pts = o.series[0] ? o.series[0].pts.filter((p) => p[1] !== null) : [];
    svg.addEventListener('pointermove', (e) => {
      if (!pts.length) return;
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) * w) / r.width;
      const t = o.from + ((px - m.l) / (w - m.l - m.r)) * span;
      let best = pts[0];
      for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
      guide.setAttribute('x1', x(best[0])); guide.setAttribute('x2', x(best[0]));
      guide.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(best[0])); dot.setAttribute('cy', y(best[1]));
      dot.setAttribute('visibility', 'visible');
      const lines = o.tip ? o.tip(best[0], best[1]) : [new Date(best[0]).toLocaleString(), best[1] + (o.unit || '')];
      showTip(tip, container, e.clientX, e.clientY, lines);
    });
    svg.addEventListener('pointerleave', () => {
      guide.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      tip.style.display = 'none';
    });
    if (!o.series.some((se) => se.pts.some((p) => p[1] !== null))) {
      const tx = s('text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', class: 'empty' }, svg);
      tx.textContent = 'Collecting data...';
    }
  }

  // ---- presence timeline ----
  // o: { from, to, watch:[[s,e]], rows:[{label, sessions:[[s,e]], pct, online}] }
  function timeline(container, o) {
    container.textContent = '';
    container.classList.add('ch-wrap');
    const w = Math.max(300, container.clientWidth || 600);
    const rowH = 15;
    const gap = 7;
    const top = 4;
    const labelW = Math.min(170, Math.round(w * 0.3));
    const h = top + o.rows.length * (rowH + gap) + 24;
    const svg = s('svg', { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, class: 'ch', role: 'img', 'aria-label': 'Device presence timeline' }, container);
    const span = o.to - o.from;
    const x = (t) => labelW + ((t - o.from) / span) * (w - labelW - 8);
    const tip = makeTip(container);
    const maxChars = Math.floor((labelW - 12) / 6.2);

    const ticks = Math.max(3, Math.min(7, Math.floor((w - labelW) / 90)));
    for (let i = 0; i <= ticks; i++) {
      const t = o.from + (span * i) / ticks;
      s('line', { x1: x(t), x2: x(t), y1: 0, y2: h - 22, class: 'grid' }, svg);
      const tx = s('text', { x: x(t), y: h - 6, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' }, svg);
      tx.textContent = timeLabel(t, span);
    }

    o.rows.forEach((r, i) => {
      const yy = top + i * (rowH + gap);
      const g = s('g', { class: 'tl-row' }, svg);
      s('rect', { x: 0, y: yy - 3, width: w, height: rowH + 6, class: 'tl-hit' }, g);
      const lab = s('text', { x: 0, y: yy + rowH - 4, class: 'tl-label' + (r.online ? '' : ' off') }, g);
      lab.textContent = r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + '...' : r.label;
      for (const [a, b] of o.watch) {
        const x1 = x(Math.max(a, o.from));
        const x2 = x(Math.min(b, o.to));
        if (x2 > x1) s('rect', { x: x1, y: yy, width: x2 - x1, height: rowH, rx: 2, class: 'tl-track' }, g);
      }
      for (const [a, b] of r.sessions) {
        const x1 = x(Math.max(a, o.from));
        const x2 = x(Math.min(b, o.to));
        s('rect', { x: x1, y: yy, width: Math.max(1.5, x2 - x1), height: rowH, rx: 2, class: 'tl-on' }, g);
      }
      g.addEventListener('pointermove', (e) => {
        showTip(tip, container, e.clientX, e.clientY, [r.label, r.pct === null ? 'No data yet' : Math.round(r.pct * 100) + '% online' + (r.online ? ' (now)' : '')]);
      });
      g.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
      if (o.onRow) g.addEventListener('click', () => o.onRow(r));
    });
  }

  // ---- horizontal bars ----
  // o: { rows:[{label, value 0..1, text}] }
  function bars(container, o) {
    container.textContent = '';
    container.classList.add('ch-wrap');
    const w = Math.max(260, container.clientWidth || 600);
    const rowH = 22;
    const labelW = Math.min(170, Math.round(w * 0.34));
    const textW = 92;
    const h = o.rows.length * rowH + 6;
    const svg = s('svg', { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, class: 'ch', role: 'img', 'aria-label': 'Time online by device' }, container);
    const maxChars = Math.floor((labelW - 8) / 6.2);
    o.rows.forEach((r, i) => {
      const yy = 3 + i * rowH;
      const lab = s('text', { x: 0, y: yy + 12, class: 'tl-label' + (r.off ? ' off' : '') }, svg);
      lab.textContent = r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + '...' : r.label;
      const bw = w - labelW - textW;
      s('rect', { x: labelW, y: yy + 3, width: bw, height: 8, rx: 2, class: 'tl-track' }, svg);
      s('rect', { x: labelW, y: yy + 3, width: Math.max(1.5, bw * Math.max(0, Math.min(1, r.value || 0))), height: 8, rx: 2, class: 'tl-on' }, svg);
      const t = s('text', { x: w, y: yy + 12, 'text-anchor': 'end' }, svg);
      t.textContent = r.text;
    });
  }

  // ---- compact presence strip (for the device drawer) ----
  function strip(container, o) {
    container.textContent = '';
    const w = Math.max(200, container.clientWidth || 320);
    const h = 30;
    const svg = s('svg', { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, class: 'ch', role: 'img', 'aria-label': 'Last 24 hours' }, container);
    const span = o.to - o.from;
    const x = (t) => 1 + ((t - o.from) / span) * (w - 2);
    for (const [a, b] of o.watch) {
      const x1 = x(Math.max(a, o.from));
      const x2 = x(Math.min(b, o.to));
      if (x2 > x1) s('rect', { x: x1, y: 3, width: x2 - x1, height: 14, rx: 2, class: 'tl-track' }, svg);
    }
    for (const [a, b] of o.sessions) {
      const x1 = x(Math.max(a, o.from));
      const x2 = x(Math.min(b, o.to));
      s('rect', { x: x1, y: 3, width: Math.max(1.5, x2 - x1), height: 14, rx: 2, class: 'tl-on' }, svg);
    }
    const l = s('text', { x: 0, y: 28 }, svg); l.textContent = '24h ago';
    const r = s('text', { x: w, y: 28, 'text-anchor': 'end' }, svg); r.textContent = 'now';
  }

  window.CSCharts = { line, timeline, bars, strip };
})();
