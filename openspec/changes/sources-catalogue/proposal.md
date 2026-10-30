# Proposal

## Why

The sources the assistant may draw on are fixed in code. The gateway
`api/mcp.mjs` serves a literal `solana` upstream and Explorer, which
`mcpExplorerEnv()` in `src/shared/config/server-env.mjs` turns on when
`MCP_EXPLORER_BYPASS` is set; adding an upstream or a credential is a deploy.
The skills list is `SKILLS` in `views/sidebar/assistant/grounding/registry.ts`,
and nothing on the server can withhold one. In the Sources tab, a skill has a
checkbox but an MCP server has none: a gateway server cannot be switched off
from the browser, and a user-added one only through the JSON editor.

HOO-2318 asks for one catalogue format for both kinds of source, composed on
the server from the environment, so an operator decides what the deployment
offers, including entries whose credentials stay on the server, and composed
in the browser with checkboxes, so a user with their own key picks what a
turn may use. A throwaway spike on branch `spike/mcp-config` proved the MCP
half; this change states the shape for both halves.

## What Changes

- One catalogue, `SOURCES_CATALOGUE` in `src/shared/config/sources.mjs`: an
  array of entries with a `kind` (`mcp` or `skill`), an `id`, a `name`, an
  optional `signedIn`, and the fields of its kind. Any string in an entry may
  hold `${NAME}` or `${NAME:-default}`, filled from the server's environment.
  An entry with a placeholder that has neither a value nor a default is left
  out, which is how an operator turns one on. The `SOURCES` variable, a JSON
  array in the same format, replaces the catalogue whole. The shipped
  catalogue serves Explorer to every caller, like the Solana upstream; its
  variables `MCP_EXPLORER_BYPASS`, `MCP_EXPLORER_URL`, and `MCP_EXPLORER_TOKEN`
  keep their names, all optional. `mcpExplorerEnv()` goes.
- An `mcp` entry may carry `protection: { provider, secret }`, a bypass for
  its upstream's bot protection. A registry in `features/mcp` says how each
  provider takes its secret, a header for the gateway and a query parameter
  for the browser, so a deployment that leaves Vercel adds a provider rather
  than changing the gateway. The gateway sends the secret only for a caller
  signed in on this site.
- A composer, `src/shared/lib/catalogue/compose.mjs`, pure over its
  arguments: it reads the catalogue or the override, withholds `signedIn`
  entries from a signed-out caller, fills placeholders, and checks `kind` and
  `id` only. Each slice validates the fields of its own kind.
- `features/mcp` validates an MCP entry once for both readers, the browser's
  `parseServers` and the gateway, and exposes `composeServers` through its
  `server.mjs`. `api/mcp.mjs` composes its upstreams through it and applies an
  entry's `authToken` and `queryParams` to upstream requests, as the browser
  does for a user entry.
- A slice `features/skills` takes the skill registry, its types, and its
  loaders from `views/sidebar/assistant/grounding/`, exposes
  `listGatewaySkills`, and validates a skill entry. A route `api/skills.mjs`
  answers GET with the skills the catalogue offers this caller, as
  `GET /api/mcp` lists servers. The Sources tab offers the skills that list
  names, so a skill the operator withheld is absent for every backend.
  Bundled content stays in the bundle; the catalogue names a bundled skill and
  cannot change its content.
