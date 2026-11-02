'use strict';
// Minimal protobuf wire-format reader/writer: just enough for the handful of
// Meshtastic messages Skynet needs. Written from the public wire-format spec;
// no Meshtastic code is bundled.

function readVarint(buf, pos) {
  let result = 0n, shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error('varint overrun');
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
    if (shift > 70n) throw new Error('varint too long');
  }
  return [result, pos];
}

// Decode a message into { fieldNumber: [values...] }.
// wire 0 -> BigInt, wire 1 -> Buffer(8), wire 2 -> Buffer, wire 5 -> Buffer(4)
function decode(buf) {
  const out = {};
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Number(key >> 3n), wire = Number(key & 7n);
    let val;
    if (wire === 0) { [val, pos] = readVarint(buf, pos); }
    else if (wire === 1) { if (pos + 8 > buf.length) throw new Error('short'); val = buf.subarray(pos, pos + 8); pos += 8; }
    else if (wire === 2) {
      let len; [len, pos] = readVarint(buf, pos); len = Number(len);
      if (pos + len > buf.length) throw new Error('short');
      val = buf.subarray(pos, pos + len); pos += len;
    } else if (wire === 5) { if (pos + 4 > buf.length) throw new Error('short'); val = buf.subarray(pos, pos + 4); pos += 4; }
    else throw new Error('bad wire type ' + wire);
    (out[field] = out[field] || []).push(val);
  }
  return out;
}

const first = (m, f) => (m[f] ? m[f][0] : undefined);
const u32 = (m, f) => { const v = first(m, f); return v === undefined ? undefined : (Buffer.isBuffer(v) ? v.readUInt32LE(0) : Number(BigInt.asUintN(32, v))); };
const i32 = (m, f) => { const v = first(m, f); return v === undefined ? undefined : (Buffer.isBuffer(v) ? v.readInt32LE(0) : Number(BigInt.asIntN(32, v))); };
const f32 = (m, f) => { const v = first(m, f); return v === undefined || !Buffer.isBuffer(v) ? undefined : v.readFloatLE(0); };
const bool = (m, f) => { const v = first(m, f); return v === undefined ? undefined : v !== 0n; };
const bytes = (m, f) => first(m, f);
const str = (m, f) => { const v = first(m, f); return Buffer.isBuffer(v) ? v.toString('utf8') : undefined; };
const msg = (m, f) => { const v = first(m, f); return Buffer.isBuffer(v) ? decode(v) : undefined; };

// ---- writing ----
function varint(n) {
  let v = BigInt(n);
  if (v < 0n) v = BigInt.asUintN(64, v);
  const out = [];
  while (v > 0x7fn) { out.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
  out.push(Number(v));
  return Buffer.from(out);
}
const key = (field, wire) => varint((field << 3) | wire);
const wVarint = (field, n) => Buffer.concat([key(field, 0), varint(n)]);
const wFixed32 = (field, n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return Buffer.concat([key(field, 5), b]); };
const wBytes = (field, buf) => Buffer.concat([key(field, 2), varint(buf.length), buf]);

module.exports = { decode, first, u32, i32, f32, bool, bytes, str, msg, varint, wVarint, wFixed32, wBytes };
