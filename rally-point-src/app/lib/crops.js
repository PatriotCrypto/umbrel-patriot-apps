'use strict';
// Rough planning table. Numbers are typical values for a temperate US garden
// (zones 5-7) and are meant as a starting point, not a promise. Adjust to your
// own soil, seed and weather.
//
// kind: 'spring' crops are timed from the LAST frost, 'fall' crops are timed
// backwards from the FIRST frost, 'garlic' is a fall-planted overwintering crop.
// sowRel: weeks relative to last frost for direct sowing / transplanting
//         outdoors (negative = before). indoor: weeks before last frost to start
//         seeds indoors (0 = direct sow). dtm: days to maturity.
// lbSqft: typical harvest, pounds per square foot per season (rough).
// kcalLb: calories per pound of the edible harvest (rough).
// viable: typical seed viability in years when stored cool and dry.

const CROPS = [
  { crop: 'Tomato', kind: 'spring', sowRel: 1, indoor: 6, dtm: 75, lbSqft: 1.5, kcalLb: 82, viable: 4 },
  { crop: 'Pepper', kind: 'spring', sowRel: 2, indoor: 8, dtm: 80, lbSqft: 0.7, kcalLb: 120, viable: 3 },
  { crop: 'Potato', kind: 'spring', sowRel: -2, indoor: 0, dtm: 100, lbSqft: 1.2, kcalLb: 350, viable: 0 },
  { crop: 'Sweet potato', kind: 'spring', sowRel: 2, indoor: 0, dtm: 110, lbSqft: 1.0, kcalLb: 390, viable: 0 },
  { crop: 'Sweet corn', kind: 'spring', sowRel: 1, indoor: 0, dtm: 80, lbSqft: 0.35, kcalLb: 390, viable: 2 },
  { crop: 'Green beans', kind: 'spring', sowRel: 1, indoor: 0, dtm: 55, lbSqft: 0.6, kcalLb: 140, viable: 3 },
  { crop: 'Dry beans', kind: 'spring', sowRel: 1, indoor: 0, dtm: 95, lbSqft: 0.25, kcalLb: 1500, viable: 3 },
  { crop: 'Peas', kind: 'spring', sowRel: -6, indoor: 0, dtm: 65, lbSqft: 0.3, kcalLb: 360, viable: 3 },
  { crop: 'Winter squash', kind: 'spring', sowRel: 1, indoor: 0, dtm: 100, lbSqft: 0.8, kcalLb: 180, viable: 4 },
  { crop: 'Pumpkin', kind: 'spring', sowRel: 1, indoor: 0, dtm: 105, lbSqft: 0.8, kcalLb: 120, viable: 4 },
  { crop: 'Zucchini', kind: 'spring', sowRel: 1, indoor: 0, dtm: 55, lbSqft: 2.0, kcalLb: 75, viable: 4 },
  { crop: 'Cucumber', kind: 'spring', sowRel: 1, indoor: 0, dtm: 60, lbSqft: 1.5, kcalLb: 70, viable: 5 },
  { crop: 'Okra', kind: 'spring', sowRel: 2, indoor: 0, dtm: 60, lbSqft: 0.5, kcalLb: 150, viable: 2 },
  { crop: 'Onion', kind: 'spring', sowRel: -4, indoor: 10, dtm: 110, lbSqft: 1.0, kcalLb: 180, viable: 1 },
  { crop: 'Cabbage', kind: 'spring', sowRel: -3, indoor: 9, dtm: 75, lbSqft: 1.0, kcalLb: 115, viable: 4 },
  { crop: 'Broccoli', kind: 'spring', sowRel: -2, indoor: 8, dtm: 65, lbSqft: 0.5, kcalLb: 155, viable: 4 },
  { crop: 'Cauliflower', kind: 'spring', sowRel: -2, indoor: 8, dtm: 70, lbSqft: 0.6, kcalLb: 115, viable: 4 },
  { crop: 'Carrot', kind: 'spring', sowRel: -2, indoor: 0, dtm: 70, lbSqft: 1.0, kcalLb: 185, viable: 3 },
  { crop: 'Beet', kind: 'spring', sowRel: -2, indoor: 0, dtm: 55, lbSqft: 1.0, kcalLb: 195, viable: 4 },
  { crop: 'Radish', kind: 'spring', sowRel: -4, indoor: 0, dtm: 25, lbSqft: 0.6, kcalLb: 70, viable: 5 },
  { crop: 'Lettuce', kind: 'spring', sowRel: -4, indoor: 0, dtm: 45, lbSqft: 0.5, kcalLb: 60, viable: 3 },
  { crop: 'Spinach', kind: 'spring', sowRel: -6, indoor: 0, dtm: 40, lbSqft: 0.4, kcalLb: 105, viable: 2 },
  { crop: 'Kale', kind: 'spring', sowRel: -4, indoor: 0, dtm: 55, lbSqft: 0.8, kcalLb: 220, viable: 4 },
  { crop: 'Turnip', kind: 'fall', sowRel: 0, indoor: 0, dtm: 50, lbSqft: 0.8, kcalLb: 130, viable: 4 },
  { crop: 'Collards', kind: 'fall', sowRel: 0, indoor: 0, dtm: 65, lbSqft: 0.8, kcalLb: 140, viable: 5 },
  { crop: 'Fall kale', kind: 'fall', sowRel: 0, indoor: 0, dtm: 55, lbSqft: 0.8, kcalLb: 220, viable: 4 },
  { crop: 'Fall spinach', kind: 'fall', sowRel: 0, indoor: 0, dtm: 40, lbSqft: 0.4, kcalLb: 105, viable: 2 },
  { crop: 'Fall carrot', kind: 'fall', sowRel: 0, indoor: 0, dtm: 70, lbSqft: 1.0, kcalLb: 185, viable: 3 },
  { crop: 'Garlic', kind: 'garlic', sowRel: 2, indoor: 0, dtm: 240, lbSqft: 0.4, kcalLb: 680, viable: 0 },
];

