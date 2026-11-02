'use strict';
// Decide whether a disc is a movie or a set of TV episodes, from its title list.

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const near = (a, b, tol) => Math.abs(a - b) <= Math.max(a, b) * tol;

// Feature-length titles on a disc, without "play all" joins or near-identical alternate copies.
function features(t) {
  const f = t.filter((x) => x.seconds >= 60 * 60).sort((a, b) => b.seconds - a.seconds);
  const keep = [];
  for (const x of f) {
    if (keep.some((k) => near(k.seconds, x.seconds, 0.04))) continue; // same film twice (another cut or a duplicate)
    keep.push(x);
  }
  // a title that is the sum of two others is a "play both" join
  const joined = (x) => keep.some((p, i) => keep.some((q, j) => j > i && p !== x && q !== x && near(p.seconds + q.seconds, x.seconds, 0.06)));
  return keep.filter((x) => !joined(x)).sort((a, b) => a.id - b.id);
}

// hint.season: the disc label names a season, so it is a TV disc even if it holds only one or two episodes.
function classify(titles, hint = {}) {
  const t = titles.filter((x) => x.seconds >= 60);
  if (!t.length) return { kind: 'unknown', reason: 'No playable titles were found.' };
  const longest = [...t].sort((a, b) => b.seconds - a.seconds || b.size - a.size)[0];

  // episode cluster: titles between 8 and 75 minutes whose length is within 30% of the cluster's median
  const cand = t.filter((x) => x.seconds >= 480 && x.seconds <= (hint.season ? 100 : 75) * 60);
  let best = [];
  for (const anchor of cand) {
    const group = cand.filter((x) => Math.abs(x.seconds - anchor.seconds) <= anchor.seconds * 0.3);
    const total = (g) => g.reduce((a, x) => a + x.seconds, 0);
    // a season-labelled disc: the episodes are the biggest chunk of video, not a pair of short extras
    if (hint.season ? total(group) > total(best) : group.length > best.length) best = group;
  }
  const tvResult = (grp) => {
    const eps = [...grp].sort((a, b) => a.id - b.id);
    const med = median(eps.map((x) => x.seconds));
    return { kind: 'tv', episodes: eps, medianMin: Math.round(med / 60), reason: `${eps.length} episode${eps.length === 1 ? '' : 's'} of about ${Math.round(med / 60)} minutes.` };
  };
  const med = best.length ? median(best.map((x) => x.seconds)) : 0;
  const featureLike = (grpMed, grp) => {
    const sum = grp.reduce((a, x) => a + x.seconds, 0);
    const playAll = Math.abs(sum - longest.seconds) / longest.seconds <= 0.12;
    return longest.seconds >= 85 * 60 && longest.seconds > grpMed * 2.2 && !playAll;
  };
  if (best.length >= 3 && !featureLike(med, best)) return tvResult(best);

  const feats = features(t);
  if (hint.season && best.length >= 1 && !featureLike(med, best)) return tvResult(best); // the label names a season
  if (feats.length >= 2) return { kind: 'movies', movies: feats, reason: `${feats.length} feature-length titles (${feats.map((x) => Math.round(x.seconds / 60) + ' min').join(', ')}), so it looks like more than one movie.` };

  // two similar-length episodes (a short season disc or a double episode disc)
  if (best.length === 2 && best.every((x) => x.seconds >= 15 * 60) && !(longest.seconds >= 50 * 60 && longest.seconds > med * 2.2)) return tvResult(best);

  if (longest.seconds >= 50 * 60) return { kind: 'movie', main: longest, reason: 'The longest title is the main feature.' };
  return { kind: 'unknown', main: longest, reason: 'The titles on this disc do not look like a movie or a set of episodes.' };
}

module.exports = { classify };
