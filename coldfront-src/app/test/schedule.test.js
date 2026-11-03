'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/schedule');

const TZ = 'America/New_York';
const sch = S.defaultSchedule();
const limits = { heatMin: 55, heatMax: 78, coolMin: 70, coolMax: 85, minGap: 3 };
// 2026-11-03 is a Tuesday. EST = UTC-5 on that date.
const at = (iso) => new Date(iso);

test('active period picks the latest start at or before now', () => {
  const a = S.activePeriod(sch, at('2026-11-03T12:00:00Z'), TZ); // 07:00 Tue
  assert.equal(a.period.name, 'Wake');
  assert.equal(a.day, 'tue');
  const b = S.activePeriod(sch, at('2026-11-03T23:00:00Z'), TZ); // 18:00 Tue
  assert.equal(b.period.name, 'Home');
});

test('before the first period of a day, yesterday\'s last period still applies', () => {
  const a = S.activePeriod(sch, at('2026-11-03T08:00:00Z'), TZ); // 03:00 Tue
  assert.equal(a.period.name, 'Sleep');
  assert.equal(a.day, 'mon');
  const sun = S.activePeriod(sch, at('2026-11-02T10:00:00Z'), TZ); // 05:00 Mon, Sunday ended 22:30
  assert.equal(sun.day, 'sun');
  assert.equal(sun.period.time, '22:30');
});

test('next boundary rolls forward across days', () => {
  const n = S.nextBoundary(sch, at('2026-11-03T12:00:00Z'), TZ); // 07:00 Tue -> Away 08:30
  assert.equal(n.period.name, 'Away');
  assert.equal(n.at.toISOString(), '2026-11-03T13:30:00.000Z');
  const m = S.nextBoundary(sch, at('2026-11-03T04:00:00Z'), TZ); // 23:00 Mon -> Tue 06:00 Wake
  assert.equal(m.period.name, 'Wake');
  assert.equal(m.at.toISOString(), '2026-11-03T11:00:00.000Z');
});

test('clampPair enforces limits and the minimum gap', () => {
  assert.deepEqual(S.clampPair(90, 60, limits), { heat: 78, cool: 81 });
  assert.deepEqual(S.clampPair(70, 71, limits), { heat: 70, cool: 73 });
  assert.deepEqual(S.clampPair(50, 90, limits), { heat: 55, cool: 85 });
});

test('away beats hold beats schedule, and expired ones are ignored', () => {
  const now = at('2026-11-03T12:00:00Z');
  const hold = { heat: 72, cool: 78, until: '2026-11-03T14:00:00Z' };
  const away = { heat: 60, cool: 84, until: null };
  assert.equal(S.resolve({ schedule: sch, hold, away, now, tz: TZ, limits }).source, 'away');
  assert.equal(S.resolve({ schedule: sch, hold, away: null, now, tz: TZ, limits }).source, 'hold');
  const expired = { ...hold, until: '2026-11-03T11:00:00Z' };
  const r = S.resolve({ schedule: sch, hold: expired, away: null, now, tz: TZ, limits });
  assert.equal(r.source, 'schedule');
  assert.equal(r.heat, 70);
});

test('resolve clamps schedule values to the safety limits', () => {
  const tight = { ...limits, heatMax: 68 };
  const r = S.resolve({ schedule: sch, hold: null, away: null, now: at('2026-11-03T12:00:00Z'), tz: TZ, limits: tight });
  assert.equal(r.heat, 68);
});

test('validateSchedule normalises and rejects bad input', () => {
  const ok = S.validateSchedule(JSON.parse(JSON.stringify(sch)));
  assert.equal(ok.days.mon.length, 4);
  const dup = JSON.parse(JSON.stringify(sch)); dup.days.mon[1].time = dup.days.mon[0].time;
  assert.throws(() => S.validateSchedule(dup), /two periods/);
  const badTime = JSON.parse(JSON.stringify(sch)); badTime.days.tue[0].time = '25:00';
  assert.throws(() => S.validateSchedule(badTime), /bad time/);
  const empty = JSON.parse(JSON.stringify(sch)); empty.days.wed = [];
  assert.throws(() => S.validateSchedule(empty), /at least one/);
  const hot = JSON.parse(JSON.stringify(sch)); hot.days.thu[0].heat = 120;
  assert.throws(() => S.validateSchedule(hot), /out of range/);
});

test('wall schedule warns when a day has more than four periods', () => {
  const s = JSON.parse(JSON.stringify(sch));
  s.days.mon = ['05:00', '06:00', '07:00', '08:00', '09:00'].map((time, i) => ({ id: `m${i}`, name: 'X', time, heat: 68, cool: 76 }));
  const w = S.wallSchedule(s);
  assert.equal(w.warnings.length, 1);
  assert.equal(w.lines.find((l) => l.day === 'mon').periods.length, 4);
});
