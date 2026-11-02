'use strict';
// Single source of truth for data shapes. The browser builds its forms and
// tables from /api/meta (which serves this), and the server validates with it.

const crypto = require('crypto');
const { isDate } = require('./dates');

const uid = () => crypto.randomBytes(6).toString('base64url');

function f(key, label, type, o) {
  return Object.assign({ key, label, type }, o || {});
}
const opt = (...a) => a;

// ------------------------------------------------------------------ categories
const FUEL_TYPES = opt('gasoline', 'ethanol-free gas', 'diesel', 'propane', 'kerosene', '2-stroke mix', 'white gas', 'charcoal', 'firewood', 'other');

const CATS = [
  { id: 'food', label: 'Food', code: 'FD', fields: [
    f('calories', 'Calories per unit (kcal)', 'num', { min: 0, hint: 'The whole can, bag or pouch, not one serving.' }),
    f('storage', 'Storage type', 'sel', { options: opt('', 'canned', 'freeze-dried', 'dry bulk', 'MRE / ready-to-eat', 'frozen', 'home-canned', 'dehydrated', 'fresh / garden', 'other') }),
    f('servings', 'Servings per unit', 'num', { min: 0 }),
  ] },
  { id: 'water', label: 'Water', code: 'H2O', fields: [
    f('gallons', 'Gallons per unit', 'num', { min: 0, hint: 'A 5-gallon jug = 5. A 16.9 oz bottle = 0.132.' }),
    f('kind', 'Kind', 'sel', { options: opt('drinking', 'non-potable') }),
  ] },
  { id: 'medical', label: 'Medical & first aid', code: 'MED', fields: [
    f('form', 'Form', 'sel', { options: opt('', 'tablet / capsule', 'liquid', 'topical', 'bandage / dressing', 'device', 'kit', 'other') }),
    f('rx', 'Prescription', 'bool'),
  ] },
  { id: 'ammo', label: 'Ammunition', code: 'AMM', sensitive: true, fields: [
    f('caliber', 'Caliber / gauge', 'text', { list: 'calibers' }),
    f('bullet', 'Type', 'sel', { options: opt('', 'FMJ', 'JHP / SP', 'rimfire', 'buckshot', 'slug', 'birdshot', 'other') }),
    f('grain', 'Grain', 'num', { min: 0 }),
    f('brand', 'Brand', 'text'),
  ] },
  { id: 'comms', label: 'Radios & comms', code: 'COM', fields: [
    f('kind', 'Kind', 'sel', { options: opt('', 'handheld (HT)', 'mobile', 'base', 'Meshtastic node', 'CB', 'scanner', 'weather radio', 'hand-crank radio', 'antenna / cable', 'other') }),
    f('details', 'Callsign / frequencies', 'text'),
    f('lastTested', 'Last tested', 'date'),
  ] },
  { id: 'light', label: 'Lights & batteries', code: 'LGT', fields: [
    f('kind', 'Kind', 'sel', { options: opt('', 'flashlight', 'headlamp', 'lantern', 'battery', 'candle', 'chem light', 'other') }),
    f('size', 'Battery size', 'text', { hint: 'AA, AAA, 18650, CR123...' }),
    f('rechargeable', 'Rechargeable', 'bool'),
  ] },
  { id: 'power', label: 'Power gear', code: 'PWR', fields: [
    f('kind', 'Kind', 'sel', { options: opt('', 'generator', 'solar panel', 'battery bank', 'inverter', 'charge controller', 'power station', 'cables / adapters', 'other') }),
    f('watts', 'Watts (rated)', 'num', { min: 0 }),
    f('capacityWh', 'Capacity (Wh)', 'num', { min: 0 }),
  ] },
  { id: 'fuel', label: 'Fuel', code: 'FUL', fields: [
    f('fuelType', 'Fuel type', 'sel', { options: FUEL_TYPES }),
    f('gallons', 'Gallons per unit', 'num', { min: 0, hint: 'A 5-gallon can = 5. A 1 lb propane cylinder = 0.236.' }),
    f('stabilized', 'Stabilizer added', 'bool'),
  ] },
  { id: 'filters', label: 'Filters & respirators', code: 'FLT', fields: [
    f('kind', 'Kind', 'sel', { options: opt('', 'gas mask', 'filter canister', 'respirator / N95', 'water filter', 'filter element', 'other') }),
    f('lifeTotal', 'Rated life', 'num', { min: 0 }),
    f('lifeUsed', 'Life used', 'num', { min: 0 }),
    f('lifeUnit', 'Life unit', 'sel', { options: opt('gallons', 'liters', 'hours', 'days') }),
    f('openedOn', 'Opened / first used', 'date'),
    f('openedLifeMonths', 'Life once opened (months)', 'num', { min: 0, hint: 'Many sealed canisters last years; opened ones far less.' }),
  ] },
  { id: 'tools', label: 'Tools & hardware', code: 'TLS', fields: [ f('kind', 'Kind', 'text') ] },
  { id: 'hygiene', label: 'Hygiene & sanitation', code: 'HYG', fields: [] },
  { id: 'shelter', label: 'Shelter, clothing, bedding', code: 'SHL', fields: [] },
  { id: 'pets', label: 'Pet & animal feed', code: 'PET', fields: [
    f('lbs', 'Pounds per unit', 'num', { min: 0 }),
    f('animal', 'For', 'text', { hint: 'dog, cat, chickens...' }),
  ] },
  { id: 'barter', label: 'Barter & trade goods', code: 'BTR', fields: [ f('tradeValue', 'Trade value / note', 'text') ] },
  { id: 'other', label: 'Other', code: 'OTH', fields: [] },
];
const CAT_IDS = CATS.map((c) => c.id);
const CAT_BY_ID = Object.fromEntries(CATS.map((c) => [c.id, c]));
const SENSITIVE_CATS = CATS.filter((c) => c.sensitive).map((c) => c.id);

