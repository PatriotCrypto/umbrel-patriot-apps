// Every sound in the app is made right here with the Web Audio API: bells, chimes, a music box,
// Santa's laugh, reindeer hooves, fireworks. Nothing is downloaded and nothing is recorded.
(function () {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let noiseBuf = null;
  let unlocked = false;
  const st = { volume: 0.8, music: true, musicOn: false, current: null, loopTimer: null, scheduled: [] };

  function ensure() {
    if (ctx) return ctx;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = st.volume;
    master.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.connect(master);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.32;
    musicGain.connect(master);
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  // Browsers only let sound start after a tap. Call this from any click.
  function unlock() {
    const c = ensure();
    if (!c) return false;
    if (c.state === 'suspended') c.resume();
    unlocked = true;
    return true;
  }
  const now = () => ctx.currentTime;

  function setVolume(v) { st.volume = Math.max(0, Math.min(1, v)); if (master) master.gain.setTargetAtTime(st.volume, now(), 0.05); }

  // ---------- building blocks ----------
  function tone({ type = 'sine', freq = 440, t = 0, dur = 0.3, vol = 0.3, attack = 0.005, decay, slide, dest }) {
    const c = ensure(); if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    const start = now() + t;
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(vol, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + (decay || dur));
    o.connect(g).connect(dest || sfxGain);
    o.start(start);
    o.stop(start + (decay || dur) + 0.05);
  }
  function noise({ t = 0, dur = 0.2, vol = 0.3, type = 'bandpass', freq = 1000, q = 1, slideTo, attack = 0.005, dest }) {
    const c = ensure(); if (!c) return;
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const start = now() + t;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(vol, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f).connect(g).connect(dest || sfxGain);
    s.start(start);
    s.stop(start + dur + 0.05);
  }
  // A bell: a fundamental plus inharmonic partials, long decay.
  function bell(freq, t = 0, vol = 0.25, decay = 1.8) {
    tone({ freq, t, dur: decay, vol, attack: 0.002 });
    tone({ freq: freq * 2.0, t, dur: decay * 0.7, vol: vol * 0.45, attack: 0.002 });
    tone({ freq: freq * 2.98, t, dur: decay * 0.5, vol: vol * 0.25, attack: 0.002 });
    tone({ freq: freq * 4.2, t, dur: decay * 0.3, vol: vol * 0.12, attack: 0.002 });
  }
  // Music box note: bright attack, soft body.
  function boxNote(freq, t, dur, vol = 0.5) {
    tone({ freq, t, dur: Math.max(0.6, dur * 1.1), vol, attack: 0.003, dest: musicGain });
    tone({ freq: freq * 3, t, dur: 0.25, vol: vol * 0.18, attack: 0.002, dest: musicGain });
    tone({ freq: freq * 5.4, t, dur: 0.12, vol: vol * 0.07, attack: 0.002, dest: musicGain });
  }

  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  function hz(name) {
    const m = /^([A-G][#b]?)(\d)$/.exec(name);
    if (!m) return 0;
    const n = NOTE[m[1]] + (Number(m[2]) + 1) * 12;
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  // ---------- sound effects ----------
  const sfx = {
    click() { if (!unlocked) return; tone({ type: 'square', freq: 1400, dur: 0.04, vol: 0.06 }); },
    beep() { if (!unlocked) return; tone({ type: 'square', freq: 900 + Math.random() * 200, dur: 0.03, vol: 0.05 }); },
    locked() { if (!unlocked) return; tone({ type: 'triangle', freq: 320, dur: 0.12, vol: 0.2 }); tone({ type: 'triangle', freq: 220, t: 0.13, dur: 0.22, vol: 0.2 }); },
    sparkle(n = 8, spread = 0.05) { if (!unlocked) return; for (let i = 0; i < n; i++) tone({ freq: 1800 + Math.random() * 2600, t: i * spread, dur: 0.35, vol: 0.09, attack: 0.002 }); },
    twinkle() { if (!unlocked) return; for (let i = 0; i < 5; i++) bell(2000 + Math.random() * 1500, i * 0.12, 0.08, 0.9); },
    chime() { if (!unlocked) return; bell(880, 0, 0.22); bell(1318, 0.18, 0.18); bell(1760, 0.36, 0.14, 2.4); },
    door() {
      if (!unlocked) return;
      tone({ type: 'sawtooth', freq: 160, slide: 290, dur: 0.55, vol: 0.05 });
      noise({ type: 'bandpass', freq: 600, slideTo: 2400, dur: 0.5, vol: 0.12, q: 2 });
      sfx.sparkle(10, 0.045);
    },
    jingle(n = 8, gap = 0.11, vol = 0.14) {
      if (!unlocked) return;
      for (let i = 0; i < n; i++) {
        const t = i * gap + Math.random() * 0.02;
        noise({ type: 'highpass', freq: 6500, dur: 0.09, vol, t });
        tone({ freq: 4200 + Math.random() * 1200, t, dur: 0.12, vol: 0.05 });
        if (i % 2 === 0) tone({ freq: 3100 + Math.random() * 400, t, dur: 0.16, vol: 0.035 });
      }
    },
    whoosh(dur = 0.6) { if (!unlocked) return; noise({ type: 'bandpass', freq: 250, slideTo: 3500, dur, vol: 0.22, q: 1.2, attack: 0.08 }); },
    hohoho() {
      if (!unlocked) return;
      for (let i = 0; i < 3; i++) {
        const t = i * 0.34;
        const f = 118 - i * 6;
        const c = ensure();
        const o = c.createOscillator();
        const g = c.createGain();
        const fl = c.createBiquadFilter();
        fl.type = 'bandpass'; fl.frequency.value = 520; fl.Q.value = 1.5;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
        o.type = 'sawtooth';
        const s = now() + t;
        o.frequency.setValueAtTime(f * 1.15, s);
        o.frequency.exponentialRampToValueAtTime(f, s + 0.12);
        g.gain.setValueAtTime(0.0001, s);
        g.gain.linearRampToValueAtTime(0.5, s + 0.03);
        g.gain.setValueAtTime(0.5, s + 0.15);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28);
        o.connect(fl).connect(lp).connect(g).connect(sfxGain);
        o.start(s); o.stop(s + 0.32);
        noise({ type: 'lowpass', freq: 900, dur: 0.08, vol: 0.08, t });
      }
    },
    clops(n = 6, gap = 0.17) { if (!unlocked) return; for (let i = 0; i < n; i++) { const t = i * gap + (i % 2 ? 0.04 : 0); noise({ type: 'lowpass', freq: 420, dur: 0.06, vol: 0.35, t }); tone({ type: 'sine', freq: 180 - (i % 2) * 40, t, dur: 0.07, vol: 0.2, slide: 90 }); } },
    pop(t = 0) { if (!unlocked) return; noise({ type: 'lowpass', freq: 1800, dur: 0.25, vol: 0.5, t }); tone({ type: 'sine', freq: 380, slide: 55, dur: 0.3, vol: 0.4, t }); sfx.sparkle(6, 0.03); },
    boom(t = 0) { if (!unlocked) return; noise({ type: 'lowpass', freq: 400, dur: 0.9, vol: 0.6, t }); tone({ type: 'sine', freq: 120, slide: 35, dur: 0.9, vol: 0.5, t }); },
    toll() { if (!unlocked) return; bell(130.8, 0, 0.5, 4.5); tone({ freq: 65, dur: 3.5, vol: 0.25, attack: 0.01 }); },
    fanfare() { if (!unlocked) return; [523, 659, 784, 1047].forEach((f, i) => { tone({ type: 'square', freq: f, t: i * 0.11, dur: i === 3 ? 0.9 : 0.14, vol: 0.09 }); tone({ type: 'triangle', freq: f / 2, t: i * 0.11, dur: i === 3 ? 0.9 : 0.14, vol: 0.12 }); }); sfx.sparkle(8, 0.06); },
    success() { if (!unlocked) return; bell(1046, 0, 0.18); bell(1318, 0.1, 0.18); bell(1568, 0.2, 0.18); bell(2093, 0.3, 0.2, 2.5); },
    ping() { if (!unlocked) return; tone({ freq: 1250, dur: 0.5, vol: 0.12, attack: 0.002 }); tone({ freq: 1250, t: 0.25, dur: 0.4, vol: 0.05, attack: 0.002 }); },
    radar() { if (!unlocked) return; tone({ freq: 880, dur: 0.9, vol: 0.07, attack: 0.01 }); tone({ freq: 1760, dur: 0.2, vol: 0.04 }); },
    shutter() { if (!unlocked) return; noise({ type: 'highpass', freq: 3000, dur: 0.03, vol: 0.4 }); noise({ type: 'bandpass', freq: 1200, dur: 0.06, vol: 0.3, t: 0.05 }); },
    giggle() { if (!unlocked) return; for (let i = 0; i < 4; i++) tone({ type: 'triangle', freq: 820 + i * 120, slide: 1300 + i * 80, t: i * 0.09, dur: 0.08, vol: 0.12 }); },
    snort() { if (!unlocked) return; noise({ type: 'lowpass', freq: 500, slideTo: 200, dur: 0.22, vol: 0.4, q: 3 }); tone({ type: 'sawtooth', freq: 140, slide: 90, dur: 0.2, vol: 0.06 }); },
    crunch() { if (!unlocked) return; noise({ type: 'bandpass', freq: 2500, dur: 0.1, vol: 0.3, q: 0.7 }); },
    swoosh() { if (!unlocked) return; noise({ type: 'bandpass', freq: 3000, slideTo: 400, dur: 0.35, vol: 0.2, q: 1 }); },
    rumble(dur = 3) { if (!unlocked) return; noise({ type: 'lowpass', freq: 70, slideTo: 160, dur, vol: 0.9, q: 0.8, attack: 0.6 }); tone({ type: 'sawtooth', freq: 40, slide: 70, dur, vol: 0.2, attack: 0.5 }); },
    angelic(t = 0) {
      if (!unlocked) return;
      const c = ensure();
      [261.6, 329.6, 392, 523.3, 659.3].forEach((f, i) => {
        for (let k = -1; k <= 1; k += 2) {
          const o = c.createOscillator(); const g = c.createGain();
          o.frequency.value = f * (1 + k * 0.0025);
          const s = now() + t + i * 0.12;
          g.gain.setValueAtTime(0.0001, s);
          g.gain.linearRampToValueAtTime(0.045, s + 1.4);
          g.gain.setValueAtTime(0.045, s + 3.2);
          g.gain.exponentialRampToValueAtTime(0.0001, s + 5.5);
          o.connect(g).connect(sfxGain);
          o.start(s); o.stop(s + 5.6);
        }
      });
      sfx.sparkle(12, 0.15);
    },
    typing(n = 6) { if (!unlocked) return; for (let i = 0; i < n; i++) tone({ type: 'square', freq: 700 + Math.random() * 500, t: i * 0.05, dur: 0.02, vol: 0.04 }); },
    countdownBeep(final) { if (!unlocked) return; tone({ type: 'square', freq: final ? 1760 : 880, dur: final ? 0.6 : 0.12, vol: 0.12 }); },
    fireworks(n = 6) { if (!unlocked) return; for (let i = 0; i < n; i++) { const t = i * 0.35 + Math.random() * 0.2; tone({ type: 'sine', freq: 300, slide: 1800, t, dur: 0.45, vol: 0.08 }); sfx.pop(t + 0.5); } },
    hooray() { if (!unlocked) return; sfx.fanfare(); sfx.jingle(10, 0.09); sfx.fireworks(3); },
    nice() { if (!unlocked) return; sfx.success(); sfx.sparkle(14, 0.05); sfx.jingle(6, 0.1, 0.08); },
    naughty() { if (!unlocked) return; tone({ type: 'sawtooth', freq: 220, slide: 110, dur: 0.6, vol: 0.12 }); tone({ type: 'triangle', freq: 165, slide: 82, dur: 0.7, vol: 0.12, t: 0.15 }); },
    scan(n = 10) { if (!unlocked) return; for (let i = 0; i < n; i++) tone({ type: 'square', freq: 600 + (i % 3) * 180, t: i * 0.12, dur: 0.06, vol: 0.05 }); },
  };

  // ---------- the music box ----------
  // Public-domain carols as note/beat pairs. R is a rest.
  const CAROLS = {
    silent: { name: 'Silent Night', bpm: 96, notes: 'G4/1.5 A4/.5 G4/1 E4/3 G4/1.5 A4/.5 G4/1 E4/3 D5/2 D5/1 B4/3 C5/2 C5/1 G4/3 A4/2 A4/1 C5/1.5 B4/.5 A4/1 G4/1.5 A4/.5 G4/1 E4/3 A4/2 A4/1 C5/1.5 B4/.5 A4/1 G4/1.5 A4/.5 G4/1 E4/3 D5/2 D5/1 F5/1.5 D5/.5 B4/1 C5/3 E5/3 C5/1 G4/1 E4/1 G4/1.5 F4/.5 D4/1 C4/6 R/3' },
    joy: { name: 'Joy to the World', bpm: 108, notes: 'C5/1.5 B4/.75 A4/.25 G4/1.5 F4/.5 E4/1 D4/1 C4/1.5 G4/.5 A4/1.5 A4/.5 B4/1.5 B4/.5 C5/2.5 C5/.5 C5/.5 B4/.5 A4/.5 G4/.5 G4/.75 F4/.25 E4/.5 C5/.5 C5/.5 B4/.5 A4/.5 G4/.5 G4/.75 F4/.25 E4/.5 E4/.5 E4/.5 E4/.5 E4/.5 E4/.25 F4/.25 G4/1.5 F4/.25 E4/.25 D4/.5 D4/.5 D4/.5 D4/.25 E4/.25 F4/1.5 E4/.25 D4/.25 E4/1 C5/2 A4/.5 G4/.75 F4/.25 E4/.5 F4/.5 E4/1 D4/1 C4/2 R/2' },
    jingle: { name: 'Jingle Bells', bpm: 132, notes: 'E4/1 E4/1 E4/2 E4/1 E4/1 E4/2 E4/1 G4/1 C4/1.5 D4/.5 E4/4 F4/1 F4/1 F4/1.5 F4/.5 F4/1 E4/1 E4/1 E4/.5 E4/.5 E4/1 D4/1 D4/1 E4/1 D4/2 G4/2 E4/1 E4/1 E4/2 E4/1 E4/1 E4/2 E4/1 G4/1 C4/1.5 D4/.5 E4/4 F4/1 F4/1 F4/1.5 F4/.5 F4/1 E4/1 E4/1 E4/.5 E4/.5 G4/1 G4/1 F4/1 D4/1 C4/4 R/2' },
    wish: { name: 'We Wish You a Merry Christmas', bpm: 150, notes: 'D4/1 G4/1 G4/.5 A4/.5 G4/.5 F#4/.5 E4/1 E4/1 E4/1 A4/1 A4/.5 B4/.5 A4/.5 G4/.5 F#4/1 D4/1 D4/1 B4/1 B4/.5 C5/.5 B4/.5 A4/.5 G4/1 E4/1 D4/.5 D4/.5 E4/1 A4/1 F#4/1 G4/2 R/1 D4/1 G4/1 G4/1 G4/1 F#4/2 F#4/1 G4/1 F#4/1 E4/1 D4/2 A4/1 B4/1 A4/1 A4/1 G4/1 G4/1 D5/1 D4/1 D4/.5 D4/.5 E4/1 A4/1 F#4/1 G4/2 R/2' },
    faithful: { name: 'O Come, All Ye Faithful', bpm: 112, notes: 'G4/2 G4/1 D4/1 G4/2 A4/2 D4/4 B4/2 A4/1 B4/1 C5/2 B4/2 A4/4 G4/2 B4/1 A4/1 G4/2 F#4/1 E4/1 F#4/2 G4/1 A4/1 B4/2 F#4/2 E4/2 D4/2 G4/4 R/2' },
    noel: { name: 'The First Noel', bpm: 104, notes: 'F#4/.5 E4/.5 D4/1.5 E4/.5 F#4/.5 G4/.5 A4/2 B4/.5 C#5/.5 D5/1 C#5/1 B4/1 A4/2 B4/.5 C#5/.5 D5/1 C#5/1 B4/1 A4/1 B4/1 C#5/1 D5/1 A4/1 G4/1 F#4/2 F#4/.5 E4/.5 D4/1.5 E4/.5 F#4/.5 G4/.5 A4/2 B4/.5 C#5/.5 D5/1 C#5/1 B4/1 A4/2 B4/.5 C#5/.5 D5/1 C#5/1 B4/1 A4/1 B4/1 C#5/1 D5/1 A4/1 G4/1 F#4/3 R/2' },
    deck: { name: 'Deck the Halls', bpm: 126, notes: 'C5/1.5 Bb4/.5 A4/1 G4/1 F4/1 G4/1 A4/1 F4/1 G4/.5 A4/.5 Bb4/.5 G4/.5 A4/1.5 G4/.5 F4/1 E4/1 F4/2 C5/1.5 Bb4/.5 A4/1 G4/1 F4/1 G4/1 A4/1 F4/1 G4/.5 A4/.5 Bb4/.5 G4/.5 A4/1.5 G4/.5 F4/1 E4/1 F4/2 G4/1.5 A4/.5 Bb4/1 G4/1 A4/1.5 Bb4/.5 C5/1 G4/1 A4/.5 B4/.5 C5/.5 A4/.5 Bb4/.5 A4/.5 G4/.5 F4/.5 E4/1 C4/1 C5/1.5 Bb4/.5 A4/1 G4/1 F4/1 G4/1 A4/1 F4/1 D5/.5 D5/.5 D5/.5 D5/.5 C5/1.5 Bb4/.5 A4/1 G4/1 F4/2 R/2' },
    emmanuel: { name: 'O Come, O Come, Emmanuel', bpm: 92, notes: 'E4/1 G4/1 B4/1 B4/1 B4/1 C5/1 B4/1 A4/1 G4/2 B4/1 C5/1 D5/1 E5/1 B4/1 D5/1 C5/1 B4/1 A4/1 G4/2 E5/1 D5/1 B4/1 B4/1 A4/1 G4/1 A4/1 G4/1 E4/2 E4/1 G4/1 B4/1 B4/1 B4/1 C5/1 B4/1 A4/1 G4/2 B4/1 D5/2 B4/1 E5/2 D5/1 B4/1 C5/1 B4/1 A4/1 G4/2 E4/1 G4/1 B4/1 B4/1 B4/1 C5/1 B4/1 A4/1 G4/3 R/2' },
    gloria: { name: 'Angels We Have Heard on High', bpm: 116, notes: 'F4/1 F4/1 F4/1 A4/1 C5/1 Bb4/1 A4/2 C5/1 D5/1 C5/1 Bb4/1 A4/2 F4/1 F4/1 F4/1 A4/1 C5/1 Bb4/1 A4/2 C5/1 D5/1 C5/1 Bb4/1 A4/2 F5/1.5 E5/.5 D5/.5 E5/.5 F5/.5 D5/.5 E5/1.5 D5/.5 C5/.5 D5/.5 E5/.5 C5/.5 D5/1.5 C5/.5 Bb4/.5 C5/.5 D5/.5 Bb4/.5 C5/2 F4/1 G4/1 A4/1 Bb4/1 A4/1 G4/1 F4/2 R/2' },
    wenceslas: { name: 'Good King Wenceslas', bpm: 120, notes: 'F4/1 F4/1 F4/1 G4/1 F4/1 F4/1 C4/2 D4/1 C4/1 D4/1 E4/1 F4/2 F4/2 F4/1 F4/1 F4/1 G4/1 F4/1 F4/1 C4/2 D4/1 C4/1 D4/1 E4/1 F4/2 F4/2 C5/1 Bb4/1 A4/1 G4/1 A4/1 G4/1 F4/2 D4/1 C4/1 D4/1 E4/1 F4/2 F4/2 C4/1 C4/1 D4/1 E4/1 F4/1 F4/1 G4/2 C5/1 Bb4/1 A4/1 G4/1 F4/2 Bb4/2 F4/4 R/2' },
    hark: { name: 'Hark! The Herald Angels Sing', bpm: 116, notes: 'C4/1 F4/1 F4/1.5 E4/.5 F4/1 A4/1 A4/1 G4/1 C5/1 C5/1 C5/1.5 Bb4/.5 A4/1 Bb4/1 A4/1 G4/1 C4/1 F4/1 F4/1.5 E4/.5 F4/1 A4/1 A4/1 G4/1 C5/1 A4/1 F4/1.5 A4/.5 G4/1 C4/1 F4/2 C5/1 C5/1 C5/1 F4/1 Bb4/1 A4/1 A4/1 G4/1 C5/1 C5/1 C5/1 F4/1 Bb4/1 A4/1 A4/1 G4/1 D5/1 D5/1 D5/1 C5/1 Bb4/1 A4/1 Bb4/1 C5/1 G4/1 A4/1 Bb4/1 A4/1 G4/1 F4/2 R/2' },
  };

  function stopMusic() {
    clearTimeout(st.loopTimer);
    st.loopTimer = null;
    for (const n of st.scheduled) { try { n.stop(); } catch (e) { /* already stopped */ } }
    st.scheduled = [];
    st.musicOn = false;
  }
  // Schedules one pass of a carol, then calls itself again if looping.
  function playCarol(key, loop = true) {
    const c = ensure();
    if (!c || !unlocked) return;
    const carol = CAROLS[key] || CAROLS.silent;
    stopMusic();
    st.current = key;
    st.musicOn = true;
    const beat = 60 / carol.bpm;
    let t = 0.05;
    for (const tok of carol.notes.split(/\s+/)) {
      const [n, d] = tok.split('/');
      const dur = Number(d) * beat;
      if (n !== 'R') boxNote(hz(n), t, dur, 0.45);
      t += dur;
    }
    if (loop) st.loopTimer = setTimeout(() => { if (st.musicOn) playCarol(key, true); }, t * 1000);
  }
  const musicSchedule = ['silent', 'joy', 'faithful', 'noel', 'deck', 'wish', 'emmanuel', 'gloria', 'jingle', 'wenceslas', 'hark'];

  window.Audio2 = {
    unlock, setVolume, sfx, CAROLS,
    get unlocked() { return unlocked; },
    get playing() { return st.musicOn ? st.current : null; },
    music: {
      play: playCarol, stop: stopMusic,
      forDay(n) { return musicSchedule[(n - 1) % musicSchedule.length]; },
      toggle(key) { if (st.musicOn) stopMusic(); else playCarol(key || st.current || 'silent'); return st.musicOn; },
    },
  };
})();
