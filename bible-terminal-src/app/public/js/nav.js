export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
  return { name: parts[0] || '', parts: parts.slice(1), q: new URLSearchParams(query) };
}
export const href = (name, parts = [], q = {}) => {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)).toString();
  return '#/' + [name, ...parts.map(encodeURIComponent)].join('/') + (qs ? '?' + qs : '');
};
export const readHref = (id, c, v, len = 0) => href('read', [id, c], v ? { v: len ? `${v}-${v + len}` : v } : {});

/** "Gen 6-9", "John 3:16", "Ps 23" -> { book, c, c2, v, v2 } or null  (used for timeline and plan references) */
export function parseSpan(text, findBook) {
  const m = String(text).trim().match(/^(.+?)\s+(\d+)(?:\s*[-–]\s*(\d+))?(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/);
  if (!m) return null;
  const book = findBook(m[1]);
  if (!book) return null;
  return { book, c: +m[2], c2: m[3] && !m[4] ? +m[3] : null, v: m[4] ? +m[4] : null, v2: m[5] ? +m[5] : null };
}
