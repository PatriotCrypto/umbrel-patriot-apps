'use strict';
// Title lookups: IMDb's public suggestions (movies) and TVmaze (TV shows and episode lists).
const IMDB = process.env.IMDB_ORIGIN || 'https://v2.sg.media-imdb.com';
const TVMAZE = process.env.TVMAZE_ORIGIN || 'https://api.tvmaze.com';
const UA = 'DiscRipper (Umbrel app; https://github.com/PatriotCrypto/umbrel-disc-ripper)';
const cache = new Map();
async function getJson(url, what) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < 3600e3) return hit.v;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }).catch((e) => { throw new Error(`Couldn't reach ${what}: ${e.message}`); });
  if (!res.ok) throw new Error(`${what} answered ${res.status}.`);
  const v = await res.json();
  cache.set(url, { t: Date.now(), v });
  return v;
}
const clean = (q) => String(q || '').replace(/[^\p{L}\p{N}\s'’.-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

async function findMovies(q) {
  q = clean(q); if (q.length < 2) return [];
  const key = q.toLowerCase();
  const d = (await getJson(`${IMDB}/suggestion/${/^[a-z0-9]/.test(key) ? key[0] : 'x'}/${encodeURIComponent(key)}.json`, 'the movie database')).d || [];
  return d.filter((x) => /^tt\d+$/.test(x.id || '') && ['movie', 'tvMovie'].includes(x.qid) && x.y).slice(0, 8)
    .map((x) => ({ id: x.id, type: x.qid, title: String(x.l || ''), year: String(x.y), cast: String(x.s || ''), poster: x.i && /^https:\/\/m\.media-amazon\.com\//.test(x.i.imageUrl || '') ? '/api/poster?u=' + encodeURIComponent(x.i.imageUrl.replace(/\._V1_[^/]*\.(jpg|png)$/i, '._V1_UX200_.jpg')) : '' }));
}
async function findShows(q) {
  q = clean(q); if (q.length < 2) return [];
  const r = await getJson(`${TVMAZE}/search/shows?q=${encodeURIComponent(q)}`, 'the TV database');
  return r.slice(0, 8).map((x) => ({ id: x.show.id, title: x.show.name, year: String(x.show.premiered || '').slice(0, 4), poster: x.show.image && /^https:\/\/static\.tvmaze\.com\//.test(x.show.image.medium || '') ? '/api/poster?u=' + encodeURIComponent(x.show.image.medium) : '' }));
}
async function showEpisodes(id) {
  if (!/^\d{1,9}$/.test(String(id))) throw new Error('Unknown show.');
  const s = await getJson(`${TVMAZE}/shows/${id}?embed=episodes`, 'the TV database');
  return { id: s.id, name: s.name, year: String(s.premiered || '').slice(0, 4), episodes: ((s._embedded && s._embedded.episodes) || []).map((e) => ({ season: e.season, number: e.number, name: e.name })) };
}
module.exports = { findMovies, findShows, showEpisodes, clean };
