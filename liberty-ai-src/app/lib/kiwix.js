'use strict';
// Optional Kiwix connection: the Liberty Drive's "Wikipedia & Reference" shelf (Wikipedia, WikiMed,
// MedlinePlus, iFixit and more) served by a kiwix-serve on your own network. Read-only GETs only.
const { cleanText, isLocalUrl } = require('./util');

const decode = (s) => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

function tag(block, name) {
  const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i').exec(block);
  return m ? decode(m[1]).trim() : '';
}

function htmlToText(html) {
  let h = String(html).replace(/<(script|style|nav|table|sup)[\s\S]*?<\/\1>/gi, ' ');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(h);
  if (body) h = body[1];
  h = h.replace(/<\/(p|div|li|h\d|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return decode(h).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

class Kiwix {
  constructor({ fetchImpl, getUrl }) {
    this.fetch = fetchImpl;
    this.getUrl = getUrl;
    this.books = null;
    this.booksAt = 0;
  }

  base() {
    const u = String(this.getUrl() || '').replace(/\/+$/, '');
    return u && isLocalUrl(u) ? u : '';
  }

  async get(path, ms = 7000) {
    const b = this.base();
    if (!b) throw new Error('Kiwix is not set up');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await this.fetch(b + path, { signal: ctl.signal, headers: { Accept: '*/*' } });
      if (!res.ok) throw new Error('Kiwix answered ' + res.status);
      return await res.text();
    } finally { clearTimeout(t); }
  }

  async listBooks(force) {
    if (!force && this.books && Date.now() - this.booksAt < 300000) return this.books;
    const xml = await this.get('/catalog/v2/entries?count=60');
    const out = [];
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      const name = tag(m[1], 'name');
      if (name) out.push({ name, title: cleanText(tag(m[1], 'title'), 120) || name });
    }
    this.books = out;
    this.booksAt = Date.now();
    return out;
  }

  // Search the first few books and read the top articles.
  async search(query, { books = 3, articles = 3, chars = 1400 } = {}) {
    const list = await this.listBooks();
    const hits = [];
    for (const b of list.slice(0, books)) {
      let xml = '';
      try { xml = await this.get('/search?content=' + encodeURIComponent(b.name) + '&pattern=' + encodeURIComponent(query) + '&pageLength=2&format=xml'); } catch (e) { continue; }
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const title = cleanText(tag(m[1], 'title'), 120);
        const link = tag(m[1], 'link');
        let path = '';
        try { path = new URL(link, 'http://x').pathname; } catch (e) { path = ''; }
        if (title && path.startsWith('/')) hits.push({ book: b.title, title, path });
      }
    }
    const out = [];
    for (const h of hits.slice(0, articles)) {
      try {
        const text = htmlToText(await this.get(h.path.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/'))).slice(0, chars);
        if (text.length > 80) out.push(Object.assign({}, h, { text }));
      } catch (e) { /* skip this article */ }
    }
    return out;
  }
}

module.exports = { Kiwix, htmlToText };
