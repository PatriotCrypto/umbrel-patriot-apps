'use strict';
// Field Command radar scope: a rotating sweep with this station at the centre and the linked
// station as a contact. Outgoing transmissions travel out to the contact (amber), incoming ones
// travel in to the centre (green). Drawn on a canvas, only while the scope is on screen.
(function () {
  const cv = document.getElementById('radarC'); if (!cv) return;
  const g = cv.getContext('2d');
  const RX = '#8dff6a', TX = '#ffbf3c', BAD = '#ff4b2b';
  const SWEEP_MS = 3200;
  let peer = null; // { name, bearing (deg), online, rtt }
  const blips = []; // { dir, t0, dur }
  let glow = 0, lastSweepAng = 0, flowIn = 0, flowOut = 0, accIn = 0, accOut = 0, lastT = performance.now();

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || 300;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr); }
    return { W: cv.width, dpr };
  }
  const polar = (cx, cy, r, deg) => { const a = ((deg - 90) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };

  function draw(now) {
    requestAnimationFrame(draw);
    if (!cv.offsetParent) return;
    const { W, dpr } = size(), cx = W / 2, cy = W / 2, R = W / 2 - 4 * dpr;
    const dt = Math.min(100, now - lastT); lastT = now;
    // steady stream of blips while a file is moving
    accIn += (flowIn * dt) / 1000; accOut += (flowOut * dt) / 1000;
    while (accIn >= 1) { accIn -= 1; blips.push({ dir: 'in', t0: now, dur: 1500 }); }
    while (accOut >= 1) { accOut -= 1; blips.push({ dir: 'out', t0: now, dur: 1500 }); }

    g.clearRect(0, 0, W, W);
    // scope face
    const face = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    face.addColorStop(0, '#0f1a0b'); face.addColorStop(1, '#050804');
    g.fillStyle = face; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    // rings, crosshair, bearing ticks
    g.strokeStyle = 'rgba(141,255,106,.18)'; g.lineWidth = 1 * dpr;
    for (let i = 1; i <= 4; i++) { g.beginPath(); g.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    for (let d = 0; d < 360; d += 10) { const [x1, y1] = polar(cx, cy, R, d), [x2, y2] = polar(cx, cy, R - (d % 30 ? 4 : 9) * dpr, d); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    g.fillStyle = 'rgba(141,255,106,.45)'; g.font = `${9 * dpr}px "Share Tech Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [d, l] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) { const [x, y] = polar(cx, cy, R - 17 * dpr, d); g.fillText(l, x, y); }

    // sweep with a fading wedge behind it
    const ang = ((now % SWEEP_MS) / SWEEP_MS) * 360;
    const a0 = ((ang - 90) * Math.PI) / 180;
    if (g.createConicGradient) {
      const cg = g.createConicGradient(a0 - Math.PI * 0.5, cx, cy);
      cg.addColorStop(0, 'rgba(141,255,106,0)'); cg.addColorStop(0.24, 'rgba(141,255,106,0)'); cg.addColorStop(0.25, 'rgba(141,255,106,.28)'); cg.addColorStop(0.2501, 'rgba(141,255,106,0)');
      g.fillStyle = cg; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0 - Math.PI * 0.5, a0); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(160,255,130,.85)'; g.lineWidth = 2 * dpr; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * Math.cos(a0), cy + R * Math.sin(a0)); g.stroke();

    // home station
    g.fillStyle = TX; g.beginPath(); g.arc(cx, cy, 3.5 * dpr, 0, Math.PI * 2); g.fill();

    if (peer) {
      const pr = R * 0.72, [px, py] = polar(cx, cy, pr, peer.bearing);
      // the sweep lights the contact up as it passes
      const passed = (lastSweepAng < peer.bearing && ang >= peer.bearing) || (lastSweepAng > ang && (peer.bearing > lastSweepAng || peer.bearing <= ang));
      if (passed) glow = 1;
      glow = Math.max(0.25, glow - dt / 2600);
      const col = peer.online ? RX : BAD;
      g.save(); g.globalAlpha = peer.online ? glow : 0.4 + 0.3 * Math.sin(now / 250);
      g.shadowColor = col; g.shadowBlur = 12 * dpr * glow; g.fillStyle = col;
      if (peer.online) { g.beginPath(); g.arc(px, py, 5 * dpr, 0, Math.PI * 2); g.fill(); }
      else { g.strokeStyle = col; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(px, py, 6 * dpr, 0, Math.PI * 2); g.stroke(); }
      g.restore();
      g.fillStyle = peer.online ? 'rgba(200,255,180,.9)' : 'rgba(255,120,100,.9)'; g.font = `${10 * dpr}px "Share Tech Mono", monospace`;
      g.textAlign = px > cx ? 'right' : 'left';
      g.fillText(peer.name.toUpperCase(), px + (px > cx ? -10 : 10) * dpr, py - 9 * dpr);
      g.fillStyle = 'rgba(141,255,106,.6)'; g.fillText(peer.online ? (peer.rtt ? peer.rtt + ' MS' : '') : 'NO CONTACT', px + (px > cx ? -10 : 10) * dpr, py + 10 * dpr);

      // transmissions in flight
      for (let i = blips.length - 1; i >= 0; i--) {
        const b = blips[i], k = (now - b.t0) / b.dur;
        if (k >= 1) { blips.splice(i, 1); continue; }
        const f = b.dir === 'out' ? k : 1 - k;
        const x = cx + (px - cx) * f, y = cy + (py - cy) * f, c = b.dir === 'out' ? TX : RX;
        for (let tr = 1; tr <= 4; tr++) { // short trail
          const ft = b.dir === 'out' ? Math.max(0, k - tr * 0.04) : Math.min(1, 1 - k + tr * 0.04);
          g.globalAlpha = 0.5 - tr * 0.11; g.fillStyle = c; g.beginPath(); g.arc(cx + (px - cx) * ft, cy + (py - cy) * ft, (3 - tr * 0.4) * dpr, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1; g.shadowColor = c; g.shadowBlur = 10 * dpr; g.fillStyle = c; g.beginPath(); g.arc(x, y, 3.5 * dpr, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
      }
    }
    // bezel
    g.strokeStyle = 'rgba(141,255,106,.4)'; g.lineWidth = 1.5 * dpr; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    lastSweepAng = ang;
  }
  requestAnimationFrame(draw);

  // a stable bearing for each station, from its ID
  const bearingOf = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 20 + (h % 320); };
  window.Radar = {
    setPeer(p) { peer = p ? { name: p.name || 'station', bearing: bearingOf(p.id), online: !!p.online, rtt: p.rtt || 0 } : null; },
    push(dir) { if (blips.length < 40) blips.push({ dir, t0: performance.now(), dur: 1400 }); },
    // bytes per second in each direction -> a few blips per second while a transfer runs
    flow(txBps, rxBps) { flowOut = txBps > 20000 ? Math.min(4, 1 + Math.log10(txBps / 20000)) : 0; flowIn = rxBps > 20000 ? Math.min(4, 1 + Math.log10(rxBps / 20000)) : 0; },
    bearingOf,
  };
})();
