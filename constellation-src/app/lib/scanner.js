'use strict';
// LAN discovery without special privileges: poke every address in the subnet with
// a tiny UDP packet so the kernel ARPs for it, wait for ARP to settle, then read
// the kernel's neighbour table. Needs host networking so it sees the real LAN.
const fs = require('fs');
const os = require('os');
const dgram = require('dgram');
const U = require('./util');

const MAX_BITS_SHORTEST = 23; // /23 = 510 hosts; larger sweeps can overflow the ARP table

// "Iface Destination Gateway Flags ..." from /proc/net/route (hex, little-endian).
function parseRoute(text) {
  let best = null;
  const lines = String(text).split('\n').slice(1);
  for (const line of lines) {
    const f = line.trim().split(/\s+/);
    if (f.length < 8) continue;
    const [iface, dest, gw, flags] = f;
    const metric = Number(f[6]);
    if (dest !== '00000000') continue;
    if (!(parseInt(flags, 16) & 2)) continue; // needs RTF_GATEWAY
    const n = parseInt(gw, 16);
    const ip = [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255].join('.');
    if (!best || metric < best.metric) best = { iface, gateway: ip, metric };
  }
  return best;
}

// "IP address  HW type  Flags  HW address  Mask  Device" from /proc/net/arp.
function parseArp(text) {
  const out = [];
  for (const line of String(text).split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 6) continue;
    const flags = parseInt(f[2], 16);
    if (!(flags & 2)) continue; // 0x2 = complete entry
    const mac = U.normMac(f[3]);
    if (!mac || U.ipToInt(f[0]) === null) continue;
    out.push({ ip: f[0], mac, iface: f[5] });
  }
  return out;
}

function ifaceInfo(name, ifaces) {
  const list = (ifaces || os.networkInterfaces())[name] || [];
  const v4 = list.find((a) => a.family === 'IPv4' || a.family === 4);
  return v4 ? { ip: v4.address, mac: U.normMac(v4.mac || ''), netmask: v4.netmask } : null;
}

// Work out which network to scan. `override` is a list of CIDR strings from Settings.
function detectNetwork({ routeText, ifaces, override } = {}) {
  let route = null;
  try { route = parseRoute(routeText != null ? routeText : fs.readFileSync('/proc/net/route', 'utf8')); } catch (e) { /* none */ }
  const all = ifaces || os.networkInterfaces();

  let iface = route && route.iface;
  let info = iface ? ifaceInfo(iface, all) : null;
  if (!info) {
    // No default route (dev machine?): first private IPv4 interface that isn't a container bridge.
    for (const [name, list] of Object.entries(all)) {
      if (/^(lo|docker|br-|veth|virbr|tailscale|tun|wg|utun)/.test(name)) continue;
      const v4 = (list || []).find((a) => (a.family === 'IPv4' || a.family === 4) && !a.internal && U.isPrivateV4(a.address));
      if (v4) { iface = name; info = { ip: v4.address, mac: U.normMac(v4.mac || ''), netmask: v4.netmask }; break; }
    }
  }
  if (!info) return { ok: false, error: 'No LAN interface found. Is the app running with host networking?' };

  let auto = U.cidrFromNetmask(info.ip, info.netmask);
  if (!auto || auto.bits < MAX_BITS_SHORTEST) auto = U.parseCidr(info.ip.split('.').slice(0, 3).join('.') + '.0/24');
  if (auto.bits > 30) auto = U.parseCidr(info.ip.split('.').slice(0, 3).join('.') + '.0/24');

  let cidrs = [auto];
  let source = 'auto';
  const wanted = (override || []).map(U.parseCidr).filter(Boolean)
    .filter((c) => c.bits >= MAX_BITS_SHORTEST && c.bits <= 30 && U.isPrivateV4(U.intToIp(c.net)));
  if (wanted.length) { cidrs = wanted; source = 'custom'; }

  return {
    ok: true,
    iface,
    ip: info.ip,
    mac: info.mac,
    gateway: route ? route.gateway : null,
    cidrs: cidrs.map((c) => c.cidr),
    parsed: cidrs,
    source,
  };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// One discovery pass. Returns { hosts: [{ip, mac}], durationMs, error? }.
async function scanOnce(net, { settleMs = 8000, readArpText, send } = {}) {
  const t0 = Date.now();
  const targets = [];
  for (const c of net.parsed) targets.push(...U.hostsOf(c));

  let sock = null;
  const doSend = send || ((ip) => new Promise((resolve) => {
    sock.send(Buffer.alloc(1), 9, ip, () => resolve()); // UDP "discard" port; errors are fine
  }));
  if (!send) {
    sock = dgram.createSocket('udp4');
    sock.on('error', () => {});
  }
  try {
    for (let i = 0; i < targets.length; i += 64) {
      await Promise.all(targets.slice(i, i + 64).map((ip) => doSend(ip)));
      await sleep(5);
    }
    if (settleMs) await sleep(settleMs);
  } finally {
    if (sock) { try { sock.close(); } catch (e) { /* ignore */ } }
  }

  let text;
  try { text = readArpText ? readArpText() : fs.readFileSync('/proc/net/arp', 'utf8'); } catch (e) {
    return { hosts: [], durationMs: Date.now() - t0, error: 'Cannot read the ARP table (' + e.code + ')' };
  }
  const inScope = (ip) => net.parsed.some((c) => U.inCidr(ip, c));
  const byMac = new Map();
  for (const e of parseArp(text)) {
    if (!inScope(e.ip)) continue;
    if (net.iface && e.iface && e.iface !== net.iface && net.source === 'auto') continue;
    byMac.set(e.mac, { ip: e.ip, mac: e.mac });
  }
  // The machine we run on never appears in its own ARP table.
  if (net.mac && net.ip && inScope(net.ip)) byMac.set(net.mac, { ip: net.ip, mac: net.mac });
  return { hosts: [...byMac.values()], durationMs: Date.now() - t0 };
}

module.exports = { parseRoute, parseArp, detectNetwork, scanOnce, MAX_BITS_SHORTEST };
