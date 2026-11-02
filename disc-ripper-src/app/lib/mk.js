'use strict';
// Parse MakeMKV's "robot" output (makemkvcon -r ...).

// MakeMKV quotes values with "" and escapes quotes as \"
function fields(rest) {
  const out = []; let i = 0;
  while (i < rest.length) {
    if (rest[i] === '"') {
      let j = i + 1, v = '';
      while (j < rest.length && rest[j] !== '"') { if (rest[j] === '\\' && j + 1 < rest.length) j++; v += rest[j++]; }
      out.push(v); i = j + 1;
      if (rest[i] === ',') i++;
    } else {
      const j = rest.indexOf(',', i);
      const end = j < 0 ? rest.length : j;
      out.push(rest.slice(i, end)); i = end + 1;
    }
  }
  return out;
}

function durSec(s) {
  const m = String(s || '').match(/^(\d+):(\d{2}):(\d{2})$/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

function parseInfo(text) {
  const disc = { name: '', volume: '' };
  const titles = new Map();
  const msgs = [];
  for (const line of String(text).split(/\r?\n/)) {
    const c = line.indexOf(':');
    if (c < 0) continue;
    const tag = line.slice(0, c), rest = line.slice(c + 1);
    if (tag === 'MSG') { const f = fields(rest); msgs.push({ code: +f[0], text: f[3] || '' }); }
    else if (tag === 'CINFO') {
      const f = fields(rest); const code = +f[0], val = f[2];
      if (code === 2) disc.name = val; else if (code === 32) disc.volume = val;
    } else if (tag === 'TINFO') {
      const f = fields(rest); const id = +f[0], code = +f[1], val = f[3];
      if (!titles.has(id)) titles.set(id, { id, name: '', seconds: 0, size: 0, chapters: 0, file: '' });
      const t = titles.get(id);
      if (code === 2) t.name = val;
      else if (code === 8) t.chapters = +val || 0;
      else if (code === 9) t.seconds = durSec(val);
      else if (code === 11) t.size = +val || 0;
      else if (code === 27) t.file = val;
    }
  }
  return { disc, titles: [...titles.values()].sort((a, b) => a.id - b.id), msgs };
}

// PRGV:current,total,max -> overall percent. "current" restarts at 0 for every
// phase of a job (analysing, saving...), so the bar must follow "total".
function parseProgress(line) {
  if (!line.startsWith('PRGV:')) return null;
  const f = line.slice(5).split(',').map(Number);
  return f[2] ? Math.max(0, Math.min(100, (f[1] / f[2]) * 100)) : null;
}

const KEY_PROBLEM = /(registration key|evaluation|key is invalid|invalid key|version is too old|too old|expired)/i;
function problemFrom(msgs) {
  const bad = msgs.filter((m) => KEY_PROBLEM.test(m.text));
  if (bad.length) return { keyProblem: true, text: bad[bad.length - 1].text };
  const err = msgs.filter((m) => /fail|error|can't|cannot|unable|no usable/i.test(m.text));
  return { keyProblem: false, text: err.length ? err[err.length - 1].text : '' };
}

module.exports = { fields, durSec, parseInfo, parseProgress, problemFrom, KEY_PROBLEM };
