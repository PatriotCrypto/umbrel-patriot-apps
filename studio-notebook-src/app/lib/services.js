'use strict';
/*
 * Looks up the artist's songs on Spotify so the notebook can show which are live.
 * Only runs when Sync is pressed. It sends nothing but the artist's public id.
 *  - Spotify: with an API key (optional, from developer.spotify.com) the whole catalogue;
 *    without one, the public artist widget, which only lists the current top tracks.
 */
const UA = { 'User-Agent': 'Mozilla/5.0 (StudioNotebook)' };

async function get(url, opts = {}) {
  const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000) }, opts, { headers: Object.assign({}, UA, opts.headers) }));
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res;
}

const spotifyArtistId = (url) => { const m = /(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?(?:embed\/)?artist\/|spotify:artist:)([A-Za-z0-9]{22})/.exec(String(url)); return m ? m[1] : ''; };

/* "Homesick West Virginia (feat. X) - Single" -> "homesick west virginia" */
function normTitle(t) {
  return String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[\[(](feat|ft|with|prod)[^\])]*[\])]/g, ' ').replace(/\s-\s(single|ep)$/g, ' ').replace(/&/g, ' and ')
    .replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
/* Same title, or the same but for an abbreviation: "Homesick WV" and "Homesick West Virginia". */
function sameTitle(a, b) {
  const x = normTitle(a), y = normTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const squash = (long, short) => {
    const L = long.split(' '), S = short.split(' ');
    if (S.length >= L.length) return false;
    let i = 0;
    for (const s of S) {
      if (L[i] === s) { i++; continue; }
      let n = 0;
      while (n < s.length && i + n < L.length && L[i + n][0] === s[n]) n++;
      if (n !== s.length || n < 2) return false;
      i += n;
    }
    return i === L.length;
  };
  return squash(x, y) || squash(y, x);
}

function parseSpotifyWidget(html) {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return [];
  let list = [];
  try { list = JSON.parse(m[1]).props.pageProps.state.data.entity.trackList || []; } catch (e) { return []; }
  return list.filter((t) => /^spotify:track:[A-Za-z0-9]{22}$/.test(t.uri || '') && t.title)
    .map((t) => ({ title: t.title, spotify: 'https://open.spotify.com/track/' + t.uri.split(':')[2], date: '' }));
}
async function spotifyWidgetTracks(artistId) {
  return parseSpotifyWidget(await (await get(`https://open.spotify.com/embed/artist/${artistId}`)).text());
}
async function spotifyApiTracks(artistId, clientId, secret) {
  const tok = await (await get('https://accounts.spotify.com/api/token', { method: 'POST', body: 'grant_type=client_credentials',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64') } })).json();
  const auth = { headers: { Authorization: 'Bearer ' + tok.access_token } };
  const step = async (what, u) => { const r = await get(u, auth); if (!r.ok) throw new Error(what + ' answered ' + r.status); return r.json(); };
  const albums = [];
  let url = `https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album,single&limit=50`;
  for (let page = 0; url && page < 6; page++) { const j = await step('Spotify albums', url); albums.push(...(j.items || [])); url = j.next; }
  const out = [];
  /* One request per album: Spotify removed the several-albums-at-once request in 2026. */
  for (const al of albums.slice(0, 120)) {
    const j = await step('Spotify album tracks', `https://api.spotify.com/v1/albums/${al.id}/tracks?limit=50`);
    for (const t of j.items || []) {
      if (!(t.artists || []).some((a) => a.id === artistId)) continue;
      out.push({ title: t.name, spotify: 'https://open.spotify.com/track/' + t.id, date: /^\d{4}-\d\d-\d\d$/.test(al.release_date) ? al.release_date : '' });
    }
  }
  return out;
}

/* One entry per song title. */
function merge(spotify) {
  const out = [];
  for (const t of spotify) {
    const r = out.find((x) => sameTitle(x.title, t.title));
    if (r) { if (!r.spotify) r.spotify = t.spotify; if (!r.date && t.date) r.date = t.date; }
    else out.push({ title: t.title, spotify: t.spotify, date: t.date });
  }
  return out;
}

/* settings: { spotifyUrl, spotifyClientId, spotifyClientSecret } */
async function catalogue(settings) {
  const notes = [];
  let spotify = [], spotifyFull = false;
  const sid = spotifyArtistId(settings.spotifyUrl);
  if (sid) {
    if (settings.spotifyClientId && settings.spotifyClientSecret) {
      try { spotify = await spotifyApiTracks(sid, settings.spotifyClientId, settings.spotifyClientSecret); spotifyFull = true; }
      catch (e) { notes.push('The Spotify key did not work (' + e.message + '), so only your top tracks were checked.'); }
    }
    if (!spotifyFull) { try { spotify = await spotifyWidgetTracks(sid); } catch (e) { notes.push('Spotify could not be reached: ' + e.message + '.'); } }
  } else if (settings.spotifyUrl) notes.push('The Spotify link does not look like an artist page.');
  return { tracks: merge(spotify), notes, counts: { spotify: spotify.length }, spotifyFull, haveSpotify: !!sid };
}

module.exports = { catalogue, merge, sameTitle, normTitle, parseSpotifyWidget, spotifyArtistId };
