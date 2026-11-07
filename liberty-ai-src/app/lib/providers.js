'use strict';
// AI providers. Three kinds, one interface:
//   ollama     a local Ollama server (the Umbrel "Ollama" app, or any Ollama on your network)
//   anthropic  Claude through the Anthropic API (needs your own API key; this is a CLOUD service)
//   openai     any OpenAI-compatible server (llama.cpp, LM Studio, vLLM, Open WebUI, ...)
// Whether a provider counts as "cloud" decides which of your data it is allowed to see.
const { isLocalUrl, HttpError } = require('./util');

const DEFAULTS = {
  ollamaUrl: 'http://ollama_ollama_1:11434',
  anthropicModel: 'claude-sonnet-5-5',
};

async function* lines(body) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
    }
  }
  buf += dec.decode();
  if (buf) yield buf;
}

function trimUrl(u) { return String(u || '').trim().replace(/\/+$/, ''); }

async function errorFrom(res, what) {
  let msg = '';
  try {
    const t = await res.text();
    try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error)) || j.message || t; } catch (e) { msg = t; }
  } catch (e) { /* ignore */ }
  msg = String(msg || '').slice(0, 300);
  if (res.status === 401 || res.status === 403) return new HttpError(502, what + ' rejected the key (' + res.status + '). Check it in Settings.');
  if (res.status === 404) return new HttpError(502, what + ' could not find that model or endpoint. ' + msg);
  if (res.status === 429) return new HttpError(502, what + ' says slow down (rate limit). Try again in a moment.');
  return new HttpError(502, what + ' error ' + res.status + (msg ? ': ' + msg : ''));
}

function netError(e, what) {
  if (e instanceof HttpError) return e;
  if (e && e.name === 'AbortError') return e;
  const code = (e && e.cause && e.cause.code) || (e && e.code) || '';
  const hint = code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? ' (name not found)' : code === 'ECONNREFUSED' ? ' (connection refused)' : '';
  return new HttpError(502, 'Could not reach ' + what + hint + '. Check the address in Settings.');
}

// ---------------------------------------------------------------- Ollama
function ollama(cfg, fetchImpl) {
  const base = trimUrl(cfg.url) || DEFAULTS.ollamaUrl;
  return {
    kind: 'ollama', label: 'Ollama', cloud: !isLocalUrl(base), model: cfg.model || '',
    async models() {
      let res;
      try { res = await fetchImpl(base + '/api/tags', { signal: AbortSignal.timeout(6000) }); } catch (e) { throw netError(e, 'Ollama'); }
      if (!res.ok) throw await errorFrom(res, 'Ollama');
      const j = await res.json();
      return (j.models || []).map((m) => m.name).filter(Boolean);
    },
    async chat({ system, messages, signal, onToken }) {
      if (!cfg.model) throw new HttpError(400, 'Pick an Ollama model in Settings first.');
      const msgs = (system ? [{ role: 'system', content: system }] : []).concat(messages);
      let res;
      try {
        res = await fetchImpl(base + '/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ model: cfg.model, messages: msgs, stream: true, keep_alive: cfg.keepAlive || '2m', options: { num_ctx: cfg.numCtx || 4096, num_predict: cfg.numPredict || 400, temperature: 0.3 } }),
        });
      } catch (e) { throw netError(e, 'Ollama'); }
      if (!res.ok) throw await errorFrom(res, 'Ollama');
      let text = '';
      let usage = null;
      for await (const line of lines(res.body)) {
        if (!line.trim()) continue;
        let j;
        try { j = JSON.parse(line); } catch (e) { continue; }
        if (j.error) throw new HttpError(502, 'Ollama: ' + String(j.error).slice(0, 200));
        const t = j.message && j.message.content;
        if (t) { text += t; onToken && onToken(t); }
        if (j.done) usage = { in: j.prompt_eval_count || 0, out: j.eval_count || 0 };
      }
      return { text, usage };
    },
  };
}

