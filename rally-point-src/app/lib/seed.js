'use strict';
// Starter content: default checklists, suggested maintenance, a starter
// inventory list, and fictional sample data for trying the app out.

const { cleanColl, COLL, uid } = require('./schema');
const { addDays } = require('./dates');

// ---------------------------------------------------------------- checklists
const CHECKLISTS = [
  { title: 'Power outage: first hour', kind: 'power outage', items: [
    'Check whether neighbors and the area are out; report the outage to the utility',
    'Unplug or switch off sensitive electronics; leave one light on so you notice when power returns',
    'Get flashlights and lanterns; avoid open flame where you can',
    'Keep the fridge and freezer closed (fridge about 4 hours, full freezer about 48, half-full about 24)',
    'Run a generator outdoors only, at least 20 feet from the house and away from windows, never in a garage',
    'Confirm carbon monoxide alarms have working batteries',
    'Charge phones and radios; tune the weather radio',
    'If you are on a well, fill tubs and containers with water now',
    'Check on neighbors, elderly relatives and anyone on powered medical equipment',
    'Write down the time the power went out',
  ] },
  { title: 'Evacuation: out the door in 15 minutes', kind: 'evacuation', items: [
    'Listen to official instructions; confirm the route and destination',
    'Grab the go-bags, medications and the documents folder',
    'Phones, chargers, radios, spare batteries, cash, keys',
    'Pets, carriers, leashes and pet food',
    'Water and food for the trip',
    'Fuel the vehicle (keep the tank above half in bad seasons)',
    'Shut off utilities only if told to',
    'Lock up; leave a note saying where you are going',
    'Message your out-of-area contact',
    'Take the planned route; know the alternate',
  ] },
  { title: 'House fire', kind: 'house fire', items: [
    'Get out and stay out; stay low under smoke',
    'Close doors behind you as you leave',
    'Go to the family meeting spot and count everyone',
    'Call 911 from outside',
    'Never go back in; tell firefighters if anyone is missing',
    'Practice the escape plan twice a year, including a night drill',
  ] },
  { title: 'Severe storm or tornado warning', kind: 'severe weather', items: [
    'Move to the lowest interior room, away from windows',
    'Mobile homes are not safe: get to a sturdy building before the storm',
    'Cover your head and neck; wear shoes',
    'Take the weather radio, flashlights, phones and pets with you',
    'Stay put until the all-clear',
    'Afterwards: watch for downed lines, gas smells and damaged structures',
  ] },
  { title: 'Winter storm', kind: 'winter storm', items: [
    'Top off vehicle fuel and check the vehicle kit',
    'Check heat sources and fuel; never use a grill or generator indoors',
    'Test carbon monoxide alarms',
    'Let faucets drip in hard freezes and open cabinet doors on exterior walls',
    'Stock extra water; keep to one heated room if power is out',
    'Layer clothing; keep blankets and sleeping bags handy',
    'Charge phones and power banks before the storm',
  ] },
  { title: 'Shelter in place', kind: 'shelter in place', items: [
    'Go indoors, close and lock doors and windows',
    'Turn off fans, heating and air conditioning that pull in outside air',
    'Pick an interior room with few windows',
    'Follow official alerts on radio or phone',
    'Keep water, a radio, flashlight and first-aid kit with you',
    'Stay until officials say it is safe',
  ] },
  { title: 'Boil-water advisory', kind: 'water', items: [
    'Use bottled or boiled water for drinking, cooking and brushing teeth',
    'Boil at a rolling boil for 1 minute (3 minutes above 6,500 ft)',
    'Let it cool and store it in clean, covered containers',
    'Discard ice made during the advisory; wash dishes in boiled or sanitized water',
    'Flush lines and replace filters when the advisory is lifted, as the utility advises',
  ] },
  { title: 'Monthly readiness check', kind: 'drill', items: [
    'Test smoke and CO alarms',
    'Radio check-in on the comms plan',
    'Test flashlights; swap dead batteries',
    'Run the generator for 30 minutes under load',
    'Pull the soonest-expiring food into this week\'s meals',
    'Check stored water and fuel levels',
    'Review the shopping list and low-stock alerts',
    'Update contacts and documents if anything changed',
  ] },
];

function defaultChecklists() {
  return CHECKLISTS.map((c) => cleanColl(COLL, 'checklists', {
    title: c.title, kind: c.kind, items: c.items.map((text) => ({ text, done: false })),
  }));
}

