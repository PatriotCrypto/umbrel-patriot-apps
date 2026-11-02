'use strict';
// Station identity and sealed messages between two linked stations.
// Each station has an X25519 key pair. Two stations derive a shared key from
// their key pairs (static Diffie-Hellman + HKDF) and seal every request and reply
// with AES-256-GCM. Only the two linked stations can read or forge them.
const crypto = require('crypto');

function newIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const jwk = privateKey.export({ format: 'jwk' });
  return { x: jwk.x, d: jwk.d, pubCheck: publicKey.export({ format: 'jwk' }).x };
}
const pubKey = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x }, format: 'jwk' });
const privKey = (id) => crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'X25519', x: id.x, d: id.d }, format: 'jwk' });
const probe = crypto.generateKeyPairSync('x25519').privateKey;
const validCache = new Map();
function validPub(x) {
  if (typeof x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(x)) return false;
  if (validCache.has(x)) return validCache.get(x);
  let ok = false;
  try { const s = crypto.diffieHellman({ privateKey: probe, publicKey: pubKey(x) }); ok = s.length === 32 && s.some((b) => b !== 0); } catch { ok = false; }
  if (validCache.size > 2000) validCache.clear();
  validCache.set(x, ok); return ok;
}
const fingerprint = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 16);

const keyCache = new Map();
function sharedKey(me, peerX) {
  const ck = me.x + '|' + peerX;
  if (keyCache.has(ck)) return keyCache.get(ck);
  if (keyCache.size > 500) keyCache.clear();
  const s = crypto.diffieHellman({ privateKey: privKey(me), publicKey: pubKey(peerX) });
  const [a, b] = [me.x, peerX].sort();
  const k = Buffer.from(crypto.hkdfSync('sha256', s, Buffer.from('uplink-v1'), Buffer.from(a + b), 32));
  keyCache.set(ck, k);
  return k;
}

// sealed blob: iv(12) | tag(16) | ciphertext of [u32 metaLen][meta JSON][data]
function seal(key, aad, meta, data) {
  const m = Buffer.from(JSON.stringify(meta));
  const head = Buffer.alloc(4); head.writeUInt32BE(m.length);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(head), c.update(m), data ? c.update(data) : Buffer.alloc(0), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function open(key, aad, buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 32) throw new Error('bad envelope');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12)); d.setAAD(Buffer.from(aad)); d.setAuthTag(buf.subarray(12, 28));
  const p = Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  const n = p.readUInt32BE(0);
  if (n > p.length - 4) throw new Error('bad envelope');
  return { meta: JSON.parse(p.subarray(4, 4 + n).toString()), data: p.subarray(4 + n) };
}

// Safety number: 40 digits from a hash of both full public keys; the same on both stations
function safetyNumber(a, b) {
  const h = crypto.createHash('sha256').update('uplink-safety-v1|' + [a, b].sort().join('|')).digest();
  const groups = []; for (let i = 0; i < 8; i++) groups.push(String(h.readUInt32BE(i * 4) % 100000).padStart(5, '0'));
  return groups.join(' ');
}

module.exports = { safetyNumber, newIdentity, validPub, fingerprint, sharedKey, seal, open };
