'use strict';
// Encrypted vault for firearms, medical records and secure notes.
//
// A random 256-bit data key (DEK) encrypts the vault with AES-256-GCM. The DEK
// is stored twice, wrapped by a key derived (scrypt) from the PIN and by a key
// derived from a one-time recovery code. Forget the PIN, use the recovery code.
// Lose both and the data cannot be recovered.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { VCOLL } = require('./schema');

const scrypt = promisify(crypto.scrypt);
const KDF = { N: 32768, r: 8, p: 1 };
const AAD_WRAP = Buffer.from('rp-wrap-v1');
const AAD_DATA = Buffer.from('rp-vault-v1');
const uid = () => crypto.randomBytes(6).toString('base64url');

async function kek(secret, salt) {
  return scrypt(Buffer.from(secret, 'utf8'), salt, 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 128 * 1024 * 1024 });
}

function seal(key, plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

function open(key, box, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAAD(aad);
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]);
}

const normRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '');

function makeRecovery() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.randomBytes(20);
  let s = '';
  for (let i = 0; i < 20; i++) s += alphabet[bytes[i] % 32];
  return s.match(/.{4}/g).join('-');
}

class Vault {
  constructor(dir, autoLockMinutes) {
    this.file = path.join(dir, 'vault.enc');
    this.autoLockMinutes = autoLockMinutes || (() => 15);
    this.dek = null;
    this.data = null;
    this.timer = null;
    this.fails = [];
    this.lockedUntil = 0;
    this.lastActive = 0;
  }

  exists() { return fs.existsSync(this.file); }
  isUnlocked() { return !!this.dek; }

  _env() { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }

  _blank() {
    const d = {};
    for (const k of Object.keys(VCOLL)) d[k] = [];
    return d;
  }

  status() {
    return {
      exists: this.exists(),
      unlocked: this.isUnlocked(),
      lockedOutSeconds: Math.max(0, Math.ceil((this.lockedUntil - Date.now()) / 1000)),
    };
  }

  touch() {
    if (!this.dek) return;
    this.lastActive = Date.now();
    if (this.timer) clearTimeout(this.timer);
    const min = +this.autoLockMinutes();
    if (min > 0) {
      this.timer = setTimeout(() => this.lock(), min * 60000);
      if (this.timer.unref) this.timer.unref();
    }
  }

