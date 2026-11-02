// The 66 books. Ids follow the openbible.info cross-reference data set.
// [id, name, testament, aliases]  (aliases are matched after lowercasing and removing spaces and dots)
export const BOOK_TABLE = [
  ['Gen', 'Genesis', 'OT', ['gn', 'ge']],
  ['Exod', 'Exodus', 'OT', ['ex', 'exo']],
  ['Lev', 'Leviticus', 'OT', ['le', 'lv']],
  ['Num', 'Numbers', 'OT', ['nu', 'nm', 'nb']],
  ['Deut', 'Deuteronomy', 'OT', ['dt', 'de']],
  ['Josh', 'Joshua', 'OT', ['jos', 'jsh']],
  ['Judg', 'Judges', 'OT', ['jdg', 'jg', 'jdgs']],
  ['Ruth', 'Ruth', 'OT', ['ru', 'rth']],
  ['1Sam', '1 Samuel', 'OT', ['1sa', '1sm', '1s']],
  ['2Sam', '2 Samuel', 'OT', ['2sa', '2sm', '2s']],
  ['1Kgs', '1 Kings', 'OT', ['1ki', '1kg', '1k']],
  ['2Kgs', '2 Kings', 'OT', ['2ki', '2kg', '2k']],
  ['1Chr', '1 Chronicles', 'OT', ['1ch', '1chron']],
  ['2Chr', '2 Chronicles', 'OT', ['2ch', '2chron']],
  ['Ezra', 'Ezra', 'OT', ['ezr']],
  ['Neh', 'Nehemiah', 'OT', ['ne']],
  ['Esth', 'Esther', 'OT', ['est', 'es']],
  ['Job', 'Job', 'OT', ['jb']],
  ['Ps', 'Psalms', 'OT', ['psalm', 'psa', 'pss', 'psm', 'pslm']],
  ['Prov', 'Proverbs', 'OT', ['pro', 'pr', 'prv']],
  ['Eccl', 'Ecclesiastes', 'OT', ['ecc', 'ec', 'qoh']],
  ['Song', 'Song of Solomon', 'OT', ['sos', 'songofsongs', 'sng', 'canticles', 'so']],
  ['Isa', 'Isaiah', 'OT', ['is']],
  ['Jer', 'Jeremiah', 'OT', ['je', 'jr']],
  ['Lam', 'Lamentations', 'OT', ['la']],
  ['Ezek', 'Ezekiel', 'OT', ['eze', 'ezk']],
  ['Dan', 'Daniel', 'OT', ['da', 'dn']],
  ['Hos', 'Hosea', 'OT', ['ho']],
  ['Joel', 'Joel', 'OT', ['jl']],
  ['Amos', 'Amos', 'OT', ['am']],
  ['Obad', 'Obadiah', 'OT', ['ob', 'oba']],
  ['Jonah', 'Jonah', 'OT', ['jon', 'jnh']],
  ['Mic', 'Micah', 'OT', ['mi']],
  ['Nah', 'Nahum', 'OT', ['na']],
  ['Hab', 'Habakkuk', 'OT', ['hb']],
  ['Zeph', 'Zephaniah', 'OT', ['zep', 'zp']],
  ['Hag', 'Haggai', 'OT', ['hg']],
  ['Zech', 'Zechariah', 'OT', ['zec', 'zc']],
  ['Mal', 'Malachi', 'OT', ['ml']],
  ['Matt', 'Matthew', 'NT', ['mt', 'mat']],
  ['Mark', 'Mark', 'NT', ['mk', 'mrk', 'mr']],
  ['Luke', 'Luke', 'NT', ['lk', 'luk']],
  ['John', 'John', 'NT', ['jn', 'jhn']],
  ['Acts', 'Acts', 'NT', ['ac', 'act']],
  ['Rom', 'Romans', 'NT', ['ro', 'rm']],
  ['1Cor', '1 Corinthians', 'NT', ['1co']],
  ['2Cor', '2 Corinthians', 'NT', ['2co']],
  ['Gal', 'Galatians', 'NT', ['ga']],
  ['Eph', 'Ephesians', 'NT', ['ep', 'ephes']],
  ['Phil', 'Philippians', 'NT', ['php', 'pp', 'philip']],
  ['Col', 'Colossians', 'NT', ['co']],
  ['1Thess', '1 Thessalonians', 'NT', ['1th', '1thes']],
  ['2Thess', '2 Thessalonians', 'NT', ['2th', '2thes']],
  ['1Tim', '1 Timothy', 'NT', ['1ti', '1tm']],
  ['2Tim', '2 Timothy', 'NT', ['2ti', '2tm']],
  ['Titus', 'Titus', 'NT', ['tit', 'ti']],
  ['Phlm', 'Philemon', 'NT', ['phm', 'philem', 'pm']],
  ['Heb', 'Hebrews', 'NT', ['he']],
  ['Jas', 'James', 'NT', ['jm', 'jam']],
  ['1Pet', '1 Peter', 'NT', ['1pe', '1pt', '1p']],
  ['2Pet', '2 Peter', 'NT', ['2pe', '2pt', '2p']],
  ['1John', '1 John', 'NT', ['1jn', '1jo', '1j']],
  ['2John', '2 John', 'NT', ['2jn', '2jo', '2j']],
  ['3John', '3 John', 'NT', ['3jn', '3jo', '3j']],
  ['Jude', 'Jude', 'NT', ['jud', 'jd']],
  ['Rev', 'Revelation', 'NT', ['re', 'rv', 'revelations', 'apocalypse']],
];

