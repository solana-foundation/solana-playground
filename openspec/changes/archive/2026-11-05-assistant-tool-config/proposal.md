# Proposal

## Why

Every edit in Sources and tools is lost on reload: a skill the user turned off comes back on, and a server they
added is gone. `PgAssistant` holds them in memory only. Slava decided on 2026-11-05 that the edits survive a reload.
([HOO-1750](https://linear.app/solana-fndn/issue/HOO-1750) Panel imports the tool registry; user config layers over
the defaults. The panel's half of that title landed with the tool registry.)

## What Changes

- The user's edits are stored as a delta over the deployment's defaults in `/.config/assistant-tools.json`, through
  `PgFs`: skill choices that differ from the default, gateway servers turned off, and the user's own server list.
- A skill the deployment adds later follows its default, a skill turned off stays off, and an unknown id has no effect
  and leaves the file on its next write.
- No credential reaches the file. `authToken`, `headers`, `queryParams`, the `protection` secret and a query in `url`
  stay in memory; a restored entry says which of them to enter again.
- `sources-catalogue`'s requirement "The selection lives in memory" gives way to this.
- No slice under `features/` or `widgets/` changes, so no telemetry event is added, renamed or removed.

## Capabilities

### New Capabilities

- `assistant-tool-config`: what of the user's tool configuration survives a reload, and what never reaches storage.

### Modified Capabilities

None in `openspec/specs/`. The requirement this replaces is in the open change `sources-catalogue`, and is edited there.

## Impact

- `client-v2/src/views/sidebar/assistant`: `store.ts`, a new `model/tool-config.ts`, `Component/Grounding.tsx`.
- `client-v2/e2e`: a new spec that reloads and reads the stored file.
- Out of scope: `client-v2/api/`, server-side configuration, carrying the file between devices or live between tabs.
  Two tabs that both edit write last-wins; the other tab picks the file up on its next load.
