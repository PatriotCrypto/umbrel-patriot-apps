'use strict';
const { dateKey } = require('./schedule');

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

function summarize({ history, events, rooms, names = {}, skip = [], settings, snap = null, now = Date.now(), days = 14 }) {
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
    if (skip.includes(String(id)) || skip.includes(+id)) continue;
    const r = (roomStats[id] ||= { t: [], h: [] });
    if (v.t != null) r.t.push(v.t);
    if (v.h != null) r.h.push(v.h);
  }
  const thermoAvg = avg(day.map((s) => s.in).filter((v) => v != null));
  const roomList = Object.entries(roomStats).map(([id, r]) => ({
    id, name: rooms[id]?.name || names[id] || `Sensor ${id}`, avgTemp: r1(avg(r.t)), minTemp: r.t.length ? r1(Math.min(...r.t)) : null, maxTemp: r.t.length ? r1(Math.max(...r.t)) : null,
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

  const house = houseView({ day, rooms, names, skip, settings, snap, now, history });

  const total = daily.reduce((a, d) => ({ heatMin: a.heatMin + d.heatMin, coolMin: a.coolMin + d.coolMin }), { heatMin: 0, coolMin: 0 });
  return { daily, rooms: roomList, findings, house, totals: { ...total, cost: settings.costPerHour > 0 ? Math.round((total.heatMin / 60) * settings.costPerHour * 100) / 100 : null } };
}

/** The "command center" numbers: every room against the whole-house average, and what setting would balance them. */
function houseView({ day, rooms, names, skip, settings, snap, now, history }) {
  const skipped = (id) => skip.includes(String(id)) || skip.includes(Number(id));
  const included = (id) => rooms[id]?.include !== false;
  const nameOf = (id, fallback) => rooms[id]?.name || fallback || names[id] || `Sensor ${id}`;
  const t = snap?.thermostat || null;

  // right now
  const list = [];
  for (const r of snap?.sensors || []) {
    if (skipped(r.nodeId)) continue;
    list.push({ id: String(r.nodeId), name: nameOf(r.nodeId, r.name), temp: r.temp ?? null, humidity: r.humidity ?? null, battery: r.battery ?? null, lastSeen: r.lastSeen || null, include: included(r.nodeId), ageMin: r.lastSeen ? Math.round((now - r.lastSeen) / 60000) : null });
  }
  const fresh = (r) => r.temp != null && r.include && r.ageMin != null && r.ageMin <= 360;
  const pts = [];
  if (t && t.temp != null) pts.push(t.temp);
  for (const r of list) if (fresh(r)) pts.push(r.temp);
  const avgNow = avg(pts);
  const rowsNow = list.map((r) => ({ ...r, delta: avgNow != null && r.temp != null ? r1(r.temp - avgNow) : null, counted: fresh(r) }));
  const spread = pts.length > 1 ? r1(Math.max(...pts) - Math.min(...pts)) : null;
  const warm = rowsNow.filter((r) => r.counted && r.temp != null).sort((a, b) => b.temp - a.temp);

  // last 24 h, sample by sample
  const houseSeries = [];
  const thermoSeries = [];
  for (const smp of day) {
    if (smp.in == null) continue;
    const v = [smp.in];
    for (const [id, r] of Object.entries(smp.rooms || {})) if (!skipped(id) && included(id) && r.t != null) v.push(r.t);
    houseSeries.push(avg(v));
    thermoSeries.push(smp.in);
  }
  const avg24 = r1(avg(houseSeries));
  const thermo24 = r1(avg(thermoSeries));
  const home = settings.comfort?.home || { heat: 68, cool: 72 };
  const lo = settings.plan === 'schedule' ? null : home.heat, hi = settings.plan === 'schedule' ? null : home.cool;
  const inBand = (v) => lo == null || (v >= lo - 0.5 && v <= hi + 0.5);
  const comfortPct = thermoSeries.length ? Math.round((thermoSeries.filter(inBand).length / thermoSeries.length) * 100) : null;
  const houseComfortPct = houseSeries.length ? Math.round((houseSeries.filter(inBand).length / houseSeries.length) * 100) : null;

  // equipment, last 24 h
  const dayStart = now - 86400000;
  let heatMin = 0, coolMin = 0, runs = 0, runMin = 0;
  for (const r of history.runs) {
    const end = r.end || now;
    if (end < dayStart || r.kind === 'fan') continue;
    const m = (end - Math.max(r.start, dayStart)) / 60000;
    if (r.kind === 'heating') heatMin += m; else coolMin += m;
    runs += 1; runMin += m;
  }
  const first = history.samples.length ? history.samples[0].t : null;

  // Balance advisor. The thermostat only knows its own spot on the wall. If the rest of the house runs cooler or warmer than that
  // spot, aim the thermostat off by the difference ("trim") so the average room lands in the range. The trim is a fixed number
  // worked out from the difference itself, so applying it twice changes nothing.
  let advice = null;
  const trimNow = Math.max(-3, Math.min(3, Number(settings.comfort?.trim) || 0));
  const roomCount = rowsNow.filter((r) => r.counted).length;
  const enough = houseSeries.length >= 72; // six hours of samples
  if (roomCount > 0 && avg24 != null && thermo24 != null) {
    const diff = r1(avg24 - thermo24); // + = the house runs warmer than the thermostat reads
    const trim = enough ? Math.max(-3, Math.min(3, -Math.round(diff))) : trimNow;
    const mid = (home.heat + home.cool) / 2;
    const feel = { heat: r1(home.heat + trimNow + diff), cool: r1(home.cool + trimNow + diff) }; // what the average room gets today
    let text;
    if (!enough) text = `Still learning: the rooms need about six hours of readings before a suggestion is worth trusting. So far the house averages ${avg24}° against ${thermo24}° at the thermostat.`;
    else if (Math.abs(diff) < 0.5) text = `The house average (${avg24}°) matches the thermostat (${thermo24}°). No adjustment needed: your ${home.heat}-${home.cool}° range is what the rooms actually get.`;
    else {
      text = `Over the last day the rooms averaged ${Math.abs(diff)}° ${diff > 0 ? 'warmer' : 'cooler'} than the thermostat reads (${avg24}° against ${thermo24}°).`;
      if (trim === trimNow) text += ` The balance adjustment of ${trim > 0 ? '+' : ''}${trim}° already covers that.`;
      else text += ` Right now your ${home.heat}-${home.cool}° range feels like about ${feel.heat}-${feel.cool}° in the average room. A balance adjustment of ${trim > 0 ? '+' : ''}${trim}° fixes that: you keep ${home.heat}-${home.cool}° as your range and the thermostat aims ${Math.abs(trim)}° ${trim > 0 ? 'higher' : 'lower'} to deliver it.`;
    }
    if (roomCount < 3 && enough) text += ` Based on ${roomCount} room sensor${roomCount === 1 ? '' : 's'}; it gets more accurate as you add more.`;
    advice = { diff, houseAvg: avg24, thermoAvg: thermo24, mid, trim, trimNow, needed: enough && trim !== trimNow, learning: !enough, rooms: roomCount, feel, text };
  }

  return {
    now: { thermostat: t?.temp ?? null, humidity: t?.humidity ?? null, average: r1(avgNow), spread, counted: pts.length, warmest: warm[0] ? { name: warm[0].name, temp: warm[0].temp } : null, coolest: warm.length > 1 ? { name: warm[warm.length - 1].name, temp: warm[warm.length - 1].temp } : null },
    rooms: rowsNow,
    day: { avgHouse: avg24, avgThermostat: thermo24, min: thermoSeries.length ? r1(Math.min(...thermoSeries)) : null, max: thermoSeries.length ? r1(Math.max(...thermoSeries)) : null, comfortPct, houseComfortPct, band: lo == null ? null : { lo, hi } },
    equipment: { heatMin: Math.round(heatMin), coolMin: Math.round(coolMin), cycles: runs, avgRunMin: runs ? r1(runMin / runs) : null, duty: r1((runMin / 1440) * 100) },
    data: { samples: history.samples.length, since: first, hours: first ? Math.round((now - first) / 3600000) : 0, rooms: list.length },
    advice,
  };
}

module.exports = { summarize };
