'use strict';
// Offline reference library. Written for this app (no third-party text).
// Guides use a tiny markup: "## heading", "- bullet", blank-line paragraphs, **bold**.

const GUIDES = [
  { id: 'threes', title: 'The rule of threes', tags: ['basics'], body: `
Rough limits that help you set priorities. Real survival depends on conditions, health and age.

- **3 minutes** without air (or in icy water)
- **3 hours** without shelter in harsh weather
- **3 days** without water
- **3 weeks** without food

Work top to bottom: safe air and shelter first, then water, then food. Food is the last urgent problem, which is why water storage and treatment matter more than a deep pantry.` },

  { id: 'water-store', title: 'Water: how much to store and how', tags: ['water'], body: `
## How much
- A common minimum is **1 gallon per person per day** for drinking and basic cooking, and more for hygiene. Many planners use 2 or more gallons per person per day in total.
- Plan more for children, nursing mothers, hot weather and anyone ill. Add water for pets and animals.
- Set your own numbers under Settings; this app uses them to work out your days of water.

## Containers
- Use food-grade containers: new or well-cleaned water jugs, barrels and cubes, or commercially bottled water.
- Store in a cool, dark place off bare concrete if you can.
- Do not reuse milk jugs; residue is hard to clean and the plastic degrades.

## Rotation
- Commercially bottled water has a printed date. Water you fill yourself is often rotated every 6 to 12 months.
- Treated tap water in clean, sealed food-grade containers stays safe for a long time, but taste can go flat. Aerate by pouring between containers.
- Log refills in Upkeep so the app reminds you.` },

  { id: 'water-treat', title: 'Treating water', tags: ['water'], body: `
Clear water first: let sediment settle and strain it through a clean cloth. Then use **one** reliable method.

## Boiling
- Bring to a rolling boil for 1 minute (3 minutes above 6,500 ft / 2,000 m). Let it cool covered.

## Bleach (plain, unscented household bleach)
- For clear water, EPA guidance is about **8 drops of 6% bleach per gallon**. Use 16 drops if the water is cloudy or very cold. With 8.25% bleach use about 6 drops per gallon.
- Stir, then wait **30 minutes**. It should have a slight chlorine smell. If not, repeat the dose and wait 15 more minutes.
- Use only bleach with no added scents, soaps or thickeners. Replace bleach roughly every year, because it loses strength.
- The Water & Power tab has a calculator for larger volumes.

## Filters
- Choose a filter rated for bacteria and protozoa (for example pore size of 0.2 micron or smaller). Many do not remove viruses. Add chemical treatment or boiling if viruses are a concern.
- Track filter life in Inventory (Filters category).

## Things that do not work
- Boiling does not remove chemicals, metals or fuel. Do not drink from water that smells of chemicals, fuel or sewage.
- Solar disinfection and distillation can help in a pinch but are slow.` },

  { id: 'food-store', title: 'Food storage basics', tags: ['food'], body: `
## What spoils food in storage
Heat, light, oxygen, moisture and pests. Cool, dark, dry and sealed wins.

## Rough best-quality windows (typical, not guarantees)
- White rice, dry beans, rolled oats, sugar, salt, honey: many years to decades when sealed, cool and dry. Honey and salt keep indefinitely.
- Brown rice and whole-grain flour: months, because the oils go rancid. Whole wheat berries keep far longer than flour.
- Canned low-acid foods (meat, vegetables): often 2 to 5 years for best quality. High-acid canned foods (tomatoes, fruit): 12 to 18 months.
- Freeze-dried meals in sealed pouches or cans: often 20 years or more as claimed by makers.
- Cooking oils and fats: 1 to 2 years before they turn.

## Habits that make storage work
- Store what you eat and eat what you store. Rotate oldest to the front.
- Use food-grade buckets with gamma lids and oxygen absorbers in mylar bags for bulk dry goods.
- Label with the date bought. Log it in Inventory so the app can warn you.
- Keep a manual can opener, extra cooking fuel and a way to heat food.
- A printed date is usually about quality, not safety. Bulging, leaking or foul-smelling cans go in the trash.` },

  { id: 'outage-food', title: 'Food safety in a power outage', tags: ['food', 'power'], body: `
USDA guidance:
- A closed refrigerator keeps food safe for about **4 hours**.
- A full freezer holds for about **48 hours** if the door stays closed (about **24 hours** if half full).
- Group frozen food together and pack it with ice or blocks if you can.
- Discard refrigerated meat, poultry, fish, eggs and cut produce that were above 40 F for more than 2 hours.
- Use a food thermometer. When in doubt, throw it out.
- Cook and eat the perishable food first, then the freezer, then the pantry.` },

  { id: 'generator', title: 'Generator and fuel safety', tags: ['power', 'fuel'], body: `
## Carbon monoxide kills
- Run generators **outdoors only**, at least 20 feet from the house, with the exhaust pointed away from doors, windows and vents. Never in a garage, basement or porch.
- Install battery-powered or battery-backup CO alarms on every level.
- Symptoms (headache, dizziness, nausea, confusion) mean get to fresh air and call 911.

## Electrical
- Never plug a generator into a wall outlet ("backfeeding"). It can kill line workers. Use heavy-duty outdoor extension cords, or have an electrician install a transfer switch or interlock.
- Keep the generator dry and on a level surface. Do not touch it with wet hands.

## Fuel
- Let it cool before refueling. Store fuel in approved containers away from living areas and ignition sources.
- Gasoline goes stale in about 3 months untreated, a year with stabilizer. Ethanol-free gas lasts longer. Diesel about a year, kerosene about two. Propane keeps essentially forever.
- Run the generator monthly under load. The app can remind you in Upkeep.` },

  { id: 'first-aid', title: 'First aid quick reference', tags: ['medical'], body: `
This is a memory aid, not a replacement for training. Take a hands-on course (Stop the Bleed, Red Cross or AHA first aid and CPR). Call 911 when you can.

## Severe bleeding
- Press firmly on the wound with a clean cloth and keep pressing.
- If a limb is bleeding badly and pressure is not working, apply a tourniquet **above the wound** (not on a joint), tighten until the bleeding stops, note the time, and do not remove it.

## Cardiac arrest (hands-only CPR)
- Call 911, then push hard and fast in the center of the chest at about 100 to 120 per minute, about 2 inches deep for an adult, letting the chest rise fully. Use an AED as soon as one arrives.

## Choking (adult, conscious)
- Give 5 back blows between the shoulder blades, then 5 abdominal thrusts, and repeat until the object comes out or the person collapses. Then start CPR.

## Burns
- Cool with running cool (not icy) water for 10 to 20 minutes. Cover loosely with a clean non-stick dressing. Do not pop blisters or apply butter or ice. Get care for large burns, burns on the face, hands or genitals, and chemical or electrical burns.

## Cold and heat
- Hypothermia: get indoors, remove wet clothes, insulate, warm the trunk first, give warm sweet drinks if alert, handle gently.
- Heat stroke (confusion, very hot skin, collapse) is an emergency: cool the person quickly with cold water or wet sheets and fanning and call 911.

## Dehydration and diarrhea
- Oral rehydration drink (WHO home recipe): **1 liter of clean water + 6 level teaspoons of sugar + half a level teaspoon of salt**. Sip steadily.` },

  { id: 'sanitation', title: 'Sanitation without running water', tags: ['hygiene'], body: `
- Bucket toilet: a 5-gallon bucket with a snap lid and toilet seat, lined with a heavy trash bag. Add an absorbent such as sawdust, cat litter or wood shavings after each use. Tie off bags and store sealed until disposal.
- If you must dig a latrine, put it **at least 200 feet** from water sources, downhill from your water, and cover each use with soil.
- Wash hands with soap and clean water for 20 seconds after the toilet and before food. Hand sanitizer with at least 60% alcohol is a backup.
- Use disposable or very hot-washed dishes. Keep a separate "dirty" and "clean" area.
- Store trash in sealed bags away from living areas to avoid pests.
- Keep extra toilet paper, soap, bleach, trash bags and feminine hygiene supplies on the shopping list.` },

  { id: 'comms', title: 'Radio and comms quick reference', tags: ['comms'], body: `
Common frequencies in the US. Check your own rules, and see the table below.

- Keep a PACE plan (Primary, Alternate, Contingency, Emergency) under Plans so everyone knows how to reach each other and when.
- Pick set check-in times so people can save battery between them.
- Write down frequencies and channels on paper too.
- Handheld radios have limited range: roughly a mile or two in the trees and a few miles over open ground. Repeaters and elevated antennas extend this a lot.
- Amateur radio needs a license (an exam). GMRS needs a license (no exam). FRS, MURS and CB do not.
- Never rely on one radio. Carry spare batteries and a simple antenna.` },

  { id: 'rain', title: 'Rainwater catchment notes', tags: ['water'], body: `
- A roof yields about **0.62 gallons per square foot per inch of rain**, and real systems capture maybe 75 to 85% of that. The Water & Power tab does the math.
- Add a gutter screen and a first-flush diverter that dumps the first few gallons of each rain, since that carries the most dirt, bird droppings and roof debris.
- Keep tanks opaque and covered to stop algae and mosquitoes. Screen all openings.
- Treat catchment water before drinking it, even if it looks clear.
- Do not collect from roofs with some treated shakes or from copper-heavy runoff for drinking.
- Some states restrict or regulate rain collection. Check your local rules.` },

  { id: 'vehicle', title: 'Vehicle kit', tags: ['shelter'], body: `
- Keep the fuel tank above half in winter and storm seasons.
- Basics: jumper cables or jump pack, tire inflator and plug kit, flashlight, first-aid kit, tow strap, multi-tool, gloves, duct tape.
- Cold weather: blanket or sleeping bag, hats and gloves, hand warmers, ice scraper, small shovel, traction aid (sand or mats), candles and a can for emergency warmth only if ventilated.
- Always: water, snacks, phone charger, paper map, reflective triangles or flares, cash.
- If stranded, stay with the vehicle unless help is very near. Run the engine sparingly and keep the tailpipe clear of snow.` },

  { id: 'meals', title: 'Planning meals from storage', tags: ['food'], body: `
- An adult needs roughly **2,000 calories a day**, so **about 60,000 calories a month**. That is roughly 36 lb of rice per person per month if rice were the only food, which is why variety (fats, proteins, vegetables) matters.
- Build a base of grain plus legume (rice and beans, pasta and lentils), add fat for calories and flavor, and add canned or dried vegetables and fruit for micronutrients.
- Stock spices, salt, sugar, bouillon, coffee or tea and a few comfort foods. Morale matters.
- Count calories, not cans. Enter calories per unit on each food item and the Planner does the rest.
- Plan for the energy you will need to cook. Dry beans and rice take a lot of fuel.` },

  { id: 'shelf', title: 'Gear and supplies shelf life', tags: ['gear'], body: `
- Alkaline batteries: roughly 5 to 10 years on the shelf. Lithium primaries: 10 or more years. Keep batteries out of devices in storage. Rechargeables lose charge, so top them up every few months.
- Bleach: about 1 year.
- Medications: the printed date is the maker's guarantee. Many tablets keep potency longer if stored cool and dry, but some (liquid antibiotics, insulin, nitroglycerin, epinephrine) do not. Ask a pharmacist before relying on expired medicine.
- Water filters: follow the maker's rated life. Gas mask canisters: follow the maker's date sealed, and much less once opened.
- Fuel: see the generator guide.
- Duct tape, cordage and plastics degrade in heat and sun.` },

  { id: 'seeds', title: 'Seeds and seed saving', tags: ['garden'], body: `
- Store seed cool, dry and dark. A sealed jar in a cool place works well, and a refrigerator or freezer in a sealed container with desiccant extends life.
- Typical viability: onion and parsnip 1 to 2 years, corn and spinach 2 to 3, beans, peas, carrots and lettuce about 3, tomato, squash and cabbage 4 or more, cucumbers and radish 5.
- Test germination before relying on old seed: put 10 seeds in a damp paper towel in a bag, keep warm, and count how many sprout.
- **Heirloom** and **open-pollinated** varieties come true from saved seed. **Hybrid** seed usually does not, so keep buying or grow open-pollinated types for security.
- Isolate or hand-pollinate cross-pollinating crops (squash, corn) if you want pure seed. Tomatoes, beans and peas are the easiest first crops to save.` },

  { id: 'law', title: 'Know your local rules', tags: ['basics'], body: `
Rules vary by state, county and city. Check before you rely on any of these:
- Rainwater collection and well or septic rules
- Generators, fuel storage limits and fire codes
- Firearm storage, transport and ammunition rules
- Livestock and poultry (zoning, number limits)
- Burn bans and outdoor fires
- Amateur, GMRS and CB radio licensing

This app is a planning tool. It does not give legal, medical or professional advice.` },
];

