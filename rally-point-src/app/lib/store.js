'use strict';
// JSON file store with atomic writes, a daily rolling backup and a small activity log.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { COLL } = require('./schema');
const { mergeSettings } = require('./settings');

const uid = () => crypto.randomBytes(6).toString('base64url');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'data.json');
    this.photoDir = path.join(dir, 'photos');
    this.backupDir = path.join(dir, 'backups');
    fs.mkdirSync(this.photoDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.timer = null;
    this.fresh = false;
    this.data = this._load();
  }

  _blank() {
    const d = { v: 1, settings: mergeSettings(null, null), log: [] };
    for (const k of Object.keys(COLL)) d[k] = [];
    return d;
  }

  _load() {
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) {
      if (e.code !== 'ENOENT') {
        // corrupt file: keep it for inspection and start from the newest backup if there is one
        try { fs.copyFileSync(this.file, this.file + '.corrupt-' + Date.now()); } catch (e2) { /* ignore */ }
        raw = this._latestBackup();
      }
    }
    if (!raw) { this.fresh = true; return this._blank(); }
    return this._normalize(raw);
  }

  _latestBackup() {
    try {
      const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort();
      if (!files.length) return null;
      return JSON.parse(fs.readFileSync(path.join(this.backupDir, files[files.length - 1]), 'utf8'));
    } catch (e) { return null; }
  }

  _normalize(raw) {
    const d = this._blank();
    d.settings = mergeSettings(raw.settings, null);
    for (const k of Object.keys(COLL)) d[k] = Array.isArray(raw[k]) ? raw[k] : [];
    d.log = Array.isArray(raw.log) ? raw.log.slice(-800) : [];
    return d;
  }

  replaceAll(raw) {
    this.data = this._normalize(raw);
    this.save();
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 250);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  dailyBackup(today) {
    const f = path.join(this.backupDir, `data-${today}.json`);
    try {
      if (fs.existsSync(f)) return;
      this.flush();
      fs.copyFileSync(this.file, f);
      const files = fs.readdirSync(this.backupDir).filter((n) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
      while (files.length > 7) fs.unlinkSync(path.join(this.backupDir, files.shift()));
    } catch (e) { /* backups are best effort */ }
  }

  col(name) { return this.data[name]; }
  find(name, id) { return this.data[name].find((x) => x.id === id); }

  add(name, doc, extra) {
    const now = new Date().toISOString();
    const rec = Object.assign({ id: uid(), created: now, updated: now }, doc, extra || {});
    this.data[name].push(rec);
    this.save();
    return rec;
  }

  update(name, id, doc) {
    const i = this.data[name].findIndex((x) => x.id === id);
    if (i < 0) return null;
    const old = this.data[name][i];
    const rec = Object.assign({}, doc, { id: old.id, created: old.created, updated: new Date().toISOString() });
    if (old.sample) rec.sample = true;
    this.data[name][i] = rec;
    this.save();
    return rec;
  }

  remove(name, id) {
    const i = this.data[name].findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [gone] = this.data[name].splice(i, 1);
    this.save();
    return gone;
  }

  log(text) {
    this.data.log.push({ t: new Date().toISOString(), text: String(text).slice(0, 200) });
    if (this.data.log.length > 800) this.data.log.splice(0, this.data.log.length - 800);
    this.save();
  }

  // ---- photos
  photoPath(id) { return path.join(this.photoDir, id + '.jpg'); }
  savePhoto(buf) {
    const id = uid();
    fs.writeFileSync(this.photoPath(id), buf);
    return id;
  }
  deletePhoto(id) {
    if (!id || !/^[A-Za-z0-9_-]{1,24}$/.test(id)) return;
    try { fs.unlinkSync(this.photoPath(id)); } catch (e) { /* already gone */ }
  }
  photoCount() {
    try { return fs.readdirSync(this.photoDir).length; } catch (e) { return 0; }
  }
}

module.exports = { Store, uid };
