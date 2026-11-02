'use strict';
// Pure helpers: file-safe names, fuzzy title matching, and disc-label cleanup.

function safeSegment(s) {
  let t = String(s || '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[. ]+/, '').replace(/[. ]+$/, '');
  while (Buffer.byteLength(t) > 200) t = t.slice(0, -1);
  return t;
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function lev(x, y) {
  if (Math.abs(x.length - y.length) > 3 || Math.min(x.length, y.length) < 6) return 0;
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return 1 - d[x.length][y.length] / Math.max(x.length, y.length);
}

function sim(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // labels often drop spaces ("FORRESTGUMP")
  if (x.replace(/ /g, '') === y.replace(/ /g, '')) return 1;
  const A = new Set(x.split(' ')), B = new Set(y.split(' '));
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return Math.max(inter / (A.size + B.size - inter), lev(x, y));
}

const GENERIC = /^(dvd ?video|dvd|disc ?\d*|video ?ts|volume|new volume|cdrom|untitled|no name|unknown|dvdvolume|logical volume id|movie|bluray|blu ray|bdmv|bd ?rom|bd ?video|bd ?disc|blu ?-?ray ?disc)$/i;

const SMALL = new Set(['of', 'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'vs']);
function titleCase(s) {
  return s.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

// "THE_SIMPSONS_S1_D2" -> { title: "The Simpsons", season: 1, disc: 2 }
function parseLabel(label) {
  const raw = String(label || '');
  let s = raw.replace(/[_.]+/g, ' ').replace(/(\d)([A-Za-z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  let season = null, disc = null;
  s = s.replace(/\b(?:season|series|s)\s?0*(\d{1,2})(?!\d)/i, (m, n) => { season = +n; return ' '; });
  s = s.replace(/\b(?:disc|disk|dvd|d)\s?0*(\d{1,2})(?!\d)/i, (m, n) => { disc = +n; return ' '; });
  s = s.replace(/\b(dvd|disc|disk|widescreen|ws|fullscreen|fs|ntsc|pal|r1|r2|special edition|collector'?s edition|video|blu ?-?ray|bluray|bd|br|uhd|hd|4k|1080p|1080i|usa|retail)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const generic = !s || GENERIC.test(raw.replace(/[_.]+/g, ' ').trim()) || GENERIC.test(s);
  if (s && s === s.toUpperCase()) s = titleCase(s);
  return { raw, title: generic ? '' : s, season, disc, generic };
}

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDur = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`; };
const fmtSize = (n) => { if (!n) return '?'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (n >= 100 || i === 0 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i]; };

module.exports = { safeSegment, norm, sim, parseLabel, pad2, fmtDur, fmtSize, titleCase };
