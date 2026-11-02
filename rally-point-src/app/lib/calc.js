'use strict';
// All the math: daily needs, days of supply, expiry, alerts, readiness score,
// gap analysis, water and power planning. Pure functions over a state object.

const { addDays, addMonths, daysBetween } = require('./dates');
const { findCrop } = require('./crops');

const r1 = (n) => Math.round(n * 10) / 10;
const r0 = (n) => Math.round(n);
const sum = (a, fn) => a.reduce((t, x) => t + (+fn(x) || 0), 0);

// ------------------------------------------------------------------ people
function headcount(members, settings, over) {
  const by = { adult: 0, teen: 0, child: 0, infant: 0, senior: 0 };
  let pets = 0;
  for (const m of members || []) {
    if (m.ptype === 'pet') pets++;
    else by[Object.prototype.hasOwnProperty.call(by, m.ptype) ? m.ptype : 'adult']++;
  }
  by.adult += Math.max(0, Math.round(+settings.guests || 0));
  const extra = (over && over.extra) || {};
  for (const k of Object.keys(by)) by[k] += Math.max(0, Math.round(+extra[k] || 0));
  pets += Math.max(0, Math.round(+extra.pet || 0));
  const people = by.adult + by.teen + by.child + by.infant + by.senior;
  return { by, pets, people };
}

function dailyNeeds(settings, members, livestock, over) {
  over = over || {};
  const hc = headcount(members, settings, over);
  const cm = settings.calories.mult;
  const wm = settings.water.mult;
  let kcal = 0; let drink = 0; let cook = 0; let hyg = 0;
  for (const t of Object.keys(hc.by)) {
    const n = hc.by[t];
    kcal += n * settings.calories.perDay * (cm[t] != null ? cm[t] : 1);
    const m = wm[t] != null ? wm[t] : 1;
    drink += n * settings.water.drink * m;
    cook += n * settings.water.cook * m;
    hyg += n * settings.water.hygiene * m;
  }
  const kmul = over.kcalMult != null ? +over.kcalMult : 1;
  const wmul = over.waterMult != null ? +over.waterMult : 1;
  kcal *= kmul; drink *= wmul; cook *= wmul; hyg *= wmul;
  const stock = (livestock || []);
  const animalFeedLb = sum(stock, (l) => l.feedLbPerDay);
  const animalWater = sum(stock, (l) => l.waterGalPerDay) + hc.pets * settings.water.petGal;
  const petFoodLb = hc.pets * settings.pet.foodLb;
  const survival = drink + cook + animalWater;
  return {
    people: hc.people, pets: hc.pets, by: hc.by,
    kcal: r0(kcal),
    water: {
      drink: r1(drink), cook: r1(cook), hygiene: r1(hyg), animals: r1(animalWater),
      survival: r1(survival), total: r1(survival + hyg),
    },
    animalFeedLb: r1(animalFeedLb + petFoodLb),
  };
}

// ------------------------------------------------------------------ expiry
function autoShelfMonths(item) {
  const x = item.x || {};
  if (item.cat === 'fuel') {
    const stab = !!x.stabilized;
    switch (x.fuelType) {
      case 'gasoline': return stab ? 12 : 3;
      case 'ethanol-free gas': return stab ? 24 : 6;
      case 'diesel': return stab ? 24 : 12;
      case 'kerosene': return 24;
      case '2-stroke mix': return stab ? 6 : 2;
      default: return 0;
    }
  }
  return 0;
}

function openedLimit(item) {
  const x = item.x || {};
  if (item.cat === 'filters' && x.openedOn && x.openedLifeMonths > 0) return addMonths(x.openedOn, x.openedLifeMonths);
  return null;
}

// effective expiry for one lot
function lotExp(item, lot) {
  let exp = lot.exp || null;
  if (!exp && lot.bought) {
    const m = item.shelfMonths > 0 ? item.shelfMonths : autoShelfMonths(item);
    if (m > 0) exp = addMonths(lot.bought, m);
  }
  const lim = openedLimit(item);
  if (lim && (!exp || lim < exp)) exp = lim;
  return exp;
}

