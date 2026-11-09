'use strict';
const { resolve, nextBoundary, activePeriod, clampPair, toMin, localParts, clamp } = require('./schedule');

const SAMPLE_MS = 5 * 60000;
const GRACE_MS = 3 * 60000; // changes this close to a period start are probably the thermostat's own schedule
const WRITE_GAP_MS = 60000;

class Engine {
  /**
   * @param store  Store
   * @param opts   {now: () => ms}
   */
  constructor(store, { now = () => Date.now() } = {}) {
    this.store = store;
    this.now = now;
    this.adapter = null;
    this.persist = false;
    this.demoHist = { samples: [], runs: [] };
    this.expected = null; // setpoints we last wrote or last saw
    this.lastWriteAt = 0;
    this.quietUntil = 0;
    this._busy = false;
    this._again = false;
    this.lastSampleAt = 0;
    this.openRun = null;
    this.last = { desired: null, snap: null, status: 'starting', note: null };
    this.coldSince = null;
    this.offset = { heat: 0, cool: 0, at: 0 };
    this.lastError = null;
  }

  get hist() { return this.persist ? this.store.history : this.demoHist; }
  get settings() { return this.store.data.settings; }

  setAdapter(adapter, { persist }) {
    this.adapter?.removeAllListeners?.('update');
    this.adapter = adapter;
    this.persist = persist;
    this.expected = null;
    this.openRun = null;
    this.coldSince = null;
    this.offset = { heat: 0, cool: 0, at: 0 };
  }

  log(type, msg) {
    // demo mode keeps its log out of the saved event list
    if (this.persist) this.store.event(type, msg, this.now());
  }

  desired(snap) {
    const s = this.store.data;
    const now = new Date(this.now());
    const d = resolve({ schedule: s.schedule, hold: s.hold, away: s.away, now, tz: this.settings.tz, limits: this.settings.limits });
    if (!d) return null;
    return this._roomAdjust(d, snap, now.getTime());
  }

  _roomAdjust(d, snap, nowMs) {
    const ra = this.settings.roomAware;
    if (!ra.enabled || !ra.roomId || d.source === 'away') return { ...d, adjust: 0 };
    const room = snap?.sensors?.find((r) => String(r.nodeId) === String(ra.roomId));
    if (!room || room.temp == null || nowMs - room.lastSeen > 30 * 60000) return { ...d, adjust: 0 };
    if (nowMs - this.offset.at >= 10 * 60000) {
      const max = Math.max(0, Math.min(5, ra.maxOffset));
      this.offset = {
        heat: Math.round(clamp(d.heat - room.temp, -max, max)),
        cool: Math.round(clamp(d.cool - room.temp, -max, max)),
        at: nowMs,
      };
    }
    // cold room -> raise the heat setpoint; hot room -> lower the cool setpoint
    const heat = this.offset.heat > 0 ? d.heat + this.offset.heat : d.heat;
    const cool = this.offset.cool < 0 ? d.cool + this.offset.cool : d.cool;
    const c = clampPair(heat, cool, this.settings.limits);
    return { ...d, heat: c.heat, cool: c.cool, adjust: c.heat - d.heat };
  }

  /** Run a tick; if one is already running (a slow Z-Wave write), run once more right after instead of overlapping. */
  async tick() {
    if (this._busy) { this._again = true; return; }
    this._busy = true;
    try { await this._tick(); } finally { this._busy = false; }
    if (this._again) { this._again = false; return this.tick(); }
  }

  /** The user (or the schedule editor) just changed something: allow a fresh write, and don't read the thermostat's old values as a wall change. */
  _userChanged() { this.lastWriteAt = 0; this.quietUntil = this.now() + 120000; }

