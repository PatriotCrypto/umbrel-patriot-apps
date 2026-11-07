'use strict';
// Small shared helpers: IPv4/CIDR math, MAC normalising, interval overlap.

function ipToInt(ip) {
  const p = String(ip).split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x)) return null;
    const v = Number(x);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

// Parse "192.168.1.0/24" -> { net, bits, mask, size, cidr } or null.
function parseCidr(text) {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/.exec(String(text).trim());
  if (!m) return null;
  const ip = ipToInt(m[1]);
  const bits = Number(m[2]);
  if (ip === null || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const net = (ip & mask) >>> 0;
  return { net, bits, mask, size: Math.pow(2, 32 - bits), cidr: intToIp(net) + '/' + bits };
}

function cidrFromNetmask(ip, netmask) {
  const i = ipToInt(ip);
  const m = ipToInt(netmask);
  if (i === null || m === null) return null;
  let bits = 0;
  for (let b = 31; b >= 0; b--) {
    if ((m >>> b) & 1) bits++;
    else break;
  }
  return parseCidr(intToIp(((i & m) >>> 0)) + '/' + bits);
}

function inCidr(ip, c) {
  const i = ipToInt(ip);
  if (i === null || !c) return false;
  return ((i & c.mask) >>> 0) === c.net;
}

// Usable host addresses (no network / broadcast address).
function hostsOf(c) {
  const out = [];
  for (let i = 1; i < c.size - 1; i++) out.push(intToIp(c.net + i));
  return out;
}

function isPrivateV4(ip) {
  const i = ipToInt(ip);
  if (i === null) return false;
  return (
    inCidr(ip, parseCidr('10.0.0.0/8')) ||
    inCidr(ip, parseCidr('172.16.0.0/12')) ||
    inCidr(ip, parseCidr('192.168.0.0/16'))
  );
}

// Normalise any common MAC spelling to "aa:bb:cc:dd:ee:ff". Returns null for
// junk, broadcast, all-zero and multicast addresses.
function normMac(m) {
  if (typeof m !== 'string') return null;
  let s = m.trim().toLowerCase();
  let parts;
  if (/[:-]/.test(s)) {
    parts = s.split(/[:-]/);
  } else {
    s = s.replace(/\./g, '');
    if (!/^[0-9a-f]{12}$/.test(s)) return null;
    parts = s.match(/../g);
  }
  if (parts.length !== 6) return null;
  const out = [];
  for (const p of parts) {
    if (!/^[0-9a-f]{1,2}$/.test(p)) return null;
    out.push(p.padStart(2, '0'));
  }
  const mac = out.join(':');
  if (mac === '00:00:00:00:00:00' || mac === 'ff:ff:ff:ff:ff:ff') return null;
  if (parseInt(out[0], 16) & 1) return null; // multicast
  return mac;
}

// Phones and laptops use "private" (locally administered) MACs for Wi-Fi.
function isRandomMac(mac) {
  return /^.[26ae]/.test(mac);
}

// Total milliseconds of [start, end|null] intervals inside the window [a, b].
function overlapMs(intervals, a, b, now) {
  let t = 0;
  for (const iv of intervals) {
    const s = iv[0];
    const e = iv[1] === null || iv[1] === undefined ? now : iv[1];
    const lo = Math.max(s, a);
    const hi = Math.min(e, b);
    if (hi > lo) t += hi - lo;
  }
  return t;
}

function clipIntervals(intervals, a, b, now) {
  const out = [];
  for (const iv of intervals) {
    const s = iv[0];
    const e = iv[1] === null || iv[1] === undefined ? now : iv[1];
    const lo = Math.max(s, a);
    const hi = Math.min(e, b);
    if (hi > lo) out.push([lo, hi]);
  }
  return out;
}

function cleanText(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);
}

module.exports = {
  ipToInt, intToIp, parseCidr, cidrFromNetmask, inCidr, hostsOf, isPrivateV4,
  normMac, isRandomMac, overlapMs, clipIntervals, cleanText,
};
