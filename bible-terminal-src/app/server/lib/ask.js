'use strict';
// "Ask" sends your question plus the passages the browser found to a local Ollama model and streams the answer back.
// The model is told to answer only from those passages and to cite them.

const SYSTEM = [
  'You are a careful Bible study assistant. The user asks a question and you are given numbered passages from the King James Bible.',
  'Answer using ONLY those passages. Cite each point with its number in square brackets, like [1] or [2][3].',
  'If the passages do not answer the question, say so plainly and do not guess. Never invent verses or quotes.',
  'Say what the text says first. If you add interpretation, label it as interpretation, and mention where Christians disagree when that is true.',
  'Keep the answer under 250 words, in plain language.',
].join(' ');

function validate(body) {
  const q = typeof body.question === 'string' ? body.question.trim() : '';
  if (!q || q.length > 600) throw new Error('Type a question (up to 600 characters).');
  const passages = Array.isArray(body.passages) ? body.passages.slice(0, 12) : [];
  const clean = passages.map(p => ({ ref: String(p.ref || '').slice(0, 40), text: String(p.text || '').slice(0, 700) })).filter(p => p.ref && p.text);
  return { question: q, passages: clean };
}

function buildMessages({ question, passages }) {
  const list = passages.map((p, i) => `[${i + 1}] ${p.ref}: ${p.text}`).join('\n');
  const user = passages.length
    ? `Passages:\n${list}\n\nQuestion: ${question}`
    : `No passages were found for this question.\n\nQuestion: ${question}`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

async function listModels(baseUrl) {
  const res = await fetch(baseUrl + '/api/tags', { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('Ollama replied HTTP ' + res.status);
  const j = await res.json();
  return (j.models || []).map(m => m.name).filter(Boolean);
}

/** Streams the model's answer to `res` as server-sent events. */
async function streamAnswer({ baseUrl, model }, input, req, res) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10 * 60 * 1000);
  res.on('close', () => ac.abort());
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
  const send = o => res.write('data: ' + JSON.stringify(o) + '\n\n');
  try {
    const r = await fetch(baseUrl + '/api/chat', {
      method: 'POST', redirect: 'error', signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true, options: { temperature: 0.2 }, messages: buildMessages(input) }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(r.status === 404 ? `The model "${model}" isn't installed on that Ollama.` : `Ollama replied HTTP ${r.status}. ${t.slice(0, 120)}`);
    }
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let o; try { o = JSON.parse(line); } catch { continue; }
        if (o.error) throw new Error(String(o.error).slice(0, 200));
        if (o.message && o.message.content) send({ t: o.message.content });
        if (o.done) send({ done: true });
      }
    }
    send({ done: true });
  } catch (e) {
    if (!ac.signal.aborted) send({ error: e.message || 'The model could not be reached.' });
  } finally {
    clearTimeout(timer);
    res.end();
  }
}

module.exports = { validate, buildMessages, listModels, streamAnswer };
