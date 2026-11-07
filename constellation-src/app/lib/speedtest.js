'use strict';
// Internet speed test, run from this machine to Cloudflare's public speed endpoints.
// It measures the connection the Umbrel itself has, which for a wired Umbrel is the whole link.
const crypto = require('crypto');

const HOST = 'https://speed.cloudflare.com';

function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}
const round1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

async function measureLatency(fetchFn, host, n, signal) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint();
    try {
      const r = await fetchFn(host + '/__down?bytes=0&r=' + Math.random().toString(36).slice(2), { signal, cache: 'no-store' });
      await r.arrayBuffer();
      if (r.ok && i > 0) times.push(Number(process.hrtime.bigint() - t0) / 1e6); // first one pays for the handshake
    } catch (e) { if (signal && signal.aborted) throw e; }
  }
  if (!times.length) return { ping: null, jitter: null };
  let j = 0;
  for (let i = 1; i < times.length; i++) j += Math.abs(times[i] - times[i - 1]);
  return { ping: round1(median(times)), jitter: round1(times.length > 1 ? j / (times.length - 1) : 0) };
}

// Run `workers` loops until `ms` has passed. `step(signal, addBytes)` does one request.
async function timed(ms, workers, step, onRate) {
  const ctl = new AbortController();
  const start = Date.now();
  let bytes = 0;
  let warmBytes = 0;
  let warmAt = 0;
  const WARM = Math.min(1500, ms * 0.2);
  const add = (n) => { bytes += n; };
  const tick = setInterval(() => {
    const el = Date.now() - start;
    if (!warmAt && el >= WARM) { warmAt = Date.now(); warmBytes = bytes; }
    if (warmAt && onRate) {
      const dt = (Date.now() - warmAt) / 1000;
      if (dt > 0.3) onRate(((bytes - warmBytes) * 8) / dt / 1e6);
    }
  }, 250);
  const timer = setTimeout(() => ctl.abort(), ms);
  const loops = [];
  for (let i = 0; i < workers; i++) {
    loops.push((async () => {
      while (!ctl.signal.aborted) {
        await new Promise((r) => setImmediate(r)); // never starve the timer that ends the test
        try { await step(ctl.signal, add); } catch (e) { if (ctl.signal.aborted) return; await new Promise((r) => setTimeout(r, 200)); }
      }
    })());
  }
  await Promise.all(loops);
  clearTimeout(timer);
  clearInterval(tick);
  const end = Date.now();
  if (!warmAt || end - warmAt < 500) {
    const dt = (end - start) / 1000;
    return dt > 0 && bytes > 0 ? (bytes * 8) / dt / 1e6 : 0;
  }
  return ((bytes - warmBytes) * 8) / ((end - warmAt) / 1000) / 1e6;
}

async function runSpeedTest(o = {}) {
  const fetchFn = o.fetchFn || fetch;
  const host = o.host || HOST;
  const downMs = o.downMs || 8000;
  const upMs = o.upMs || 6000;
  const progress = o.onProgress || (() => {});
  const out = { t: Date.now(), down: null, up: null, ping: null, jitter: null, server: 'Cloudflare', error: null };
  const master = new AbortController();
  try {
    progress({ phase: 'ping', mbps: null });
    const lat = await measureLatency(fetchFn, host, 7, master.signal);
    out.ping = lat.ping; out.jitter = lat.jitter;
    if (out.ping === null) throw new Error('Could not reach the speed test server');

    progress({ phase: 'download', mbps: null });
    out.down = round1(await timed(downMs, 4, async (signal, add) => {
      const r = await fetchFn(host + '/__down?bytes=25000000&r=' + Math.random().toString(36).slice(2), { signal, cache: 'no-store' });
      if (!r.ok || !r.body) throw new Error('bad response');
      const reader = r.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; add(value.length); }
    }, (m) => progress({ phase: 'download', mbps: round1(m) })));
    if (!out.down) throw new Error('Download test got no data. Is the internet reachable from this app?');

    progress({ phase: 'upload', mbps: null });
    const body = crypto.randomBytes(1000000);
    out.up = round1(await timed(upMs, 3, async (signal, add) => {
      const r = await fetchFn(host + '/__up', { method: 'POST', body, signal, headers: { 'Content-Type': 'application/octet-stream' } });
      await r.arrayBuffer();
      if (!r.ok) throw new Error('bad response');
      add(body.length);
    }, (m) => progress({ phase: 'upload', mbps: round1(m) })));
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return out;
}

module.exports = { runSpeedTest, measureLatency, HOST };
