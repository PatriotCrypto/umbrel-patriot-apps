'use strict';
// Uplink sound effects, synthesized live with Web Audio (no sound files).
// Radio squelch, data bursts and modem warbles for a cyberdeck feel.
(function () {
  let ctx = null, master = null, noiseBuf = null;
  const prefs = { on: true, vol: 0.5 };
  try { const s = JSON.parse(localStorage.getItem('ul.sfx') || '{}'); if (typeof s.on === 'boolean') prefs.on = s.on; if (s.vol >= 0 && s.vol <= 1) prefs.vol = s.vol; } catch {}
  const savePrefs = () => { try { localStorage.setItem('ul.sfx', JSON.stringify(prefs)); } catch {} };

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = prefs.vol * 0.6;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  // browsers only allow sound after the person has clicked or typed once
  const unlock = () => { ensure(); };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));

  // building blocks ---------------------------------------------------------
  function tone(t0, { f = 880, f2 = null, dur = 0.08, type = 'square', vol = 0.25, a = 0.004, rel = 0.03, filter = null }) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + a);
    g.gain.setValueAtTime(vol, t0 + Math.max(a, dur - rel)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (filter) { const bq = ctx.createBiquadFilter(); bq.type = filter.type || 'lowpass'; bq.frequency.value = filter.f; bq.Q.value = filter.q || 1; node.connect(bq); node = bq; }
    node.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(t0, { dur = 0.12, vol = 0.18, f = 2500, q = 0.8, type = 'bandpass', sweep = null }) {
    const s = ctx.createBufferSource(), bq = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; bq.type = type; bq.frequency.setValueAtTime(f, t0); bq.Q.value = q;
    if (sweep) bq.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(bq).connect(g).connect(master); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
  }
  function burst(t0, n, { base = 1400, spread = 1600, step = 0.028, vol = 0.12 }) {
    for (let i = 0; i < n; i++) tone(t0 + i * step, { f: base + Math.round(Math.random() * spread / 200) * 200, dur: step * 0.8, type: 'square', vol, a: 0.002, rel: 0.008, filter: { type: 'lowpass', f: 4200 } });
  }

  // the sound banks: one per look ----------------------------------------------
  const BANKS = {
    // Cyberdeck: radio squelch, data bursts, modem warbles
    cyber: {
      tx(t) { tone(t, { f: 900, f2: 1800, dur: 0.06, type: 'square', vol: 0.16, filter: { f: 3500 } }); burst(t + 0.07, 6, { base: 1600, spread: 1400, vol: 0.09 }); noise(t + 0.25, { dur: 0.05, vol: 0.06, f: 3000 }); },
      rx(t) { noise(t, { dur: 0.09, vol: 0.14, f: 1800, q: 0.6 }); tone(t + 0.08, { f: 1318, dur: 0.07, type: 'triangle', vol: 0.28 }); tone(t + 0.17, { f: 1760, dur: 0.11, type: 'triangle', vol: 0.28 }); burst(t + 0.3, 4, { base: 1200, spread: 1000, vol: 0.06 }); },
      ack(t) { tone(t, { f: 2400, dur: 0.035, type: 'sine', vol: 0.12 }); tone(t + 0.05, { f: 3200, dur: 0.035, type: 'sine', vol: 0.1 }); },
      xfer(t) { for (let i = 0; i < 8; i++) tone(t + i * 0.045, { f: i % 2 ? 2100 : 1300, dur: 0.04, type: 'sawtooth', vol: 0.07, filter: { f: 2800, q: 2 } }); noise(t + 0.36, { dur: 0.18, vol: 0.06, f: 2200, sweep: 600 }); },
      done(t) { [784, 1046, 1568].forEach((f, i) => tone(t + i * 0.08, { f, dur: 0.12, type: 'triangle', vol: 0.24 })); tone(t + 0.26, { f: 3136, dur: 0.05, type: 'sine', vol: 0.08 }); },
      linkup(t) { tone(t, { f: 220, f2: 1760, dur: 0.35, type: 'sawtooth', vol: 0.1, filter: { f: 2400, q: 6 } }); tone(t + 0.36, { f: 1760, dur: 0.08, type: 'triangle', vol: 0.2 }); },
      linkdown(t) { tone(t, { f: 880, f2: 110, dur: 0.45, type: 'sawtooth', vol: 0.1, filter: { f: 1600, q: 4 } }); noise(t + 0.1, { dur: 0.4, vol: 0.08, f: 900, sweep: 200 }); },
      error(t) { tone(t, { f: 160, dur: 0.14, type: 'square', vol: 0.18, filter: { f: 900 } }); tone(t + 0.17, { f: 130, dur: 0.2, type: 'square', vol: 0.18, filter: { f: 900 } }); },
      cw: { f: 700, type: 'square', filter: { f: 1400 } },
    },
    // Mars Mission: Apollo-style Quindar tones, clean telemetry sines, a master alarm
    mars: {
      tx(t) { tone(t, { f: 2525, dur: 0.25, type: 'sine', vol: 0.16, a: 0.005, rel: 0.02 }); noise(t + 0.27, { dur: 0.06, vol: 0.03, f: 3000 }); },
      rx(t) { noise(t, { dur: 0.05, vol: 0.04, f: 3000 }); tone(t + 0.05, { f: 2475, dur: 0.25, type: 'sine', vol: 0.16, a: 0.005, rel: 0.02 }); tone(t + 0.36, { f: 1200, dur: 0.06, type: 'sine', vol: 0.1 }); },
      ack(t) { tone(t, { f: 1800, dur: 0.04, type: 'sine', vol: 0.1 }); },
      xfer(t) { for (let i = 0; i < 6; i++) tone(t + i * 0.07, { f: 1000 + i * 180, dur: 0.05, type: 'sine', vol: 0.09 }); },
      done(t) { [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.09, { f, dur: 0.16, type: 'sine', vol: 0.18 })); },
      linkup(t) { tone(t, { f: 392, dur: 0.6, type: 'sine', vol: 0.1, a: 0.15, rel: 0.3 }); tone(t + 0.05, { f: 587, dur: 0.6, type: 'sine', vol: 0.08, a: 0.15, rel: 0.3 }); tone(t + 0.1, { f: 784, dur: 0.6, type: 'sine', vol: 0.07, a: 0.15, rel: 0.3 }); },
      linkdown(t) { tone(t, { f: 660, f2: 330, dur: 0.6, type: 'sine', vol: 0.12, rel: 0.3 }); noise(t + 0.15, { dur: 0.5, vol: 0.05, f: 1200, sweep: 300 }); },
      error(t) { for (let i = 0; i < 3; i++) { tone(t + i * 0.22, { f: 880, dur: 0.1, type: 'square', vol: 0.1, filter: { f: 2200 } }); tone(t + i * 0.22 + 0.1, { f: 660, dur: 0.1, type: 'square', vol: 0.1, filter: { f: 2200 } }); } },
      cw: { f: 600, type: 'sine' },
    },
    // 1985 Desktop: a PC speaker, square waves only
    desk85: {
      tx(t) { tone(t, { f: 1000, dur: 0.07, type: 'square', vol: 0.12, a: 0.001, rel: 0.003 }); },
      rx(t) { tone(t, { f: 800, dur: 0.08, type: 'square', vol: 0.12, a: 0.001, rel: 0.003 }); tone(t + 0.12, { f: 1200, dur: 0.1, type: 'square', vol: 0.12, a: 0.001, rel: 0.003 }); },
      ack(t) { tone(t, { f: 2000, dur: 0.015, type: 'square', vol: 0.08, a: 0.001, rel: 0.003 }); },
      xfer(t) { for (let i = 0; i < 10; i++) tone(t + i * 0.03, { f: i % 2 ? 1500 : 900, dur: 0.028, type: 'square', vol: 0.08, a: 0.001, rel: 0.002 }); },
      done(t) { [523, 659, 784].forEach((f, i) => tone(t + i * 0.1, { f, dur: 0.09, type: 'square', vol: 0.11, a: 0.001, rel: 0.003 })); },
      linkup(t) { [400, 600, 800, 1000, 1200].forEach((f, i) => tone(t + i * 0.05, { f, dur: 0.045, type: 'square', vol: 0.09, a: 0.001, rel: 0.003 })); },
      linkdown(t) { [1200, 1000, 800, 600, 400].forEach((f, i) => tone(t + i * 0.06, { f, dur: 0.055, type: 'square', vol: 0.09, a: 0.001, rel: 0.003 })); },
      error(t) { tone(t, { f: 220, dur: 0.35, type: 'square', vol: 0.13, a: 0.001, rel: 0.01 }); },
      cw: { f: 800, type: 'square' },
    },
    // Umbrel: soft, rounded interface sounds
    umbrel: {
      tx(t) { noise(t, { dur: 0.12, vol: 0.05, f: 800, q: 0.7, sweep: 3200 }); tone(t + 0.08, { f: 988, dur: 0.18, type: 'sine', vol: 0.16, a: 0.004, rel: 0.15 }); },
      rx(t) { tone(t, { f: 1319, dur: 0.35, type: 'sine', vol: 0.16, a: 0.004, rel: 0.3 }); tone(t + 0.11, { f: 1976, dur: 0.45, type: 'sine', vol: 0.13, a: 0.004, rel: 0.4 }); },
      ack(t) { tone(t, { f: 2637, dur: 0.12, type: 'sine', vol: 0.06, a: 0.002, rel: 0.1 }); },
      xfer(t) { [659, 784, 988].forEach((f, i) => tone(t + i * 0.06, { f, dur: 0.25, type: 'triangle', vol: 0.09, a: 0.004, rel: 0.2 })); },
      done(t) { [784, 988, 1175, 1568].forEach((f, i) => tone(t + i * 0.035, { f, dur: 0.7, type: 'sine', vol: 0.09, a: 0.005, rel: 0.6 })); },
      linkup(t) { tone(t, { f: 523, dur: 0.4, type: 'sine', vol: 0.12, a: 0.01, rel: 0.3 }); tone(t + 0.14, { f: 784, dur: 0.6, type: 'sine', vol: 0.12, a: 0.01, rel: 0.5 }); },
      linkdown(t) { tone(t, { f: 659, dur: 0.35, type: 'sine', vol: 0.12, a: 0.01, rel: 0.3 }); tone(t + 0.16, { f: 440, dur: 0.6, type: 'sine', vol: 0.12, a: 0.01, rel: 0.5 }); },
      error(t) { tone(t, { f: 196, dur: 0.3, type: 'sine', vol: 0.22, a: 0.004, rel: 0.25 }); tone(t + 0.12, { f: 165, dur: 0.35, type: 'sine', vol: 0.2, a: 0.004, rel: 0.3 }); },
      cw: { f: 660, type: 'sine' },
    },
  };
  // Field Command: push-to-talk clicks, roger beeps, a radar ping, teletype and a klaxon
  BANKS.war = {
    tx(t) { noise(t, { dur: 0.02, vol: 0.2, f: 2500, q: 0.5 }); noise(t + 0.02, { dur: 0.16, vol: 0.06, f: 1800, q: 0.4 }); tone(t + 0.2, { f: 1300, dur: 0.09, type: 'square', vol: 0.12, filter: { f: 2500 } }); noise(t + 0.3, { dur: 0.02, vol: 0.18, f: 2500, q: 0.5 }); },
    rx(t) { tone(t, { f: 1450, f2: 1380, dur: 0.9, type: 'sine', vol: 0.22, a: 0.003, rel: 0.85 }); tone(t + 0.02, { f: 2900, dur: 0.3, type: 'sine', vol: 0.04, a: 0.003, rel: 0.28 }); noise(t + 0.55, { dur: 0.14, vol: 0.06, f: 1600, q: 0.5 }); },
    ack(t) { noise(t, { dur: 0.015, vol: 0.18, f: 3000, q: 0.5 }); noise(t + 0.07, { dur: 0.015, vol: 0.18, f: 3000, q: 0.5 }); },
    xfer(t) { for (let i = 0; i < 12; i++) noise(t + i * 0.045 + (i % 3 ? 0 : 0.02), { dur: 0.018, vol: 0.14, f: 2200 + (i % 4) * 300, q: 3 }); },
    done(t) { tone(t, { f: 880, dur: 0.12, type: 'square', vol: 0.11, filter: { f: 2200 } }); tone(t + 0.16, { f: 1320, dur: 0.2, type: 'square', vol: 0.11, filter: { f: 2200 } }); },
    linkup(t) { for (let i = 0; i < 6; i++) tone(t + i * 0.07 * (1 - i * 0.1), { f: 1000, dur: 0.035, type: 'sine', vol: 0.14 }); tone(t + 0.36, { f: 1000, dur: 0.45, type: 'sine', vol: 0.14, rel: 0.1 }); },
    linkdown(t) { noise(t, { dur: 0.7, vol: 0.12, f: 2400, q: 0.3, sweep: 300 }); tone(t, { f: 700, f2: 180, dur: 0.6, type: 'sine', vol: 0.08 }); },
    error(t) { for (let i = 0; i < 4; i++) tone(t + i * 0.18, { f: i % 2 ? 520 : 640, dur: 0.17, type: 'square', vol: 0.11, a: 0.002, rel: 0.01, filter: { f: 1800 } }); },
    cw: { f: 650, type: 'square', filter: { f: 1100 } },
  };
  let bankName = 'cyber';
  const bank = () => BANKS[bankName] || BANKS.cyber;

  // Morse code (the CW easter egg), 18 words per minute
  const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '!': '-.-.--', '@': '.--.-.' };
  const toMorse = (text) => String(text).toUpperCase().split(/\s+/).filter(Boolean).map((w) => [...w].map((c) => MORSE[c] || '').filter(Boolean).join(' ')).filter(Boolean).join(' / ');
  function morse(text, maxSec = 20) {
    const code = toMorse(text); if (!prefs.on || !code || !ensure() || ctx.state !== 'running') return code;
    const v = bank().cw, dit = 1.2 / 18;
    let t = ctx.currentTime + 0.05; const end = t + maxSec;
    for (const ch of code) {
      if (t > end) break;
      if (ch === '.' || ch === '-') { const d = ch === '.' ? dit : dit * 3; tone(t, { f: v.f, dur: d, type: v.type, vol: 0.22, a: 0.004, rel: 0.004, filter: v.filter }); t += d + dit; }
      else if (ch === ' ') t += dit * 2;
      else if (ch === '/') t += dit * 2;
    }
    return code;
  }

  let last = {};
  function play(name) {
    const S = bank();
    if (!prefs.on || typeof S[name] !== 'function' || !ensure() || ctx.state !== 'running') return;
    const now = performance.now(); if (last[name] && now - last[name] < 350) return; last[name] = now;
    S[name](ctx.currentTime + 0.01);
  }
  window.SFX = {
    play,
    get on() { return prefs.on; },
    get vol() { return prefs.vol; },
    setOn(v) { prefs.on = !!v; savePrefs(); if (v) { ensure(); } },
    setVol(v) { prefs.vol = Math.max(0, Math.min(1, +v || 0)); savePrefs(); if (master) master.gain.value = prefs.vol * 0.6; },
    names: ['tx', 'ack', 'rx', 'xfer', 'done', 'linkup', 'linkdown', 'error'],
    setTheme(n) { if (BANKS[n]) bankName = n; },
    morse, toMorse,
  };
})();
