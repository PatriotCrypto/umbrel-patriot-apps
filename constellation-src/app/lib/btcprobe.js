'use strict';
// Is something listening on the Bitcoin peer-to-peer port? A plain TCP connect, no data sent.
const net = require('net');

function probePort(ip, port = 8333, ms = 900) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port });
    let done = false;
    const end = (ok) => { if (done) return; done = true; s.destroy(); resolve(ok); };
    s.setTimeout(ms, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
}

module.exports = { probePort };
