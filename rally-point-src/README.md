# Rally Point

Private preparedness and homestead planner for Umbrel. Independent community app, not affiliated with Umbrel.

**What it does**
- Inventory with lots, expiration dates, low-stock levels, barcode scan (USB scanner anywhere, camera on https)
- Console with days of food, water, fuel and power, weakest links and a readiness score; three home-screen widgets
- Planner: what-if scenarios and an auto shopping list
- Water and power: sources, rain catchment and bleach calculators, solar/battery budget, generators, fuel age
- Group: members, positions, skills, tasks, watch roster, go-bags
- Plans: checklists, contacts, places, document expirations, PACE comms plan
- Homestead: garden, frost-based sowing calendar, seeds, animals, harvest and preserving log
- Encrypted vault (firearms, medical, secure notes) and one-tap stealth mode
- Four looks, offline library of guides, backup and restore

## Install
Umbrel Settings → App Store → ⋯ → Community App Stores → add `https://github.com/PatriotCrypto/umbrel-patriot-apps`.

## Security notes
- All data stays on your Umbrel in `${APP_DATA_DIR}/data`. No telemetry. The only optional network features are the ntfy digest and Open Food Facts lookup, both off by default.
- Vault: AES-256-GCM with a random key wrapped by scrypt-derived keys from your PIN and a one-time recovery code. Lose both and the vault cannot be recovered. The vault is locked on a timer and by stealth mode.
- Everything outside the vault (including inventory quantities) is stored unencrypted on disk. Rely on your node's disk encryption and Umbrel login.
- Stealth mode hides the ammo category from every screen, widget and digest.
- Umbrel's app login protects the UI. Do not expose the app port directly.

## Development
```
cd app && npm install && DATA_DIR=./data node server.js   # http://localhost:3967
npm test
```

MIT licensed.