function itemQty(item) {
  return sum(item.lots || [], (l) => l.qty);
}

function expInfo(item, today, soonDays) {
  const lots = (item.lots || []).filter((l) => l.qty > 0).map((l) => {
    const exp = lotExp(item, l);
    return { id: l.id, qty: l.qty, exp, days: exp ? daysBetween(today, exp) : null };
  });
  let expiredQty = 0; let soonQty = 0; let nearest = null; let nearestDays = null;
  for (const l of lots) {
    if (l.days == null) continue;
    if (l.days < 0) expiredQty += l.qty;
    else if (l.days <= soonDays) soonQty += l.qty;
    if (nearest == null || l.days < nearestDays) { nearest = l.exp; nearestDays = l.days; }
  }
  return { qty: sum(lots, (l) => l.qty), expiredQty, soonQty, nearest, nearestDays, lots };
}

// ------------------------------------------------------------------ supply
function visibleItems(state) {
  const hide = state.hideCats || [];
  return (state.items || []).filter((i) => !hide.includes(i.cat));
}

function supply(state, over) {
  over = over || {};
  const s = state.settings;
  const today = state.today;
  const needs = dailyNeeds(s, state.members, state.livestock, over);
  const countExpired = over.countExpired != null ? !!over.countExpired : !!s.countExpired;
  const items = visibleItems(state);

  let foodKcal = 0; let foodExpired = 0;
  let potable = 0; let nonpot = 0;
  let animalLbs = 0;
  const fuelGal = {};
  const ammo = {};
  const links = [];
  const people = needs.people;

  for (const it of items) {
    const info = expInfo(it, today, s.expiry.soonDays);
    const usable = countExpired ? info.qty : info.qty - info.expiredQty;
    const x = it.x || {};
    if (it.cat === 'food') {
      foodKcal += usable * (x.calories || 0);
      foodExpired += info.expiredQty * (x.calories || 0);
    } else if (it.cat === 'water') {
      const g = x.gallons || 0;
      if (x.kind === 'non-potable') nonpot += usable * g; else potable += usable * g;
    } else if (it.cat === 'pets') {
      animalLbs += usable * (x.lbs || 0);
    } else if (it.cat === 'fuel') {
      const ft = x.fuelType || 'other';
      fuelGal[ft] = (fuelGal[ft] || 0) + usable * (x.gallons || 0);
    } else if (it.cat === 'ammo') {
      const cal = (x.caliber || 'unspecified').trim() || 'unspecified';
      ammo[cal] = (ammo[cal] || 0) + info.qty;
    }
    if (it.dailyUse > 0) {
      const need = it.dailyUse * (it.usePer === 'person' ? Math.max(1, people) : 1);
      links.push({
        id: it.id, name: it.name, cat: it.cat, unit: it.unit, qty: r1(usable), need: r1(need),
        days: need > 0 ? r1(usable / need) : null,
      });
    }
  }

  let inflow = 0;
  for (const w of state.wsources || []) {
    potable += +w.currentGal || 0;
    inflow += +w.inflowGalPerDay || 0;
  }

  // food
  const foodDays = needs.kcal > 0 ? foodKcal / needs.kcal : null;

  // water
  const survNet = needs.water.survival - inflow;
  const fullNet = needs.water.total - inflow;
  const survivalDays = needs.water.survival <= 0 ? null : (survNet <= 0 ? null : potable / survNet);
  const fullDays = needs.water.total <= 0 ? null : (fullNet <= 0 ? null : (potable + nonpot) / fullNet);

  // animals
  const animalDays = needs.animalFeedLb > 0 ? animalLbs / needs.animalFeedLb : null;

  // fuel / generators
  const gens = s.generators || [];
  const fuel = [];
  const types = new Set([...Object.keys(fuelGal), ...gens.map((g) => g.fuelType)]);
  for (const t of types) {
    const burn = sum(gens.filter((g) => g.fuelType === t), (g) => g.gph * g.hoursPerDay);
    const gal = fuelGal[t] || 0;
    fuel.push({ type: t, gallons: r1(gal), burnPerDay: r1(burn), days: burn > 0 ? r1(gal / burn) : null, hasGen: gens.some((g) => g.fuelType === t) });
  }
  fuel.sort((a, b) => (b.hasGen - a.hasGen) || a.type.localeCompare(b.type));

  links.sort((a, b) => (a.days == null) - (b.days == null) || a.days - b.days);

  return {
    needs,
    countExpired,
    food: { kcal: r0(foodKcal), kcalExpired: r0(foodExpired), days: foodDays == null ? null : r1(foodDays) },
    water: {
      potable: r1(potable), nonpotable: r1(nonpot), inflow: r1(inflow),
      survivalDays: survivalDays == null ? null : r1(survivalDays),
      fullDays: fullDays == null ? null : r1(fullDays),
      survivalSustainable: needs.water.survival > 0 && survNet <= 0,
      fullSustainable: needs.water.total > 0 && fullNet <= 0,
    },
    animals: { lbs: r1(animalLbs), days: animalDays == null ? null : r1(animalDays) },
    fuel,
    links,
    ammo: Object.entries(ammo).map(([caliber, rounds]) => ({ caliber, rounds })).sort((a, b) => b.rounds - a.rounds),
  };
}

