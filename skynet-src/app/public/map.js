'use strict';
// Small self-contained map: canvas, pan/zoom, radar-style HUD, optional OpenStreetMap tiles.
// With tiles off it draws a grid and range rings, so it works fully offline.
(function () {
  const TILE = 256;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wx = (lon, z) => (lon + 180) / 360 * TILE * Math.pow(2, z);
  const wy = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * Math.pow(2, z); };
  const lonOf = (x, z) => x / (TILE * Math.pow(2, z)) * 360 - 180;
  const latOf = (y, z) => { const n = Math.PI - 2 * Math.PI * y / (TILE * Math.pow(2, z)); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hex2rgba = (c, a) => {
    c = c.trim();
    if (c[0] === '#') { if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]; const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
    return c;
  };

  class MapView {
    constructor(canvas, onPick) {
      this.c = canvas; this.ctx = canvas.getContext('2d'); this.onPick = onPick;
      this.center = { lat: 39.5, lon: -98.35 }; this.z = 12;
      this.data = { nodes: [], trails: {}, coverage: [], me: null, home: null, showTrails: true, showCov: true, tiles: false, selected: null };
      this.cache = new Map(); this.hits = []; this.fitted = false; this.last = 0;
      this._events();
      new ResizeObserver(() => this.draw()).observe(canvas);
      if (!still) requestAnimationFrame((t) => this._loop(t));
    }
    _loop(t) {
      if (!document.body.contains(this.c)) return; // view changed: stop quietly
      if (!document.hidden && t - this.last > 45) { this.last = t; this.draw(); }
      requestAnimationFrame((x) => this._loop(x));
    }
    css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
    _blips(list) {
      const seen = this.seen || (this.seen = new Set()), first = !this.primed;
      this.primed = true; this.blips = this.blips || [];
      for (const a of list) {
        const k = a.ts + '-' + a.id;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!first && !still) this.blips.push({ from: a.from, to: a.to, dir: a.dir, t: performance.now() });
      }
      if (seen.size > 400) { seen.clear(); for (const a of list) seen.add(a.ts + '-' + a.id); }
    }
    set(data) {
      if (data.activity) this._blips(data.activity);
      Object.assign(this.data, data);
      if (!this.fitted) this.fit();
      this.draw();
    }
    points() {
      const p = [];
      for (const n of this.data.nodes) if (typeof n.lat === 'number') p.push(n);
      if (this.data.home && typeof this.data.home.lat === 'number') p.push(this.data.home);
      return p;
    }
    fit() {
      const p = this.points();
      if (!p.length) return;
      this.fitted = true;
      const w = this.c.clientWidth || 600, h = this.c.clientHeight || 360;
      const la = p.map((x) => x.lat), lo = p.map((x) => x.lon);
      const minLa = Math.min(...la), maxLa = Math.max(...la), minLo = Math.min(...lo), maxLo = Math.max(...lo);
      this.center = { lat: (minLa + maxLa) / 2, lon: (minLo + maxLo) / 2 };
      let z = 17;
      for (; z > 2; z -= 0.25) {
        const dx = Math.abs(wx(maxLo, z) - wx(minLo, z)), dy = Math.abs(wy(minLa, z) - wy(maxLa, z));
        if (dx < w * 0.7 && dy < h * 0.7) break;
      }
      this.z = clamp(z, 3, 17);
    }
    focus(n) { if (n && typeof n.lat === 'number') { this.center = { lat: n.lat, lon: n.lon }; this.draw(); } }
    zoom(dz, px, py) {
      const w = this.c.clientWidth, h = this.c.clientHeight;
      px = px ?? w / 2; py = py ?? h / 2;
      const cx = wx(this.center.lon, this.z), cy = wy(this.center.lat, this.z);
      const lon = lonOf(cx + (px - w / 2), this.z), lat = latOf(cy + (py - h / 2), this.z);
      this.z = clamp(this.z + dz, 2, 18);
      const nx = wx(lon, this.z) - (px - w / 2), ny = wy(lat, this.z) - (py - h / 2);
      this.center = { lat: clamp(latOf(ny, this.z), -85, 85), lon: lonOf(nx, this.z) };
      this.draw();
    }
    _events() {
      const c = this.c; let drag = null, moved = 0;
      c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; moved = 0; c.setPointerCapture(e.pointerId); });
      c.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; moved += Math.abs(dx) + Math.abs(dy);
        const cx = wx(this.center.lon, this.z) - dx, cy = wy(this.center.lat, this.z) - dy;
        this.center = { lat: clamp(latOf(cy, this.z), -85, 85), lon: lonOf(cx, this.z) }; this.draw();
      });
      c.addEventListener('pointerup', (e) => {
        if (drag && moved < 5) { // a tap: pick the nearest node
          const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
          let best = null, bd = 28;
          for (const h of this.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.id; } }
          if (best && this.onPick) this.onPick(best);
        }
        drag = null;
      });
      c.addEventListener('wheel', (e) => { e.preventDefault(); const r = c.getBoundingClientRect(); this.zoom(e.deltaY < 0 ? 0.5 : -0.5, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    }
    draw() {
      const c = this.c, dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = this.ctx; g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = this.css('--map'), grid = this.css('--grid'), fg = this.css('--mapfg'), dim = this.css('--mapdim'), acc = this.css('--mapacc'), acc2 = this.css('--mapacc2'), warn = this.css('--mapwarn'), bad = this.css('--mapbad'), font = this.css('--font');
      const marker = this.css('--marker') || 'diamond', sweepOn = this.css('--sweep') !== '0', title = (this.css('--maptitle') || '"SECTOR VIEW"').replace(/^["']|["']$/g, '');
      const now = performance.now();
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const z = this.z, cx = wx(this.center.lon, z), cy = wy(this.center.lat, z), ox = cx - w / 2, oy = cy - h / 2;
      const P = (lat, lon) => [wx(lon, z) - ox, wy(lat, z) - oy];
      this.hits = [];

      if (this.data.tiles) this._tiles(g, ox, oy, w, h);
      else {
        g.strokeStyle = grid; g.lineWidth = 1; g.beginPath();
        for (let x = -((ox % 80) + 80) % 80; x < w; x += 80) { g.moveTo(x, 0); g.lineTo(x, h); }
        for (let y = -((oy % 80) + 80) % 80; y < h; y += 80) { g.moveTo(0, y); g.lineTo(w, y); }
        g.stroke();
      }

      const me = this.data.nodes.find((n) => n.id === this.data.me && typeof n.lat === 'number') || (this.data.home && typeof this.data.home.lat === 'number' ? this.data.home : null);
      const mpp = 156543.03 * Math.cos(this.center.lat * Math.PI / 180) / Math.pow(2, z); // metres per pixel
      if (me) {
        const [mx, my] = P(me.lat, me.lon);
        // range rings (dashed) + labels
        g.strokeStyle = hex2rgba(acc, 0.28); g.fillStyle = dim; g.font = '10px ' + font; g.lineWidth = 1; g.setLineDash([3, 5]);
        for (const m of [250, 500, 1000, 2000, 5000, 10000, 20000, 50000]) {
          const r = m / mpp; if (r < 30 || r > Math.max(w, h) * 1.2) continue;
          g.beginPath(); g.arc(mx, my, r, 0, 7); g.stroke(); g.fillText((m >= 1000 ? m / 1000 + ' KM' : m + ' M'), mx + r * 0.707 + 4, my - r * 0.707);
        }
        g.setLineDash([]);
        // bearing ticks around the outer ring area + radar sweep
        const R = Math.max(w, h) * 0.9;
        g.strokeStyle = hex2rgba(acc, 0.14);
        g.beginPath(); g.moveTo(mx - R, my); g.lineTo(mx + R, my); g.moveTo(mx, my - R); g.lineTo(mx, my + R); g.stroke();
        if (!still && sweepOn) {
          const a0 = (now / 4200) % 1 * Math.PI * 2, steps = 26, span = Math.PI / 4.5;
          for (let i = 0; i < steps; i++) {
            const a1 = a0 - span * i / steps, a2 = a0 - span * (i + 1) / steps;
            g.fillStyle = hex2rgba(acc, 0.1 * (1 - i / steps));
            g.beginPath(); g.moveTo(mx, my); g.arc(mx, my, R, a2, a1); g.closePath(); g.fill();
          }
          g.strokeStyle = hex2rgba(acc, 0.55); g.lineWidth = 1.2; g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + Math.cos(a0) * R, my + Math.sin(a0) * R); g.stroke();
        }
      }
      // coverage dots
      if (this.data.showCov) {
        for (const p of this.data.coverage) {
          const [x, y] = P(p.lat, p.lon); if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
          const q = clamp((p.snr + 15) / 30, 0, 1);
          g.fillStyle = hex2rgba(q > 0.55 ? acc : q > 0.3 ? warn : bad, 0.2 + 0.3 * q);
          g.beginPath(); g.arc(x, y, Math.max(3, 28 / mpp), 0, 7); g.fill();
        }
      }
      // trails
      if (this.data.showTrails) {
        g.lineWidth = 1.6; g.lineJoin = 'round';
        for (const [id, t] of Object.entries(this.data.trails)) {
          if (t.length < 2 || id === this.data.me) continue;
          const sel = id === this.data.selected;
          g.strokeStyle = sel ? acc2 : hex2rgba(acc, 0.5); g.lineWidth = sel ? 2.2 : 1.4;
          g.beginPath(); t.forEach((p, i) => { const [x, y] = P(p.lat, p.lon); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
        }
      }
      // nodes
      const nowS = Date.now() / 1000, stale = (this.data.staleMinutes || 60) * 60;
      g.font = '600 11px ' + font;
      for (const n of this.data.nodes) {
        if (typeof n.lat !== 'number') continue;
        const [x, y] = P(n.lat, n.lon); if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
        const old = nowS - (n.lastHeard || 0) > stale, low = typeof n.battery === 'number' && n.battery <= (this.data.lowBattery || 20) && n.battery <= 100;
        const col = old ? dim : low ? warn : acc, isMe = n.id === this.data.me;
        if (!old && !still) { // heartbeat ring
          const ph = ((now / 1800) + (n.num || n.id.length * 0.13)) % 1;
          g.strokeStyle = hex2rgba(col, 0.5 * (1 - ph)); g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 6 + ph * 14, 0, 7); g.stroke();
        }
        g.fillStyle = isMe ? acc2 : col; g.strokeStyle = isMe ? acc2 : col; g.lineWidth = 2;
        if (isMe && marker === 'heart') { g.beginPath(); g.moveTo(x - 9, y + 7); g.lineTo(x - 9, y - 3); g.lineTo(x - 5, y + 1); g.lineTo(x - 3, y - 7); g.lineTo(x, y - 1); g.lineTo(x + 3, y - 7); g.lineTo(x + 5, y + 1); g.lineTo(x + 9, y - 3); g.lineTo(x + 9, y + 7); g.closePath(); g.fill(); } // a little crown for the base
        else if (isMe) { g.fillRect(x - 6, y - 6, 12, 12); g.strokeRect(x - 11, y - 11, 22, 22); }
        else if (marker === 'heart') { g.beginPath(); g.moveTo(x, y + 7); g.bezierCurveTo(x - 12, y - 1, x - 6, y - 10, x, y - 4); g.bezierCurveTo(x + 6, y - 10, x + 12, y - 1, x, y + 7); g.closePath(); g.fill(); }
        else if (marker === 'box') { g.fillRect(x - 8, y - 5.5, 16, 11); g.strokeStyle = fg; g.lineWidth = 1.2; g.strokeRect(x - 8, y - 5.5, 16, 11); if (old) { g.beginPath(); g.moveTo(x - 8, y - 5.5); g.lineTo(x + 8, y + 5.5); g.moveTo(x + 8, y - 5.5); g.lineTo(x - 8, y + 5.5); g.stroke(); } }
        else { g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y); g.closePath(); g.fill(); }
        if (n.id === this.data.selected) { // targeting brackets
          g.strokeStyle = acc2; g.lineWidth = 2; const k = 15, l = 6;
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.beginPath(); g.moveTo(x + sx * k, y + sy * (k - l)); g.lineTo(x + sx * k, y + sy * k); g.lineTo(x + sx * (k - l), y + sy * k); g.stroke(); }
        }
        g.fillStyle = fg; g.fillText((n.short || n.long || n.id).toUpperCase(), x + 12, y - 1);
        if (typeof n.battery === 'number') { g.fillStyle = low ? warn : dim; g.font = '10px ' + font; g.fillText(n.battery > 100 ? 'PWR' : n.battery + '%', x + 12, y + 11); g.font = '600 11px ' + font; }
        this.hits.push({ id: n.id, x, y });
      }
      // packet pulses: rx = from the sender toward the base, tx = from the base outward
      if (this.blips && this.blips.length) {
        const DUR = 2600, mp = me ? P(me.lat, me.lon) : null;
        this.blips = this.blips.filter((b) => now - b.t < DUR);
        const posOf = (id) => { const n = this.data.nodes.find((q) => q.id === id && typeof q.lat === 'number'); return n ? P(n.lat, n.lon) : null; };
        for (const b of this.blips) {
          const k = (now - b.t) / DUR, tx = b.dir === 'tx', col = tx ? acc2 : acc;
          const a = tx ? mp : posOf(b.from), z2 = tx ? (b.to === '^all' ? null : posOf(b.to)) : mp;
          g.lineWidth = 2;
          if (a) { g.strokeStyle = hex2rgba(col, 0.9 * (1 - k)); g.beginPath(); g.arc(a[0], a[1], 8 + k * 46, 0, 7); g.stroke(); }
          else if (mp && !tx) { g.strokeStyle = hex2rgba(col, 0.9 * (1 - k)); g.beginPath(); g.arc(mp[0], mp[1], 8 + (1 - k) * 46, 0, 7); g.stroke(); } // sender has no GPS: pulse closes in on the base
          if (a && z2) {
            const q = Math.min(1, k * 1.8), x = a[0] + (z2[0] - a[0]) * q, y = a[1] + (z2[1] - a[1]) * q;
            g.strokeStyle = hex2rgba(col, 0.45 * (1 - k)); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(x, y); g.stroke();
            g.fillStyle = hex2rgba(col, 1 - k * 0.6); g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill();
          }
        }
      }
      if (this.data.home && typeof this.data.home.lat === 'number' && !this.data.nodes.some((n) => n.id === this.data.me && typeof n.lat === 'number')) {
        const [x, y] = P(this.data.home.lat, this.data.home.lon); g.strokeStyle = acc2; g.lineWidth = 2; g.strokeRect(x - 6, y - 6, 12, 12);
      }

      // ---- HUD frame ----
      g.strokeStyle = acc; g.lineWidth = 2;
      const m = 6, L = 16;
      for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) { g.beginPath(); g.moveTo(x, y + sy * L); g.lineTo(x, y); g.lineTo(x + sx * L, y); g.stroke(); }
      g.strokeStyle = hex2rgba(acc, 0.35); g.lineWidth = 1; g.beginPath();
      for (let x = 40; x < w - 30; x += 40) { g.moveTo(x, 0); g.lineTo(x, x % 200 === 0 ? 9 : 5); }
      for (let y = 40; y < h - 30; y += 40) { g.moveTo(0, y); g.lineTo(y % 200 === 0 ? 9 : 5, y); }
      g.moveTo(w / 2 - 8, h / 2); g.lineTo(w / 2 + 8, h / 2); g.moveTo(w / 2, h / 2 - 8); g.lineTo(w / 2, h / 2 + 8); g.stroke();
      g.font = '10px ' + font; g.fillStyle = acc; g.fillText(title, 16, 20);
      const la = this.center.lat, lo = this.center.lon;
      g.fillStyle = dim; g.textAlign = 'right';
      g.fillText(`LAT ${Math.abs(la).toFixed(4)}${la >= 0 ? 'N' : 'S'}  LON ${Math.abs(lo).toFixed(4)}${lo >= 0 ? 'E' : 'W'}  Z${z.toFixed(1)}`, w - 16, h - 12);
      g.textAlign = 'left';
      // scale bar
      const bars = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
      const bm = bars.find((b) => b / mpp > 60) || bars[bars.length - 1], bp = bm / mpp;
      g.strokeStyle = fg; g.fillStyle = fg; g.lineWidth = 2; g.beginPath(); g.moveTo(16, h - 18); g.lineTo(16 + bp, h - 18); g.moveTo(16, h - 22); g.lineTo(16, h - 14); g.moveTo(16 + bp, h - 22); g.lineTo(16 + bp, h - 14); g.stroke();
      g.fillText(bm >= 1000 ? bm / 1000 + ' KM' : bm + ' M', 22 + bp, h - 14);
    }
    _tiles(g, ox, oy, w, h) {
      const zi = clamp(Math.round(this.z), 1, 18), s = Math.pow(2, this.z - zi), ts = TILE * s;
      const x0 = Math.floor(ox / ts), x1 = Math.floor((ox + w) / ts), y0 = Math.floor(oy / ts), y1 = Math.floor((oy + h) / ts), n = Math.pow(2, zi);
      for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= n) continue;
        const wrapped = ((tx % n) + n) % n, key = zi + '/' + wrapped + '/' + ty;
        let img = this.cache.get(key);
        if (!img) {
          img = new Image(); img.onload = () => this.draw(); img.src = `https://tile.openstreetmap.org/${key}.png`; this.cache.set(key, img);
          if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value);
        }
        if (img.complete && img.naturalWidth) { g.globalAlpha = parseFloat(this.css('--tilealpha')) || 0.5; g.filter = this.css('--tilefilter') || 'none'; g.drawImage(img, tx * ts - ox, ty * ts - oy, ts + 0.5, ts + 0.5); g.filter = 'none'; g.globalAlpha = 1; }
      }
      g.fillStyle = this.css('--mapfg'); g.font = '10px sans-serif'; g.fillText('© OpenStreetMap contributors', w - 160, 18);
    }
  }
  window.MapView = MapView;
})();
