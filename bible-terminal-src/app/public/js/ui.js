export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/** Wrap matches of `re` (global, case-insensitive) inside plain text with <mark>, returning safe HTML. */
export function markHtml(text, re) {
  if (!re) return esc(text);
  let out = '', last = 0, m;
  re.lastIndex = 0;
  // the search regex expects word boundaries on normalised text, so run it on a space-padded copy
  const padded = ' ' + text + ' ';
  while ((m = re.exec(padded))) {
    if (!m[0]) { re.lastIndex++; continue; }
    const s = m.index - 1, e = s + m[0].length;
    if (s < last) continue;
    out += esc(text.slice(last, Math.max(s, 0))) + '<mark>' + esc(text.slice(Math.max(s, 0), e)) + '</mark>';
    last = e;
  }
  return out + esc(text.slice(last));
}

export function download(name, text, type = 'text/markdown') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('api/' + path, {
    method,
    headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-bt': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) throw new Error((j && j.error) || `HTTP ${r.status}`);
  return j;
}

export const fmtBytes = n => n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.ceil(n / 1e3) + ' KB';
export const fmtDate = ms => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
