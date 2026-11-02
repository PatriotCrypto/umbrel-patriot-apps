'use strict';
// The user's personal data is one small JSON document: bookmarks, highlights, notes, plan progress,
// memorization cards and display preferences. The browser edits it and saves it here.
// Everything is validated on the way in so a bad client can't store junk.

const REF = /^[0-9A-Za-z]{2,6}\.\d{1,3}\.\d{1,3}$/;          // Gen.1.1
const REFSPAN = /^[0-9A-Za-z]{2,6}\.\d{1,3}\.\d{1,3}(-\d{1,3})?$/; // John.3.16-17
const COLORS = new Set(['y', 'g', 'b', 'p', 'r']);
const LIMITS = { bookmarks: 2000, highlights: 20000, notes: 5000, noteLen: 20000, cards: 2000 };

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = v => (Number.isFinite(v) ? v : 0);

function empty() {
  return { rev: 0, bookmarks: [], highlights: {}, notes: {}, plans: {}, cards: {}, prefs: {} };
}

function sanitize(input) {
  const d = empty();
  const x = input && typeof input === 'object' ? input : {};
  d.rev = Math.max(0, Math.floor(num(x.rev)));

  if (Array.isArray(x.bookmarks)) {
    for (const b of x.bookmarks.slice(0, LIMITS.bookmarks)) {
      if (b && typeof b.ref === 'string' && REFSPAN.test(b.ref)) {
        d.bookmarks.push({ ref: b.ref, label: str(b.label, 200), at: Math.floor(num(b.at)) });
      }
    }
  }
  if (x.highlights && typeof x.highlights === 'object') {
    for (const [k, c] of Object.entries(x.highlights).slice(0, LIMITS.highlights)) {
      if (REF.test(k) && COLORS.has(c)) d.highlights[k] = c;
    }
  }
  if (x.notes && typeof x.notes === 'object') {
    for (const [k, n] of Object.entries(x.notes).slice(0, LIMITS.notes)) {
      if (REFSPAN.test(k) && n && typeof n.text === 'string' && n.text.trim()) {
        d.notes[k] = { text: str(n.text, LIMITS.noteLen), at: Math.floor(num(n.at)) };
      }
    }
  }
  if (x.plans && typeof x.plans === 'object') {
    for (const [id, p] of Object.entries(x.plans).slice(0, 20)) {
      if (!/^[a-z0-9-]{1,40}$/.test(id) || !p || typeof p !== 'object') continue;
      const done = Array.isArray(p.done) ? [...new Set(p.done.filter(n => Number.isInteger(n) && n >= 1 && n <= 400))].sort((a, b) => a - b) : [];
      d.plans[id] = { start: Math.floor(num(p.start)), done };
    }
  }
  if (x.cards && typeof x.cards === 'object') {
    for (const [k, c] of Object.entries(x.cards).slice(0, LIMITS.cards)) {
      if (REFSPAN.test(k) && c && typeof c === 'object') {
        d.cards[k] = { box: Math.min(5, Math.max(0, Math.floor(num(c.box)))), due: Math.floor(num(c.due)), added: Math.floor(num(c.added)) };
      }
    }
  }
  if (x.prefs && typeof x.prefs === 'object') {
    const p = x.prefs;
    if (typeof p.skin === 'string' && /^[a-z]{3,12}$/.test(p.skin)) d.prefs.skin = p.skin;
    if (p.size >= 0.8 && p.size <= 1.6) d.prefs.size = p.size;
    if (typeof p.compare === 'boolean') d.prefs.compare = p.compare;
    if (typeof p.exact === 'boolean') d.prefs.exact = p.exact;
    if (p.lastRead && typeof p.lastRead === 'object' && /^[0-9A-Za-z]{2,6}$/.test(p.lastRead.b || '')) {
      d.prefs.lastRead = { b: p.lastRead.b, c: Math.min(200, Math.max(1, Math.floor(num(p.lastRead.c)) || 1)) };
    }
  }
  return d;
}

module.exports = { sanitize, empty, REF, REFSPAN };
