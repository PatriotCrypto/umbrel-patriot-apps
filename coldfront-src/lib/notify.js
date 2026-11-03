'use strict';
const { filterStatus } = require('./filter');

/** Every notification trigger. All default to off; the person turns each one on by hand. */
const TRIGGERS = {
  filterDue: 'Filter is coming due',
  filterOverdue: 'Filter is overdue (repeats weekly)',
  linkLost: 'Lost the connection to the Z-Wave server',
  linkRestored: 'Z-Wave connection is back',
  thermostatLost: 'Thermostat stopped reporting (15 min)',
  thermostatRestored: 'Thermostat is reporting again',
  sensorOffline: 'A room sensor went quiet (3 h)',
  batteryLow: 'A sensor battery is at 20% or less',
  freeze: 'House is below 45°F',
  hot: 'House is above 90°F',
  noHeat: 'House is cold and the furnace is not running',
  humidity: 'Humidity outside your range in a room',
  wallChange: 'Thermostat was changed at the wall or by another app',
  writeFail: 'Cold Front could not change the thermostat',
};
const DEFAULT_TRIGGERS = () => Object.fromEntries(Object.keys(TRIGGERS).map((k) => [k, false]));

// alert key (from the engine) -> trigger
function triggerForAlert(key) {
  if (key === 'link') return 'linkLost';
  if (key === 'stale') return 'thermostatLost';
  if (key === 'freeze') return 'freeze';
  if (key === 'hot') return 'hot';
  if (key === 'noheat') return 'noHeat';
  if (key === 'write') return 'writeFail';
  if (key.startsWith('hum') || key.startsWith('dry')) return 'humidity';
  if (key.startsWith('bat')) return 'batteryLow';
  if (key.startsWith('off')) return 'sensorOffline';
  return null;
}
const PRIORITY = { freeze: 5, hot: 4, noHeat: 4, linkLost: 4, thermostatLost: 4, writeFail: 3, filterOverdue: 3 };
const TAGS = { freeze: 'cold_face', hot: 'hot_face', noHeat: 'warning', linkLost: 'electric_plug', linkRestored: 'white_check_mark', thermostatLost: 'electric_plug', thermostatRestored: 'white_check_mark', filterDue: 'wrench', filterOverdue: 'wrench', batteryLow: 'battery', sensorOffline: 'electric_plug', humidity: 'droplet', wallChange: 'thermometer', writeFail: 'warning' };
const COOLDOWN_MS = 30 * 60000; // the same alert will not send twice inside this window, which stops flapping
const SIGNAL_DEBOUNCE_MS = 2 * 60000; // a link must stay down this long before we call it lost

