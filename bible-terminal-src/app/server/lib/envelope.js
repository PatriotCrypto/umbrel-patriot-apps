'use strict';
// Reads the content of an Ordinals inscription out of a Bitcoin transaction's witness data.
// An inscription lives in a taproot script:  <pubkey> OP_CHECKSIG  OP_FALSE OP_IF "ord" ... OP_ENDIF
// We only need the first envelope of the first input that has one (inscription number i0).

const zlib = require('zlib');

function parseScript(buf) {
  const ops = [];
  let i = 0;
  while (i < buf.length) {
    const op = buf[i++];
    if (op === 0x00) ops.push({ t: 'push', d: Buffer.alloc(0), zero: true });
    else if (op <= 0x4b) { ops.push({ t: 'push', d: buf.subarray(i, i + op) }); i += op; }
    else if (op === 0x4c) { const n = buf[i]; i += 1; ops.push({ t: 'push', d: buf.subarray(i, i + n) }); i += n; }
    else if (op === 0x4d) { const n = buf.readUInt16LE(i); i += 2; ops.push({ t: 'push', d: buf.subarray(i, i + n) }); i += n; }
    else if (op === 0x4e) { const n = buf.readUInt32LE(i); i += 4; ops.push({ t: 'push', d: buf.subarray(i, i + n) }); i += n; }
    else if (op >= 0x51 && op <= 0x60) ops.push({ t: 'num', v: op - 0x50 });
    else ops.push({ t: 'op', v: op });
  }
  return ops;
}

function tagValue(o) {
  if (o.t === 'num') return o.v;
  if (o.t === 'push' && o.d.length === 1) return o.d[0];
  return null;
}

/** Find the first ord envelope in a parsed script. Returns { contentType, encoding, body } or null. */
function readEnvelope(ops) {
  for (let k = 0; k + 2 < ops.length; k++) {
    if (!(ops[k].t === 'push' && ops[k].zero)) continue;
    if (!(ops[k + 1].t === 'op' && ops[k + 1].v === 0x63)) continue;
    const proto = ops[k + 2];
    if (!(proto.t === 'push' && proto.d.toString('latin1') === 'ord')) continue;
    let j = k + 3;
    const fields = {};
    const body = [];
    let inBody = false;
    for (; j < ops.length; j++) {
      const o = ops[j];
      if (o.t === 'op' && o.v === 0x68) break; // OP_ENDIF
      if (!inBody) {
        if (o.t === 'push' && o.zero) { inBody = true; continue; }
        const tag = tagValue(o);
        const val = ops[++j];
        if (tag !== null && val && val.t === 'push') fields[tag] = val.d;
      } else if (o.t === 'push') {
        body.push(o.d);
      }
    }
    return {
      contentType: fields[1] ? fields[1].toString('utf8') : null,
      encoding: fields[9] ? fields[9].toString('utf8') : null,
      body: Buffer.concat(body),
    };
  }
  return null;
}

/** Candidate tapscripts in a witness stack (script is second to last item, ignoring an annex). */
function tapscripts(witness) {
  const items = witness.map(h => Buffer.from(h, 'hex'));
  if (items.length >= 2 && items[items.length - 1][0] === 0x50) items.pop(); // annex
  if (items.length < 2) return [];
  return [items[items.length - 2]];
}

/**
 * Extract the inscription from a transaction in the mempool.space / Esplora JSON shape
 * ({ vin: [{ witness: [hex, ...] }] }) or Bitcoin Core verbose getrawtransaction
 * ({ vin: [{ txinwitness: [hex, ...] }] }).
 */
function extractInscription(tx) {
  for (const vin of tx.vin || []) {
    const witness = vin.witness || vin.txinwitness;
    if (!witness || witness.length < 2) continue;
    for (const script of tapscripts(witness)) {
      let env;
      try { env = readEnvelope(parseScript(script)); } catch { env = null; }
      if (!env) continue;
      let body = env.body;
      if (env.encoding === 'gzip') body = zlib.gunzipSync(body);
      else if (env.encoding === 'br') body = zlib.brotliDecompressSync(body);
      else if (env.encoding) throw new Error('unsupported content-encoding: ' + env.encoding);
      return { contentType: env.contentType, content: body };
    }
  }
  return null;
}

module.exports = { parseScript, readEnvelope, extractInscription };