// ---------------------------------------------------------------- maintenance
const MAINT = [
  ['Run the generator under load for 30 minutes', 30],
  ['Test radios and run a check-in', 30],
  ['Inspect fire extinguishers (gauge, pin, hose)', 30],
  ['Check tire pressure and top off vehicle fuel', 30],
  ['Check battery levels; recharge rechargeables', 90],
  ['Rotate stored fuel; add stabilizer if needed', 90],
  ['Replace smoke and CO alarm batteries', 180],
  ['Check go-bags: rotate food, water, batteries, clothes', 180],
  ['Check food buckets and pouches for damage or pests', 180],
  ['Check first-aid kits for expired items', 180],
  ['Rotate or refresh stored water', 180],
  ['Service chainsaw and hand tools', 180],
  ['Test well or cistern water quality', 365],
  ['Germination-test stored seed', 365],
  ['Review documents, contacts and the comms plan', 365],
];

function defaultMaint(today) {
  return MAINT.map(([name, everyDays]) => cleanColl(COLL, 'maint', { name, everyDays, startDate: addDays(today, Math.min(everyDays, 30)) }));
}

// ---------------------------------------------------------------- starter inventory
const S = (name, cat, unit, x, extra) => Object.assign({ name, cat, unit, x: x || {}, lots: [] }, extra || {});

const STARTER = [
  // food: calories are typical dry-weight values; edit to match your labels
  S('White rice', 'food', 'lb', { calories: 1650, storage: 'dry bulk' }),
  S('Dry beans', 'food', 'lb', { calories: 1500, storage: 'dry bulk' }),
  S('Rolled oats', 'food', 'lb', { calories: 1750, storage: 'dry bulk' }),
  S('Pasta', 'food', 'lb', { calories: 1600, storage: 'dry bulk' }),
  S('All-purpose flour', 'food', 'lb', { calories: 1650, storage: 'dry bulk' }),
  S('Sugar', 'food', 'lb', { calories: 1750, storage: 'dry bulk' }),
  S('Honey', 'food', 'lb', { calories: 1380, storage: 'other' }),
  S('Cooking oil', 'food', 'lb', { calories: 4000, storage: 'other' }),
  S('Peanut butter', 'food', 'lb', { calories: 2650, storage: 'other' }),
  S('Powdered milk', 'food', 'lb', { calories: 1640, storage: 'dry bulk' }),
  S('Canned vegetables', 'food', 'can', { calories: 100, storage: 'canned' }),
  S('Canned fruit', 'food', 'can', { calories: 150, storage: 'canned' }),
  S('Canned meat or fish', 'food', 'can', { calories: 300, storage: 'canned' }),
  S('Freeze-dried meal pouch', 'food', 'pouch', { calories: 600, storage: 'freeze-dried', servings: 2 }),
  S('Salt', 'food', 'lb', { calories: 0, storage: 'dry bulk' }),
  // water
  S('Water, 5-gallon jug', 'water', 'jug', { gallons: 5, kind: 'drinking' }, { shelfMonths: 12 }),
  S('Bottled water case (24 x 16.9 oz)', 'water', 'case', { gallons: 3.17, kind: 'drinking' }, { shelfMonths: 24 }),
  S('Water barrel, 55 gal', 'water', 'drum', { gallons: 55, kind: 'drinking' }),
  S('Unscented bleach (for water treatment)', 'hygiene', 'gal', {}, { shelfMonths: 12, minQty: 1 }),
  // medical
  S('First-aid kit', 'medical', 'kit', { form: 'kit' }, { minQty: 1 }),
  S('Tourniquet', 'medical', 'each', { form: 'device' }, { minQty: 2 }),
  S('Trauma / pressure bandage', 'medical', 'each', { form: 'bandage / dressing' }),
  S('Ibuprofen', 'medical', 'each', { form: 'tablet / capsule' }),
  S('Antihistamine', 'medical', 'each', { form: 'tablet / capsule' }),
  S('Oral rehydration salts', 'medical', 'each', { form: 'other' }),
  S('Antibiotic ointment', 'medical', 'each', { form: 'topical' }),
  S('Nitrile gloves', 'medical', 'box', { form: 'other' }),
  S('Thermometer', 'medical', 'each', { form: 'device' }),
  // comms / light / power
  S('NOAA weather radio (hand-crank)', 'comms', 'each', { kind: 'weather radio' }),
  S('Handheld two-way radio', 'comms', 'each', { kind: 'handheld (HT)' }),
  S('Flashlight', 'light', 'each', { kind: 'flashlight' }),
  S('Headlamp', 'light', 'each', { kind: 'headlamp' }),
  S('Lantern', 'light', 'each', { kind: 'lantern' }),
  S('AA batteries', 'light', 'each', { kind: 'battery', size: 'AA' }, { minQty: 8 }),
  S('AAA batteries', 'light', 'each', { kind: 'battery', size: 'AAA' }, { minQty: 8 }),
  S('Power bank', 'power', 'each', { kind: 'battery bank' }),
  S('Portable solar panel', 'power', 'each', { kind: 'solar panel' }),
  // fuel
  S('Gasoline, 5-gal can', 'fuel', 'can', { fuelType: 'gasoline', gallons: 5, stabilized: false }),
  S('Propane, 20 lb cylinder', 'fuel', 'each', { fuelType: 'propane', gallons: 4.7 }),
  S('Propane, 1 lb canister', 'fuel', 'each', { fuelType: 'propane', gallons: 0.236 }),
  // filters
  S('Gravity water filter', 'filters', 'each', { kind: 'water filter', lifeUnit: 'gallons' }),
  S('Replacement filter elements', 'filters', 'each', { kind: 'filter element', lifeUnit: 'gallons' }),
  S('N95 respirators', 'filters', 'box', { kind: 'respirator / N95' }),
  // hygiene
  S('Toilet paper', 'hygiene', 'roll', {}, { dailyUse: 0.15, usePer: 'person' }),
  S('Bar soap', 'hygiene', 'each', {}, { dailyUse: 0.03, usePer: 'person' }),
  S('Trash bags', 'hygiene', 'box', {}),
  S('Hand sanitizer', 'hygiene', 'each', {}),
  // shelter
  S('Sleeping bag', 'shelter', 'each', {}),
  S('Wool blanket', 'shelter', 'each', {}),
  S('Tarp', 'shelter', 'each', {}),
  S('Emergency mylar blanket', 'shelter', 'each', {}),
  S('Rain poncho', 'shelter', 'each', {}),
  // tools
  S('Multi-tool', 'tools', 'each', {}),
  S('Fixed-blade knife', 'tools', 'each', {}),
  S('Hatchet or axe', 'tools', 'each', {}),
  S('Duct tape', 'tools', 'roll', {}),
  S('Lighters / fire starters', 'tools', 'each', {}, { minQty: 4 }),
  S('Work gloves', 'tools', 'pair', {}),
  S('Fire extinguisher', 'tools', 'each', {}, { minQty: 1 }),
  S('Shovel', 'tools', 'each', {}),
];