const UNITS = opt('each', 'can', 'jar', 'pouch', 'bag', 'box', 'case', 'bucket', 'jug', 'bottle', 'lb', 'oz', 'gal', 'rounds', 'pair', 'roll', 'set', 'kit');
const PTYPES = opt('adult', 'teen', 'child', 'infant', 'senior', 'pet');

// ------------------------------------------------------------------ collections
const lotFields = [
  f('qty', 'Qty', 'num', { min: 0, def: 0 }),
  f('exp', 'Expires', 'date'),
  f('bought', 'Bought', 'date'),
  f('cost', 'Cost', 'num', { min: 0 }),
  f('note', 'Note', 'text'),
];

const itemFields = [
  f('name', 'Name', 'text', { req: true }),
  f('cat', 'Category', 'sel', { options: CAT_IDS, req: true }),
  f('unit', 'Unit', 'text', { list: 'units', def: 'each' }),
  f('location', 'Location', 'text', { list: 'locations' }),
  f('minQty', 'Low-stock alert at', 'num', { min: 0, hint: 'Alert when the total falls to this or below.' }),
  f('reorderTo', 'Restock up to', 'num', { min: 0, hint: 'Used by the shopping list generator.' }),
  f('dailyUse', 'Daily use', 'num', { min: 0, hint: 'Units used per day. Powers days-remaining for this item.' }),
  f('usePer', 'Daily use is per', 'sel', { options: opt('group', 'person'), def: 'group' }),
  f('shelfMonths', 'Shelf life (months)', 'num', { min: 0, hint: 'Used to compute an expiry from the bought date when none is entered.' }),
  f('weightOz', 'Weight each (oz)', 'num', { min: 0 }),
  f('barcode', 'Barcode', 'text', { max: 40 }),
  f('notes', 'Notes', 'long'),
  f('tags', 'Tags', 'tags'),
  f('lots', 'Lots (quantity and expiry)', 'lines', { of: lotFields, dropIf: (l) => !(l.qty > 0) && !l.exp && !l.bought }),
];

