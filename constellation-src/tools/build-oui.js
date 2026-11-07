'use strict';
// Build app/data/oui.tsv (MAC prefix -> vendor) from the npm "oui-data" package
// (IEEE registry data). Run from a folder where `npm install oui-data` was done:
//   node tools/build-oui.js /path/to/node_modules/oui-data/index.json app/data/oui.tsv
const fs = require('fs');

const [, , src, dest] = process.argv;
if (!src || !dest) {
  console.error('usage: node build-oui.js <oui-data index.json> <out.tsv>');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));

const SUFFIX = /[,\s]+(inc|inc\.|incorporated|llc|l\.l\.c\.|ltd|ltd\.|limited|co|co\.|corp|corp\.|corporation|gmbh|s\.a\.|b\.v\.|ag|oy|plc|pty|s\.r\.l\.|ab|a\/s|kg)[.,]?$/i;

function tidy(name) {
  let n = name.split('\n')[0].trim();
  for (let i = 0; i < 3; i++) n = n.replace(SUFFIX, '').trim();
  n = n.replace(/[,.\s]+$/, '');
  if (n === n.toUpperCase() && /[A-Z]/.test(n)) {
    n = n
      .split(/(\s+)/)
      .map((w) => (w.length <= 3 || /\d|[-&]/.test(w) ? w : w[0] + w.slice(1).toLowerCase()))
      .join('');
  }
  return n.slice(0, 40);
}

const lines = [];
for (const [prefix, vendor] of Object.entries(raw)) {
  if (!/^[0-9A-Fa-f]{6}$/.test(prefix)) continue;
  const v = tidy(String(vendor));
  if (!v || /^private$/i.test(v)) continue;
  lines.push(prefix.toUpperCase() + '\t' + v);
}
lines.sort();
fs.writeFileSync(dest, lines.join('\n') + '\n');
console.log('wrote', lines.length, 'prefixes to', dest);