function starterItems(names) {
  const want = names ? new Set(names) : null;
  return STARTER.filter((s) => !want || want.has(s.name)).map((s) => cleanColl(COLL, 'items', s));
}

function starterList() {
  return STARTER.map((s) => ({ name: s.name, cat: s.cat }));
}

// ---------------------------------------------------------------- sample data
// All of it is fictional. Everything is tagged sample:true so it can be removed in one click.
function sampleDocs(today) {
  const d = (n) => addDays(today, n);
  const lot = (qty, exp, bought, cost) => ({ id: uid(), qty, exp: exp || '', bought: bought || '', cost: cost || 0, note: '' });
  const m = {};
  const mk = (key, name, ptype, role, skills, age) => { m[key] = uid(); return { _key: key, id: m[key], name, ptype, role, skills, age }; };
  const members = [
    mk('a', 'Alex', 'adult', 'Leader, Cook', ['cooking', 'logistics'], 41),
    mk('s', 'Sam', 'adult', 'Medic, Mechanic', ['EMT', 'small engines'], 39),
    mk('r', 'Riley', 'teen', 'Comms', ['ham radio'], 15),
    mk('j', 'Jo', 'child', '', [], 8),
    mk('b', 'Biscuit', 'pet', 'Dog', [], 4),
  ];
  const item = (name, cat, unit, x, extra) => Object.assign({ name, cat, unit, x: x || {}, lots: [] }, extra || {});
  const items = [
    item('White rice', 'food', 'lb', { calories: 1650, storage: 'dry bulk' }, { lots: [lot(50, d(900), d(-60), 45)], location: 'Basement shelf A' }),
    item('Dry beans', 'food', 'lb', { calories: 1500, storage: 'dry bulk' }, { lots: [lot(40, d(700), d(-90), 60)], location: 'Basement shelf A' }),
    item('Rolled oats', 'food', 'lb', { calories: 1750, storage: 'dry bulk' }, { lots: [lot(20, d(400), d(-40), 30)], location: 'Basement shelf A' }),
    item('Canned vegetables', 'food', 'can', { calories: 100, storage: 'canned' }, { lots: [lot(24, d(-20), d(-800), 24), lot(36, d(500), d(-100), 40)], location: 'Pantry', minQty: 12 }),
    item('Canned meat or fish', 'food', 'can', { calories: 300, storage: 'canned' }, { lots: [lot(18, d(18), d(-700), 30)], location: 'Pantry' }),
    item('Freeze-dried meal pouch', 'food', 'pouch', { calories: 600, storage: 'freeze-dried', servings: 2 }, { lots: [lot(30, d(5000), d(-120), 240)], location: 'Basement shelf B' }),
    item('Cooking oil', 'food', 'lb', { calories: 4000, storage: 'other' }, { lots: [lot(6, d(150), d(-200), 24)], location: 'Pantry' }),
    item('Water, 5-gallon jug', 'water', 'jug', { gallons: 5, kind: 'drinking' }, { lots: [lot(8, '', d(-150), 0)], shelfMonths: 12, location: 'Basement' }),
    item('Bottled water case (24 x 16.9 oz)', 'water', 'case', { gallons: 3.17, kind: 'drinking' }, { lots: [lot(4, d(240), d(-100), 20)], location: 'Garage' }),
    item('Unscented bleach (for water treatment)', 'hygiene', 'gal', {}, { lots: [lot(1, '', d(-300), 4)], shelfMonths: 12, minQty: 1, location: 'Basement' }),
    item('Toilet paper', 'hygiene', 'roll', {}, { lots: [lot(48, '', d(-30), 40)], dailyUse: 0.15, usePer: 'person', location: 'Basement' }),
    item('AA batteries', 'light', 'each', { kind: 'battery', size: 'AA' }, { lots: [lot(6, d(900), d(-20), 8)], minQty: 8, reorderTo: 24, location: 'Utility drawer' }),
    item('Headlamp', 'light', 'each', { kind: 'headlamp' }, { lots: [lot(4, '', '', 60)], location: 'Utility drawer' }),
    item('Handheld two-way radio', 'comms', 'each', { kind: 'handheld (HT)', details: 'Sample radios', lastTested: d(-12) }, { lots: [lot(4, '', '', 120)], location: 'Go-bags' }),
    item('Gasoline, 5-gal can', 'fuel', 'can', { fuelType: 'gasoline', gallons: 5, stabilized: false }, { lots: [lot(3, '', d(-80), 60)], location: 'Shed' }),
    item('Propane, 20 lb cylinder', 'fuel', 'each', { fuelType: 'propane', gallons: 4.7 }, { lots: [lot(2, '', '', 60)], location: 'Shed' }),
    item('First-aid kit', 'medical', 'kit', { form: 'kit' }, { lots: [lot(2, d(120), '', 50)], minQty: 1, location: 'Kitchen / Truck' }),
    item('Tourniquet', 'medical', 'each', { form: 'device' }, { lots: [lot(3, '', '', 90)], minQty: 2, location: 'Go-bags' }),
    item('Gravity water filter', 'filters', 'each', { kind: 'water filter', lifeTotal: 6000, lifeUsed: 5500, lifeUnit: 'gallons' }, { lots: [lot(1, '', '', 300)], location: 'Kitchen' }),
    item('Dog food', 'pets', 'bag', { lbs: 30, animal: 'dog' }, { lots: [lot(2, d(200), d(-30), 80)], location: 'Garage' }),
    item('Chicken feed', 'pets', 'bag', { lbs: 40, animal: 'chickens' }, { lots: [lot(3, d(90), d(-20), 54)], location: 'Shed' }),
  ];
  const wsources = [
    { name: 'Rain tank', type: 'tank', capacityGal: 500, currentGal: 320, inflowGalPerDay: 0, roofSqft: 1200, treat: true, lastTested: d(-400), lastCleaned: d(-200), notes: 'Sample' },
  ];
  const loads = [
    { name: 'Refrigerator', watts: 150, qty: 1, hoursPerDay: 8, critical: true, notes: '' },
    { name: 'LED lights', watts: 10, qty: 6, hoursPerDay: 5, critical: true, notes: '' },
    { name: 'Radios and chargers', watts: 30, qty: 1, hoursPerDay: 4, critical: true, notes: '' },
    { name: 'Well pump', watts: 750, qty: 1, hoursPerDay: 1, critical: true, notes: '' },
    { name: 'Chest freezer', watts: 100, qty: 1, hoursPerDay: 8, critical: false, notes: '' },
  ];
  const tasks = [
    { title: 'Check water barrels for algae', assignee: m.j, due: d(3), every: 30, priority: 'normal', kind: 'chore', notes: '', done: false, doneAt: '', count: 4 },
    { title: 'Radio check-in with family net', assignee: m.r, due: d(0), every: 7, priority: 'normal', kind: 'drill', notes: '', done: false, doneAt: '', count: 12 },
    { title: 'Restock first-aid kit', assignee: m.s, due: d(-4), every: 0, priority: 'high', kind: 'project', notes: '', done: false, doneAt: '', count: 0 },
    { title: 'Rotate pantry (first in, first out)', assignee: m.a, due: d(9), every: 30, priority: 'normal', kind: 'chore', notes: '', done: false, doneAt: '', count: 6 },
  ];
  const maint = [
    { name: 'Run the generator under load for 30 minutes', everyDays: 30, lastDone: d(-41), startDate: '', notes: 'Sample', history: [] },
    { name: 'Test radios and run a check-in', everyDays: 30, lastDone: d(-12), startDate: '', notes: '', history: [] },
  ];
  const contacts = [
    { name: 'Pat (out-of-area contact)', relation: 'out-of-area contact', phone: '555-0100', altPhone: '', email: '', address: '', notes: 'Sample entry' },
    { name: 'Neighbor Lee', relation: 'neighbor', phone: '555-0101', altPhone: '', email: '', address: 'Next door', notes: 'Has a spare key' },
  ];
  const places = [
    { name: 'Mailbox at the road', kind: 'primary rally point', address: 'End of the driveway', lat: 39.1, lon: -84.9, routeNotes: '', notes: 'Sample' },
    { name: 'Grandpa\'s farm', kind: 'bug-out destination', address: 'Sample location', lat: 39.4, lon: -85.3, routeNotes: 'Take the county road, avoid the highway', notes: '' },
    { name: 'County fairgrounds', kind: 'alternate rally point', address: 'Sample location', lat: 39.0, lon: -84.6, routeNotes: '', notes: '' },
  ];
  const docs = [
    { name: 'Passport (Alex)', kind: 'passport', owner: m.a, expires: d(60), where: 'Fireproof box', hasCopy: true, notes: '' },
    { name: 'Homeowner insurance policy', kind: 'insurance', owner: '', expires: d(200), where: 'Go-bag folder', hasCopy: true, notes: '' },
  ];
  const beds = [
    { name: 'Raised bed 1', sqft: 32, sun: 'full', soil: 'Loam, compost added', notes: 'Sample' },
    { name: 'Raised bed 2', sqft: 32, sun: 'full', soil: 'Loam', notes: '' },
  ];
  const seeds = [
    { crop: 'Tomato', variety: 'Roma', kind: 'open-pollinated', qty: 2, unit: 'packets', packedYear: +today.slice(0, 4) - 1, viableYears: 4, germRate: 90, germTested: '', source: 'Sample', notes: '' },
    { crop: 'Onion', variety: 'Yellow sweet', kind: 'hybrid', qty: 1, unit: 'packets', packedYear: +today.slice(0, 4) - 3, viableYears: 1, germRate: null, germTested: '', source: 'Sample', notes: '' },
  ];
  const livestock = [
    { name: 'Laying hens', species: 'Chickens', breed: 'Mixed', count: 6, acquired: d(-500), feedLbPerDay: 1.5, waterGalPerDay: 0.5, nextHealth: d(10), healthNote: 'Check for mites', notes: '' },
  ];
  const checklistsExtra = [];
  const bags = [
    { name: 'Alex 72-hour bag', owner: m.a, kind: '72-hour bug-out', maxWeightLb: 30, notes: 'Sample', lines: [
      { id: uid(), name: 'Water filter (compact)', qty: 1, weightOz: 3, packed: true, itemId: '' },
      { id: uid(), name: 'Headlamp', qty: 1, weightOz: 3, packed: true, itemId: '' },
      { id: uid(), name: 'Tarp 8x10', qty: 1, weightOz: 28, packed: false, itemId: '' },
      { id: uid(), name: 'Freeze-dried meals (3 days)', qty: 6, weightOz: 5, packed: true, itemId: '' },
    ] },
  ];
  const hlog = [
    { date: d(-10), what: 'Eggs', qty: 24, unit: 'each', source: 'livestock', notes: '' },
    { date: d(-3), what: 'Tomatoes', qty: 14, unit: 'lb', source: 'garden', notes: '' },
  ];
  return { members, items, wsources, loads, tasks, maint, contacts, places, docs, beds, seeds, livestock, bags, hlog, checklistsExtra };
}

module.exports = { defaultChecklists, defaultMaint, starterItems, starterList, sampleDocs };
