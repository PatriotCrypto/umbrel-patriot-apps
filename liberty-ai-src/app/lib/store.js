'use strict';
// Tiny JSON file store: atomic writes, debounced saves, one backup a day (7 kept),
// and recovery from a damaged file.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir, file = 'data.json') {
    this.dir = dir;
    this.file = path.join(dir, file);
    this.name = file.replace(/\.json$/, '');
    this.timer = null;
    this.getter = null;
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  }

  _readJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  // Returns parsed data, or null when there is nothing usable on disk.
  load() {
    if (fs.existsSync(this.file)) {
      try { return this._readJson(this.file); } catch (e) {
        try { fs.renameSync(this.file, this.file + '.corrupt-' + Date.now()); } catch (e2) { /* ignore */ }
      }
    }
    const bdir = path.join(this.dir, 'backups');
    const backups = fs.readdirSync(bdir).filter((f) => f.startsWith(this.name + '-')).sort().reverse();
    for (const b of backups) {
      try { return this._readJson(path.join(bdir, b)); } catch (e) { /* try older */ }
    }
    return null;
  }

  // Register a function that returns the object to persist.
  attach(getter) { this.getter = getter; }

  saveNow() {
    if (!this.getter) return;
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.getter()));
    fs.renameSync(tmp, this.file);
  }

  scheduleSave(delayMs = 15000) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      try { this.saveNow(); } catch (e) { console.error('save failed:', e.message); }
    }, delayMs);
    if (this.timer.unref) this.timer.unref();
  }

  backupDaily(now = Date.now()) {
    try {
      const day = new Date(now).toISOString().slice(0, 10);
      const dest = path.join(this.dir, 'backups', this.name + '-' + day + '.json');
      if (!fs.existsSync(dest) && fs.existsSync(this.file)) fs.copyFileSync(this.file, dest);
      const all = fs.readdirSync(path.join(this.dir, 'backups')).filter((f) => f.startsWith(this.name + '-')).sort();
      for (const f of all.slice(0, Math.max(0, all.length - 7))) fs.unlinkSync(path.join(this.dir, 'backups', f));
    } catch (e) { console.error('backup failed:', e.message); }
  }
}

module.exports = { Store };
