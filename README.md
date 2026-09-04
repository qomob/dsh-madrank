# MADRank for DSH

> **Track your AI usage. See how you rank.**

[![npm](https://img.shields.io/npm/v/@qomob/dsh-madrank)](https://www.npmjs.com/package/@qomob/dsh-madrank)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![MADRank](https://img.shields.io/badge/MADRank-madrank.ai-black)](https://madrank.ai)

**English** | [简体中文](./README.zh-CN.md)

MADRank is an AI Usage & Ranking plugin for [DeepSeek Harness (DSH)](https://github.com/qomob/dsh). It turns your DSH activity into a private local dashboard — Today / 7-Day history / Top models / Streak — and, if you explicitly opt in, an anonymous global **7-Day Token Race** based on real usage.

The core principle is simple: **local tracking runs by default, global ranking is an explicit opt-in, uploads only happen for finished UTC days, and only aggregated usage is ever sent.**

<p align="center">
  <img src="./docs/quick-view.png" alt="MADRank Quick View — rendered from real local data" width="300">&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="./docs/settings.png" alt="MADRank Settings — configuration panel" width="470">
</p>
<p align="center"><sub>Left: sidebar Quick View (real local data) · Right: Settings → MADRank panel</sub></p>

---

## Features

**1. Local AI Usage Dashboard** (works fully offline, no ranking required)

* **Today** — today's usage
* **7-Day / 30-Day History** — recent 7-day / 30-day trends
* **Top Models** — your most-used models
* **Streak** — consecutive active days
* **vs 7-Day Average** — compare against your own 7-day baseline
* **RANK** — global rank status
* **Cached Tokens** — tracked separately from the ranking metric

Data comes from the DSH session projection feed — the plugin never reads DSH's internal database directly.

**2. 7-Day Token Race** (the core competitive metric)

> **7-Day Uncached Tokens** — total primary tokens over the last **7 UTC days**.

```text
Primary Tokens = uncached input tokens + output tokens
Cached Tokens  = cache read + cache write
```

Cached tokens are excluded from the ranking metric so cross-model, cross-provider cache differences never distort the comparison.

**3. Opt-in Global Ranking**

Nothing is uploaded by default. Sync only starts after you explicitly enable **join the global ranking**:

* Off by default, explicit opt-in
* No real-time requests, no same-day data ever
* Only **finished UTC days** are uploaded, as per-day per-model aggregates
* Sync failure never affects local statistics

**4. One-click Share Card**

The **share button** on the Quick View card turns your rank into a postable card:

* **Dedicated share link** — `https://madrank.ai/share/<shareToken>`, viewable from any device by anyone
* **Auto-generated social card image** — rendered server-side (7-day token total, global rank, brand mark, QR code to madrank.ai); social platforms pick it up automatically as the card preview
* **Copy-ready bilingual share text** — with rank and model info
* **Server-authoritative numbers** — refreshed from the server (`/api/usage/me`) right before sharing, so stale local caches never leak stale numbers into your posts

Sharing uploads no new private data: the share token only addresses your anonymous node on a public leaderboard, and the leaderboard itself is public.

---

## Privacy by Design

Local tracking and global sync are separated at the architecture level.

```text
Default (offline-capable):
DSH → Local Projection → Local Usage Store → Local Dashboard

After joining the race:
Local Usage Store → Finished UTC Day → Aggregated Usage → MADRank Ingest
```

**Never uploaded:** prompts, responses, tool arguments, individual request payloads, same-day usage.
**Uploaded:** daily, per-model aggregated usage only.

Deletion is intentionally split: **Clear Local Data** removes this machine's statistics; **Delete Remote Data** requests removal of the remote rows tied to your anonymous installation identity.

---

## Usage Accuracy

MADRank does not invent a second token-accounting logic. It uses DSH's **session projection** as the data source and reconciles aggregation against an independent reference token-meter. A real-session reconciliation run:

```text
input        745,120  =  745,120
output       186,324  =  186,324
cache read 26,352,384 = 26,352,384

MATCH ✓
```

The suite covers streaming replacement, waterfall tool traffic, cross-midnight bucketing and `(turn, step)` replacement semantics. Goal: stay consistent with DSH's own token meter.

---

## Installation

**Option 1: npm (recommended)**

```bash
cd ~/.dsh/profiles/web
pnpm add @qomob/dsh-madrank
```

Add to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - name: '@qomob/dsh-madrank'
```

Restart DSH. Installation succeeded when the log shows `settings ns registered: madrank-usage` and the MADRank entry appears in the sidebar.

**Option 2: local development from GitHub**

```bash
git clone https://github.com/qomob/dsh-madrank.git
cd dsh-madrank && npm install && npm run build:client
cd ~/.dsh/profiles/web
pnpm add 'link:/absolute/path/to/dsh-madrank'
```

Use `link:` not `file:` (`file:` copies the package and breaks source sync). Then register and restart DSH as above.

---

## UI Model

```text
Sidebar → Quick View = VIEW
Settings → MADRank   = CONFIGURE
```

Quick View shows your usage, 7-day trend, model mix and rank; the share button on the card generates your personal share card. Settings controls the join switch, auto-sync, privacy, local/remote deletion and plugin status.

---

## 💬 Join the Community

Scan the QR code to join the DSH plugin community — discuss DSH usage, plugin development and best practices:

<div align="center">

<img src="wechat.jpg" width="180" alt="DSH plugin WeChat group QR code" />

</div>

> The WeChat group QR code expires periodically. If it stops working, leave a message in [Issues](https://github.com/qomob/dsh/issues) and we will refresh it.

---

## Architecture

```text
┌──────────────────────┐
│   DSH Session Logs   │
│    Source of Truth   │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  sessionProjections  │
│     madrankUsage     │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│      UsageStore      │
│  local usage cache   │
└──────────┬───────────┘
      ┌────┴─────┐
      ▼          ▼
   Local UI    Daily Sync
                   │
                   ▼
            MADRank Ingest
                   │
                   ▼
           7-Day Token Race
```

DSH session logs are the source of truth; the plugin reads `sessionProjections` (never SQLite directly), keeps a rebuildable local cache, and keeps daily sync fully isolated from local statistics. All DSH coupling lives in `src/compat.ts` — verifiable via `npm run verify:dsh`.

Integration follows the current official recommendations from the DeepSeek Harness repository (cookbook `docs/cookbook/adding-a-settings-card.md` and the `dsh-session-projection` / `dsh-settings` package references): the projection definition is the official `{ key, stateSchema, init, apply, wire, stateVersion }` shape (zod `ZodType`), the settings namespace registers a schemastery schema through the official register contract (`src/settings-schema.ts`), the sync tick and flush debounce use the official `timer` service when present, and the browser card registers under `settings.plugin.item` keyed by its namespace so the Plugins section pairs it with the served namespace automatically.

Non-negotiables: never fork DSH · never read internal SQLite directly · never duplicate token-meter semantics · never create an independent session event pipeline · never upload same-day usage · never upload prompts/responses/tool arguments · never let global sync block local statistics.

---

## Storage

Default directory `~/.madrank/usage/` (override with `MADRANK_USAGE_DIR`): `installation-id`, `usage-store.json`, `card-snapshot.json`, `global-rank.json`, `deleted-epoch`, `cleared-epoch`. The anonymous identity is a locally generated installation UUID; a new machine means a new identity by default.

---

## Development

```bash
npm install
npm test
npm run typecheck
npm run build:client
npm run reconcile -- <events.jsonl>
npm run reconcile:fixture
npm run verify:dsh
npm run preview
```

TypeScript · React · Zod · Vitest.

---

## Project Status

Local usage projection, 7/30-day history, top models, streak, Quick View, Settings, local clearing, remote deletion, daily aggregated sync protocol, golden-case and real-traffic reconciliation and DSH compatibility verification are all implemented. Global ranking is live against the MADRank ingest service, and the **share card is fully working**: dedicated link, server-rendered social card image and bilingual share text, with numbers auto-refreshed from the server before sharing. Current version: v0.3.6.

---

## Related Projects

The MADRank ecosystem goes beyond the DSH plugin:

* **[madrank-node](https://www.npmjs.com/package/@qomob/madrank-node)** — official CLI collector: reads real usage from local Claude Code / Codex / OpenCode / Gemini CLI / DSH logs, aggregates, and optionally uploads, sharing the same anonymous identity with this plugin
* **[madrank-sync](https://github.com/qomob/madrank-sync)** — skill marketplace distribution: AI agents (Claude Code / DSH, etc.) collect and upload via a skill, with built-in integrity self-check and anti-fabrication guardrails

---

## Disclaimer

This project is a community-driven, unofficial project and is not affiliated with DeepSeek AI. "DeepSeek", "dsh", "DeepSeek Harness" and related names and trademarks belong to their respective owners.

---

🌐 https://madrank.ai

## License

[MIT](./LICENSE) © 2026 qomob / MADRank