// ------------------------------------------------------------------ tasks / maintenance
function maintNext(m, today) {
  if (m.lastDone) return addDays(m.lastDone, m.everyDays || 90);
  return m.startDate || today;
}

function maintStatus(m, today) {
  const next = maintNext(m, today);
  return { next, days: daysBetween(today, next) };
}

function roleCoverage(members, keyRoles) {
  return (keyRoles || []).map((role) => {
    const key = role.toLowerCase().split(/[\s/]+/)[0];
    const who = (members || []).filter((m) => m.ptype !== 'pet' && (
      (m.role || '').toLowerCase().includes(key) ||
      (m.skills || []).some((t) => t.toLowerCase().includes(key))
    )).map((m) => m.name);
    return { role, members: who };
  });
}

// ------------------------------------------------------------------ alerts
const SEV = { crit: 0, warn: 1, info: 2 };

function alerts(state, opts) {
  opts = opts || {};
  const s = state.settings;
  const today = state.today;
  const out = [];
  const push = (sev, kind, title, detail, view, ref) => out.push({ sev, kind, title, detail: detail || '', view: view || '', ref: ref || null });
  const target = s.targetDays;
  const sup = opts.supply || supply(state);

  for (const it of visibleItems(state)) {
    const info = expInfo(it, today, s.expiry.warnDays);
    const unit = it.unit || '';
    if (info.expiredQty > 0) {
      push('warn', 'expired', `${it.name}: ${r1(info.expiredQty)} ${unit} expired`, 'Use, rotate or discard.', 'inventory', { coll: 'items', id: it.id });
    } else if (info.nearestDays != null && info.nearestDays <= s.expiry.soonDays) {
      push('warn', 'expiring', `${it.name} expires in ${info.nearestDays} day${info.nearestDays === 1 ? '' : 's'}`, info.nearest, 'inventory', { coll: 'items', id: it.id });
    } else if (info.nearestDays != null && info.nearestDays <= s.expiry.warnDays) {
      push('info', 'expiring', `${it.name} expires in ${info.nearestDays} days`, info.nearest, 'inventory', { coll: 'items', id: it.id });
    }
    const qty = itemQty(it);
    if (it.minQty > 0 && qty <= it.minQty) {
      push(qty <= 0 ? 'crit' : 'warn', 'low', `${it.name} is ${qty <= 0 ? 'out' : 'low'}: ${r1(qty)} ${unit}`, `Alert level ${it.minQty}`, 'inventory', { coll: 'items', id: it.id });
    }
    const x = it.x || {};
    if (it.cat === 'filters' && x.lifeTotal > 0 && x.lifeUsed >= x.lifeTotal * 0.9) {
      push(x.lifeUsed >= x.lifeTotal ? 'crit' : 'warn', 'filter', `${it.name} is at ${r0((x.lifeUsed / x.lifeTotal) * 100)}% of rated life`, '', 'inventory', { coll: 'items', id: it.id });
    }
  }

  // supply days vs target
  if (!opts.noSupply) {
    const check = (label, days, sustainable, view) => {
      if (sustainable || days == null) return;
      if (days < target / 3) push('crit', 'supply', `${label}: ${r1(days)} days (target ${target})`, '', view);
      else if (days < target) push('warn', 'supply', `${label}: ${r1(days)} days (target ${target})`, '', view);
    };
    if (sup.needs.kcal > 0) check('Food', sup.food.days == null ? 0 : sup.food.days, false, 'planner');
    if (sup.needs.water.survival > 0) check('Drinking and cooking water', sup.water.survivalDays, sup.water.survivalSustainable, 'water');
    if (sup.animals.days != null) check('Animal feed', sup.animals.days, false, 'planner');
    for (const f of sup.fuel) if (f.hasGen && f.days != null) check(`${f.type} for generator`, f.days, false, 'water');
  }

  // tasks
  for (const t of state.tasks || []) {
    if (t.done || !t.due) continue;
    const d = daysBetween(today, t.due);
    if (d < 0) push(t.priority === 'high' ? 'crit' : 'warn', 'task', `Overdue: ${t.title}`, `${-d} day${d === -1 ? '' : 's'} late`, 'group', { coll: 'tasks', id: t.id });
    else if (d <= 2) push('info', 'task', `Due ${d === 0 ? 'today' : 'in ' + d + ' days'}: ${t.title}`, '', 'group', { coll: 'tasks', id: t.id });
  }

  for (const m of state.maint || []) {
    const st = maintStatus(m, today);
    if (st.days < 0) push('warn', 'maint', `Overdue: ${m.name}`, `${-st.days} days late`, 'upkeep', { coll: 'maint', id: m.id });
    else if (st.days <= 7) push('info', 'maint', `Due ${st.days === 0 ? 'today' : 'in ' + st.days + ' days'}: ${m.name}`, '', 'upkeep', { coll: 'maint', id: m.id });
  }

  for (const d of state.docs || []) {
    if (!d.expires) continue;
    const n = daysBetween(today, d.expires);
    if (n < 0) push('crit', 'doc', `Expired: ${d.name}`, d.expires, 'plans', { coll: 'docs', id: d.id });
    else if (n <= 90) push(n <= 30 ? 'warn' : 'info', 'doc', `${d.name} expires in ${n} days`, d.expires, 'plans', { coll: 'docs', id: d.id });
  }

  const year = +today.slice(0, 4);
  for (const sd of state.seeds || []) {
    const life = sd.viableYears > 0 ? sd.viableYears : (findCrop(sd.crop) || {}).viable;
    if (sd.packedYear && life > 0 && sd.qty !== 0 && sd.packedYear + life <= year) {
      push('info', 'seed', `${sd.crop}${sd.variety ? ' (' + sd.variety + ')' : ''} seed is past typical viability`, `Packed ${sd.packedYear}. Run a germination test.`, 'homestead', { coll: 'seeds', id: sd.id });
    }
  }

  for (const l of state.livestock || []) {
    if (l.nextHealth) {
      const n = daysBetween(today, l.nextHealth);
      if (n < 0) push('warn', 'animal', `Overdue animal care: ${l.name}`, l.healthNote, 'homestead', { coll: 'livestock', id: l.id });
      else if (n <= 14) push('info', 'animal', `Animal care due in ${n} days: ${l.name}`, l.healthNote, 'homestead', { coll: 'livestock', id: l.id });
    }
  }

  for (const w of state.wsources || []) {
    if (w.lastTested && daysBetween(w.lastTested, today) > 365) {
      push('info', 'water', `${w.name}: water test is over a year old`, w.lastTested, 'water', { coll: 'wsources', id: w.id });
    }
  }

  // vault-derived alerts only when the caller says it is allowed (never in widgets or digests)
  if (opts.vault) {
    const v = opts.vault;
    for (const rec of v.medical || []) {
      const who = ((state.members || []).find((m) => m.id === rec.member) || {}).name || 'Member';
      for (const rx of rec.rx || []) {
        if (rx.perDay > 0 && rx.onHand != null) {
          const d = rx.onHand / rx.perDay;
          if (d < 14) push(d < 7 ? 'crit' : 'warn', 'meds', `${who}: ${rx.name} lasts ${r1(d)} days`, '', 'vault');
        }
        if (rx.rxExpires) {
          const n = daysBetween(today, rx.rxExpires);
          if (n < 0) push('warn', 'meds', `${who}: ${rx.name} prescription expired`, rx.rxExpires, 'vault');
          else if (n <= 30) push('info', 'meds', `${who}: ${rx.name} prescription expires in ${n} days`, rx.rxExpires, 'vault');
        }
      }
    }
    for (const g of v.firearms || []) {
      if (g.cleanEvery > 0 && g.roundsSinceClean >= g.cleanEvery) push('info', 'gun', `${g.name} is due for cleaning`, `${g.roundsSinceClean} rounds since cleaning`, 'vault');
    }
  }

  out.sort((a, b) => SEV[a.sev] - SEV[b.sev]);
  return out;
}

