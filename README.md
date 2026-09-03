# dsh-madrank

> **MADRank Usage** — Track your AI usage. See how you rank.
>
> A [DeepSeek Harness](https://www.npmjs.com/package/@qomob/dsh-madrank) plugin that turns your local AI usage into a private dashboard, with an **opt-in** anonymous global ranking (7-Day Token Race) at [madrank.ai/rank](https://madrank.ai/rank).

- **Local first** — usage statistics live on your machine (`~/.madrank/usage/`), fully usable offline. Global ranking is off by default.
- **Aggregates only** — syncs one anonymous daily number per model. Never your chats, prompts, responses, files, or API keys.
- **Honest numbers** — Primary Tokens = uncached input + output; cache tokens are shown separately and never counted.

## Install

### Option A — npm (recommended)

```bash
cd ~/.dsh/profiles/web
pnpm add @qomob/dsh-madrank
```

### Option B — from GitHub (source link, updates stay in sync)

```bash
git clone https://github.com/qomob/dsh-madrank.git
cd dsh-madrank && npm install && npm run build:client   # builds the browser half (dist/client.js)

cd ~/.dsh/profiles/web
pnpm add 'link:/absolute/path/to/dsh-madrank'    # use link:, not file: (file: copies and stops syncing)
```

### Register + restart (both options)

```yaml
# append to ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - name: '@qomob/dsh-madrank'
```

Then **restart DSH** (dependency/patch changes are not hot-reloaded).

> ⚠️ Do **not** register a local file path (`- name: '/path/to/src/index.ts'`) — the sidebar entry
> would render empty because the browser half only loads through the package-name entry.

Verify: the DSH log shows `settings ns registered: madrank-usage`, and a MADRank entry appears in the sidebar.

## Usage

- **Sidebar → MADRank** — your quick view: today's usage, most-used models, 7/30-day trend, and your global rank.
- **Settings → MADRank** — configuration: join/leave the global ranking, auto-sync, privacy, local data, plugin status.

Turn on **Participate in global ranking** in Settings; your rank appears at [madrank.ai/rank](https://madrank.ai/rank) after the first daily sync (only finished UTC days are ever submitted).

## Privacy

MADRank only receives the aggregates required for ranking:

| Synced | Never synced |
| --- | --- |
| Token counts, usage dates, model names | Chats, prompts, responses, files, API keys, tool arguments |

- Participation is opt-in and can be turned off anytime; local statistics are unaffected.
- Your identity is a random install ID (salted server-side); switching machines means a new identity.
- "Delete synced data" removes ranking data already submitted to MADRank; "Clear local data" only clears this device's records.

## Development

```bash
npm install
npm test               # vitest
npm run typecheck
npm run build:client   # rebuild dist/client.js (browser half)
```

## License

[MIT](./LICENSE)
