'use strict';
// Host health read from /proc and /sys (read-only) and the mounted storage.
const fs = require('fs');
const os = require('os');
const path = require('path');

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

function parseMeminfo(text) {
  const m = {};
  for (const line of String(text || '').split('\n')) {
    const x = /^(\w+):\s+(\d+)/.exec(line);
    if (x) m[x[1]] = Number(x[2]) * 1024;
  }
  return m;
}

function cpuTimes(text) {
  const line = String(text || '').split('\n').find((l) => l.startsWith('cpu '));
  if (!line) return null;
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (v[3] || 0) + (v[4] || 0);
  const total = v.reduce((a, b) => a + b, 0);
  return { idle, total };
}

let lastCpu = null;

function sampleCpu(procDir) {
  const now = cpuTimes(readText(path.join(procDir, 'stat')));
  if (!now) return null;
  let pct = null;
  if (lastCpu && now.total > lastCpu.total) {
    pct = Math.round((1 - (now.idle - lastCpu.idle) / (now.total - lastCpu.total)) * 1000) / 10;
  }
  lastCpu = now;
  return pct;
}

function temps(sysDir) {
  const out = [];
  const hw = path.join(sysDir, 'class', 'hwmon');
  let dirs = [];
  try { dirs = fs.readdirSync(hw); } catch (e) { /* none */ }
  for (const d of dirs) {
    const base = path.join(hw, d);
    const name = (readText(path.join(base, 'name')) || d).trim();
    let files = [];
    try { files = fs.readdirSync(base).filter((f) => /^temp\d+_input$/.test(f)); } catch (e) { continue; }
    for (const f of files) {
      const v = Number(readText(path.join(base, f)));
      if (!Number.isFinite(v) || v <= 0) continue;
      const label = (readText(path.join(base, f.replace('_input', '_label'))) || '').trim();
      out.push({ sensor: name, label: label || f.replace('_input', ''), c: Math.round(v / 100) / 10 });
    }
  }
  if (!out.length) {
    const tz = path.join(sysDir, 'class', 'thermal');
    let zs = [];
    try { zs = fs.readdirSync(tz).filter((f) => f.startsWith('thermal_zone')); } catch (e) { /* none */ }
    for (const z of zs) {
      const v = Number(readText(path.join(tz, z, 'temp')));
      if (Number.isFinite(v) && v > 0) out.push({ sensor: (readText(path.join(tz, z, 'type')) || z).trim(), label: z, c: Math.round(v / 100) / 10 });
    }
  }
  return out;
}

async function diskUsage(p) {
  try {
    const s = await fs.promises.statfs(p);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - free, pct: total ? Math.round(((total - free) / total) * 1000) / 10 : 0 };
  } catch (e) { return null; }
}

// roots: { proc, sys, disks: [{ name, path }] } so tests can point at fake folders.
async function collectSystem(roots = {}) {
  const procDir = roots.proc || '/proc';
  const sysDir = roots.sys || '/sys';
  const mem = parseMeminfo(readText(path.join(procDir, 'meminfo')));
  const load = (readText(path.join(procDir, 'loadavg')) || '').trim().split(/\s+/).slice(0, 3).map(Number);
  const up = Number((readText(path.join(procDir, 'uptime')) || '').split(/\s+/)[0]);
  const cores = (os.cpus() || []).length || 1;
  const total = mem.MemTotal || os.totalmem();
  const avail = mem.MemAvailable != null ? mem.MemAvailable : os.freemem();
  const swapTotal = mem.SwapTotal || 0;
  const swapUsed = swapTotal - (mem.SwapFree || 0);
  const disks = [];
  for (const d of roots.disks || []) {
    const u = await diskUsage(d.path);
    if (u) disks.push(Object.assign({ name: d.name, path: d.path }, u));
  }
  const tl = temps(sysDir);
  return {
    cores,
    cpuPct: sampleCpu(procDir),
    load: load.length === 3 && load.every(Number.isFinite) ? load : null,
    uptimeSec: Number.isFinite(up) ? up : Math.floor(os.uptime()),
    mem: { total, available: avail, used: total - avail, pct: total ? Math.round(((total - avail) / total) * 1000) / 10 : 0 },
    swap: { total: swapTotal, used: swapUsed, pct: swapTotal ? Math.round((swapUsed / swapTotal) * 1000) / 10 : 0 },
    temps: tl,
    tempMax: tl.length ? Math.max(...tl.map((t) => t.c)) : null,
    disks,
  };
}

module.exports = { collectSystem, parseMeminfo, cpuTimes, temps };
