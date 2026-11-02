'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const dates = require('../lib/dates');
const calc = require('../lib/calc');
const crops = require('../lib/crops');
const S = require('../lib/schema');
const { mergeSettings, defaultSettings } = require('../lib/settings');

test('dates', () => {
  assert.equal(dates.addDays('2026-01-30', 3), '2026-02-02');
  assert.equal(dates.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(dates.daysBetween('2026-01-01', '2026-01-31'), 30);
  assert.ok(dates.isDate('2026-02-28')); assert.ok(!dates.isDate('2026-02-30'));
});

test('bleach dose', () => {
  const r = calc.bleachDose(10, 6, false);
  assert.ok(r && JSON.stringify(r).length > 2);
});

test('settings merge is a whitelist and clamps', () => {
  const s = mergeSettings(defaultSettings(), { targetDays: 45, evil: 'x', ntfy: { hour: 99, bogus: 1 }, home: { lat: 500, lon: 10 } });
  assert.equal(s.targetDays, 45); assert.equal(s.evil, undefined); assert.equal(s.ntfy.bogus, undefined);
  assert.equal(s.ntfy.hour, 23); assert.equal(s.home.lat, null);
});

test('crop plan', () => {
  const p = crops.plan('Tomato', '2026-04-25', '2026-10-15');
  assert.ok(p && p.outdoor && p.harvest);
});

test('schema cleans and rejects', () => {
  const it = S.cleanColl(S.COLL, 'items', { name: ' Rice ', cat: 'food', unit: 'lb', lots: [{ qty: '5' }] });
  assert.equal(it.name, 'Rice'); assert.equal(it.lots[0].qty, 5);
  assert.throws(() => S.cleanColl(S.COLL, 'items', { cat: 'food' }), S.ValidationError);
});
