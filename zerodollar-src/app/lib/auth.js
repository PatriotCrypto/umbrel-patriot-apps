import crypto from 'node:crypto';
import { bad } from './util.js';

const DAY = 86400000;
const SESSION_MS = 30 * DAY;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}
export function checkPassword(pw, rec) {
  if (!rec || typeof pw !== 'string') return false;
  const want = Buffer.from(rec.hash, 'hex');
  const got = crypto.scryptSync(pw, Buffer.from(rec.salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('Use at least 8 characters.');
  if (pw.length > 200) throw bad('That password is too long.');
  return pw;
}

export class Auth {
  constructor(priv) {
    this.priv = priv;
    this.fails = new Map(); // ip -> {n, until}
  }
  get required() {
    return !!this.priv.data.auth;
  }
  #prune() {
    const now = Date.now();
    for (const [k, v] of Object.entries(this.priv.data.sessions)) if (v < now) delete this.priv.data.sessions[k];
  }
  newSession() {
    this.#prune();
    const token = crypto.randomBytes(32).toString('hex');
    this.priv.data.sessions[sha(token)] = Date.now() + SESSION_MS;
    this.priv.save();
    return token;
  }
  valid(token) {
    if (!token) return false;
    const exp = this.priv.data.sessions[sha(token)];
    return !!exp && exp > Date.now();
  }
  drop(token) {
    if (token && this.priv.data.sessions[sha(token)]) {
      delete this.priv.data.sessions[sha(token)];
      this.priv.save();
    }
  }
  setPassword(pw) {
    this.priv.data.auth = hashPassword(validatePassword(pw));
    this.priv.data.sessions = {};
    this.priv.save();
  }
  clear() {
    this.priv.data.auth = null;
    this.priv.data.sessions = {};
    this.priv.save();
  }
  /** Brute-force brake: five wrong tries, then a wait that doubles. */
  throttle(ip) {
    const f = this.fails.get(ip);
    if (f && f.until > Date.now()) throw Object.assign(new Error(`Too many tries. Wait ${Math.ceil((f.until - Date.now()) / 1000)} seconds.`), { status: 429 });
  }
  failed(ip) {
    const f = this.fails.get(ip) || { n: 0, until: 0 };
    f.n++;
    if (f.n >= 5) f.until = Date.now() + Math.min(15 * 60000, 30000 * 2 ** (f.n - 5));
    this.fails.set(ip, f);
  }
  ok(ip) {
    this.fails.delete(ip);
  }
}

export function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