const BY_NAME = Object.fromEntries(CROPS.map((c) => [c.crop.toLowerCase(), c]));

function findCrop(name) {
  if (!name) return null;
  const k = String(name).trim().toLowerCase();
  if (BY_NAME[k]) return BY_NAME[k];
  // loose match: "Roma tomato" -> Tomato
  for (const c of CROPS) if (k.includes(c.crop.toLowerCase())) return c;
  return null;
}

const { addDays, mmddToDate } = require('./dates');

// Dates for one crop given this year's frost dates.
// Returns { indoor, outdoor, harvest } as YYYY-MM-DD or null.
function plan(crop, lastFrost, firstFrost) {
  const c = typeof crop === 'string' ? findCrop(crop) : crop;
  if (!c || !lastFrost || !firstFrost) return null;
  let outdoor; let indoor = null;
  if (c.kind === 'spring') {
    outdoor = addDays(lastFrost, c.sowRel * 7);
    if (c.indoor) indoor = addDays(lastFrost, -c.indoor * 7);
  } else if (c.kind === 'fall') {
    // sow so it matures about two weeks before the first frost
    outdoor = addDays(firstFrost, -(c.dtm + 14));
  } else {
    outdoor = addDays(firstFrost, c.sowRel * 7); // garlic: two weeks after first frost
  }
  const start = c.kind === 'spring' && c.indoor ? addDays(lastFrost, c.sowRel * 7) : outdoor;
  const harvest = addDays(start, c.dtm);
  return { indoor, outdoor, harvest, kind: c.kind };
}

function frostDates(settings, year) {
  const last = mmddToDate(settings.frost.last, year);
  const first = mmddToDate(settings.frost.first, year);
  return { last, first };
}

// pounds / kcal harvested for plantings that have a yield, in a given year
function gardenStats(plantings, year) {
  let lb = 0; let kcal = 0; let est = 0;
  for (const p of plantings) {
    const y = (p.harvestDate || p.sowDate || '').slice(0, 4);
    if (+y !== year) continue;
    const c = findCrop(p.crop);
    if (p.yieldLb > 0) {
      lb += p.yieldLb;
      if (c) kcal += p.yieldLb * c.kcalLb;
    } else if (c && p.sqft > 0 && p.status !== 'failed' && p.status !== 'harvested') {
      est += p.sqft * c.lbSqft * c.kcalLb;
    }
  }
  return { lb: Math.round(lb * 10) / 10, kcal: Math.round(kcal), plannedKcal: Math.round(est) };
}

function publicCrops() {
  return CROPS.map(({ crop, kind, sowRel, indoor, dtm, lbSqft, kcalLb, viable }) => ({ crop, kind, sowRel, indoor, dtm, lbSqft, kcalLb, viable }));
}

module.exports = { CROPS, findCrop, plan, frostDates, gardenStats, publicCrops };