// ------------------------------------------------------------------ readiness
function readiness(state, sup, alertList) {
  const s = state.settings;
  const target = Math.max(1, s.targetDays);
  const parts = [];
  const add = (id, label, weight, value, detail) => parts.push({ id, label, weight, value: Math.max(0, Math.min(1, value)), detail });

  if (sup.needs.kcal > 0) add('food', 'Food', 3, (sup.food.days || 0) / target, `${sup.food.days == null ? 0 : sup.food.days} days of ${target}`);
  if (sup.needs.water.survival > 0) {
    const v = sup.water.survivalSustainable ? 1 : (sup.water.survivalDays || 0) / target;
    add('water', 'Water', 3, v, sup.water.survivalSustainable ? 'sustainable' : `${sup.water.survivalDays == null ? 0 : sup.water.survivalDays} days of ${target}`);
  }
  const genFuel = sup.fuel.filter((f) => f.hasGen && f.days != null);
  if (genFuel.length) {
    const worst = Math.min(...genFuel.map((f) => f.days));
    add('fuel', 'Fuel', 1, worst / target, `${worst} days`);
  }
  if (sup.animals.days != null) add('animals', 'Animal feed', 1, sup.animals.days / target, `${sup.animals.days} days`);

  const links = sup.links.filter((l) => l.days != null);
  if (links.length) {
    const avg = sum(links, (l) => Math.min(1, l.days / target)) / links.length;
    add('items', 'Tracked supplies', 1, avg, `${links.length} items with daily use`);
  }

  // expiry health: share of stocked lots that are not expired
  let lots = 0; let bad = 0;
  for (const it of visibleItems(state)) {
    const info = expInfo(it, state.today, s.expiry.soonDays);
    for (const l of info.lots) { lots++; if (l.days != null && l.days < 0) bad++; }
  }
  if (lots > 0) add('expiry', 'Rotation', 1, 1 - bad / lots, bad ? `${bad} expired lot${bad === 1 ? '' : 's'}` : 'nothing expired');

  const maint = state.maint || [];
  if (maint.length) {
    const od = maint.filter((m) => maintStatus(m, state.today).days < 0).length;
    add('maint', 'Upkeep', 1, 1 - od / maint.length, od ? `${od} overdue` : 'on schedule');
  }

  const people = (state.members || []).filter((m) => m.ptype !== 'pet');
  if (people.length && (s.keyRoles || []).length) {
    const cov = roleCoverage(state.members, s.keyRoles);
    const have = cov.filter((c) => c.members.length).length;
    add('roles', 'Roles covered', 1, have / cov.length, `${have} of ${cov.length}`);
  }

  const totalW = sum(parts, (p) => p.weight);
  const score = totalW > 0 ? r0((sum(parts, (p) => p.weight * p.value) / totalW) * 100) : 0;
  let grade = 'NOT READY';
  if (score >= 90) grade = 'READY';
  else if (score >= 75) grade = 'GOOD';
  else if (score >= 50) grade = 'FAIR';
  else if (score >= 25) grade = 'LOW';
  return { score, grade, parts: parts.map((p) => ({ ...p, value: Math.round(p.value * 100) / 100 })), crit: alertList.filter((a) => a.sev === 'crit').length };
}