function validNtfy(n) {
  if (n.server !== undefined) {
    let u; try { u = new URL(n.server); } catch { throw new Error('ntfy server must be a full URL such as https://ntfy.sh'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('ntfy server must start with http:// or https://');
  }
  if (n.topic !== undefined && n.topic !== '' && !/^[A-Za-z0-9_-]{1,64}$/.test(n.topic)) throw new Error('ntfy topic can only use letters, numbers, - and _ (max 64)');
}

class Notifier {
  constructor(store, { now = () => Date.now(), fetchFn = (...a) => fetch(...a), onLog = () => {} } = {}) {
    this.store = store; this.now = now; this.fetch = fetchFn; this.onLog = onLog;
    this.active = new Set(); this.lastSent = {}; this.downSince = {}; this.wasDown = new Set();
    this.lastEventT = now(); this.primed = false;
  }

  get cfg() { return this.store.data.settings.ntfy; }
  enabled(trigger) { const c = this.cfg; return !!(c.enabled && c.topic && c.triggers[trigger]); }

  async send({ title, message, priority = 3, tags = '' }) {
    const c = this.cfg;
    if (!c.topic) throw new Error('Set a topic first');
    const url = `${c.server.replace(/\/+$/, '')}/${encodeURIComponent(c.topic)}`;
    const headers = { Title: title, Priority: String(priority), 'Content-Type': 'text/plain; charset=utf-8' };
    if (tags) headers.Tags = tags;
    if (c.token) headers.Authorization = `Bearer ${c.token}`;
    const res = await this.fetch(url, { method: 'POST', headers, body: message, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`ntfy answered ${res.status}`);
  }

  async _fire(trigger, key, title, message, { force = false } = {}) {
    if (!this.enabled(trigger)) return;
    const t = this.now();
    if (!force && this.lastSent[key] && t - this.lastSent[key] < COOLDOWN_MS) return;
    this.lastSent[key] = t;
    try {
      await this.send({ title, message, priority: PRIORITY[trigger] || 3, tags: TAGS[trigger] || '' });
      this.onLog('notify', `Sent notification: ${title}`);
    } catch (e) {
      this.onLog('notify', `Notification failed: ${e.message}`);
    }
  }

  /** Call once per tick with engine.state(). Sends on the moment something starts, and on recovery for the signal triggers. */
  async evaluate(state) {
    const nowMs = this.now();
    const live = state.mode === 'live';
    const alerts = state.alerts.filter((a) => a.key !== 'nothermo' && a.key !== 'filter');
    const keys = new Set(alerts.map((a) => a.key));

    if (live) {
      // link down is debounced so a restart or a short blip does not page anyone
      if (keys.has('link')) {
        this.downSince.link ||= nowMs;
        if (nowMs - this.downSince.link >= SIGNAL_DEBOUNCE_MS && !this.wasDown.has('link')) {
          this.wasDown.add('link');
          await this._fire('linkLost', 'link', 'Z-Wave connection lost', 'Cold Front cannot reach the Z-Wave server. The thermostat keeps running its own schedule.', { force: true });
        }
      } else {
        this.downSince.link = 0;
        if (this.wasDown.delete('link')) await this._fire('linkRestored', 'linkRestored', 'Z-Wave connection restored', 'Cold Front is talking to the Z-Wave server again.', { force: true });
      }
      if (keys.has('stale')) {
        if (!this.wasDown.has('stale')) { this.wasDown.add('stale'); await this._fire('thermostatLost', 'stale', 'Thermostat stopped reporting', 'No report from the thermostat for over 15 minutes. Check the batteries and the Z-Wave signal.', { force: true }); }
      } else if (this.wasDown.delete('stale')) {
        await this._fire('thermostatRestored', 'staleBack', 'Thermostat reporting again', 'The thermostat is back on the Z-Wave network.', { force: true });
      }
      for (const a of alerts) {
        if (a.key === 'link' || a.key === 'stale') continue;
        const trig = triggerForAlert(a.key);
        if (!trig || this.active.has(a.key)) continue;
        await this._fire(trig, a.key, ({ freeze: 'Freeze warning', hot: 'House is hot', noHeat: 'No heat', humidity: 'Humidity alert', batteryLow: 'Sensor battery low', sensorOffline: 'Sensor offline', writeFail: 'Could not change thermostat' })[trig] || 'Cold Front alert', a.text);
      }
    }
    this.active = new Set(alerts.filter((a) => a.key !== 'link' && a.key !== 'stale').map((a) => a.key));

    // changes made at the wall or by another controller
    const fresh = this.store.data.events.filter((e) => e.t > this.lastEventT && e.type === 'external');
    if (this.store.data.events.length) this.lastEventT = Math.max(this.lastEventT, ...this.store.data.events.map((e) => e.t));
    if (live) for (const e of fresh) await this._fire('wallChange', 'wall', 'Thermostat changed outside Cold Front', e.msg);

    await this._filter(nowMs);
  }

  // The filter reminder is calendar based, so it works in demo mode too.
  async _filter(nowMs) {
    const s = this.store.data;
    const st = filterStatus(s.settings.filter, nowMs, s.settings.tz);
    if (!st.configured) return;
    const mark = (s.notifyState.filter ||= {});
    if (mark.cycle !== st.lastChanged) { for (const k of Object.keys(mark)) delete mark[k]; mark.cycle = st.lastChanged; this.store.touch(); }
    if (st.state === 'soon' && !mark.soon) {
      mark.soon = true; this.store.touch();
      await this._fire('filterDue', 'filterDue', `${st.name} due ${st.daysLeft === 0 ? 'today' : `in ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'}`}`, `Planned change date: ${st.dueDate}. Mark it done in Cold Front when you swap it.`, { force: true });
    }
    if (st.state === 'overdue') {
      if (!mark.overdueAt || nowMs - mark.overdueAt >= 7 * 86400000) {
        mark.overdueAt = nowMs; this.store.touch();
        await this._fire('filterOverdue', 'filterOverdue', `${st.name} is overdue`, `It was due ${st.dueDate} (${-st.daysLeft} day${st.daysLeft === -1 ? '' : 's'} ago).`, { force: true });
      }
    }
  }
}

module.exports = { Notifier, TRIGGERS, DEFAULT_TRIGGERS, validNtfy, triggerForAlert };
