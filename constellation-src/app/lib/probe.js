'use strict';
// Round-trip time by timing a TCP connect. A refused connection still proves the
// host answered, so it counts as a reply; only a timeout counts as loss.
const net = require('net');

function tcpRtt(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    let done = false;
    const sock = new net.Socket();
    const finish = (ok) => {
      if (done) return;
      done = true;
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      try { sock.destroy(); } catch (e) { /* ignore */ }
      resolve(ok ? Math.round(ms * 10) / 10 : null);
    };
    sock.setTimeout(timeoutMs, () => finish(false));
    sock.once('connect', () => finish(true));
    sock.once('error', (e) => finish(e && (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET')));
    try { sock.connect(port, host); } catch (e) { finish(false); }
  });
}

// { wan, lan } in milliseconds, null = no reply.
async function probeAll({ gateway, wanTargets, timeoutMs } = {}) {
  const targets = wanTargets || [['1.1.1.1', 443], ['8.8.8.8', 443]];
  const lanP = gateway ? tcpRtt(gateway, 80, timeoutMs || 1500) : Promise.resolve(null);
  let wan = null;
  for (const [h, p] of targets) {
    wan = await tcpRtt(h, p, timeoutMs || 2500);
    if (wan !== null) break;
  }
  return { wan, lan: await lanP };
}

module.exports = { tcpRtt, probeAll };
