# Liberty AI

A home server doctor and ask-anything assistant for Umbrel. Born from the Liberty Drive offline-AI USB.
*Freedom doesn't need Wi-Fi.*

## What it does

- **Home Server Doctor.** Checks disk, memory, swap, CPU load, temperature, Docker containers and reclaimable space every 10 minutes. Findings are written in plain English with what to do next. A 0 to 100 health score and a 24-hour trend. Optional ntfy alerts (urgent only by default, once a day per problem).
- **Ask anything.** Answers questions about your server, your apps and your files. Every answer cites numbered sources; tap one to see the exact text the AI was given.
- **Files.** Add folders from your Umbrel storage and Liberty AI builds a local search index (txt, md, csv, json, html, rtf, docx, odt, epub, pptx, xlsx, and PDF). Hidden files, symlinks and secret-looking names (keys, wallets, passwords, seeds) are never indexed.
- **Apps.** A switch per app, off by default, for whether Liberty AI may read its data. Patriot Apps with widgets (Rally Point, ZeroDollar, Cold Front) share data today; others show status only until they adopt the contract below.
- **Your choice of AI.** A local model (Ollama or any OpenAI-compatible server) or your own Claude key. Four looks. There is a secret.

## Privacy and safety

- **Read-only.** Liberty AI never changes your server. Docker access is GET-only against a short allowlist (no inspect, because it exposes environment variables), and the socket is mounted read-only. A read-only Docker socket is still powerful, so the app also limits who can connect: only Umbrel's app proxy and loopback.
- **Permission-first.** Sources (health, logs, apps, files) each have an on switch and a separate "may go to a cloud AI" switch. Defaults: files, logs and apps never go to the cloud. **Local-only mode** blocks every cloud provider before any data is gathered.
- **Scrubbed.** Logs are redacted (keys, tokens, seed phrases shapes, invoices, URL credentials) and files are redacted too when the AI is a cloud one.
- **Auditable.** The Settings page shows the exact prompt sent for your last 20 questions.
- **Your Claude key** is typed into Settings only, stored in a private file, and never sent back to the browser.
- The app reads only the Umbrel storage folders you add. It does not mount other apps' data.

## The `/liberty-ai/summary` contract

Any app can join. Serve a read-only JSON page at `/liberty-ai/summary` on its internal port:

```json
{ "title": "Rally Point", "lines": ["Readiness 72%", "3 supplies expire in 30 days"] }
```

or `{ "title": "...", "items": [{ "label": "Water", "value": "9 days" }] }`. Liberty AI falls back to Umbrel widget JSON when there is no summary. You can also add any home-network JSON address as a custom connector.

## Setup

1. Install, then open **Settings** and pick an AI. For fully local use, install Ollama from the Umbrel store and choose it.
2. Add folders on the **Files** page.
3. Switch on the apps you want it to read on the **Apps** page.

## Roadmap

1. Suggest-actions stage: it proposes a fix and you approve it.
2. More app connectors.
3. Liberty Drive library and Kiwix offline reference.

## Development

```
cd app
npm test
LIBERTY_DEMO=1 DATA_DIR=./.demo-data STORAGE_DIR=./.demo-storage PORT=3981 node server.js
```

Demo mode fakes Docker, system stats and the AI so you can look around with no server.

MIT licensed. Independent project, not affiliated with Anthropic, Ollama or Umbrel.
