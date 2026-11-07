'use strict';
// The brain: turns raw scan results into devices, online sessions, uptime,
// events and chart data. No network or disk access in here, so it is easy to test.
const U = require('./util');
const oui = require('./oui');
const { guessType, TYPES } = require('./classify');

const DAY = 86400e3;
const RETENTION = { sessions: 90 * DAY, samples: 30 * DAY, probes: 14 * DAY, events: 2000 };
const RANGES = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };

const DEFAULT_SETTINGS = {
  scanIntervalSec: 30,
  offlineAfterSec: 300,
  subnets: [],
  resolveNames: true,
  speedEveryHours: 0,
  ntfy: { enabled: false, server: 'https://ntfy.sh', topic: '' },
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function newState(now) {
  return {
    v: 1, createdAt: now, baselineDone: false, baselineAt: null,
    settings: clone(DEFAULT_SETTINGS),
    devices: {}, order: [], speed: [], events: [], samples: [], probes: [], watch: [], lastScan: null,
  };
}

// ---- settings ----
function validateSettings(input, current) {
  const out = clone(current || DEFAULT_SETTINGS);
  const err = (m) => ({ ok: false, error: m });
  if (input.scanIntervalSec !== undefined) {
    const n = Number(input.scanIntervalSec);
    if (!Number.isInteger(n) || n < 15 || n > 300) return err('Scan interval must be 15 to 300 seconds');
    out.scanIntervalSec = n;
  }
  if (input.offlineAfterSec !== undefined) {
    const n = Number(input.offlineAfterSec);
    if (!Number.isInteger(n) || n < 60 || n > 1800) return err('Offline delay must be 60 to 1800 seconds');
    out.offlineAfterSec = n;
  }
  if (input.speedEveryHours !== undefined) {
    const n = Number(input.speedEveryHours);
    if (![0, 3, 6, 12, 24].includes(n)) return err('Speed test schedule must be off, or every 3, 6, 12 or 24 hours');
    out.speedEveryHours = n;
  }
  if (input.resolveNames !== undefined) out.resolveNames = !!input.resolveNames;
  if (input.subnets !== undefined) {
    if (!Array.isArray(input.subnets) || input.subnets.length > 4) return err('Up to 4 networks');
    const list = [];
    for (const s of input.subnets) {
      const c = U.parseCidr(s);
      if (!c || c.bits < 23 || c.bits > 30 || !U.isPrivateV4(U.intToIp(c.net))) {
        return err('Networks must be private ranges between /23 and /30, like 192.168.1.0/24');
      }
      list.push(c.cidr);
    }
    out.subnets = list;
  }
  if (input.ntfy !== undefined) {
    const n = input.ntfy || {};
    const next = Object.assign({}, out.ntfy);
    if (n.enabled !== undefined) next.enabled = !!n.enabled;
    if (n.server !== undefined) {
      let u;
      try { u = new URL(String(n.server)); } catch (e) { return err('Notification server must be a web address'); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return err('Notification server must start with http:// or https://');
      next.server = u.origin + u.pathname.replace(/\/+$/, '');
    }
    if (n.topic !== undefined) {
      const t = String(n.topic).trim();
      if (t && !/^[A-Za-z0-9_-]{1,64}$/.test(t)) return err('Topic can only use letters, numbers, - and _');
      next.topic = t;
    }
    if (next.enabled && !next.topic) return err('Enter a topic to turn notifications on');
    out.ntfy = next;
  }
  return { ok: true, settings: out };
}

class Engine {
  constructor(state, now = Date.now()) {
    this.s = state && state.v === 1 ? state : newState(now);
    this.s.settings = Object.assign(clone(DEFAULT_SETTINGS), this.s.settings);
    this.s.settings.ntfy = Object.assign(clone(DEFAULT_SETTINGS.ntfy), this.s.settings.ntfy);
    if (!Array.isArray(this.s.order)) this.s.order = [];
    if (!Array.isArray(this.s.speed)) this.s.speed = [];
    this.pending = []; // new-device notifications waiting to be sent
    this.version = 0;  // bumps on every change (SSE uses it)
  }

  get settings() { return this.s.settings; }
  get graceMs() { return this.s.settings.offlineAfterSec * 1000; }
  touch() { this.version++; }

  // Called once at startup: close sessions that ended while the app was stopped.
  repair(now) {
    for (const d of Object.values(this.s.devices)) {
      const last = d.sessions[d.sessions.length - 1];
      if (last && last[1] === null) {
        if (now - d.lastSeen > this.graceMs) { last[1] = d.lastSeen; d.online = false; } else d.online = true;
      } else d.online = false;
    }
  }

  heartbeat(now) {
    const maxGap = Math.max(3 * this.s.settings.scanIntervalSec * 1000, 90e3);
    const w = this.s.watch;
    const last = w[w.length - 1];
    if (last && now - last[1] <= maxGap) last[1] = now;
    else w.push([now, now]);
  }

  _ev(kind, mac, msg, now) {
    this.s.events.push({ t: now, kind, mac, msg });
    if (this.s.events.length > RETENTION.events + 200) this.s.events.splice(0, this.s.events.length - RETENTION.events);
  }

  _newDevice(mac, ip, now, known) {
    const random = U.isRandomMac(mac);
    return {
      mac, ip, hostname: null, hostnameAt: 0,
      vendor: random ? null : oui.lookup(mac),
      random, name: '', type: '', typeAuto: 'other', notes: '',
      known, hidden: false, role: 'device',
      firstSeen: now, lastSeen: now, online: false, sessions: [],
    };
  }

  // hosts: [{ip, mac}] found this scan. ctx: { gatewayIp, selfMac }
  applyScan(hosts, now, ctx = {}) {
    const s = this.s;
    const seen = new Set();
    const baseline = !s.baselineDone;
    let created = 0;

    for (const h of hosts) {
      const mac = U.normMac(h.mac);
      if (!mac) continue;
      seen.add(mac);
      let d = s.devices[mac];
      if (!d) {
        d = this._newDevice(mac, h.ip, now, baseline);
        s.devices[mac] = d;
        created++;
        if (!baseline) {
          this._ev('new', mac, 'New device joined the network', now);
          this.pending.push({ mac, ip: h.ip, vendor: d.vendor });
        }
      }
      d.ip = h.ip;
      d.lastSeen = now;
      d.role = ctx.gatewayIp && h.ip === ctx.gatewayIp ? 'gateway' : ctx.selfMac && mac === ctx.selfMac ? 'self' : 'device';
      d.typeAuto = guessType(d);
      if (!d.online) {
        d.online = true;
        d.sessions.push([now, null]);
        if (!baseline && d.firstSeen !== now) this._ev('joined', mac, 'Came online', now);
      }
    }

    for (const d of Object.values(s.devices)) {
      if (seen.has(d.mac) || !d.online) continue;
      if (now - d.lastSeen > this.graceMs) {
        const last = d.sessions[d.sessions.length - 1];
        if (last && last[1] === null) last[1] = d.lastSeen;
        d.online = false;
        this._ev('left', d.mac, 'Went offline', d.lastSeen);
      }
    }

    if (baseline && seen.size >= 2) {
      s.baselineDone = true;
      s.baselineAt = now;
      this._ev('baseline', null, 'Found ' + created + ' devices on the network', now);
    }

    s.lastScan = { at: now, hosts: seen.size };
    this.heartbeat(now);
    this.addSample(now);
    this.touch();
    return { created };
  }

  addSample(now) {
    const last = this.s.samples[this.s.samples.length - 1];
    if (last && now - last.t < 55e3) return;
    let n = 0;
    for (const d of Object.values(this.s.devices)) if (d.online) n++;
    this.s.samples.push({ t: now, n });
  }

  addProbe(now, p) {
    this.s.probes.push({ t: now, wan: p.wan, lan: p.lan });
    this.touch();
  }

  setHostname(mac, name, now) {
    const d = this.s.devices[mac];
    if (!d) return;
    d.hostnameAt = now;
    if (name && name !== d.hostname) {
      d.hostname = name;
      d.typeAuto = guessType(d);
      this.touch();
    }
  }

  setBtc(mac, on, now) {
    const d = this.s.devices[mac];
    if (!d) return;
    d.btcAt = now;
    if (!!d.btc !== !!on) { d.btc = !!on; this.touch(); }
  }

  // Online devices whose Bitcoin-port check is due (daily if it answered, every 12 h if not).
  needsBtc(now) {
    return Object.values(this.s.devices).filter((d) => d.online && d.role !== 'gateway' && now - (d.btcAt || 0) > (d.btc ? 24 : 12) * 3600e3);
  }

  // Devices whose name should be (re)looked up now.
  needsName(now, retryMs = 6 * 3600e3) {
    const out = [];
    for (const d of Object.values(this.s.devices)) {
      if (!d.online) continue;
      if (d.hostname ? now - d.hostnameAt > 7 * DAY : now - d.hostnameAt > retryMs) out.push(d);
    }
    return out;
  }

  updateDevice(mac, patch, now) {
    const d = this.s.devices[mac];
    if (!d) return null;
    if (patch.name !== undefined) {
      const n = U.cleanText(patch.name, 40);
      if (n !== d.name) {
        this._ev('renamed', mac, n ? 'Named "' + n + '"' : 'Name cleared', now);
        d.name = n;
        if (n) d.known = true;
      }
    }
    if (patch.type !== undefined) {
      if (patch.type !== '' && !TYPES.includes(patch.type)) throw Object.assign(new Error('Unknown device type'), { status: 400 });
      d.type = patch.type;
    }
    if (patch.notes !== undefined) d.notes = U.cleanText(patch.notes, 300);
    if (patch.known !== undefined) d.known = !!patch.known;
    if (patch.hidden !== undefined) d.hidden = !!patch.hidden;
    if (patch.group !== undefined) d.group = U.cleanText(patch.group, 24);
    this.touch();
    return d;
  }

  // The one constellation: the order devices sit around the ring, set by dragging.
  setOrder(list, tags) {
    if (!Array.isArray(list) || list.length > 2000) throw Object.assign(new Error('Bad order'), { status: 400 });
    const seen = new Set();
    const out = [];
    for (const m of list) {
      const mac = typeof m === 'string' ? U.normMac(m) : null;
      if (mac && this.s.devices[mac] && !seen.has(mac)) { seen.add(mac); out.push(mac); }
    }
    this.s.order = out;
    if (tags && typeof tags === 'object') {
      for (const [m, t] of Object.entries(tags)) {
        const mac = U.normMac(m);
        if (mac && this.s.devices[mac]) this.s.devices[mac].group = U.cleanText(t, 24);
      }
    }
    this.touch();
    return out;
  }

  acknowledgeAll() {
    let n = 0;
    for (const d of Object.values(this.s.devices)) if (!d.known) { d.known = true; n++; }
    if (n) this.touch();
    return n;
  }

  forget(mac) {
    if (!this.s.devices[mac]) return false;
    delete this.s.devices[mac];
    this.s.order = this.s.order.filter((m) => m !== mac);
    this.s.events = this.s.events.filter((e) => e.mac !== mac);
    this.touch();
    return true;
  }

  addSpeed(r) {
    this.s.speed.push(r);
    if (this.s.speed.length > 400) this.s.speed.splice(0, this.s.speed.length - 400);
    this.touch();
  }

  clearHistory(now) {
    this.s.speed = [];
    this.s.samples = [];
    this.s.probes = [];
    this.s.events = [];
    this.s.watch = [[now, now]];
    for (const d of Object.values(this.s.devices)) {
      d.sessions = d.online ? [[now, null]] : [];
      d.firstSeen = d.online ? now : d.firstSeen;
    }
    this.touch();
  }

  prune(now) {
    const s = this.s;
    for (const d of Object.values(s.devices)) {
      const cut = now - RETENTION.sessions;
      if (d.sessions.length && d.sessions[0][1] !== null && d.sessions[0][1] < cut) {
        d.sessions = d.sessions.filter((x) => x[1] === null || x[1] >= cut);
      }
      if (d.sessions.length > 4000) d.sessions.splice(0, d.sessions.length - 4000);
    }
    s.probes = s.probes.filter((p) => p.t >= now - RETENTION.probes);
    // Keep minute samples for a week, 5-minute samples after that.
    const week = now - 7 * DAY;
    const out = [];
    let lastBucket = -1;
    for (const p of s.samples) {
      if (p.t < now - RETENTION.samples) continue;
      if (p.t >= week) { out.push(p); continue; }
      const b = Math.floor(p.t / 300e3);
      if (b !== lastBucket) { out.push(p); lastBucket = b; }
    }
    s.samples = out;
    s.watch = s.watch.filter((w) => w[1] >= now - RETENTION.sessions);
  }

  // ---- views ----
  uptime(d, now, windowMs) {
    const a = Math.max(now - windowMs, d.firstSeen);
    const monitored = U.overlapMs(this.s.watch, a, now, now);
    if (monitored <= 0) return { pct: null, onlineMs: 0, monitoredMs: 0 };
    const onlineMs = Math.min(monitored, U.overlapMs(d.sessions, a, now, now));
    return { pct: onlineMs / monitored, onlineMs, monitoredMs: monitored };
  }

  view(d, now) {
    const open = d.online ? d.sessions[d.sessions.length - 1] : null;
    return {
      mac: d.mac, ip: d.ip, name: d.name, hostname: d.hostname, vendor: d.vendor,
      type: d.type || d.typeAuto, typeAuto: d.typeAuto, typeSet: d.type,
      notes: d.notes, known: d.known, hidden: d.hidden, role: d.role, random: d.random,
      firstSeen: d.firstSeen, lastSeen: d.lastSeen, online: d.online, group: d.group || '', btc: !!d.btc,
      since: open ? open[0] : null,
      up24: this.uptime(d, now, DAY),
      up7: this.uptime(d, now, 7 * DAY),
      label: d.name || d.hostname || (d.random ? '' : d.vendor) || d.ip,
    };
  }

  list(now) {
    return Object.values(this.s.devices).map((d) => this.view(d, now));
  }

  summary(now) {
    const devs = Object.values(this.s.devices);
    const online = devs.filter((d) => d.online).length;
    const unreviewed = devs.filter((d) => !d.known).length;
    const unnamed = devs.filter((d) => !d.name && d.role === 'device').length;
    const lastProbe = this.s.probes[this.s.probes.length - 1] || null;
    return { total: devs.length, online, unreviewed, unnamed, lastProbe, baselineDone: this.s.baselineDone };
  }

  history(range, now) {
    const span = RANGES[range] || RANGES['24h'];
    const from = now - span;
    const bucket = Math.max(60e3, Math.ceil(span / 360 / 60e3) * 60e3);

    // devices online over time
    const online = [];
    {
      let cur = -1, sum = 0, cnt = 0, t0 = 0;
      const flush = () => { if (cnt) online.push([t0, Math.round((sum / cnt) * 10) / 10]); };
      for (const p of this.s.samples) {
        if (p.t < from) continue;
        const b = Math.floor((p.t - from) / bucket);
        if (b !== cur) { flush(); cur = b; sum = 0; cnt = 0; t0 = from + b * bucket; }
        sum += p.n; cnt++;
      }
      flush();
    }

    // internet latency
    const wan = [];
    const all = [];
    let lost = 0, total = 0;
    {
      let cur = -1, vals = [], lan = [], miss = 0, t0 = 0;
      const flush = () => {
        if (!vals.length && !miss) return;
        const n = vals.length;
        const avg = n ? vals.reduce((a, b) => a + b, 0) / n : null;
        const lanAvg = lan.length ? lan.reduce((a, b) => a + b, 0) / lan.length : null;
        wan.push([t0, avg === null ? null : Math.round(avg * 10) / 10, n ? Math.min(...vals) : null, n ? Math.max(...vals) : null,
          Math.round((miss / (n + miss)) * 1000) / 10, lanAvg === null ? null : Math.round(lanAvg * 10) / 10]);
      };
      for (const p of this.s.probes) {
        if (p.t < from) continue;
        const b = Math.floor((p.t - from) / bucket);
        if (b !== cur) { flush(); cur = b; vals = []; lan = []; miss = 0; t0 = from + b * bucket; }
        total++;
        if (p.wan === null) { miss++; lost++; } else { vals.push(p.wan); all.push(p.wan); }
        if (p.lan !== null && p.lan !== undefined) lan.push(p.lan);
      }
      flush();
    }
    all.sort((a, b) => a - b);
    const stats = {
      count: total,
      avg: all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10 : null,
      min: all.length ? all[0] : null,
      p95: all.length ? all[Math.min(all.length - 1, Math.floor(all.length * 0.95))] : null,
      max: all.length ? all[all.length - 1] : null,
      lossPct: total ? Math.round((lost / total) * 1000) / 10 : null,
    };

    // per-device presence in range
    const devices = Object.values(this.s.devices).map((d) => {
      const a = Math.max(from, d.firstSeen);
      const monitored = U.overlapMs(this.s.watch, a, now, now);
      const onlineMs = Math.min(monitored, U.overlapMs(d.sessions, a, now, now));
      return {
        mac: d.mac, label: this.view(d, now).label, type: d.type || d.typeAuto, online: d.online, role: d.role,
        onlineMs, monitoredMs: monitored, pct: monitored > 0 ? onlineMs / monitored : null,
        sessions: U.clipIntervals(d.sessions, from, now, now),
      };
    });

    const events = this.s.events.filter((e) => e.t >= from).slice(-300).reverse();
    const watch = U.clipIntervals(this.s.watch, from, now, now);
    const speed = this.s.speed.filter((r) => r.t >= from);
    return { range: RANGES[range] ? range : '24h', speed, from, to: now, bucketMs: bucket, online, wan, wanStats: stats, devices, events, watch };
  }

  // Rebuild a clean state from an uploaded backup. Never trust the shape.
  static sanitizeImport(obj, now) {
    if (!obj || typeof obj !== 'object' || obj.v !== 1 || typeof obj.devices !== 'object') {
      throw Object.assign(new Error('That does not look like a Constellation backup'), { status: 400 });
    }
    const st = newState(now);
    const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    st.createdAt = num(obj.createdAt) || now;
    st.baselineDone = !!obj.baselineDone;
    st.baselineAt = num(obj.baselineAt);
    const vs = validateSettings(obj.settings || {}, st.settings);
    if (vs.ok) st.settings = vs.settings;
    for (const [k, d] of Object.entries(obj.devices)) {
      const mac = U.normMac(k);
      if (!mac || !d || typeof d !== 'object') continue;
      const nd = {
        mac, ip: U.ipToInt(d.ip) === null ? '' : d.ip,
        hostname: d.hostname ? U.cleanText(d.hostname, 63) : null, hostnameAt: num(d.hostnameAt) || 0,
        vendor: d.vendor ? U.cleanText(d.vendor, 60) : null, random: U.isRandomMac(mac),
        name: U.cleanText(d.name, 40), type: TYPES.includes(d.type) ? d.type : '',
        typeAuto: TYPES.includes(d.typeAuto) ? d.typeAuto : 'other', notes: U.cleanText(d.notes, 300),
        known: d.known !== false, hidden: !!d.hidden, group: '', role: ['gateway', 'self'].includes(d.role) ? d.role : 'device',
        firstSeen: num(d.firstSeen) || now, lastSeen: num(d.lastSeen) || now, online: false, sessions: [],
      };
      if (typeof d.group === 'string') nd.group = U.cleanText(d.group, 24);
      nd.btc = d.btc === true; nd.btcAt = num(d.btcAt) || 0;
      for (const iv of Array.isArray(d.sessions) ? d.sessions.slice(-4000) : []) {
        if (Array.isArray(iv) && num(iv[0]) !== null && (iv[1] === null || num(iv[1]) !== null)) nd.sessions.push([iv[0], iv[1]]);
      }
      st.devices[mac] = nd;
    }
    const pairs = (arr, f) => (Array.isArray(arr) ? arr : []).map(f).filter(Boolean);
    st.samples = pairs(obj.samples, (p) => (p && num(p.t) !== null && num(p.n) !== null ? { t: p.t, n: p.n } : null)).slice(-60000);
    st.probes = pairs(obj.probes, (p) => (p && num(p.t) !== null ? { t: p.t, wan: num(p.wan), lan: num(p.lan) } : null)).slice(-30000);
    st.order = (Array.isArray(obj.order) ? obj.order : []).map((m) => (typeof m === 'string' ? U.normMac(m) : null)).filter((m, i, a) => m && st.devices[m] && a.indexOf(m) === i);
    st.events = pairs(obj.events, (e) => (e && num(e.t) !== null && typeof e.kind === 'string'
      ? { t: e.t, kind: e.kind.slice(0, 16), mac: U.normMac(e.mac || '') || null, msg: U.cleanText(e.msg, 120) } : null)).slice(-RETENTION.events);
    st.speed = pairs(obj.speed, (r) => (r && num(r.t) !== null ? { t: r.t, down: num(r.down), up: num(r.up), ping: num(r.ping), jitter: num(r.jitter), server: U.cleanText(r.server, 24), error: r.error ? U.cleanText(r.error, 120) : null } : null)).slice(-400);
    st.watch = pairs(obj.watch, (w) => (Array.isArray(w) && num(w[0]) !== null && num(w[1]) !== null ? [w[0], w[1]] : null));
    return st;
  }
}

module.exports = { Engine, newState, validateSettings, DEFAULT_SETTINGS, RANGES };