// ---------------------------------------------------------------- Anthropic
function anthropic(cfg, key, fetchImpl) {
  const base = 'https://api.anthropic.com';
  const headers = () => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
  return {
    kind: 'anthropic', label: 'Claude (Anthropic API)', cloud: true, model: cfg.model || DEFAULTS.anthropicModel,
    async models() {
      if (!key) throw new HttpError(400, 'Add your Anthropic API key in Settings first.');
      let res;
      try { res = await fetchImpl(base + '/v1/models?limit=50', { headers: headers(), signal: AbortSignal.timeout(8000) }); } catch (e) { throw netError(e, 'Anthropic'); }
      if (!res.ok) throw await errorFrom(res, 'Anthropic');
      const j = await res.json();
      return (j.data || []).map((m) => m.id).filter(Boolean);
    },
    async chat({ system, messages, signal, onToken }) {
      if (!key) throw new HttpError(400, 'Add your Anthropic API key in Settings first.');
      let res;
      try {
        res = await fetchImpl(base + '/v1/messages', {
          method: 'POST', headers: headers(), signal,
          body: JSON.stringify({ model: cfg.model || DEFAULTS.anthropicModel, max_tokens: 2048, system: system || undefined, messages, stream: true }),
        });
      } catch (e) { throw netError(e, 'Anthropic'); }
      if (!res.ok) throw await errorFrom(res, 'Anthropic');
      let text = '';
      const usage = { in: 0, out: 0 };
      for await (const line of lines(res.body)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch (e) { continue; }
        if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') { text += j.delta.text; onToken && onToken(j.delta.text); }
        else if (j.type === 'message_start' && j.message && j.message.usage) usage.in = j.message.usage.input_tokens || 0;
        else if (j.type === 'message_delta' && j.usage) usage.out = j.usage.output_tokens || 0;
        else if (j.type === 'error') throw new HttpError(502, 'Anthropic: ' + String((j.error && j.error.message) || 'stream error').slice(0, 200));
      }
      return { text, usage };
    },
  };
}

// ---------------------------------------------------------------- OpenAI-compatible
function openai(cfg, key, fetchImpl) {
  let base = trimUrl(cfg.url);
  base = base.replace(/\/v1$/, '');
  const headers = () => Object.assign({ 'content-type': 'application/json' }, key ? { authorization: 'Bearer ' + key } : {});
  return {
    kind: 'openai', label: 'OpenAI-compatible server', cloud: !isLocalUrl(base || 'http://x'), model: cfg.model || '',
    async models() {
      if (!base) throw new HttpError(400, 'Enter the server address in Settings first.');
      let res;
      try { res = await fetchImpl(base + '/v1/models', { headers: headers(), signal: AbortSignal.timeout(6000) }); } catch (e) { throw netError(e, 'the server'); }
      if (!res.ok) throw await errorFrom(res, 'The server');
      const j = await res.json();
      return (j.data || []).map((m) => m.id).filter(Boolean);
    },
    async chat({ system, messages, signal, onToken }) {
      if (!base) throw new HttpError(400, 'Enter the server address in Settings first.');
      if (!cfg.model) throw new HttpError(400, 'Pick a model in Settings first.');
      const msgs = (system ? [{ role: 'system', content: system }] : []).concat(messages);
      let res;
      try {
        res = await fetchImpl(base + '/v1/chat/completions', {
          method: 'POST', headers: headers(), signal,
          body: JSON.stringify({ model: cfg.model, messages: msgs, stream: true, temperature: 0.3 }),
        });
      } catch (e) { throw netError(e, 'the server'); }
      if (!res.ok) throw await errorFrom(res, 'The server');
      let text = '';
      for await (const line of lines(res.body)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch (e) { continue; }
        const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (t) { text += t; onToken && onToken(t); }
      }
      return { text, usage: null };
    },
  };
}

function create(settings, secrets, fetchImpl = fetch) {
  switch (settings.provider) {
    case 'anthropic': return anthropic(settings.anthropic || {}, secrets.anthropicKey || '', fetchImpl);
    case 'openai': return openai(settings.openai || {}, secrets.openaiKey || '', fetchImpl);
    case 'ollama':
    default: return ollama(settings.ollama || {}, fetchImpl);
  }
}

module.exports = { create, DEFAULTS, lines };