  async _tick() {
    if (!this.adapter) return;
    const nowMs = this.now();
    const snap = this.adapter.snapshot();
    const t = snap.thermostat;
    this.last.snap = snap;
    if (!snap.connected) { this.last.status = 'disconnected'; this.last.desired = null; return; }
    if (!t) { this.last.status = 'no-thermostat'; this.last.desired = null; this._track(null, snap, nowMs); return; }

    this._track(t, snap, nowMs);
    this._expireHold(nowMs);

    const d = this.desired(snap);
    this.last.desired = d;
    if (!d || t.heat == null || t.cool == null) { this.last.status = 'waiting'; return; }
    const obs = { heat: t.heat, cool: t.cool };

    const differs = this.expected && (Math.abs(obs.heat - this.expected.heat) >= 0.5 || Math.abs(obs.cool - this.expected.cool) >= 0.5);
    const writeLag = nowMs - this.lastWriteAt < 90000 || nowMs < this.quietUntil; // the thermostat takes a moment to report our own write back
    const reverted = differs && this.preWrite && Math.abs(obs.heat - this.preWrite.heat) < 0.5 && Math.abs(obs.cool - this.preWrite.cool) < 0.5;
    if (differs && !writeLag && reverted) {
      // the thermostat went back to what it had before our write: it refused or dropped it. That is not someone at the wall.
      this.log('error', `The thermostat did not keep our setting (still ${obs.heat}/${obs.cool}). Check its mode: it may ignore this setpoint in Off or the other mode.`);
      this.expected = obs; this.preWrite = null;
    } else if (differs && !writeLag) {
      if (this._nearBoundary(nowMs)) {
        this.expected = obs; // the thermostat's own schedule moved at the same time ours did
      } else {
        this.log('external', `Setpoints changed outside Cold Front: heat ${this.expected.heat}→${obs.heat}, cool ${this.expected.cool}→${obs.cool}`);
        this.expected = obs;
        if (this.settings.wallChange === 'hold' && this.settings.enforce) {
          const next = nextBoundary(this.store.data.schedule, new Date(nowMs), this.settings.tz);
          this.store.data.hold = { heat: obs.heat, cool: obs.cool, until: next ? next.at.toISOString() : null, source: 'wall', since: nowMs };
          this.store.touch();
          this.log('hold', `Holding ${obs.heat}/${obs.cool} until the next period`);
          this.last.desired = this.desired(snap);
          this.last.status = 'ok';
          return;
        }
      }
    }
    if (!this.expected) this.expected = obs;

    const off = Math.abs(obs.heat - d.heat) >= 0.5 || Math.abs(obs.cool - d.cool) >= 0.5;
    if (!this.settings.enforce) { this.last.status = off ? 'observing' : 'ok'; return; }
    if (off && nowMs - this.lastWriteAt >= WRITE_GAP_MS) {
      this.lastWriteAt = nowMs;
      this.preWrite = { heat: obs.heat, cool: obs.cool };
      try {
        await this.adapter.setSetpoints({ heat: Math.abs(obs.heat - d.heat) >= 0.5 ? d.heat : null, cool: Math.abs(obs.cool - d.cool) >= 0.5 ? d.cool : null });
        this.expected = { heat: d.heat, cool: d.cool };
        this.log('set', `Set heat ${d.heat}, cool ${d.cool} (${d.label})`);
        this.lastError = null;
        this.last.status = 'ok';
      } catch (e) {
        this.lastError = e.message;
        this.log('error', `Could not set setpoints: ${e.message}`);
        this.last.status = 'write-failed';
      }
    } else this.last.status = 'ok';
  }

