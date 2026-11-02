'use strict';
// Work out which movie or show a disc is, from the label and the titles stored on the disc.
const N = require('./names');

const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const WEAK = 0.55;
const toks = (s) => N.norm(s).split(' ').filter(Boolean);
const digitsOf = (s) => new Set(toks(s).map((t) => (ROMAN[t] ? String(ROMAN[t]) : t)).filter((t) => /^\d{1,2}$/.test(t)));

// How well a search result's title fits what we searched for (0 to 1).
function score(query, title, year, candYear) {
  let s = N.sim(query, title);
  const A = toks(query), B = new Set(toks(title));
  // the label left off the subtitle ("Pirates of the Caribbean" vs "...: Dead Man's Chest")
  if (A.length >= 2 && A.every((t) => B.has(t))) s = Math.max(s, 0.6 + 0.4 * A.length / B.size);
  // a sequel number in the label that the title lacks ("... 2" vs "... The Curse of the Black Pearl")
  const td = digitsOf(title);
  for (const d of digitsOf(query)) if (!td.has(d)) { s *= 0.5; break; }
  if (year && candYear && String(year) === String(candYear)) s = Math.min(1, s + 0.1);
  return s;
}

// "Pirates Of The Caribbean 2" or "... Part II" -> { base: "Pirates Of The Caribbean", n: 2 }
function splitSequel(q) {
  const m = String(q || '').trim().match(/^(.*?\S)\s+(?:part\s+|chapter\s+|vol(?:ume)?\.?\s+)?(\d{1,2}|ii|iii|iv|v|vi|vii|viii|ix)$/i);
  if (!m) return null;
  const raw = m[2].toLowerCase();
  const n = /^\d+$/.test(raw) ? +raw : ROMAN[raw];
  return n >= 1 && n <= 12 ? { base: m[1].trim(), n } : null;
}

function stripYear(q) {
  const m = String(q || '').match(/^(.*?)[\s(\[]*\b((?:19|20)\d\d)\b[\s)\]]*$/);
  return m && m[1].trim().length >= 2 ? { q: m[1].trim(), year: m[2] } : { q: String(q || '').trim(), year: '' };
}

// Pick the best result. Not a match if nothing fits, or if several films fit equally well (a franchise name alone).
function pick(query, cands, year) {
  let best = null, bs = 0;
  for (const c of cands) { let v = score(query, c.title, year, c.year); if (c.type === 'tvMovie') v -= 0.001; if (v > bs) { bs = v; best = c; } }
  const close = new Set(cands.filter((c) => score(query, c.title, year, c.year) >= 0.6).map((c) => N.norm(c.title))).size;
  const ambiguous = bs < 0.9 && close >= 2;
  return { best: bs >= WEAK && !ambiguous ? best : null, score: bs, ambiguous };
}

const uniq = (list) => { const seen = new Set(); return list.filter((x) => { const k = N.norm(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };

// queries: texts to try in order (disc label, then the disc's own title names).
async function resolveMovie(META, queries) {
  const pool = []; const ids = new Set();
  const add = (cands) => { for (const c of cands) if (!ids.has(c.id)) { ids.add(c.id); pool.push(c); } };
  let best = null, bscore = 0, ambiguous = false, note = '';
  const variants = [];
  for (const q of queries) { variants.push(q); const w = String(q || '').trim().split(/\s+/); if (w.length >= 3) variants.push(w.slice(1).join(' ')); } // "POTC On Stranger Tides" -> "On Stranger Tides"
  for (const raw of uniq(variants)) {
    const { q, year } = stripYear(raw);
    let cands = []; try { cands = await META.findMovies(q); } catch {}
    add(cands);
    const r = pick(q, cands, year);
    if (r.best && r.score >= 0.9) {
      // IMDb lists the best-known title first: if that one also fits, it is the likelier film ("Dead Man's Chest" is also a 1965 western)
      const first = cands[0];
      if (first && first.id !== r.best.id && first.type === 'movie' && score(q, first.title, year, first.year) >= 0.6) return { match: first, sure: false, candidates: pool, note: `Two films fit "${q}". Picked the better-known one; check the year.` };
      return { match: r.best, sure: !r.ambiguous, candidates: pool, note: '' };
    }
    if (r.best && r.score > bscore) { best = r.best; bscore = r.score; }
    if (r.ambiguous) ambiguous = true;
    // "Title 2": the second film in the series, by release year
    const seq = splitSequel(q);
    if (seq) {
      let fam = []; try { fam = await META.findMovies(seq.base); } catch {}
      add(fam);
      const bn = N.norm(seq.base);
      const films = fam.filter((c) => c.type === 'movie' && N.norm(c.title).startsWith(bn)).sort((a, b) => +a.year - +b.year);
      if (films.length >= seq.n) return { match: films[seq.n - 1], sure: false, candidates: pool, note: `Chosen by number: film ${seq.n} of ${films.length} called "${seq.base}…" by release year. Check it.` };
    }
  }
  if (best && !ambiguous) return { match: best, sure: bscore >= 0.9, candidates: pool, note: '' };
  return { match: null, sure: false, candidates: pool, note: ambiguous ? 'Several films fit this label, so pick the right one.' : '' };
}

const TV_NOISE = /\b(the )?complete (series|collection|seasons?)|box ?set|collection|special edition|bonus( disc)?\b/gi;
async function resolveShow(META, queries) {
  const pool = []; const ids = new Set();
  let best = null, bscore = 0;
  const variants = [];
  for (const q of queries) { variants.push(q); const c = String(q || '').replace(TV_NOISE, ' ').replace(/\s+/g, ' ').trim(); if (c && c !== q) variants.push(c); }
  for (const raw of uniq(variants)) {
    const { q, year } = stripYear(raw);
    let cands = []; try { cands = await META.findShows(q); } catch {}
    for (const c of cands) if (!ids.has(c.id)) { ids.add(c.id); pool.push(c); }
    for (const c of cands) { const v = score(q, c.title, year, c.year); if (v > bscore) { bscore = v; best = c; } }
    if (bscore >= 0.9) break;
  }
  return { match: bscore >= WEAK ? best : null, score: bscore, candidates: pool };
}

module.exports = { resolveMovie, resolveShow, score, splitSequel, stripYear, pick, WEAK };
