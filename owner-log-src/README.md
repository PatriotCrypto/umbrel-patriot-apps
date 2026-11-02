# Owner Log

A self-hosted record keeper for aircraft owners. Inspections and maintenance due,
squawks, airworthiness directives and service bulletins, equipment, flights,
costs and overhaul reserves — for one aircraft, on your own server.

Free and open source, and built to cover what the subscription ownership apps do,
without a subscription and without your maintenance history living on someone
else's machine.

## Features

- **Status** — one page that answers "can I fly it today": overdue airworthiness
  items, open directives and grounding squawks, with times, hours and costs.
- **Maintenance** — inspections and recurring work tracked on hours, calendar
  months, or both, counted on the tach, Hobbs or airframe time. Signing an item
  off writes a logbook entry, moves the due date and records the cost.
- **Squawks** — severity, grounding flag, photos, and open, in progress, deferred
  or resolved. Resolving one writes the repair into the logbook.
- **Compliance** — ADs, service bulletins, safety directives and notices, with
  recurring intervals, method of compliance and proof links. VOR checks with the
  30-day IFR window.
- **Equipment** — components and STCs with serial numbers, install times and time
  in service against TBO.
- **Flights** — tach and Hobbs readings, pilot, route and fuel. Logging a flight
  rolls the aircraft times forward and accrues the hourly reserves.
- **Costs** — fixed and variable, by category, with receipts, tax-deductible
  flags, and co-owner shares.
- **Hourly rate** — what an hour actually costs: variable spending per hour,
  fixed costs spread over the hours you expect to fly, and reserves for the
  overhaul, at whatever yearly utilisation you type in.
- **Reserves** — set money aside per flight hour for the engine, prop, paint and
  the unexpected, with balances and targets.
- **Logbook** — your own record of work done, with who did it and their
  certificate number.
- **Documents** — airworthiness certificate, registration, weight and balance,
  POH, insurance, 337s and logbook scans.
- **Reports** — an annual inspection packet PDF, an AD and SB compliance report,
  and a cost of ownership report.
- **Exports** — CSV for flights, costs, squawks, the logbook and directives,
  everything as JSON, and a full backup zip with restore.
- **Imports** — flights from a Pilot Logbook, ForeFlight or spreadsheet CSV, and
  directives from a CSV such as the per-model download on Van's service
  information page.

## Install on umbrelOS

Owner Log is published in the **Hangar** community app store, alongside Pilot
Logbook and Builder Log.

1. Open the Umbrel App Store, then **Community App Stores** (the three dots, top
   right).
2. Add the store, if it is not already there:

   ```
   https://github.com/PatriotCrypto/umbrel-patriot-apps
   ```

3. Open the **Hangar** store and install **Owner Log**.
4. Open the app, fill in the aircraft under **Aircraft**, then set the last-done
   dates on the **Maintenance** page so the due dates are right.

Updates keep your data. Only uninstalling removes it.

### How a release works

This repository holds the source and builds the container image. The store
listing — `hangar-owner-log/umbrel-app.yml` and its `docker-compose.yml` — lives
in the
[pilot-logbook-umbrel](https://github.com/PatriotCrypto/umbrel-patriot-apps)
repository, because a community app store cannot share an id with another one.

1. Here: tag `vX.Y.Z` and push it. GitHub Actions builds
   `ghcr.io/PatriotCrypto/hangar-owner-log:X.Y.Z` for amd64 and arm64.
2. In the store repository: bump `version` in `umbrel-app.yml` and the image tag
   in `docker-compose.yml`, then push.

## Run it without Umbrel

```bash
git clone https://github.com/PatriotCrypto/umbrel-patriot-apps
cd owner-log-umbrel
pip install -r requirements.txt
OWL_DATA_DIR=./data python -m uvicorn app.main:app --port 8080
```

Then open <http://localhost:8080>. Tests run with `python -m pytest tests/ -q`.

## Your data

Everything lives in the app's data folder: a SQLite database and your uploads.
**Nothing in this app contacts the internet** — no analytics, no update checks,
no directive lookups, no outbound calls of any kind. That is also why ADs and
service bulletins are entered or imported by you rather than fetched. Take a
backup from **Settings → Full backup ZIP** before you upgrade anything, and keep
a copy off the server.

## Support

Open an issue at
<https://github.com/PatriotCrypto/umbrel-patriot-apps/issues>.

## Disclaimer

Not affiliated with, endorsed by, or connected to the FAA, Van's Aircraft, Inc.,
Coflyt, AircraftMX or any other product. **This app keeps your own records. It
does not replace the aircraft's permanent maintenance logbooks, and nothing it
prints is a maintenance release or an approval for return to service.** Due dates
are worked out from intervals you enter; the defaults it ships with are a
starting point, not legal advice. You remain responsible for the airworthiness of
your aircraft and for complying with the regulations that apply to you.

## License

MIT. See [LICENSE](LICENSE).

## Credits

Built by PatriotCrypto with Claude.