// ---------------------------------------------------------------- calorie reference
// Approximate calories per pound of dry or as-listed product.
const CALORIES = [
  ['White rice (dry)', 1650], ['Dry beans', 1500], ['Lentils (dry)', 1600], ['Rolled oats', 1750],
  ['Wheat berries', 1500], ['All-purpose flour', 1650], ['Cornmeal', 1650], ['Pasta (dry)', 1600],
  ['Instant potato flakes', 1620], ['Sugar', 1750], ['Honey', 1380], ['Cooking oil / shortening', 4000],
  ['Butter', 3250], ['Peanut butter', 2650], ['Almonds / nuts', 2650], ['Powdered milk (nonfat)', 1640],
  ['Dried fruit (raisins)', 1360], ['Canned tuna in water', 520], ['Salt', 0],
];

// ---------------------------------------------------------------- radio table
const RADIO = [
  { service: 'FRS / GMRS', where: 'Channel 1: 462.5625 MHz. Channel 3: 462.6125. Channel 7: 462.7125 (shared channels)', license: 'FRS: none. GMRS: FCC license, no exam', note: 'Popular family radios. Short range.' },
  { service: 'MURS', where: '151.820, 151.880, 151.940, 154.570, 154.600 MHz', license: 'None', note: 'Five license-free VHF channels.' },
  { service: 'NOAA Weather Radio', where: '162.400, 162.425, 162.450, 162.475, 162.500, 162.525, 162.550 MHz', license: 'Receive only', note: 'Alerts and forecasts.' },
  { service: 'Amateur 2 m', where: '146.520 MHz simplex calling frequency', license: 'Amateur license (exam)', note: 'Also check local repeaters and ARES nets.' },
  { service: 'Amateur 70 cm', where: '446.000 MHz simplex calling frequency', license: 'Amateur license (exam)', note: '' },
  { service: 'CB', where: 'Channel 9: 27.065 MHz (emergency). Channel 19: 27.185 (highway)', license: 'None', note: 'Channel 9 is reserved for emergencies and travelers.' },
];

module.exports = { GUIDES, CALORIES, RADIO };
