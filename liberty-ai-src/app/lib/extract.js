'use strict';
// Turns files into plain text for the search index. No dependencies:
// text formats are read directly, Office/ePub files are unzipped with Node's zlib,
// and PDFs use `pdftotext` (poppler) when it is installed in the image.
const fs = require('fs');
const zlib = require('zlib');
const { execFile } = require('child_process');

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'yml', 'yaml', 'ini', 'conf', 'toml', 'xml',
  'rst', 'tex', 'srt', 'vtt', 'js', 'py', 'sh', 'sql', 'cfg', 'env.example', 'nfo', 'org']);
const HTML_EXT = new Set(['html', 'htm', 'xhtml']);
const ZIP_EXT = new Set(['docx', 'odt', 'epub', 'pptx', 'xlsx', 'ods', 'odp']);
const MAX_CHARS = 2_000_000;

// File names and folders that are never indexed, whatever the user picked.
const DENY_NAME = /(^\.|\.env$|\.pem$|\.key$|\.p12$|\.pfx$|\.kdbx?$|\.keystore$|id_(rsa|ed25519|ecdsa)|wallet\.dat|\.macaroon$|seed|mnemonic|password|passwd|secret|credential|\.ovpn$|\.gpg$|\.asc$|shadow$)/i;
const DENY_DIR = /^(\.|node_modules$|\$RECYCLE|System Volume Information|lost\+found)/i;

function extOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

function supported(name, hasPdf) {
  const e = extOf(name);
  return TEXT_EXT.has(e) || HTML_EXT.has(e) || ZIP_EXT.has(e) || e === 'rtf' || (e === 'pdf' && hasPdf);
}

function isDenied(name, isDir) {
  return isDir ? DENY_DIR.test(name) : DENY_NAME.test(name);
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    }
    return ENT[g.toLowerCase()] !== undefined ? ENT[g.toLowerCase()] : m;
  });
}

function stripMarkup(s) {
  return decodeEntities(String(s)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br|text:p|w:p|a:p|text:h)>|<(br|text:line-break|w:br)\s*\/?>/gi, '\n')
    .replace(/<\/(td|th|w:tc)>/gi, '\t')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---- minimal ZIP reader (central directory + inflateRaw) ----
function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    out.push({ name, method, csize, usize, off });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

function zipRead(buf, e) {
  if (e.usize > 40 * 1024 * 1024) throw new Error('Zip entry too large');
  const nlen = buf.readUInt16LE(e.off + 26);
  const elen = buf.readUInt16LE(e.off + 28);
  const start = e.off + 30 + nlen + elen;
  const data = buf.slice(start, start + e.csize);
  if (e.method === 0) return data;
  if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 40 * 1024 * 1024 });
  throw new Error('Unsupported zip method');
}

function extractZip(buf, ext) {
  const entries = readZipEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const parts = [];
  const add = (name) => { const e = byName.get(name); if (e) parts.push(stripMarkup(zipRead(buf, e).toString('utf8'))); };
  if (ext === 'docx') add('word/document.xml');
  else if (ext === 'odt' || ext === 'ods' || ext === 'odp') add('content.xml');
  else if (ext === 'xlsx') add('xl/sharedStrings.xml');
  else if (ext === 'pptx') {
    entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .forEach((e) => parts.push(stripMarkup(zipRead(buf, e).toString('utf8'))));
  } else if (ext === 'epub') {
    entries.filter((e) => /\.(x?html?)$/i.test(e.name) && !/nav\./i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 400).forEach((e) => parts.push(stripMarkup(zipRead(buf, e).toString('utf8'))));
  }
  return parts.join('\n\n');
}

function pdfToText(file) {
  return new Promise((resolve, reject) => {
    execFile('pdftotext', ['-layout', '-q', '-enc', 'UTF-8', file, '-'], { timeout: 25000, maxBuffer: 24 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

let pdfChecked = null;
function hasPdftotext() {
  if (pdfChecked !== null) return Promise.resolve(pdfChecked);
  return new Promise((resolve) => {
    execFile('pdftotext', ['-v'], { timeout: 4000 }, (err) => {
      // pdftotext -v prints to stderr and exits 0; "not found" gives ENOENT.
      pdfChecked = !(err && err.code === 'ENOENT');
      resolve(pdfChecked);
    });
  });
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i++) { const c = buf[i]; if (c === 0 || (c < 7) || (c > 13 && c < 32 && c !== 27)) bad++; }
  return n > 0 && bad / n > 0.02;
}

async function extractFile(file, name) {
  const ext = extOf(name);
  if (ext === 'pdf') return (await pdfToText(file)).slice(0, MAX_CHARS);
  const buf = await fs.promises.readFile(file);
  if (ZIP_EXT.has(ext)) return extractZip(buf, ext).slice(0, MAX_CHARS);
  if (looksBinary(buf)) return '';
  let s = buf.toString('utf8');
  if (HTML_EXT.has(ext)) s = stripMarkup(s);
  else if (ext === 'rtf') s = decodeEntities(s.replace(/\\par[d]?/g, '\n').replace(/\\'[0-9a-f]{2}/gi, ' ').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, ''));
  else if (ext === 'json') s = s.replace(/[{}\[\]"]/g, ' ').replace(/,\s*\n/g, '\n');
  return s.slice(0, MAX_CHARS);
}

module.exports = { extractFile, supported, isDenied, extOf, hasPdftotext, stripMarkup, extractZip, readZipEntries, TEXT_EXT, ZIP_EXT };