  lock() {
    if (this.dek) this.dek.fill(0);
    this.dek = null;
    this.data = null;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  _checkLockout() {
    const now = Date.now();
    if (now < this.lockedUntil) {
      const err = new Error('Too many wrong attempts. Try again in ' + Math.ceil((this.lockedUntil - now) / 1000) + ' seconds.');
      err.code = 'LOCKOUT';
      throw err;
    }
  }

  _fail() {
    const now = Date.now();
    this.fails = this.fails.filter((t) => now - t < 10 * 60000);
    this.fails.push(now);
    if (this.fails.length >= 5) { this.lockedUntil = now + 5 * 60000; this.fails = []; }
  }

  async setup(pin) {
    if (this.exists()) throw new Error('Vault already exists');
    if (typeof pin !== 'string' || pin.length < 4) throw new Error('PIN must be at least 4 characters');
    const dek = crypto.randomBytes(32);
    const recovery = makeRecovery();
    const sp = crypto.randomBytes(16); const sr = crypto.randomBytes(16);
    const env = {
      v: 1, kdf: KDF,
      pin: Object.assign({ salt: sp.toString('base64') }, seal(await kek(pin, sp), dek, AAD_WRAP)),
      rec: Object.assign({ salt: sr.toString('base64') }, seal(await kek(normRecovery(recovery), sr), dek, AAD_WRAP)),
      payload: null,
    };
    this.dek = dek;
    this.data = this._blank();
    this._write(env);
    this.touch();
    return { recovery };
  }

  _write(env) {
    env = env || this._env();
    env.payload = seal(this.dek, Buffer.from(JSON.stringify(this.data), 'utf8'), AAD_DATA);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(env), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  save() { if (this.dek) this._write(); }

  async _tryUnwrap(code) {
    const env = this._env();
    try {
      const dek = open(await kek(code, Buffer.from(env.pin.salt, 'base64')), env.pin, AAD_WRAP);
      return { dek, env };
    } catch (e) { /* not the PIN */ }
    try {
      const dek = open(await kek(normRecovery(code), Buffer.from(env.rec.salt, 'base64')), env.rec, AAD_WRAP);
      return { dek, env, viaRecovery: true };
    } catch (e) { /* not the recovery code either */ }
    return null;
  }

  async unlock(code) {
    if (!this.exists()) throw new Error('No vault yet');
    this._checkLockout();
    const r = await this._tryUnwrap(String(code || ''));
    if (!r) { this._fail(); return false; }
    this.fails = [];
    const data = JSON.parse(open(r.dek, r.env.payload, AAD_DATA).toString('utf8'));
    for (const k of Object.keys(VCOLL)) if (!Array.isArray(data[k])) data[k] = [];
    this.dek = r.dek;
    this.data = data;
    this.touch();
    return { viaRecovery: !!r.viaRecovery };
  }

  // check a PIN or recovery code without unlocking
  async verify(code) {
    if (!this.exists()) return true;
    this._checkLockout();
    const r = await this._tryUnwrap(String(code || ''));
    if (!r) { this._fail(); return false; }
    r.dek.fill(0);
    this.fails = [];
    return true;
  }

  async changePin(current, next) {
    if (typeof next !== 'string' || next.length < 4) throw new Error('New PIN must be at least 4 characters');
    this._checkLockout();
    const r = await this._tryUnwrap(String(current || ''));
    if (!r) { this._fail(); return false; }
    const sp = crypto.randomBytes(16);
    r.env.pin = Object.assign({ salt: sp.toString('base64') }, seal(await kek(next, sp), r.dek, AAD_WRAP));
    if (!this.dek) { this.dek = r.dek; this.data = JSON.parse(open(r.dek, r.env.payload, AAD_DATA).toString('utf8')); }
    this._write(r.env);
    this.touch();
    return true;
  }

  // new recovery code (vault must be unlocked)
  async rotateRecovery() {
    if (!this.dek) throw new Error('Vault is locked');
    const env = this._env();
    const recovery = makeRecovery();
    const sr = crypto.randomBytes(16);
    env.rec = Object.assign({ salt: sr.toString('base64') }, seal(await kek(normRecovery(recovery), sr), this.dek, AAD_WRAP));
    this._write(env);
    return { recovery };
  }

  // ---- collections
  col(name) { this.touch(); return this.data[name]; }

  add(name, doc) {
    const now = new Date().toISOString();
    const rec = Object.assign({ id: uid(), created: now, updated: now }, doc);
    this.col(name).push(rec);
    this.save();
    return rec;
  }

  update(name, id, doc) {
    const arr = this.col(name);
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const old = arr[i];
    arr[i] = Object.assign({}, doc, { id: old.id, created: old.created, updated: new Date().toISOString() });
    this.save();
    return arr[i];
  }

  remove(name, id) {
    const arr = this.col(name);
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [gone] = arr.splice(i, 1);
    this.save();
    return gone;
  }

  // encrypted file for backups (never decrypted)
  exportEnvelope() {
    if (!this.exists()) return null;
    return this._env();
  }

  importEnvelope(env) {
    this.lock();
    if (!env || !env.pin || !env.rec || !env.payload) throw new Error('Not a vault backup');
    fs.writeFileSync(this.file, JSON.stringify(env), { mode: 0o600 });
  }

  destroy() {
    this.lock();
    try { fs.unlinkSync(this.file); } catch (e) { /* none */ }
  }
}

module.exports = { Vault };