export const BOOKS = BOOK_TABLE.map(([id, name, testament], i) => ({ id, name, testament, index: i }));
export const BOOK_BY_ID = Object.fromEntries(BOOKS.map(b => [b.id, b]));

const aliasMap = new Map();
for (const [id, name, , aliases] of BOOK_TABLE) {
  aliasMap.set(norm(name), id);
  aliasMap.set(norm(id), id);
  for (const a of aliases) if (!aliasMap.has(a)) aliasMap.set(a, id);
}
// explicit words people actually type; these win over short aliases
aliasMap.set('co', 'Col');
aliasMap.set('ps', 'Ps');
aliasMap.set('phil', 'Phil');

function norm(s) {
  return String(s).toLowerCase().replace(/[.\s]+/g, '');
}

// "I John", "II Kings", "First Samuel" -> "1 john" ...
function fixNumerals(s) {
  return s
    .replace(/^\s*(iii|third)\b\.?\s*/i, '3 ')
    .replace(/^\s*(ii|second)\b\.?\s*/i, '2 ')
    .replace(/^\s*(i|first)\b\.?\s+(?=[a-z])/i, '1 ');
}

/** Find a book id from free text ("1 Jn", "song of songs", "Psalm"). Returns null if unknown. */
export function findBook(text) {
  const n = norm(fixNumerals(text));
  if (!n) return null;
  if (aliasMap.has(n)) return aliasMap.get(n);
  // unique prefix of a full name ("deut", "revel")
  const hits = BOOK_TABLE.filter(([, name]) => norm(name).startsWith(n));
  if (hits.length === 1 && n.length >= 3) return hits[0][0];
  return null;
}

/**
 * Parse a reference like "John 3:16", "Jn 3", "ps 23:1-4", "1 cor 13".
 * Returns { book, chapter?, verse?, verseEnd? } or null.
 */
export function parseRef(input) {
  const s = String(input || '').trim();
  const m = s.match(/^((?:[1-3]|i{1,3}|first|second|third)?\.?\s*[a-z][a-z.\s]*?)\s*(?:(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?)?\s*$/i);
  if (!m) return null;
  const book = findBook(m[1]);
  if (!book) return null;
  const out = { book };
  if (m[2]) out.chapter = parseInt(m[2], 10);
  if (m[3]) out.verse = parseInt(m[3], 10);
  if (m[4]) out.verseEnd = parseInt(m[4], 10);
  return out;
}