// ------------------------------------------------------------------ expiry timeline (next 12 months)
function expiryTimeline(state) {
  const today = state.today;
  const out = [{ label: 'Expired', n: 0 }];
  const base = today.slice(0, 7);
  const months = [];
  for (let i = 0; i < 12; i++) months.push(addMonths(base + '-01', i).slice(0, 7));
  months.forEach((m) => out.push({ label: m, n: 0 }));
  for (const it of visibleItems(state)) {
    for (const l of expInfo(it, today, 0).lots) {
      if (!l.exp) continue;
      if (l.days < 0) out[0].n++;
      else {
        const i = months.indexOf(l.exp.slice(0, 7));
        if (i >= 0) out[i + 1].n++;
      }
    }
  }
  return out;
}

function valueTotals(state) {
  const by = {}; let total = 0;
  for (const it of visibleItems(state)) {
    const v = sum(it.lots || [], (l) => l.cost);
    by[it.cat] = (by[it.cat] || 0) + v;
    total += v;
  }
  return { total: Math.round(total), by };
}

// ------------------------------------------------------------------ gaps and shopping
function planGaps(state, targetDays, over) {
  const sup = supply(state, over);
  const n = sup.needs;
  const T = targetDays;
  const gaps = [];
  if (n.kcal > 0) {
    const short = n.kcal * T - sup.food.kcal;
    if (short > 0) gaps.push({ kind: 'food', name: 'Food (calories)', cat: 'food', short: r0(short), unit: 'kcal', detail: `about ${r0(short / 1650)} lb of rice or an equivalent` });
  }
  if (n.water.survival > 0) {
    const need = n.water.survival * T - sup.water.inflow * T;
    const short = need - sup.water.potable;
    if (short > 0) gaps.push({ kind: 'water', name: 'Drinking and cooking water', cat: 'water', short: r0(short), unit: 'gal', detail: `${Math.ceil(short / 5)} five-gallon jugs` });
  }
  for (const f of sup.fuel) {
    if (!f.hasGen || f.burnPerDay <= 0) continue;
    const short = f.burnPerDay * T - f.gallons;
    if (short > 0) gaps.push({ kind: 'fuel', name: `Fuel: ${f.type}`, cat: 'fuel', short: r1(short), unit: 'gal', detail: `${Math.ceil(short / 5)} five-gallon cans` });
  }
  if (n.animalFeedLb > 0) {
    const short = n.animalFeedLb * T - sup.animals.lbs;
    if (short > 0) gaps.push({ kind: 'animals', name: 'Animal feed', cat: 'pets', short: r0(short), unit: 'lb', detail: '' });
  }
  const seen = new Set();
  for (const l of sup.links) {
    const short = l.need * T - l.qty;
    if (short > 0.05) {
      seen.add(l.id);
      gaps.push({ kind: 'item', name: l.name, cat: l.cat, short: r1(short), unit: l.unit || '', itemId: l.id, detail: `${l.days} days on hand` });
    }
  }
  for (const it of visibleItems(state)) {
    if (seen.has(it.id) || !(it.minQty > 0)) continue;
    const qty = itemQty(it);
    if (qty <= it.minQty) {
      const upTo = it.reorderTo > qty ? it.reorderTo : it.minQty * 2;
      gaps.push({ kind: 'low', name: it.name, cat: it.cat, short: r1(upTo - qty), unit: it.unit || '', itemId: it.id, detail: 'below alert level' });
    }
  }
  return { gaps, supply: sup };
}

