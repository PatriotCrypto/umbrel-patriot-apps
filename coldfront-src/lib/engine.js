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
    const d = resolve({ schedule: this._plan(), hold: s.hold, away: s.away, now, tz: this.settings.tz, limits: this.settings.limits });
    if (!d) return null;
    return this._roomAdjust(d, snap, now.getTime());
  }

  get ranged() { return this.settings.plan !== 'schedule'; }

  /** The base plan: the weekly schedule, or in range mode one flat Home period every day. */
  _plan() {
    if (!this.ranged) return this.store.data.schedule;
    const c = this.settings.comfort, trim = Math.max(-3, Math.min(3, Number(c.trim) || 0));
    const h = { heat: c.home.heat + trim, cool: c.home.cool + trim }; // trim = room balance: aim the thermostat a little off so the rooms land in the range
    const days = {};
    for (const d of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) days[d] = [{ id: `${d}0`, name: 'Home', time: '00:00', heat: h.heat, cool: h.cool }];
    return { days };
  }

  /** Average of the thermostat and every included room that reported lately. */
  houseAverage(snap, nowMs) {
    const vals = [];
    if (snap?.thermostat?.temp != null) vals.push(snap.thermostat.temp);
    for (const r of snap?.sensors || []) {
      if (this.store.data.rooms[r.nodeId]?.include === false) continue;
      if (r.temp != null && nowMs - r.lastSeen <= 6 * 3600000) vals.push(r.temp);
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  _roomAdjust(d, snap, nowMs) {
    const ra = this.settings.roomAware;
    if (!ra.enabled || !ra.roomId || d.source === 'away') return { ...d, adjust: 0 };
    let temp;
    if (ra.roomId === 'avg') temp = this.houseAverage(snap, nowMs);
    else {
      const room = snap?.sensors?.find((r) => String(r.nodeId) === String(ra.roomId));
      if (!room || room.temp == null || nowMs - room.lastSeen > 30 * 60000) return { ...d, adjust: 0 };
      temp = room.temp;
    }
    if (temp == null) return { ...d, adjust: 0 };
    const room = { temp };
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
    await this._manageMode(t, d, nowMs);
    this._range(t, d, nowMs);
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
          const next = this.ranged ? null : nextBoundary(this.store.data.schedule, new Date(nowMs), this.settings.tz);
          const until = next ? next.at : new Date(nowMs + 4 * 3600000); // no schedule to wait for: 4 hours
          this.store.data.hold = { heat: obs.heat, cool: obs.cool, until: until.toISOString(), source: 'wall', since: nowMs };
          this.store.touch();
          this.log('hold', `Holding ${obs.heat}/${obs.cool} ${next ? 'until the next period' : 'for 4 hours'}`);
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

  /**
   * Keep the thermostat in a mode that can serve the range. Auto is first choice. If the thermostat will not take Auto, or sits
   * in Auto without running while the house is past a limit, switch it to Cool or Heat ourselves ("changeover assist").
   */
  async _manageMode(t, d, nowMs) {
    const s = this.settings;
    if (!s.keepAuto || !s.enforce || !this.adapter.setMode) return;
    if (!['auto', 'heat', 'cool'].includes(t.mode) || t.temp == null) return; // Off and emergency heat are a person's choice
    if (this.userMode) return; // you chose Heat or Cool in the app: single-temperature mode, left alone until you pick Auto
    const canAuto = !t.modes || t.modes.includes('auto');
    const need = t.temp >= d.cool + 1 ? 'cool' : t.temp <= d.heat - 1 ? 'heat' : null;
    if (need !== (this.need ? this.need.kind : null)) this.need = need ? { kind: need, since: nowMs } : null;
    const serving = !need || (need === 'cool' ? (t.opState === 'cooling' || t.opDetail === 'pending-cool') : (t.opState === 'heating' || t.opDetail === 'pending-heat'));
    const gap = nowMs - (this.modeTriedAt || 0) >= 10 * 60000;
    if (need && !serving) this.adapter.pollNow?.(); // make sure we are not acting on a stale report

    if (need && !serving && t.mode !== need && nowMs - this.need.since >= (t.mode === 'auto' ? (this.autoBroken ? 3 : 10) : 2) * 60000 && gap) {
      this.modeTriedAt = nowMs;
      if (t.mode === 'auto') this.autoBroken = true; // Auto had its chance and did nothing
      try {
        await this.adapter.setMode(need);
        this.assist = { kind: need, since: nowMs };
        this.log('mode', `House is ${t.temp}°, ${need === 'cool' ? `above the ${d.cool}° high` : `below the ${d.heat}° low`}, and the thermostat was not ${need}ing in ${t.mode === 'auto' ? 'Auto' : t.mode === 'heat' ? 'Heat' : 'Cool'} mode. Switched it to ${need === 'cool' ? 'Cool' : 'Heat'}.`);
      } catch (e) { this.log('error', `Could not switch the thermostat to ${need}: ${e.message}`); }
      return;
    }
    if (this.assist) {
      if (t.mode !== this.assist.kind) this.assist = null; // changed elsewhere
      else {
        const done = this.assist.kind === 'cool' ? t.temp <= d.cool - 0.5 : t.temp >= d.heat + 0.5;
        if (!done || nowMs - this.assist.since < 10 * 60000) return;
        this.assist = null;
      }
    }
    if (t.mode === 'auto') { this.modeTries = 0; return; }
    if (!canAuto) this.autoBroken = true;
    if ((this.modeTries || 0) >= 3) this.autoBroken = true;
    if (!gap) return;
    // Auto let us down before. Heat is a safe place to rest (the house cannot freeze if the Umbrel goes offline); Cool is not, so
    // even then go back to Auto after a cooling assist, as long as the thermostat accepts it.
    if (this.autoBroken && !(t.mode === 'cool' && canAuto && (this.modeTries || 0) < 3)) return;
    if (!this.autoBroken) this.modeTries = (this.modeTries || 0) + 1;
    this.modeTriedAt = nowMs;
    try {
      await this.adapter.setMode('auto');
      this.log('mode', `Thermostat was in ${t.mode}; switched to Auto so it can hold ${this.ranged ? 'the low/high range' : 'both setpoints'}`);
    } catch (e) { this.log('error', `Could not switch the thermostat to Auto: ${e.message}`); }
  }

  /** The person picked a mode in the app: respect it for a while. */
  noteModeChoice(mode) { this.settings.modePref = mode; this.store.touch(); this.resetModeCare(); }
  /** Heat or Cool picked on purpose in the app (not Auto, and not something Cold Front switched to itself). */
  get userMode() { const m = this.settings.modePref; return m === 'heat' || m === 'cool' || m === 'off' ? m : null; }
  resetModeCare() { this.modeTries = 0; this.modeTriedAt = 0; this.autoBroken = false; this.assist = null; this.need = null; }

  /** One plain sentence on what the thermostat is doing about the range right now, or null when all is as expected. */
  explain(t, d, nowMs) {
    if (!t || !d || t.temp == null) return null;
    const M = { heat: 'Heat', cool: 'Cool', auto: 'Auto', off: 'Off', aux: 'Emergency heat' };
    if (t.mode === 'off') return { level: 'warn', text: 'The thermostat is Off, so nothing will run.' };
    const care = this.settings.keepAuto && this.settings.enforce && !this.userMode;
    const side = t.temp >= d.cool + 1 ? 'cool' : t.temp <= d.heat - 1 ? 'heat' : null;
    if (!side) {
      if (this.assist) return { level: 'info', text: `Cold Front put the thermostat in ${M[this.assist.kind]} because Auto was not ${this.assist.kind}ing. It goes back once the house is in range.` };
      if (!care && !this.userMode && (t.mode === 'heat' || t.mode === 'cool') && this.settings.enforce) return { level: 'info', text: `The thermostat is in ${M[t.mode]} mode, so it will only ${t.mode}.`, fix: 'auto' };
      return null;
    }
    if (this.userMode && this.userMode === t.mode && t.mode !== side) return null; // single-temperature mode: the other side is off on purpose
    const cool = side === 'cool';
    const limit = cool ? `${d.cool}° high` : `${d.heat}° low`;
    const where = `${t.temp}° is ${cool ? 'above' : 'below'} your ${limit}`;
    if (t.opState === (cool ? 'cooling' : 'heating')) return { level: 'ok', text: `${cool ? 'Cooling' : 'Heating'} now: ${where}.` };
    if (t.opDetail === (cool ? 'pending-cool' : 'pending-heat')) return { level: 'info', text: `${where}. The thermostat is waiting a few minutes to protect the ${cool ? 'AC compressor' : 'equipment'}, then it starts.` };
    const dev = cool ? t.cool : t.heat, want = cool ? d.cool : d.heat;
    if (dev != null && Math.abs(dev - want) >= 0.5) return { level: 'warn', text: `${where}, but the thermostat still has ${dev}° as its ${cool ? 'high' : 'low'}. ${this.settings.enforce ? 'Sending the new setting again.' : 'Cold Front is set to observe only.'}` };
    if (t.mode !== 'auto' && t.mode !== side) return { level: 'warn', text: `${where}, but the thermostat is in ${M[t.mode] || t.mode} mode and cannot ${side}. ${care ? `Cold Front is switching it to ${M[side]}.` : `Switch it to Auto or ${M[side]}.`}`, fix: care ? null : 'auto' };
    if (t.mode === 'auto') return { level: 'warn', text: `${where}. The thermostat is in Auto but not ${side}ing yet. ${care ? `If it has not started in 10 minutes, Cold Front switches it to ${M[side]}.` : ''}`.trim() };
    return { level: 'warn', text: `${where}. The thermostat is in ${M[t.mode]} mode at ${dev}° but reports idle. Look at its screen for "Wait", then check the ${cool ? 'AC breaker and outdoor unit' : 'furnace'}.` };
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

  /** Track how long the house has been well outside the range (for the alert). */
  _range(t, d, nowMs) {
    const side = t.temp == null ? null : t.temp >= d.cool + 2 ? 'high' : t.temp <= d.heat - 2 ? 'low' : null;
    if (!side) this.outSince = null;
    else if (!this.outSince || this.outSince.side !== side) this.outSince = { side, at: nowMs, limit: side === 'high' ? d.cool : d.heat };
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
      if (this.outSince && nowMs - this.outSince.at >= 30 * 60000 && snap.kind !== 'sim') out.push({ level: 'warn', key: 'range', text: `The house has been ${this.outSince.side === 'high' ? 'above' : 'below'} your ${this.outSince.limit}° ${this.outSince.side} for ${Math.round((nowMs - this.outSince.at) / 60000)} minutes (now ${t.temp}°).` });
      if (st === 'write-failed') out.push({ level: 'warn', key: 'write', text: `Could not change the thermostat: ${this.lastError}` });
    }
    const h = this.settings.humidity;
    for (const r of snap?.sensors || []) {
      const name = this.store.data.rooms[r.nodeId]?.name || r.name || `Sensor ${r.nodeId}`;
      if (r.humidity != null && r.humidity > h.max) out.push({ level: 'warn', key: `hum${r.nodeId}`, text: `${name} humidity is ${r.humidity}%.` });
      if (r.humidity != null && r.humidity < h.min) out.push({ level: 'info', key: `dry${r.nodeId}`, text: `${name} humidity is ${r.humidity}%, which is dry.` });
      if (r.battery != null && r.battery <= 20) out.push({ level: 'warn', key: `bat${r.nodeId}`, text: `${name} battery is at ${r.battery}%.` });
      // battery sensors sleep and only report a change in temperature, so a quiet room can go many hours legitimately
      if (snap.kind !== 'sim' && nowMs - r.lastSeen > 14 * 3600000) out.push({ level: 'info', key: `off${r.nodeId}`, text: `${name} has not checked in for ${Math.round((nowMs - r.lastSeen) / 3600000)} hours${r.battery != null ? ` (battery ${r.battery}%)` : ''}. It may be asleep, out of range, or need a battery.` });
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
    const d = snap && snap.connected && snap.thermostat ? this.desired(snap) : this.last.desired; // fresh, so a change shows at once
    const next = this.ranged ? null : nextBoundary(s.schedule, new Date(nowMs), this.settings.tz);
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
      why: this.explain(snap?.thermostat, d, nowMs),
      assist: this.assist ? this.assist.kind : null,
      single: this.userMode && snap?.thermostat && snap.thermostat.mode === this.userMode && this.userMode !== 'off' ? this.userMode : null,
      alerts: this.alerts(snap, nowMs),
    };
  }

  /** Create a hold. until: 'next' | number of hours | null (until cancelled) */
  setHold({ heat, cool, until }) {
    const s = this.store.data;
    const c = clampPair(heat, cool, this.settings.limits);
    let at = null;
    if (until === 'next' && this.ranged) until = 4;
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
    const aw = this.settings.comfort.away;
    const c = clampPair(heat ?? aw.heat, cool ?? aw.cool, this.settings.limits);
    s.away = { heat: c.heat, cool: c.cool, until: hours ? new Date(this.now() + hours * 3600000).toISOString() : null, since: this.now() };
    this.log('away', `Away mode on: ${c.heat}/${c.cool}`);
    this._userChanged();
    this.store.touch();
    return s.away;
  }
}

module.exports = { Engine, SAMPLE_MS };
