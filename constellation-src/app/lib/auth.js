'use strict';
// Password sign-in. Host networking means Umbrel's own login is not in front of
// this app, so the app guards itself: scrypt-hashed password, signed session
// cookie, one-time recovery code, and throttled login attempts.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COOKIE = 'cs_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }

function hashSecret(secret, salt) {
  return crypto.scryptSync(String(secret), salt, 32, { N: 16384, r: 8, p: 1 });
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function makeRecoveryCode() {
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) {
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    if (i % 5 === 4 && i < 19) out += '-';
  }
  return out;
}

class Auth {
  constructor(dir, { disabled = false } = {}) {
    this.file = path.join(dir, 'auth.json');
    this.disabled = disabled;
    this.fails = new Map(); // ip -> { n, until }
    this.data = null;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { this.data = null; }
  }

  get configured() { return !!(this.data && this.data.hash); }

  _save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  _store(password, recoveryCode) {
    const salt = crypto.randomBytes(16);
    const rsalt = crypto.randomBytes(16);
    this.data = {
      salt: b64u(salt),
      hash: b64u(hashSecret(password, salt)),
      rsalt: b64u(rsalt),
      rhash: b64u(hashSecret(recoveryCode.replace(/-/g, ''), rsalt)),
      secret: b64u(crypto.randomBytes(32)), // rotating this signs everyone out
    };
    this._save();
  }

  // First-run setup. Returns the recovery code (shown once) or throws.
  setup(password) {
    if (this.configured) throw Object.assign(new Error('Already set up'), { status: 409 });
    checkPassword(password);
    const code = makeRecoveryCode();
    this._store(password, code);
    return code;
  }

  verify(password) {
    if (!this.configured || typeof password !== 'string') return false;
    const salt = Buffer.from(this.data.salt, 'base64url');
    return safeEqual(b64u(hashSecret(password, salt)), this.data.hash);
  }

  verifyRecovery(code) {
    if (!this.configured || typeof code !== 'string') return false;
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const salt = Buffer.from(this.data.rsalt, 'base64url');
    return safeEqual(b64u(hashSecret(clean, salt)), this.data.rhash);
  }

  // Change the password; rotates the recovery code and signs every session out.
  change(newPassword) {
    checkPassword(newPassword);
    const code = makeRecoveryCode();
    this._store(newPassword, code);
    return code;
  }

  // ---- throttle ----
  blockedFor(ip, now = Date.now()) {
    const f = this.fails.get(ip);
    return f && f.until > now ? Math.ceil((f.until - now) / 1000) : 0;
  }

  recordFail(ip, now = Date.now()) {
    const f = this.fails.get(ip) || { n: 0, until: 0 };
    f.n++;
    if (f.n >= 5) { f.until = now + Math.min(15 * 60e3, 30e3 * Math.pow(2, f.n - 5)); }
    this.fails.set(ip, f);
    if (this.fails.size > 500) this.fails.delete(this.fails.keys().next().value);
  }

  recordOk(ip) { this.fails.delete(ip); }

  // ---- session cookie ----
  _sign(payload) {
    return crypto.createHmac('sha256', Buffer.from(this.data.secret, 'base64url')).update(payload).digest('base64url');
  }

  issue(now = Date.now()) {
    const payload = b64u(JSON.stringify({ exp: now + SESSION_MS }));
    return payload + '.' + this._sign(payload);
  }

  cookieHeader(token, clear = false) {
    const base = COOKIE + '=' + (clear ? '' : token) + '; Path=/; HttpOnly; SameSite=Strict';
    return clear ? base + '; Max-Age=0' : base + '; Max-Age=' + Math.floor(SESSION_MS / 1000);
  }

  isAuthed(req, now = Date.now()) {
    if (this.disabled) return true;
    if (!this.configured) return false;
    const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)').exec(req.headers.cookie || '');
    if (!m) return false;
    const [payload, sig] = m[1].split('.');
    if (!payload || !sig || !safeEqual(sig, this._sign(payload))) return false;
    try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > now; } catch (e) { return false; }
  }
}

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw Object.assign(new Error('Use at least 8 characters'), { status: 400 });
  if (p.length > 200) throw Object.assign(new Error('Password is too long'), { status: 400 });
}

module.exports = { Auth, COOKIE, makeRecoveryCode };
