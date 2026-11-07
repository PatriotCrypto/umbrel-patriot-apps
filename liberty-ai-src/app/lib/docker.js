'use strict';
// A deliberately tiny, READ-ONLY client for the Docker socket.
// Every request is a GET and the path must match an allow-list. There is no code
// anywhere in this app that can start, stop, restart, create or delete anything.
// (Container "inspect" is not allowed either, because it exposes environment variables.)
const http = require('http');

const NAME = '[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}';
const ALLOWED = [
  /^\/_ping$/,
  /^\/version$/,
  /^\/info$/,
  /^\/system\/df$/,
  /^\/containers\/json\?all=(?:1|true)$/,
  new RegExp('^/containers/' + NAME + '/logs\\?stdout=1&stderr=1&tail=\\d{1,4}$'),
  new RegExp('^/containers/' + NAME + '/stats\\?stream=false$'),
];

function isAllowed(p) {
  return ALLOWED.some((re) => re.test(p));
}

function rawGet(socketPath, path, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (!isAllowed(path)) return reject(new Error('Docker path not allowed: ' + path));
    const req = http.request({ socketPath, path, method: 'GET', timeout: timeoutMs }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 8 * 1024 * 1024) { req.destroy(new Error('Docker response too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('Docker socket timed out')));
    req.on('error', reject);
    req.end();
  });
}

// Docker multiplexes stdout/stderr into 8-byte-header frames for non-TTY containers.
function demux(buf) {
  const out = [];
  let i = 0;
  let framed = true;
  while (i < buf.length) {
    if (i + 8 > buf.length) { framed = false; break; }
    const t = buf[i];
    const len = buf.readUInt32BE(i + 4);
    if (![0, 1, 2].includes(t) || buf[i + 1] || buf[i + 2] || buf[i + 3] || i + 8 + len > buf.length) { framed = false; break; }
    out.push(buf.slice(i + 8, i + 8 + len).toString('utf8'));
    i += 8 + len;
  }
  return framed ? out.join('') : buf.toString('utf8');
}

class Docker {
  constructor(socketPath = '/var/run/docker.sock', impl = rawGet) {
    this.socketPath = socketPath;
    this.impl = impl;
  }

  async json(path) {
    const r = await this.impl(this.socketPath, path);
    if (r.status !== 200) throw new Error('Docker answered ' + r.status);
    return JSON.parse(r.body.toString('utf8'));
  }

  async available() {
    try {
      const r = await this.impl(this.socketPath, '/_ping', 3000);
      return r.status === 200;
    } catch (e) { return false; }
  }

  version() { return this.json('/version'); }
  info() { return this.json('/info'); }
  df() { return this.json('/system/df'); }
  containers() { return this.json('/containers/json?all=1'); }

  async logs(id, tail = 60) {
    const n = Math.max(1, Math.min(500, Math.floor(tail)));
    const r = await this.impl(this.socketPath, '/containers/' + id + '/logs?stdout=1&stderr=1&tail=' + n);
    if (r.status !== 200) throw new Error('Docker answered ' + r.status);
    return demux(r.body);
  }

  async stats(id) {
    return this.json('/containers/' + id + '/stats?stream=false');
  }
}

module.exports = { Docker, isAllowed, demux };
