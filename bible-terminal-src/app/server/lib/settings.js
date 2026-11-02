'use strict';
// Server-side settings (Ollama address, how Verify reaches Bitcoin). Stored in DATA_DIR/settings.json, mode 0600.
// The RPC password is never sent back to the browser.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  ollama: { baseUrl: '', model: '' },
  verify: { mode: 'public', restUrl: '', rpcUrl: '', rpcUser: '', rpcPass: '' },
};

function cleanUrl(v, label) {
  const s = String(v || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { throw new Error(`${label}: not a valid address`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`${label}: must start with http:// or https://`);
  if (u.username || u.password) throw new Error(`${label}: don't put a username or password in the address`);
  return s;
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const k of Object.keys(DEFAULTS)) Object.assign(this.data[k], saved[k] || {});
    } catch { /* first run */ }
  }

  get() { return this.data; }

  publicView() {
    const { ollama, verify } = this.data;
    return {
      ollama: { ...ollama },
      verify: { mode: verify.mode, restUrl: verify.restUrl, rpcUrl: verify.rpcUrl, rpcUser: verify.rpcUser, hasRpcPass: !!verify.rpcPass },
    };
  }

  update(patch) {
    const next = JSON.parse(JSON.stringify(this.data));
    if (patch.ollama) {
      if ('baseUrl' in patch.ollama) next.ollama.baseUrl = cleanUrl(patch.ollama.baseUrl, 'Ollama address');
      if ('model' in patch.ollama) next.ollama.model = String(patch.ollama.model || '').trim().slice(0, 120);
    }
    if (patch.verify) {
      const v = patch.verify;
      if ('mode' in v) {
        if (!['public', 'rest', 'rpc'].includes(v.mode)) throw new Error('unknown verify mode');
        next.verify.mode = v.mode;
      }
      if ('restUrl' in v) next.verify.restUrl = cleanUrl(v.restUrl, 'Explorer address');
      if ('rpcUrl' in v) next.verify.rpcUrl = cleanUrl(v.rpcUrl, 'Bitcoin node address');
      if ('rpcUser' in v) next.verify.rpcUser = String(v.rpcUser || '').slice(0, 200);
      if (typeof v.rpcPass === 'string' && v.rpcPass) next.verify.rpcPass = v.rpcPass.slice(0, 500);
      if (v.clearRpcPass) next.verify.rpcPass = '';
      if (next.verify.mode === 'rest' && !next.verify.restUrl) throw new Error('Enter the explorer address first');
      if (next.verify.mode === 'rpc' && !next.verify.rpcUrl) throw new Error('Enter the Bitcoin node address first');
    }
    this.data = next;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return this.publicView();
  }
}

module.exports = { Settings };