- The shipped catalogue carries the 37 community skills that
  [solana.com/skills](https://solana.com/skills) lists, each a remote skill
  whose `baseUrl` is on `raw.githubusercontent.com` at the commit the page
  pins. A skill entry may carry `enabled: false` and then starts unchecked;
  the community skills that help write, test, or inspect programs in this
  environment start checked, the rest unchecked. The Foundation skills the
  page lists are reference files of `solana-dev`, which the assistant already
  loads, so they get no entries of their own.
- The Sources tab shows a checkbox for every source, skill or server, gateway
  or user-added. An unchecked server contributes no tools to the next turn and
  shows no console; an unchecked skill is absent from the prompt's catalogue
  and `load_skill` refuses it. The choice lives in memory, as the skill choice
  does today. A model provider profile declares `supportsTools`; when it is
  `false`, a turn declares no tools and the tab says so in place of the lists.
  The community skills sit in a fold of their own with a count of those
  checked. The skills list and the additional-servers editor each have a help
  tip and an "Entry format" link to `client-v2/docs/agent-sources-and-tools.md`,
  which describes a skill entry as it already describes an MCP server entry.
- Telemetry: `features/mcp` adds `mcp_server_toggled` (`server`: `gateway` or
  `user`, as the slice's other events name it; `enabled`). `features/skills`
  adds `skills_toggled` (`id`: the skill's public id; `enabled`), with the
  prefix `skills` registered in `shared/lib/telemetry/prefixes.ts`. Both
  fire from the Sources tab. No event names a server or carries a URL. The
  events were confirmed in the brainstorm as `server_toggled` and
  `skill_toggled`; they carry their slice's prefix here, as every event does.

## Capabilities

### New Capabilities

- `client-v2-sources`: the catalogue of sources the deployment offers: its
  format, how the server composes it from the environment and for whom, what
  the gateway and the skills route list, and how the Sources tab's selection
  decides what a turn may use.
- `client-v2-skills`: the skills slice of `features/skills`: what it lists and
  loads, and the event it reports.

### Modified Capabilities

- `client-v2-mcp`: the event `mcp_server_toggled`, and the gateway applying a
  catalogue entry's credentials to upstream requests. The capability exists so
  far only as the delta of the open change `assistant-ai-sdk-transport`
  (every task ticked, not archived), so this change's delta adds requirements
  and modifies none; both deltas merge into one spec at archive time.

## Impact

- Code: `client-v2/src/shared/config/sources.mjs` (added),
  `client-v2/src/shared/lib/catalogue/` (added),
  `client-v2/src/shared/config/server-env.mjs` (`mcpExplorerEnv` removed,
  `sourcesEnv` added), `client-v2/api/mcp.mjs`, `client-v2/api/skills.mjs`
  (added), `client-v2/src/features/mcp/` (`model/entry.mjs`,
  `model/compose.mjs`, `server.mjs` added; `model/config.ts`,
  `model/telemetry.ts`), `client-v2/src/features/skills/` (added, taking
  `grounding/registry.ts`, `grounding/types.ts`, and `grounding/skills.ts`
  from `views/sidebar/assistant/` with their tests),
  `client-v2/src/views/sidebar/assistant/`: `store.ts`, `model/provider.ts`,
  `model/model-providers/`, `model/prompt.ts`, `model/skill-tools.ts`,
  `Component/Grounding.tsx`, and their tests. Docs: `.env.example`,
  `docs/deploy-client-vercel.md`, `docs/agent-sources-and-tools.md` (a "Skill
  entries" section), `docs/assistant-context.md` copied with
  `yarn sync-assistant-context`.
- Environment: `SOURCES` is read. `MCP_EXPLORER_BYPASS` no longer turns
  Explorer on: Explorer is listed whether it is set or not, and when set its
  secret rides only on signed-in callers' requests. `MCP_EXPLORER_URL` and
  `MCP_EXPLORER_TOKEN` keep their effect. A deployment that sets none of
  them serves the Solana upstream, Explorer, both Foundation skills, and the
  community skills.
- Dependencies: none added or removed.
- Users: the Sources tab gains a checkbox per server, and a server switched
  off is absent from the next turn. The community skills appear, some
  checked; each checked one adds its name and description to the prompt. A
  deployment can now withhold a skill or a server, in which case it is absent
  from the tab for every backend. A signed-out user keeps the Solana
  upstream, gains Explorer, and keeps every source the catalogue does not
  mark `signedIn`. Chat, approvals, Stop, stored threads,
  and the default backend's sign-in gate behave as before.
- Out of scope:
  - Persisting the selection across reloads: nothing in the Sources tab is
    persisted today, and the selection joins it.
  - Enforcing the selection on the server. Tools execute in the browser for
    every backend, and `api/agent.mjs` keeps forwarding what the browser
    declares; the server decides what is offered, the browser what is used.
  - Per-user or per-plan allow lists, and changing a bundled skill's content
    from the environment.
  - The `load_skill` and reference tools' behaviour beyond refusing a skill
    that is switched off.
