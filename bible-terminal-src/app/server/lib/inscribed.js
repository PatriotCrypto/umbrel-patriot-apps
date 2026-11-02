'use strict';
// The inscribed text is a plain-text KJV: a title block, then verses written as "C:V text".
// Several verses can share one paragraph ("... years: 1:15 And let them ..."), so we walk the
// markers in strict order: after C:V the next marker must be C:(V+1) or (C+1):1, whichever comes first.

function parseInscribedBook(text, id = 'book') {
  const flat = String(text).replace(/\r/g, '').replace(/\s+/g, ' ').trim();
  const find = (c, v, from) => {
    const needle = `${c}:${v} `;
    let i = from;
    for (;;) {
      i = flat.indexOf(needle, i);
      if (i < 0) return -1;
      if (i === 0 || flat[i - 1] === ' ') return i;
      i++;
    }
  };
  const first = find(1, 1, 0);
  if (first < 0) throw new Error(id + ': no 1:1 marker');
  const header = flat.slice(0, first).split(/ (?=Otherwise Called:|Commonly Called:|or )/).map(s => s.trim()).filter(Boolean);
  const verses = [];
  let c = 1, v = 1, pos = first;
  for (;;) {
    const start = pos + `${c}:${v} `.length;
    const a = find(c, v + 1, start), b = find(c + 1, 1, start);
    let next = -1, nc = c, nv = v;
    if (a >= 0 && (b < 0 || a < b)) { next = a; nv = v + 1; } else if (b >= 0) { next = b; nc = c + 1; nv = 1; }
    const end = next < 0 ? flat.length : next;
    verses.push({ c, v, t: flat.slice(start, end).trim() });
    if (next < 0) break;
    pos = next; c = nc; v = nv;
  }
  return { verses, header };
}

/** verses -> chapters[c-1][v-1]; returns { chapters, problems } */
function toChapters(verses, id = 'book') {
  const chapters = [];
  const problems = [];
  for (const { c, v, t } of verses) {
    while (chapters.length < c) chapters.push([]);
    const ch = chapters[c - 1];
    while (ch.length < v - 1) { ch.push(''); problems.push(`${id} ${c}:${ch.length} missing`); }
    ch[v - 1] = t;
  }
  return { chapters, problems };
}

module.exports = { parseInscribedBook, toChapters };
