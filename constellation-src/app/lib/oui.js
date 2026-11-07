'use strict';
const fs = require('fs');
const path = require('path');

let map = null;

function load(file) {
  map = new Map();
  const txt = fs.readFileSync(file || path.join(__dirname, '..', 'data', 'oui.tsv'), 'utf8');
  for (const line of txt.split('\n')) {
    if (line.length > 7 && line[6] === '\t') map.set(line.slice(0, 6), line.slice(7));
  }
  return map.size;
}

// Vendor name for a MAC, or null (unknown, or a private/random address).
function lookup(mac) {
  if (!map) load();
  const key = String(mac).replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
  if (key.length < 6) return null;
  return map.get(key) || null;
}

module.exports = { lookup, load };
