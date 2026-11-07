'use strict';
// Settings: defaults and validation. Secrets (API keys) live in their own file.
const fs = require('fs');
const path = require('path');
const { cleanText, clamp, HttpError } = require('./util');
const { DEFAULTS } = require('./providers');

function defaults() {
  return {
    provider: 'ollama',
    ollama: { url: DEFAULTS.ollamaUrl, model: '', numCtx: 8192 },
    anthropic: { model: DEFAULTS.anthropicModel },
    openai: { url: '', model: '' },
    localOnly: false,
    // enabled: may Liberty AI use this kind of data at all?  cloud: may it go to a cloud AI?
    sources: {
      health: { enabled: true, cloud: true },
      logs: { enabled: true, cloud: false },
      apps: { enabled: true, cloud: false },
      files: { enabled: true, cloud: false },
    },
    appsOn: {},
    folders: [],
    checkIntervalMin: 10,
    ntfy: { enabled: false, server: 'https://ntfy.sh', topic: '', minSeverity: 'crit' },
  };
}

function httpUrl(v, label, allowEmpty) {
  const s = cleanText(v, 200).replace(/\/+$/, '');
  if (!s && allowEmpty) return '';
  let u;
  try { u = new URL(s); } catch (e) { throw new HttpError(400, label + ' must be a full address like http://host:11434'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, label + ' must start with http:// or https://');
  if (u.username || u.password) throw new HttpError(400, label + ' cannot contain a password');
  return u.origin + (u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '');
}

const bool = (v, d) => (typeof v === 'boolean' ? v : d);

// `known` is the list of app ids that may be switched on.
function validate(input, cur, known) {
  const s = JSON.parse(JSON.stringify(cur));
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Expected settings');
  if (input.provider !== undefined) {
    if (!['ollama', 'anthropic', 'openai'].includes(input.provider)) throw new HttpError(400, 'Unknown AI provider');
    s.provider = input.provider;
  }
  if (input.ollama) {
    if (input.ollama.url !== undefined) s.ollama.url = httpUrl(input.ollama.url, 'The Ollama address', false);
    if (input.ollama.model !== undefined) s.ollama.model = cleanText(input.ollama.model, 120);
    if (input.ollama.numCtx !== undefined) s.ollama.numCtx = Math.round(clamp(input.ollama.numCtx, 2048, 131072));
  }
  if (input.anthropic && input.anthropic.model !== undefined) s.anthropic.model = cleanText(input.anthropic.model, 120) || DEFAULTS.anthropicModel;
  if (input.openai) {
    if (input.openai.url !== undefined) s.openai.url = httpUrl(input.openai.url, 'The server address', true);
    if (input.openai.model !== undefined) s.openai.model = cleanText(input.openai.model, 120);
  }
  s.localOnly = bool(input.localOnly, s.localOnly);
  if (input.sources && typeof input.sources === 'object') {
    for (const k of Object.keys(s.sources)) {
      const v = input.sources[k];
      if (v && typeof v === 'object') {
        s.sources[k].enabled = bool(v.enabled, s.sources[k].enabled);
        s.sources[k].cloud = bool(v.cloud, s.sources[k].cloud);
      }
    }
  }
  if (input.appsOn && typeof input.appsOn === 'object') {
    for (const id of known) if (typeof input.appsOn[id] === 'boolean') s.appsOn[id] = input.appsOn[id];
  }
  if (input.checkIntervalMin !== undefined) s.checkIntervalMin = Math.round(clamp(input.checkIntervalMin, 5, 60));
  if (input.ntfy && typeof input.ntfy === 'object') {
    const n = input.ntfy;
    s.ntfy.enabled = bool(n.enabled, s.ntfy.enabled);
    if (n.server !== undefined) s.ntfy.server = httpUrl(n.server, 'The notification server', false);
    if (n.topic !== undefined) {
      const t = cleanText(n.topic, 64);
      if (t && !/^[A-Za-z0-9_-]{3,64}$/.test(t)) throw new HttpError(400, 'The notification topic can use letters, numbers, - and _ (3 to 64 characters)');
      s.ntfy.topic = t;
    }
    if (n.minSeverity !== undefined) s.ntfy.minSeverity = n.minSeverity === 'warn' ? 'warn' : 'crit';
  }
  return s;
}

class Secrets {
  constructor(dir) {
    this.file = path.join(dir, 'secrets.json');
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch (e) { /* none yet */ }
  }

  get() { return this.data; }

  has() { return { anthropic: !!this.data.anthropicKey, openai: !!this.data.openaiKey }; }

  set(patch) {
    for (const k of ['anthropicKey', 'openaiKey']) {
      if (patch[k] === undefined) continue;
      const v = cleanText(patch[k], 300);
      if (v && /\s/.test(v)) throw new HttpError(400, 'That key contains spaces. Paste only the key.');
      if (v) this.data[k] = v; else delete this.data[k];
    }
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch (e) { /* ignore */ }
  }
}

module.exports = { defaults, validate, Secrets };