const COLL = {
  items: { label: 'Inventory', title: 'name', max: 6000, fields: itemFields, hidden: ['photo', 'x'] },
  members: { label: 'Members', title: 'name', max: 200, hidden: ['photo'], fields: [
    f('name', 'Name', 'text', { req: true }),
    f('ptype', 'Type', 'sel', { options: PTYPES, def: 'adult' }),
    f('role', 'Position / job title', 'text', { hint: 'Leader, Medic, Security, Comms, Cook...' }),
    f('skills', 'Skills & certifications', 'tags'),
    f('age', 'Age', 'num', { min: 0, max: 120 }),
    f('phone', 'Phone', 'text'),
    f('email', 'Email', 'text'),
    f('emergencyName', 'Emergency contact', 'text'),
    f('emergencyPhone', 'Emergency contact phone', 'text'),
    f('gear', 'Assigned gear', 'long'),
    f('notes', 'Notes', 'long'),
  ] },
  tasks: { label: 'Tasks', title: 'title', max: 2000, fields: [
    f('title', 'Task', 'text', { req: true }),
    f('assignee', 'Assigned to', 'ref', { ref: 'members' }),
    f('due', 'Due', 'date'),
    f('every', 'Repeat every (days)', 'num', { min: 0, max: 3650, def: 0, hint: '0 = one-time. Completing a repeating task moves its due date forward.' }),
    f('priority', 'Priority', 'sel', { options: opt('normal', 'high', 'low'), def: 'normal' }),
    f('kind', 'Kind', 'sel', { options: opt('chore', 'drill', 'maintenance', 'project', 'other'), def: 'chore' }),
    f('notes', 'Notes', 'long'),
    f('done', 'Done', 'bool'),
    f('doneAt', 'Done on', 'date'),
    f('count', 'Times completed', 'num', { min: 0, def: 0 }),
  ] },
  maint: { label: 'Maintenance', title: 'name', max: 1000, fields: [
    f('name', 'What', 'text', { req: true }),
    f('itemId', 'Linked inventory item', 'ref', { ref: 'items' }),
    f('everyDays', 'Every (days)', 'num', { min: 1, max: 3650, def: 90 }),
    f('lastDone', 'Last done', 'date'),
    f('startDate', 'Start date (if never done)', 'date'),
    f('notes', 'Notes', 'long'),
    f('history', 'History', 'lines', { of: [ f('date', 'Date', 'date'), f('note', 'Note', 'text') ], dropIf: (l) => !l.date, readonly: true }),
  ] },
  checklists: { label: 'Checklists', title: 'title', max: 200, fields: [
    f('title', 'Title', 'text', { req: true }),
    f('kind', 'Kind', 'sel', { options: opt('general', 'power outage', 'evacuation', 'house fire', 'severe weather', 'winter storm', 'shelter in place', 'medical', 'water', 'drill'), def: 'general' }),
    f('notes', 'Notes', 'long'),
    f('items', 'Items', 'lines', { of: [ f('text', 'Step', 'text', { max: 300 }), f('done', 'Done', 'bool') ], dropIf: (l) => !l.text }),
  ] },
  contacts: { label: 'Contacts', title: 'name', max: 500, fields: [
    f('name', 'Name', 'text', { req: true }),
    f('relation', 'Relationship', 'sel', { options: opt('family', 'out-of-area contact', 'neighbor', 'doctor / medical', 'vet', 'utility', 'local emergency mgmt', 'poison control', 'mechanic', 'other'), def: 'family' }),
    f('phone', 'Phone', 'text'),
    f('altPhone', 'Alt phone', 'text'),
    f('email', 'Email', 'text'),
    f('address', 'Address', 'text'),
    f('notes', 'Notes', 'long'),
  ] },
  places: { label: 'Places', title: 'name', max: 300, fields: [
    f('name', 'Name', 'text', { req: true }),
    f('kind', 'Kind', 'sel', { options: opt('primary rally point', 'alternate rally point', 'bug-out destination', 'water source', 'shelter', 'medical', 'fuel', 'supplies', 'other'), def: 'primary rally point' }),
    f('address', 'Address / description', 'text'),
    f('lat', 'Latitude', 'num', { min: -90, max: 90 }),
    f('lon', 'Longitude', 'num', { min: -180, max: 180 }),
    f('routeNotes', 'Route notes', 'long'),
    f('notes', 'Notes', 'long'),
  ] },
  docs: { label: 'Documents', title: 'name', max: 500, fields: [
    f('name', 'Document', 'text', { req: true }),
    f('kind', 'Kind', 'sel', { options: opt('ID / license', 'passport', 'birth certificate', 'marriage / family', 'deed / title', 'insurance', 'will / legal', 'medical / immunization', 'permit', 'vehicle title / registration', 'financial', 'other'), def: 'other' }),
    f('owner', 'Whose', 'ref', { ref: 'members' }),
    f('expires', 'Expires', 'date'),
    f('where', 'Where the copy is kept', 'text'),
    f('hasCopy', 'Paper copy in go-bag / safe', 'bool'),
    f('notes', 'Notes (do not store ID numbers)', 'long'),
  ] },
  beds: { label: 'Garden beds', title: 'name', max: 300, fields: [
    f('name', 'Bed', 'text', { req: true }),
    f('sqft', 'Square feet', 'num', { min: 0 }),
    f('sun', 'Sun', 'sel', { options: opt('full', 'part', 'shade'), def: 'full' }),
    f('soil', 'Soil', 'text'),
    f('notes', 'Notes', 'long'),
  ] },
  plantings: { label: 'Plantings', title: 'crop', max: 4000, fields: [
    f('crop', 'Crop', 'text', { req: true, list: 'crops' }),
    f('variety', 'Variety', 'text'),
    f('bed', 'Bed', 'ref', { ref: 'beds' }),
    f('status', 'Status', 'sel', { options: opt('planned', 'sown', 'transplanted', 'growing', 'harvested', 'failed'), def: 'planned' }),
    f('sowDate', 'Sow / start date', 'date'),
    f('transplantDate', 'Transplant date', 'date'),
    f('dtm', 'Days to maturity', 'num', { min: 0, max: 400 }),
    f('harvestDate', 'Harvest date (expected or actual)', 'date'),
    f('sqft', 'Square feet planted', 'num', { min: 0 }),
    f('yieldLb', 'Harvested (lb)', 'num', { min: 0 }),
    f('notes', 'Notes', 'long'),
  ] },
  seeds: { label: 'Seeds', title: 'crop', max: 2000, fields: [
    f('crop', 'Crop', 'text', { req: true, list: 'crops' }),
    f('variety', 'Variety', 'text'),
    f('kind', 'Type', 'sel', { options: opt('unknown', 'heirloom', 'open-pollinated', 'hybrid'), def: 'unknown' }),
    f('qty', 'Quantity', 'num', { min: 0 }),
    f('unit', 'Unit', 'sel', { options: opt('packets', 'seeds', 'oz', 'g'), def: 'packets' }),
    f('packedYear', 'Year packed / harvested', 'num', { min: 1900, max: 2200 }),
    f('viableYears', 'Viable for (years)', 'num', { min: 0, max: 50 }),
    f('germRate', 'Germination (%)', 'num', { min: 0, max: 100 }),
    f('germTested', 'Germination tested', 'date'),
    f('source', 'Source', 'text'),
    f('notes', 'Notes', 'long'),
  ] },
  livestock: { label: 'Livestock', title: 'name', max: 200, fields: [
    f('name', 'Group / animal', 'text', { req: true }),
    f('species', 'Species', 'text', { list: 'species' }),
    f('breed', 'Breed', 'text'),
    f('count', 'Count', 'num', { min: 0, def: 1 }),
    f('acquired', 'Acquired', 'date'),
    f('feedLbPerDay', 'Feed per day, whole group (lb)', 'num', { min: 0 }),
    f('waterGalPerDay', 'Water per day, whole group (gal)', 'num', { min: 0 }),
    f('nextHealth', 'Next vaccination / health task', 'date'),
    f('healthNote', 'Health note', 'text'),
    f('notes', 'Notes', 'long'),
  ] },
  hlog: { label: 'Harvest log', title: 'what', max: 8000, fields: [
    f('date', 'Date', 'date', { req: true }),
    f('what', 'What', 'text', { req: true }),
    f('qty', 'Quantity', 'num', { min: 0 }),
    f('unit', 'Unit', 'text', { list: 'hunits', def: 'lb' }),
    f('source', 'Source', 'sel', { options: opt('garden', 'livestock', 'forage', 'hunt / fish', 'other'), def: 'garden' }),
    f('notes', 'Notes', 'long'),
  ] },
  canning: { label: 'Preserving log', title: 'product', max: 4000, fields: [
    f('date', 'Date', 'date', { req: true }),
    f('product', 'Product', 'text', { req: true }),
    f('method', 'Method', 'sel', { options: opt('water bath', 'pressure canning', 'dehydrate', 'freeze', 'ferment', 'smoke / cure', 'freeze-dry', 'other'), def: 'water bath' }),
    f('qty', 'Jars / packages', 'num', { min: 0, def: 0 }),
    f('jarSize', 'Container', 'text', { hint: 'pint, quart, half-pint...' }),
    f('kcalPerJar', 'Calories per jar', 'num', { min: 0 }),
    f('lot', 'Batch / lot', 'text'),
    f('shelfMonths', 'Shelf life (months)', 'num', { min: 0, def: 18 }),
    f('addedToPantry', 'Added to pantry', 'bool'),
    f('notes', 'Notes', 'long'),
  ] },
  bags: { label: 'Go-bags', title: 'name', max: 100, fields: [
    f('name', 'Bag', 'text', { req: true }),
    f('owner', 'Owner', 'ref', { ref: 'members' }),
    f('kind', 'Kind', 'sel', { options: opt('72-hour bug-out', 'get-home', 'vehicle kit', 'go-bag', 'other'), def: '72-hour bug-out' }),
    f('maxWeightLb', 'Target max weight (lb)', 'num', { min: 0 }),
    f('notes', 'Notes', 'long'),
    f('lines', 'Contents', 'lines', { of: [
      f('name', 'Item', 'text', { max: 120 }),
      f('qty', 'Qty', 'num', { min: 0, def: 1 }),
      f('weightOz', 'oz each', 'num', { min: 0 }),
      f('packed', 'Packed', 'bool'),
      f('itemId', 'Inventory item', 'ref', { ref: 'items' }),
    ], dropIf: (l) => !l.name && !l.itemId }),
  ] },
  loads: { label: 'Electrical loads', title: 'name', max: 300, fields: [
    f('name', 'Device', 'text', { req: true }),
    f('watts', 'Watts', 'num', { min: 0 }),
    f('qty', 'How many', 'num', { min: 0, def: 1 }),
    f('hoursPerDay', 'Hours per day', 'num', { min: 0, max: 24 }),
    f('critical', 'Critical load', 'bool'),
    f('notes', 'Notes', 'text'),
  ] },
  wsources: { label: 'Water sources', title: 'name', max: 100, fields: [
    f('name', 'Source', 'text', { req: true }),
    f('type', 'Type', 'sel', { options: opt('tank', 'rain barrel', 'cistern', 'well', 'spring / creek', 'pond', 'municipal tap', 'other'), def: 'tank' }),
    f('capacityGal', 'Capacity (gal)', 'num', { min: 0 }),
    f('currentGal', 'Current level (gal)', 'num', { min: 0 }),
    f('inflowGalPerDay', 'Reliable inflow (gal/day)', 'num', { min: 0, hint: 'A well or spring you can count on. Leave 0 for storage only.' }),
    f('roofSqft', 'Roof area feeding it (sq ft)', 'num', { min: 0 }),
    f('treat', 'Needs treatment before drinking', 'bool'),
    f('lastTested', 'Last water test', 'date'),
    f('lastCleaned', 'Last cleaned', 'date'),
    f('notes', 'Notes', 'long'),
  ] },
  wlog: { label: 'Water treatment log', title: 'source', max: 3000, fields: [
    f('date', 'Date', 'date', { req: true }),
    f('source', 'Source', 'text'),
    f('method', 'Method', 'sel', { options: opt('bleach', 'boil', 'filter', 'UV', 'distill', 'other'), def: 'bleach' }),
    f('gallons', 'Gallons', 'num', { min: 0 }),
    f('notes', 'Notes', 'text'),
  ] },
  shopping: { label: 'Shopping list', title: 'name', max: 1500, fields: [
    f('name', 'Item', 'text', { req: true }),
    f('qty', 'Qty', 'num', { min: 0, def: 1 }),
    f('unit', 'Unit', 'text'),
    f('cat', 'Category', 'sel', { options: CAT_IDS }),
    f('note', 'Note', 'text'),
    f('itemId', 'Inventory item', 'ref', { ref: 'items' }),
    f('done', 'Bought', 'bool'),
    f('auto', 'Auto', 'bool', { readonly: true }),
  ] },
};

