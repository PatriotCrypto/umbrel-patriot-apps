// A small, quiet sound palette: soft bells and chimes with a little room reverb, used only where a
// sound matters (opening a door, a locked door, the Scanner, badges, the launch). Everything is made
// with the Web Audio API; nothing is downloaded. There is no background music.
(function () {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, master = null, dry = null, wet = null, noiseBuf = null;
  let unlocked = false;
  const st = { volume: 0.8 };

  function ensure() {
    if (ctx) return ctx;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = st.volume; master.connect(ctx.destination);
    dry = ctx.createGain(); dry.connect(master);
    // A simple room: two feedback delays into a low-pass, mixed in quietly.
    wet = ctx.createGain(); wet.gain.value = 0.28;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.connect(master);
    [0.11, 0.173].forEach((time) => {
      const d = ctx.createDelay(1); d.delayTime.value = time;
      const fb = ctx.createGain(); fb.gain.value = 0.42;
      wet.connect(d); d.connect(fb); fb.connect(d); d.connect(lp);
    });
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function unlock() { const c = ensure(); if (!c) return false; if (c.state === 'suspended') c.resume(); unlocked = true; return true; }
  const now = () => ctx.currentTime;
  function setVolume(v) { st.volume = Math.max(0, Math.min(1, v)); if (master) master.gain.setTargetAtTime(st.volume, now(), 0.05); }
  function out(g) { g.connect(dry); g.connect(wet); }

  function tone({ type = 'sine', freq = 440, t = 0, dur = 0.3, vol = 0.2, attack = 0.004, slide }) {
    const c = ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), s = now() + t;
    o.type = type; o.frequency.setValueAtTime(freq, s);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), s + dur);
    g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(vol, s + attack); g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    o.connect(g); out(g); o.start(s); o.stop(s + dur + 0.05);
  }
  function noise({ t = 0, dur = 0.2, vol = 0.2, type = 'bandpass', freq = 1000, q = 1, slideTo, attack = 0.005 }) {
    const c = ensure(); if (!c) return;
    const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const s = now() + t;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, s + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(vol, s + attack); g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    src.connect(f).connect(g); out(g); src.start(s); src.stop(s + dur + 0.05);
  }
  // A bell: fundamental plus soft inharmonic partials.
  function bell(freq, t = 0, vol = 0.16, decay = 1.6) {
    tone({ freq, t, dur: decay, vol, attack: 0.002 });
    tone({ freq: freq * 2.0, t, dur: decay * 0.6, vol: vol * 0.3, attack: 0.002 });
    tone({ freq: freq * 2.98, t, dur: decay * 0.4, vol: vol * 0.14, attack: 0.002 });
  }
  const quiet = () => {};
  const ok = () => unlocked;

  const sfx = {
    // the moments that matter
    door() { if (!ok()) return; noise({ type: 'lowpass', freq: 500, dur: 0.12, vol: 0.18 }); bell(1046, 0.12, 0.12, 1.2); bell(1318, 0.26, 0.1, 1.3); bell(1568, 0.4, 0.09, 1.8); },
    locked() { if (!ok()) return; tone({ freq: 180, dur: 0.14, vol: 0.14 }); tone({ freq: 150, t: 0.16, dur: 0.22, vol: 0.12 }); },
    chime() { if (!ok()) return; bell(880, 0, 0.12); bell(1318, 0.16, 0.1); bell(1760, 0.32, 0.08, 2.2); },
    success() { if (!ok()) return; bell(1046, 0, 0.1); bell(1318, 0.09, 0.1); bell(1568, 0.18, 0.1); bell(2093, 0.27, 0.11, 2.4); },
    sparkle(n = 5, spread = 0.06) { if (!ok()) return; for (let i = 0; i < Math.min(n, 6); i++) bell(2000 + Math.random() * 1800, i * spread, 0.035, 0.7); },
    twinkle() { if (!ok()) return; sfx.sparkle(5, 0.1); },
    jingle(n = 8, gap = 0.11, vol = 0.05) { if (!ok()) return; for (let i = 0; i < n; i++) { const t = i * gap + Math.random() * 0.015; bell(3600 + Math.random() * 900, t, vol, 0.5); if (i % 2 === 0) bell(2700 + Math.random() * 300, t, vol * 0.7, 0.6); } },
    pop(t = 0) { if (!ok()) return; noise({ type: 'lowpass', freq: 1400, dur: 0.22, vol: 0.3, t }); tone({ freq: 320, slide: 60, dur: 0.28, vol: 0.22, t }); },
    boom(t = 0) { if (!ok()) return; noise({ type: 'lowpass', freq: 300, dur: 0.9, vol: 0.4, t }); tone({ freq: 90, slide: 35, dur: 0.9, vol: 0.3, t }); },
    fireworks(n = 5) { if (!ok()) return; for (let i = 0; i < n; i++) { const t = i * 0.4 + Math.random() * 0.2; noise({ type: 'bandpass', freq: 600, slideTo: 2400, dur: 0.4, vol: 0.06, t, q: 2 }); sfx.pop(t + 0.45); } },
    rumble(dur = 3) { if (!ok()) return; noise({ type: 'lowpass', freq: 70, slideTo: 150, dur, vol: 0.7, q: 0.8, attack: 0.6 }); },
    toll() { if (!ok()) return; bell(130.8, 0, 0.3, 4.5); tone({ freq: 65.4, dur: 3.5, vol: 0.14, attack: 0.01 }); },
    angelic(t = 0) {
      if (!ok()) return; const c = ensure();
      [261.6, 329.6, 392, 523.3].forEach((f, i) => { for (let k = -1; k <= 1; k += 2) { const o = c.createOscillator(), g = c.createGain(), s = now() + t + i * 0.14; o.frequency.value = f * (1 + k * 0.002); g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(0.03, s + 1.4); g.gain.setValueAtTime(0.03, s + 3); g.gain.exponentialRampToValueAtTime(0.0001, s + 5.2); o.connect(g); out(g); o.start(s); o.stop(s + 5.3); } });
      sfx.sparkle(5, 0.2);
    },
    nice() { if (!ok()) return; sfx.success(); sfx.jingle(6, 0.1, 0.04); },
    naughty() { if (!ok()) return; tone({ freq: 220, slide: 165, dur: 0.6, vol: 0.1 }); tone({ freq: 165, slide: 124, dur: 0.7, vol: 0.1, t: 0.2 }); },
    scan(n = 10) { if (!ok()) return; for (let i = 0; i < n; i++) tone({ freq: 1200, t: i * 0.3, dur: 0.05, vol: 0.05 }); },
    hooray() { if (!ok()) return; sfx.success(); sfx.jingle(8, 0.09, 0.04); sfx.fireworks(3); },
    fanfare() { sfx.success(); },
    countdownBeep(final) { if (!ok()) return; if (final) bell(1760, 0, 0.14, 1.2); else tone({ freq: 880, dur: 0.08, vol: 0.05 }); },
    // the rest of the app used to chirp on every tap; it stays silent now
    click: quiet, beep: quiet, typing: quiet, snort: quiet, clops: quiet, crunch: quiet, swoosh: quiet, whoosh: quiet, giggle: quiet, hohoho: quiet, radar: quiet, ping: quiet, shutter: quiet,
  };

  window.Audio2 = {
    unlock, setVolume, sfx, CAROLS: {},
    get unlocked() { return unlocked; },
    get playing() { return null; },
    music: { play: quiet, stop: quiet, forDay() { return null; }, toggle() { return false; } },
  };
})();
