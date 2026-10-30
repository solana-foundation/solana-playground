# Design

## Context

See [proposal.md](proposal.md), "Why". Before this change, `api/mcp.mjs`
builds its upstream map from `mcpExplorerEnv()`, the browser client in
`features/mcp` validates a user's server list in `parseServers`
(`model/config.ts`), and `PgAssistant` in `views/sidebar/assistant/store.ts`
merges the gateway's list (`GET /api/mcp`) with the user's entries, the
gateway's entry winning an id. Skills are `SKILLS` in
`views/sidebar/assistant/grounding/registry.ts`; `enabledSkillIds` in the
store filters them for the prompt (`model/prompt.ts`, `describeCatalog`) and
for the skill tools (`model/skill-tools.ts`, `requireSkill`). Tools execute
in the browser for every backend; `api/agent.mjs` forwards what the browser
declares.

The spike on branch `spike/mcp-config` (uncommitted at the time of writing,
rebased on foundation master e41981fc0) holds a working MCP half:
`features/mcp/model/{entry,catalogue,compose}.mjs`, `server.mjs`, the
gateway composing through `composeServers`, `supportsTools` on the provider
profiles, `setMcpServerEnabled` in the store, and the checkboxes in
`Component/Grounding.tsx`, with unit tests. Its browser behaviour was checked
by hand against the public Solana upstream.

Constraints from `client-v2/CLAUDE.md`: a feature never imports another
feature; `api/` reaches a slice only through its `server.mjs` and `shared` by
path; a slice with an `index.ts` declares its events in `model/telemetry.ts`
with a registered prefix; `.mjs` under `src/` is what `api/` can import
(`allowJs` lets TypeScript import the same file).

## Goals / Non-Goals

**Goals:**

- One entry format and one composition rule for skills and servers, held in
  `shared/` so neither feature imports the other.
- The spike's MCP half lands with its tests; the skills half follows the same
  shape.
- Every requirement in [specs/client-v2-sources/spec.md](specs/client-v2-sources/spec.md)
  held by a `node --test` case for the server side or a vitest case for the
  browser side; the two browser scenarios the suite cannot drive are marked
  `(manual)` in the spec.

**Non-Goals:**

- Moving the Sources tab out of `views/` or into a `Base`/connected pair; it
  stays a legacy component until the design pass reaches it.
- A server-side check of what a turn declares.

## Decisions

### The catalogue and the composer live in `shared`

`src/shared/config/sources.mjs` holds `SOURCES_CATALOGUE`, and
`src/shared/lib/catalogue/compose.mjs` holds `composeCatalogue({ env, override,
signedIn })`: it parses the override or takes the catalogue, drops `signedIn`
entries for a signed-out caller, fills placeholders, checks `kind` and `id`
uniqueness, and returns entries grouped by kind, still untyped beyond those
fields. Each feature validates its own kind: `features/mcp/model/entry.mjs`
(`validateServers`, as spiked) and `features/skills/model/entry.mjs`
(`validateSkills`). `features/mcp/server.mjs` exports
`composeServers({ env, signedIn })` and `features/skills/server.mjs`
`composeSkills({ env, signedIn })`, each calling the shared composer and its
own validator.

Alternatives: keeping the catalogue in `features/mcp` as the spike does, with
skills added to it, makes `features/skills` import `features/mcp`, which the
boundary check forbids. A `features/sources` slice owning both kinds would
need the MCP entry validator, and so `features/mcp`, for the same reason.
`shared/config` already holds the environment's names (`server-env.mjs`),
so a catalogue of what the deployment offers belongs beside it; the composer
has no domain knowledge beyond `kind`, `id`, and `signedIn`.

### Placeholders: an unresolved one drops the entry, `${NAME:-}` marks an optional value

As spiked. An entry whose `url` names an unset `${DOCS_HOST}` is absent
rather than served with a broken address. A header or query value, or a
bypass secret, written `${NAME:-}` that resolves to an empty string is left
out of the entry, so an optional token never travels as an empty header. The
rule is the same for `url`, `name`, `baseUrl`, and any other string: one
rule, stated once in the composer.

### A bypass is a provider's, and rides only for a signed-in caller

Explorer's public endpoint answers without a bypass; only a deployment behind
Vercel's bot protection needs one. So the shipped Explorer entry is served to
every caller, and its `MCP_EXPLORER_BYPASS` is optional. A bypass is an entry
field, `protection: { provider, secret }`, rather than a literal header: the
registry `PROTECTION_PROVIDERS` in `features/mcp/model/protection.mjs` says
which header the gateway sends and which query parameter the browser sends,
because a custom header from the browser must pass the upstream's CORS
preflight and a query parameter need not. A deployment off Vercel adds a row.

The secret is ours. Sent for every caller, it would make the gateway a way
past the upstream's bot protection for anyone, from any site. So the gateway
lists a protected entry for everyone and sends the secret only for a caller
signed in from this site's origin; anyone else reaches the upstream without
it, which works against a public endpoint and fails against a protected one.
The session is a database read, so `api/mcp.mjs` looks it up only when
signing in would change the answer: a `signedIn` entry or a protected one.

Alternative: withholding a protected entry from a signed-out caller, as the
spike first did. It hid Explorer from every bring-your-own-key user although
the public endpoint needs no secret.

Alternative: dropping only the field whose placeholder is unset. It makes an
entry's presence depend on which field was blank, and a server served without
its credential looks broken rather than absent.

### `SOURCES` replaces the catalogue whole

One variable, one format, no merge. An operator who wants the shipped
catalogue minus one entry copies the catalogue into `SOURCES` without it.
`docs/deploy-client-vercel.md` shows the shipped catalogue as the starting
point. `MCP_SERVERS` from the spike is renamed `SOURCES` before it ships, so
no deployment ever sets the old name.

