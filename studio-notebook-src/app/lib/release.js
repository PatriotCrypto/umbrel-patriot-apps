'use strict';
/*
 * Release planning: the dates worth knowing about, and a suggested date for the next release.
 * The rules are the common guidance for independent releases (release on a Friday, keep a steady
 * gap between songs, leave time to pitch, stay clear of the dead weeks). Nobody outside the
 * streaming services knows exactly how their recommendations work, so this is advice, not a formula.
 */
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const parse = (s) => new Date(s + 'T00:00:00Z');
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const nth = (y, m, weekday, n) => { const first = utc(y, m, 1); return utc(y, m, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7); };
const lastOf = (y, m, weekday) => { const end = utc(y, m + 1, 0); return addDays(end, -((end.getUTCDay() - weekday + 7) % 7)); };

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1, day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}

/* Dates a songwriter may want to aim a release at, or steer around. */
function eventsFor(y) {
  const e = easter(y), thanks = nth(y, 10, 4, 4);
  return [
    [utc(y, 0, 1), "New Year's Day"], [utc(y, 1, 14), "Valentine's Day"], [addDays(e, -2), 'Good Friday'], [e, 'Easter'],
    [nth(y, 4, 0, 2), "Mother's Day"], [lastOf(y, 4, 1), 'Memorial Day'], [nth(y, 5, 0, 3), "Father's Day"], [utc(y, 6, 4), 'Independence Day'],
    [nth(y, 8, 1, 1), 'Labor Day'], [utc(y, 10, 11), 'Veterans Day'], [thanks, 'Thanksgiving'], [addDays(thanks, 1), 'Black Friday'], [utc(y, 11, 25), 'Christmas'],
  ].map(([d, name]) => ({ date: iso(d), name }));
}
function events(fromIso, toIso) {
  const out = [];
  for (let y = +fromIso.slice(0, 4); y <= +toIso.slice(0, 4); y++) out.push(...eventsFor(y));
  return out.filter((e) => e.date >= fromIso && e.date <= toIso).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/* Fridays when a new song tends to get lost. */
function quietReason(d) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  if (iso(d) === iso(addDays(nth(y, 10, 4, 4), 1))) return 'Black Friday';
  if ((m === 11 && day >= 19) || (m === 0 && day <= 2)) return 'the Christmas and New Year weeks, when holiday playlists take over and most people are away';
  return '';
}
function fridayOnOrAfter(d) { return addDays(d, (5 - d.getUTCDay() + 7) % 7); }
function pickFriday(earliest) {
  let d = fridayOnOrAfter(earliest), skipped = '';
  for (let i = 0; i < 6; i++) { const why = quietReason(d); if (!why) break; skipped = why; d = addDays(d, 7); }
  return { d, skipped };
}
const nice = (s) => parse(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/* songs: [{title, status, releaseDate}]. today: 'YYYY-MM-DD'. */
function suggest(songs, cadenceWeeks, today) {
  const gap = [2, 3, 4, 6, 8].includes(+cadenceWeeks) ? +cadenceWeeks : 4;
  const t = parse(today);
  const dated = songs.filter((s) => s.releaseDate && s.status !== 'shelved').sort((a, b) => (a.releaseDate < b.releaseDate ? 1 : -1));
  const latest = dated[0] || null;
  const byGap = latest ? addDays(parse(latest.releaseDate), gap * 7) : t;
  const byLead = addDays(t, 21);
  const { d, skipped } = pickFriday(new Date(Math.max(byGap, byLead)));
  const date = iso(d);
  const reasons = ['It is a Friday. New releases, Release Radar and New Music Friday playlists all turn over on Fridays.'];
  if (latest) {
    const weeks = Math.round((d - parse(latest.releaseDate)) / DAY / 7);
    reasons.push(`It is ${weeks} weeks after "${latest.title}" (${nice(latest.releaseDate)}). Your setting is one release every ${gap} weeks, which gives each song time to work before the next one takes its place.`);
  } else reasons.push('No song has a release date yet, so this is simply the first good Friday.');
  const lead = Math.round((d - t) / DAY);
  reasons.push(`It is ${lead} days away. Upload to your distributor at least 3 weeks ahead, and pitch it in Spotify for Artists at least 7 days ahead so it can reach your followers' Release Radar.`);
  if (skipped) reasons.push(`An earlier Friday was skipped because it falls in ${skipped}.`);
  const near = events(iso(addDays(d, 7)), iso(addDays(d, 35)))[0];
  if (near) reasons.push(`${near.name} is ${nice(near.date)}. A song written for it would be out in good time.`);
  const alternates = [];
  const sooner = pickFriday(new Date(Math.max(latest ? addDays(parse(latest.releaseDate), 14) : t, addDays(t, 8)))).d;
  if (iso(sooner) < date) alternates.push({ date: iso(sooner), label: 'Sooner', note: 'The earliest Friday that still leaves a week to pitch. Tighter than your usual gap.' });
  alternates.push({ date: iso(pickFriday(addDays(d, gap * 7 - 6)).d), label: 'Later', note: 'One more gap further out.' });
  return { date, cadenceWeeks: gap, latest: latest ? { title: latest.title, date: latest.releaseDate } : null, reasons, alternates };
}

module.exports = { suggest, events, easter, quietReason };