  _nearBoundary(nowMs) {
    const sched = this.store.data.schedule;
    const now = new Date(nowMs);
    const a = activePeriod(sched, now, this.settings.tz);
    if (!a) return false;
    const lp = localParts(now, this.settings.tz);
    if (a.day === ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][lp.day] && lp.minutes - toMin(a.period.time) <= GRACE_MS / 60000) return true;
    return false;
  }

  _expireHold(nowMs) {
    const s = this.store.data;
    for (const k of ['hold', 'away']) {
      if (s[k] && s[k].until && new Date(s[k].until).getTime() <= nowMs) {
        this.log(k, `${k === 'hold' ? 'Hold' : 'Away'} ended`);
        s[k] = null;
        this.store.touch();
      }
    }
  }

  _track(t, snap, nowMs) {
    // run tracking (no thermostat yet: still record room sensors below)
    const kind = t && (t.opState === 'heating' || t.opState === 'cooling' || t.opState === 'fan') ? t.opState : null;
    if (kind !== (this.openRun ? this.openRun.kind : null)) {
      if (this.openRun) { this.openRun.end = nowMs; this.hist.runs.push(this.openRun); this.openRun = null; }
      if (kind) this.openRun = { kind, start: nowMs };
    }
    // samples
    if (nowMs - this.lastSampleAt >= SAMPLE_MS) {
      this.lastSampleAt = nowMs;
      const rooms = {};
      for (const r of snap.sensors) rooms[r.nodeId] = { t: r.temp, h: r.humidity };
      this.hist.samples.push(t ? { t: nowMs, in: t.temp, hum: t.humidity, heat: t.heat, cool: t.cool, op: t.opState, mode: t.mode, rooms } : { t: nowMs, in: null, hum: null, heat: null, cool: null, op: null, mode: null, rooms });
      if (this.persist) { try { this.store.saveHistory(); } catch (e) { console.error('history save failed:', e.message); } }
      if (!this.persist && this.hist.samples.length > 9000) this.hist.samples.splice(0, 500);
    }
    // furnace not heating when the house is cold
    const cold = !!t && t.temp != null && t.heat != null && t.temp < t.heat - 3 && (t.mode === 'heat' || t.mode === 'auto') && t.opState === 'idle';
    if (cold) this.coldSince ||= nowMs; else this.coldSince = null;
  }

  alerts(snap, nowMs) {
    const out = [];
    const st = this.last.status;
    if (!snap || !snap.connected) out.push({ level: 'bad', key: 'link', text: 'Not connected to the Z-Wave JS server.' });
    else if (!snap.thermostat) out.push({ level: 'warn', key: 'nothermo', text: 'Connected, but no thermostat is paired yet.' });
    const t = snap?.thermostat;
    if (t) {
      if (nowMs - t.lastSeen > 15 * 60000 && snap.kind !== 'sim') out.push({ level: 'warn', key: 'stale', text: 'No report from the thermostat for over 15 minutes.' });
      if (t.temp != null && t.temp < 45) out.push({ level: 'bad', key: 'freeze', text: `Indoor temperature is ${t.temp}°F. Pipes can freeze below about 40°F.` });
      if (t.temp != null && t.temp > 90) out.push({ level: 'bad', key: 'hot', text: `Indoor temperature is ${t.temp}°F.` });
      if (this.coldSince && nowMs - this.coldSince > 45 * 60000) out.push({ level: 'bad', key: 'noheat', text: 'The house is more than 3°F under the heat setpoint and the furnace is not running. Check the furnace.' });
      if (st === 'write-failed') out.push({ level: 'warn', key: 'write', text: `Could not change the thermostat: ${this.lastError}` });
    }
    const h = this.settings.humidity;
    for (const r of snap?.sensors || []) {
      const name = this.store.data.rooms[r.nodeId]?.name || r.name || `Sensor ${r.nodeId}`;
      if (r.humidity != null && r.humidity > h.max) out.push({ level: 'warn', key: `hum${r.nodeId}`, text: `${name} humidity is ${r.humidity}%.` });
      if (r.humidity != null && r.humidity < h.min) out.push({ level: 'info', key: `dry${r.nodeId}`, text: `${name} humidity is ${r.humidity}%, which is dry.` });
      if (r.battery != null && r.battery <= 20) out.push({ level: 'warn', key: `bat${r.nodeId}`, text: `${name} battery is at ${r.battery}%.` });
      if (snap.kind !== 'sim' && nowMs - r.lastSeen > 3 * 3600000) out.push({ level: 'warn', key: `off${r.nodeId}`, text: `${name} has not reported in over 3 hours.` });
    }
    for (const l of snap?.leaks || []) {
      const name = this.store.data.rooms[l.nodeId]?.name || l.name || `Water sensor ${l.nodeId}`;
      if (l.wet) out.push({ level: 'bad', key: `leak${l.nodeId}`, text: `Water detected at ${name}. Go and check it now.` });
      if (l.battery != null && l.battery <= 20) out.push({ level: 'warn', key: `lbat${l.nodeId}`, text: `${name} battery is at ${l.battery}%.` });
      // water sensors sleep for long stretches, so give them a full day before calling them quiet
      if (snap.kind !== 'sim' && nowMs - l.lastSeen > 26 * 3600000) out.push({ level: 'warn', key: `loff${l.nodeId}`, text: `${name} has not reported in over a day.` });
    }
    return out;
  }

  state() {
    const nowMs = this.now();
    const snap = this.last.snap;
    const s = this.store.data;
    const d = this.last.desired;
    const next = nextBoundary(s.schedule, new Date(nowMs), this.settings.tz);
    const sensors = (snap?.sensors || []).map((r) => ({ ...r, name: s.rooms[r.nodeId]?.name || r.name || `Sensor ${r.nodeId}`, include: s.rooms[r.nodeId]?.include !== false }));
    return {
      now: nowMs,
      mode: this.settings.mode,
      adapter: { kind: snap?.kind || this.adapter?.kind, connected: !!snap?.connected, error: snap?.error || null },
      status: this.last.status,
      thermostat: snap?.thermostat || null,
      sensors,
      leaks: (snap?.leaks || []).map((l) => ({ ...l, name: s.rooms[l.nodeId]?.name || l.name || `Water sensor ${l.nodeId}` })),
      desired: d,
      next: next ? { at: next.at.toISOString(), name: next.period.name, heat: next.period.heat, cool: next.period.cool } : null,
      hold: s.hold, away: s.away,
      alerts: this.alerts(snap, nowMs),
    };
  }

  /** Create a hold. until: 'next' | number of hours | null (until cancelled) */
  setHold({ heat, cool, until }) {
    const s = this.store.data;
    const c = clampPair(heat, cool, this.settings.limits);
    let at = null;
    if (until === 'next') { const n = nextBoundary(s.schedule, new Date(this.now()), this.settings.tz); at = n ? n.at.toISOString() : null; }
    else if (typeof until === 'number' && until > 0) at = new Date(this.now() + Math.min(until, 24 * 14) * 3600000).toISOString();
    if (s.away) { s.away = null; this.log('away', 'Away mode off (a hold was set)'); } // away outranks a hold, so setting a hold means you are home
    s.hold = { heat: c.heat, cool: c.cool, until: at, source: 'app', since: this.now() };
    this.store.touch();
    this.log('hold', `Hold ${c.heat}/${c.cool}${at ? ` until ${at}` : ' until cancelled'}`);
    this._userChanged();
    return s.hold;
  }

  clearHold() {
    const s = this.store.data;
    if (s.hold) this.log('hold', 'Hold cancelled');
    s.hold = null;
    this.store.touch();
    this._userChanged();
  }

  setAway({ on, heat, cool, hours }) {
    const s = this.store.data;
    if (!on) { if (s.away) this.log('away', 'Away mode off'); s.away = null; this._userChanged(); this.store.touch(); return null; }
    const c = clampPair(heat ?? this.settings.limits.heatMin + 4, cool ?? this.settings.limits.coolMax - 2, this.settings.limits);
    s.away = { heat: c.heat, cool: c.cool, until: hours ? new Date(this.now() + hours * 3600000).toISOString() : null, since: this.now() };
    this.log('away', `Away mode on: ${c.heat}/${c.cool}`);
    this._userChanged();
    this.store.touch();
    return s.away;
  }
}

module.exports = { Engine, SAMPLE_MS };