// ------------------------------------------------------------------ water and power helpers
function rainCatch(roofSqft, rainfallIn, eff) {
  const e = eff == null ? 0.8 : eff;
  const perInch = roofSqft * 0.623 * e;
  const year = perInch * rainfallIn;
  return { perInch: r1(perInch), perYear: r0(year), perDay: r1(year / 365) };
}

// EPA guidance: 8 drops of 6% bleach per gallon of clear water, double for cloudy.
// 8.25% -> 6 drops. Scales inversely with strength. 64 drops = 1 teaspoon here.
function bleachDose(gallons, strengthPct, cloudy) {
  const s = Math.max(1, +strengthPct || 6);
  const perGal = 8 * (6 / s) * (cloudy ? 2 : 1);
  const drops = Math.ceil(perGal * gallons);
  return { drops, tsp: Math.round((drops / 64) * 100) / 100, ml: Math.round(drops * 0.05 * 10) / 10, dropsPerGal: Math.round(perGal * 10) / 10 };
}

function powerPlan(state) {
  const p = state.settings.power;
  const loads = state.loads || [];
  const dailyWh = sum(loads, (l) => l.watts * (l.qty == null ? 1 : l.qty) * l.hoursPerDay);
  const criticalWh = sum(loads.filter((l) => l.critical), (l) => l.watts * (l.qty == null ? 1 : l.qty) * l.hoursPerDay);
  const peakW = sum(loads, (l) => l.watts * (l.qty == null ? 1 : l.qty));
  const eff = Math.max(0.01, p.systemEff / 100);
  const solarWh = p.solarW * p.sunHours * eff;
  const genWh = p.genSupplementHrs * p.genWatts;
  const usable = p.bankWh * (p.dod / 100);
  const calc = (use) => {
    const net = solarWh + genWh - use;
    if (use <= 0) return { net, days: null, sustainable: true };
    if (net >= 0) return { net, days: null, sustainable: true };
    return { net, days: usable / -net, sustainable: false };
  };
  const all = calc(dailyWh); const crit = calc(criticalWh);
  return {
    dailyWh: r0(dailyWh), criticalWh: r0(criticalWh), peakW: r0(peakW),
    solarWh: r0(solarWh), genWh: r0(genWh), usableBankWh: r0(usable),
    all: { net: r0(all.net), days: all.days == null ? null : r1(all.days), sustainable: all.sustainable },
    critical: { net: r0(crit.net), days: crit.days == null ? null : r1(crit.days), sustainable: crit.sustainable },
    inverterOk: p.inverterW <= 0 ? null : p.inverterW >= peakW,
    needSolarW: p.sunHours > 0 ? r0(dailyWh / (p.sunHours * eff)) : null,
    needBankWh2d: p.dod > 0 ? r0((dailyWh * 2) / (p.dod / 100)) : null,
  };
}

function dist(lat1, lon1, lat2, lon2) {
  const R = 3958.8; const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad; const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function medDays(rx) {
  return rx.perDay > 0 && rx.onHand != null ? r1(rx.onHand / rx.perDay) : null;
}

module.exports = {
  headcount, dailyNeeds, supply, alerts, readiness, expInfo, lotExp, itemQty, autoShelfMonths,
  maintNext, maintStatus, roleCoverage, expiryTimeline, valueTotals, planGaps,
  rainCatch, bleachDose, powerPlan, dist, medDays, visibleItems,
};
