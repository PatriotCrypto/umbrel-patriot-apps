'use strict';
// Optical drive access through standard tools (blkid, eject) so it can be tested with stand-ins.
const { execFile } = require('child_process');
const fsp = require('fs/promises');
const path = require('path');
const DEV_DIR = process.env.DEV_DIR || '/dev';

function run(cmd, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), timedOut: !!(err && err.killed) });
    });
  });
}

async function listDrives() {
  try { return (await fsp.readdir(DEV_DIR)).filter((n) => /^sr\d+$/.test(n)).sort().map((n) => path.join(DEV_DIR, n)); } catch { return []; }
}
async function listNodes(re) {
  try { return (await fsp.readdir(DEV_DIR)).filter((n) => re.test(n)).sort(); } catch { return []; }
}

// present: a disc with a readable filesystem is in the drive
async function probe(dev) {
  const r = await run('blkid', ['-p', '-o', 'export', dev], 25000);
  if (r.code !== 0) return { present: false, detail: (r.stderr || '').trim().slice(0, 200) };
  const kv = {};
  for (const l of r.stdout.split('\n')) { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 1); }
  // blkid's export format escapes spaces and odd characters ("Young\ Washington", "\x28")
  const unesc = (v) => String(v || '').replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, '$1');
  return { present: true, label: unesc(kv.LABEL || kv.LABEL_FATBOOT || ''), type: kv.TYPE || '' };
}

// open | closed (disc in) | empty (tray closed, no disc) | notready | unknown (the drive does not say)
const CDSTATUS = process.env.CDSTATUS_BIN || 'cdstatus';
async function trayState(dev) {
  const r = await run(CDSTATUS, [dev], 5000);
  const t = r.stdout.trim();
  return r.code === 0 && ['open', 'closed', 'empty', 'notready'].includes(t) ? t : 'unknown';
}

async function eject(dev) {
  const r = await run('eject', [dev], 30000);
  return { ok: r.code === 0, detail: (r.stderr || r.stdout || '').trim().slice(0, 200) };
}

module.exports = { run, listDrives, listNodes, probe, eject, trayState, DEV_DIR };