Alternative: a merge or an allow-list variable per kind. Two variables that
interact need a precedence rule and a doc section for it; a replacement needs
neither.

### Skills get a slice and a route

`features/skills` takes `grounding/registry.ts`, `grounding/types.ts`, and
`grounding/skills.ts` from `views/sidebar/assistant/`, with their tests, and
exposes `listGatewaySkills`, `loadSkill`, `loadReference`, `SkillEntry`, and
the bundled content lookup. `grounding/index.ts` keeps re-exporting what the
assistant's legacy modules import, so `model/prompt.ts` and
`model/skill-tools.ts` change their import path and nothing else. The bundled
content, `content/playground-env.skill.md`, stays where
`yarn sync-assistant-context` writes it; the slice imports it from the legacy
root, which the layer rules allow.

`api/skills.mjs` is GET-only and mirrors the gateway's discovery branch:
origin check, session read, `composeSkills`, `{ skills }`. The browser's list
is the server's, for both backends: a skill is absent for a bring-your-own-key
user when the operator withheld it, because the catalogue describes the
deployment, not the backend. `PgAssistant.loadMcpServers` gains a sibling,
`loadSkills`, called at the same points.

Alternative: extending `GET /api/mcp` to return skills. The gateway speaks MCP
and nothing else; a skills list in its discovery answer would make every MCP
client that reads it see a foreign field.

### The selection stays in `PgAssistant`, in memory

`enabledSkillIds` already lives there; `setMcpServerEnabled` joins it as
spiked: a gateway entry's choice is a set of ids kept apart from the
gateway's list, which `loadMcpServers` replaces whole, and a user entry's
choice is its `enabled` field, so the editor shows it. Nothing in the Sources
tab persists today, and persisting one half would leave the tab half
remembered.

### `supportsTools` on the provider profile

A boolean on `ModelProviderProfile`, `true` for every profile that exists;
`model/provider.ts` passes `tools: undefined` when it is `false`, and the tab
reads the same flag. The flag is per profile, not per model, because the
profiles are where provider behaviour is data already.

### Community skills from solana.com/skills

The catalogue carries the 37 community skills that
[solana.com/skills](https://solana.com/skills) lists, as remote skills. The
page's 17 Foundation entries are files under `solana-dev`'s `references/`,
which `read_skill_reference` already reaches, so they get no entries. The
Solana Developer MCP already indexes `solana.com/docs`, the agent pages
included, and `solana.com/developers`, so no skill is added for the docs.

- **Pinned to the page's commits.** Each `baseUrl` is
  `https://raw.githubusercontent.com/<owner>/<repo>/<commit>/<path>/`, with
  the commit the page links. A skill's text enters the model's context, and a
  branch would let its owner change what every deployment's model reads.
  Updating a skill is a catalogue change, reviewed like any other.
- **Our own short descriptions.** Every checked skill's name and description
  sit in the prompt. A `SKILL.md` frontmatter description can run to a
  paragraph, and reading it means a request per skill on every panel open, so
  the entry carries one sentence written for this catalogue.
- **Every one starts unchecked, for every caller.** Each community entry
  carries `enabled: false` and no `signedIn`, so the skills route lists all
  37 to a signed-out caller, and so to a user with their own key, as to a
  signed-in one. A third party's text enters the prompt only after the user
  checks its skill, and the prompt stays the length of the two Foundation
  skills until then.
- **A fold in the tab.** The two Foundation skills stay at the top; the
  community skills sit under a fold with a count of those checked, so 37 rows
  do not push the MCP section out of view.

Alternatives: generating the entries from the page, which has no API, means
scraping HTML in a script that breaks silently on a redesign. Reading each
`SKILL.md`'s frontmatter at runtime costs a request per skill and a longer
prompt.

### Telemetry

`features/mcp` adds `mcp_server_toggled` to its tracker; `features/skills`
registers the prefix `skills` and adds `skills_toggled`. The store calls both
from the setters, so a toggle fires once however the tab is built. The skill
id is a public name from the catalogue, so it may ride on the event; a server
is reported by kind only, as the slice's other events do.

## Risks / Trade-offs

- [A community skill's text misleads the model] → The text is fixed at a
  reviewed commit, a checked skill is only listed until the model loads it,
  and `playground-env` stays the source the prompt tells the model to prefer
  on versions.
- [Each checked skill lengthens the prompt] → None starts checked, and each
  carries a one-sentence description.
- [A useful community skill goes unnoticed because it starts off] → The
  community fold shows the count checked and each skill's description; a
  deployment that wants one on by default sets `SOURCES` with that entry's
  `enabled` left out.

- [A `SOURCES` typo takes the whole gateway and skills route down] → Both
  routes fail with the error naming `SOURCES`, `scripts/check-agent-env.mjs`
  gains a `SOURCES` parse check so `yarn dev` reports it at start, and the
  docs show the shipped catalogue as the text to copy.
- [A withheld skill lowers answer quality for a user who did not choose that]
  → The tab says which skills the server lists; an operator who withholds
  `playground-env` does so knowingly, and the docs say what each shipped skill
  is for.
- [The skills route adds one request per panel open] → It is fetched with the
  gateway's list at the same points, and a failure degrades to no skills with
  a note rather than an error.
- [The spike's file names move] → `features/mcp/model/catalogue.mjs` and
  `compose.mjs` become `shared/config/sources.mjs` and
  `shared/lib/catalogue/compose.mjs` in task 1; the spike's tests move with
  them.

## Migration Plan

No data changes. Each task ships behind the existing environment: a
deployment with no `SOURCES` serves what it served before task 1, with
`MCP_EXPLORER_*` meaning what they meant. Rollback is reverting the PR.