// vault collections (encrypted at rest)
const VCOLL = {
  firearms: { label: 'Firearms', title: 'name', max: 500, fields: [
    f('name', 'Name / nickname', 'text', { req: true }),
    f('type', 'Type', 'sel', { options: opt('pistol', 'revolver', 'rifle', 'shotgun', 'carbine / PCC', 'air rifle', 'other'), def: 'pistol' }),
    f('make', 'Make', 'text'),
    f('model', 'Model', 'text'),
    f('caliber', 'Caliber / gauge', 'text', { list: 'calibers' }),
    f('serial', 'Serial number', 'text'),
    f('acquired', 'Acquired', 'date'),
    f('value', 'Value ($)', 'num', { min: 0 }),
    f('location', 'Stored where', 'text'),
    f('condition', 'Condition', 'sel', { options: opt('excellent', 'good', 'fair', 'needs repair'), def: 'good' }),
    f('magazines', 'Magazines', 'num', { min: 0 }),
    f('assignedTo', 'Assigned to', 'ref', { ref: 'members' }),
    f('lastCleaned', 'Last cleaned', 'date'),
    f('roundsSinceClean', 'Rounds since cleaning', 'num', { min: 0 }),
    f('cleanEvery', 'Clean every (rounds)', 'num', { min: 0, def: 500 }),
    f('accessories', 'Accessories', 'long'),
    f('notes', 'Notes', 'long'),
  ] },
  medical: { label: 'Medical records', title: 'member', max: 300, fields: [
    f('member', 'Member', 'ref', { ref: 'members', req: true }),
    f('bloodType', 'Blood type', 'sel', { options: opt('', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown') }),
    f('allergies', 'Allergies', 'long'),
    f('conditions', 'Conditions', 'long'),
    f('doctor', 'Doctor', 'text'),
    f('doctorPhone', 'Doctor phone', 'text'),
    f('lastPhysical', 'Last physical', 'date'),
    f('notes', 'Notes', 'long'),
    f('rx', 'Medications', 'lines', { of: [
      f('name', 'Medication', 'text', { max: 120 }),
      f('dose', 'Dose', 'text', { max: 80 }),
      f('schedule', 'Schedule', 'text', { max: 80 }),
      f('onHand', 'On hand', 'num', { min: 0 }),
      f('perDay', 'Per day', 'num', { min: 0 }),
      f('rxExpires', 'Rx expires', 'date'),
    ], dropIf: (l) => !l.name }),
  ] },
  vnotes: { label: 'Secure notes', title: 'title', max: 500, fields: [
    f('title', 'Title', 'text', { req: true }),
    f('kind', 'Kind', 'sel', { options: opt('cache location', 'combination / code', 'account recovery', 'instructions', 'other'), def: 'other' }),
    f('body', 'Note', 'long', { max: 20000 }),
  ] },
};

// ------------------------------------------------------------------ validation
class ValidationError extends Error {}

function cleanStr(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function cleanNum(v, spec) {
  if (v === '' || v == null || v === false) return spec.def != null ? spec.def : null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) return spec.def != null ? spec.def : null;
  let r = n;
  if (spec.min != null && r < spec.min) r = spec.min;
  if (spec.max != null && r > spec.max) r = spec.max;
  return Math.round(r * 10000) / 10000;
}

function cleanValue(spec, v) {
  switch (spec.type) {
    case 'text': return cleanStr(v, spec.max || 200);
    case 'long': return cleanStr(v, spec.max || 5000);
    case 'num': return cleanNum(v, spec);
    case 'date': { const s = cleanStr(v, 10); return isDate(s) ? s : ''; }
    case 'bool': return v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
    case 'sel': {
      const s = cleanStr(v, 80);
      const opts = spec.options || [];
      if (opts.includes(s)) return s;
      return spec.def != null ? spec.def : (opts.includes('') ? '' : opts[0] || '');
    }
    case 'ref': return cleanStr(v, 24);
    case 'tags': {
      const a = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
      return a.map((t) => cleanStr(t, 40)).filter(Boolean).slice(0, 30);
    }
    case 'lines': {
      if (!Array.isArray(v)) return [];
      const out = [];
      for (const raw of v.slice(0, 300)) {
        if (!raw || typeof raw !== 'object') continue;
        const line = cleanDoc(spec.of, raw, null, true);
        line.id = cleanStr(raw.id, 24) || uid();
        if (spec.dropIf && spec.dropIf(line)) continue;
        out.push(line);
      }
      return out;
    }
    default: return null;
  }
}

function defaultFor(spec) {
  switch (spec.type) {
    case 'text': case 'long': case 'date': case 'ref': return '';
    case 'num': return spec.def != null ? spec.def : null;
    case 'bool': return false;
    case 'sel': return spec.def != null ? spec.def : ((spec.options || [])[0] ?? '');
    case 'tags': case 'lines': return [];
    default: return null;
  }
}

// Build a clean doc from `input` using `fields`. When `existing` is given,
// keys absent from input keep their existing value (PUT semantics).
function cleanDoc(fields, input, existing, skipRequired) {
  const out = {};
  for (const spec of fields) {
    const has = Object.prototype.hasOwnProperty.call(input, spec.key);
    if (spec.readonly && existing && !has) { out[spec.key] = existing[spec.key]; continue; }
    if (has) out[spec.key] = cleanValue(spec, input[spec.key]);
    else if (existing && existing[spec.key] !== undefined) out[spec.key] = existing[spec.key];
    else out[spec.key] = defaultFor(spec);
    if (spec.req && !skipRequired) {
      const val = out[spec.key];
      if (val === '' || val == null) throw new ValidationError(`${spec.label} is required`);
    }
  }
  return out;
}

function cleanItem(input, existing) {
  const base = cleanDoc(itemFields, input, existing);
  const cat = CAT_BY_ID[base.cat] || CAT_BY_ID.other;
  // category extras live in x
  const xin = (input.x && typeof input.x === 'object') ? input.x : null;
  const xold = (existing && existing.x) || {};
  const x = {};
  for (const spec of cat.fields) {
    if (xin && Object.prototype.hasOwnProperty.call(xin, spec.key)) x[spec.key] = cleanValue(spec, xin[spec.key]);
    else if (xold[spec.key] !== undefined) x[spec.key] = xold[spec.key];
    else x[spec.key] = defaultFor(spec);
  }
  base.x = x;
  base.photo = cleanStr(input.photo !== undefined ? input.photo : (existing && existing.photo) || '', 24);
  return base;
}

function cleanColl(table, name, input, existing) {
  const spec = table[name];
  if (!spec) throw new ValidationError('Unknown collection');
  if (!input || typeof input !== 'object') throw new ValidationError('Bad request body');
  if (name === 'items') return cleanItem(input, existing);
  const doc = cleanDoc(spec.fields, input, existing);
  if (name === 'members') doc.photo = cleanStr(input.photo !== undefined ? input.photo : (existing && existing.photo) || '', 24);
  return doc;
}

// what the browser needs to render forms
function publicMeta() {
  const strip = (fields) => fields.map((s) => {
    const o = Object.assign({}, s);
    delete o.dropIf;
    if (s.of) o.of = strip(s.of);
    return o;
  });
  const coll = {};
  for (const [k, v] of Object.entries(COLL)) coll[k] = { label: v.label, title: v.title, fields: strip(v.fields) };
  const vcoll = {};
  for (const [k, v] of Object.entries(VCOLL)) vcoll[k] = { label: v.label, title: v.title, fields: strip(v.fields) };
  return {
    cats: CATS.map((c) => ({ id: c.id, label: c.label, code: c.code, sensitive: !!c.sensitive, fields: strip(c.fields) })),
    coll, vcoll, units: UNITS, ptypes: PTYPES, fuelTypes: FUEL_TYPES,
  };
}

module.exports = {
  CATS, CAT_IDS, CAT_BY_ID, SENSITIVE_CATS, COLL, VCOLL, UNITS, PTYPES, FUEL_TYPES,
  cleanColl, cleanItem, cleanDoc, cleanStr, cleanNum, ValidationError, publicMeta, uid,
};
