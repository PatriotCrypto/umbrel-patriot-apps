'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = () => ({
  version: 1,
  settings: {
    callsign: '',
    mode: 'demo',          // demo | live
    host: '',              // Meshtastic node address (Wi-Fi/Ethernet), TCP port 4403
    port: 4403,
    staleMinutes: 60,
    lowBattery: 20,
    tiles: false,          // opt-in OpenStreetMap background
    home: { lat: null, lon: null }
  },
  contacts: [],
  freqs: [],
  log: [],
  messages: [],
  nodes: {},
  trails: {}
});

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'skynet.json');
    this.timer = null;
    fs.mkdirSync(dir, { recursive: true });
    this.data = DEFAULTS();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const d = DEFAULTS();
      this.data = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}), home: { ...d.settings.home, ...((raw.settings || {}).home || {}) } } };
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // corrupt file: keep a copy, start fresh
        try { fs.renameSync(this.file, this.file + '.corrupt-' + Date.now()); } catch (_) {}
      }
    }
  }
  id() { return crypto.randomBytes(6).toString('hex'); }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 400);
    if (this.timer.unref) this.timer.unref();
  }
  flush() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store, DEFAULTS };
