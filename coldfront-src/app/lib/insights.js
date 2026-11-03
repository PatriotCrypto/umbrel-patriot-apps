'use strict';
const { dateKey } = require('./schedule');

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

function summarize({ history, events, rooms, settings, now = Date.now(), days = 14 }) {
  const tz = settings.tz;
  const since = now - days * 86400000;
  const byDay = new Map();
  const dayOf = (t) => dateKey(new Date(t), tz);
  const slot = (k) => { if (!byDay.has(k)) byDay.set(k, { date: k, heatMin: 0, coolMin: 0, fanMin: 0, cycles: 0, short: 0, ins: [], external: 0 }); return byDay.get(k); };

  // Split a run at local midnights so each day gets its own minutes.
  const splitByDay = (a, b) => {
    const parts = [];
    while (a < b) {
      const k = dayOf(a);
      let lo = a, hi = b;
      if (dayOf(b - 1) === k) { parts.push([k, b - a]); break; }
      while (hi - lo > 1000) { const mid = Math.floor((lo + hi) / 2); if (dayOf(mid) === k) lo = mid; else hi = mid; }
      parts.push([k, hi - a]);
      a = hi;
    }
    return parts;
  };
  for (const r of history.runs) {
    const end = r.end || now;
    if (end < since) continue;
    for (const [k, ms] of splitByDay(Math.max(r.start, since), end)) {
      const d = slot(k);
      const mins = ms / 60000;
      if (r.kind === 'heating') d.heatMin += mins; else if (r.kind === 'cooling') d.coolMin += mins; else d.fanMin += mins;
    }
    if (r.kind !== 'fan') {
      const d = slot(dayOf(r.start));
      d.cycles += 1;
      if ((end - r.start) / 60000 < 5 && r.end) d.short += 1;
    }
  }
  for (const s of history.samples) if (s.t >= since && s.in != null) slot(dayOf(s.t)).ins.push(s.in);
  for (const e of events) if (e.t >= since && e.type === 'external') slot(dayOf(e.t)).external += 1;

  const daily = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => ({
    date: d.date, heatMin: Math.round(d.heatMin), coolMin: Math.round(d.coolMin), fanMin: Math.round(d.fanMin), cycles: d.cycles, shortCycles: d.short,
    avgIn: r1(avg(d.ins)), minIn: d.ins.length ? r1(Math.min(...d.ins)) : null, maxIn: d.ins.length ? r1(Math.max(...d.ins)) : null,
    external: d.external,
    cost: settings.costPerHour > 0 ? Math.round((d.heatMin / 60) * settings.costPerHour * 100) / 100 : null,
  }));

  // rooms over the last 24 h
  const day = history.samples.filter((s) => s.t >= now - 86400000);
  const roomStats = {};
  for (const s of day) for (const [id, v] of Object.entries(s.rooms || {})) {
    const r = (roomStats[id] ||= { t: [], h: [] });
    if (v.t != null) r.t.push(v.t);
    if (v.h != null) r.h.push(v.h);
  }
  const thermoAvg = avg(day.map((s) => s.in).filter((v) => v != null));
  const roomList = Object.entries(roomStats).map(([id, r]) => ({
    id, name: rooms[id]?.name || `Sensor ${id}`, avgTemp: r1(avg(r.t)), minTemp: r.t.length ? r1(Math.min(...r.t)) : null, maxTemp: r.t.length ? r1(Math.max(...r.t)) : null,
    avgHum: r1(avg(r.h)), vsThermostat: thermoAvg != null && r.t.length ? r1(avg(r.t) - thermoAvg) : null,
  }));

  const findings = [];
  for (const r of roomList) {
    if (r.vsThermostat != null && Math.abs(r.vsThermostat) >= 3) findings.push(`${r.name} averages ${Math.abs(r.vsThermostat)}°F ${r.vsThermostat < 0 ? 'colder' : 'warmer'} than the thermostat's own reading over the last day.`);
    if (r.avgHum != null && r.avgHum < settings.humidity.min) findings.push(`${r.name} humidity averages ${Math.round(r.avgHum)}%, below your ${settings.humidity.min}% floor.`);
    if (r.avgHum != null && r.avgHum > settings.humidity.max) findings.push(`${r.name} humidity averages ${Math.round(r.avgHum)}%, above your ${settings.humidity.max}% ceiling. Mold risk rises past about 60%.`);
  }
  const last7 = daily.slice(-7);
  const totalShort = last7.reduce((a, d) => a + d.shortCycles, 0);
  const totalCycles = last7.reduce((a, d) => a + d.cycles, 0);
  if (totalCycles >= 10 && totalShort / totalCycles > 0.25) findings.push(`${totalShort} of ${totalCycles} heating/cooling cycles this week ran under 5 minutes. Short cycling wears equipment; check the filter and the differential.`);
  const ext = last7.reduce((a, d) => a + d.external, 0);
  if (ext >= 3) findings.push(`The thermostat was changed outside Cold Front ${ext} times this week. Check the wall unit and any other controllers.`);
  if (last7.length >= 3) {
    const heat = last7.map((d) => d.heatMin);
    const mean = avg(heat);
    const today = heat[heat.length - 1];
    if (mean > 60 && today > mean * 1.6) findings.push(`Heating ran ${Math.round(today)} min today against a recent average of ${Math.round(mean)} min.`);
  }

  const total = daily.reduce((a, d) => ({ heatMin: a.heatMin + d.heatMin, coolMin: a.coolMin + d.coolMin }), { heatMin: 0, coolMin: 0 });
  return { daily, rooms: roomList, findings, totals: { ...total, cost: settings.costPerHour > 0 ? Math.round((total.heatMin / 60) * settings.costPerHour * 100) / 100 : null } };
}

module.exports = { summarize };
