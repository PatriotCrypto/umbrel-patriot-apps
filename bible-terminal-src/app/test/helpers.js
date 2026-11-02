'use strict';
const crypto = require('crypto');
const zlib = require('zlib');

const push = b => {
  if (b.length <= 0x4b) return Buffer.concat([Buffer.from([b.length]), b]);
  if (b.length <= 0xff) return Buffer.concat([Buffer.from([0x4c, b.length]), b]);
  const n = Buffer.alloc(2); n.writeUInt16LE(b.length); return Buffer.concat([Buffer.from([0x4d]), n, b]);
};

/** A taproot-style witness script holding an ordinals envelope. */
function envelope(content, { type = 'text/plain;charset=utf-8', gz = false } = {}) {
  const body = gz ? zlib.gzipSync(content) : content;
  const parts = [push(crypto.randomBytes(32)), Buffer.from([0xac, 0x00, 0x63]), push(Buffer.from('ord')), Buffer.from([0x01, 0x01]), push(Buffer.from(type))];
  if (gz) parts.push(Buffer.from([0x01, 0x09]), push(Buffer.from('gzip')));
  parts.push(Buffer.from([0x00]));
  for (let i = 0; i < body.length; i += 520) parts.push(push(body.subarray(i, i + 520)));
  parts.push(Buffer.from([0x68]));
  return Buffer.concat(parts);
}

/** An Esplora-shaped transaction carrying that inscription. */
const fakeTx = (txid, content, opts) => ({ txid, vin: [{ witness: ['aa'.repeat(64), envelope(content, opts).toString('hex'), 'c0' + '11'.repeat(32)] }] });

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
module.exports = { envelope, fakeTx, sha };
