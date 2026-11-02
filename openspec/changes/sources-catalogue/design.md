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

Branch `spike/mcp-config` (PR solana-foundation/solana-playground#82) began
as a spike of the MCP half and carries the whole change: the shared
catalogue and composer, `features/mcp` composing the gateway's upstreams from
them, the `features/skills` slice with `api/skills.mjs`, the community
skills, the per-source checkboxes with their events, and `supportsTools` on
the provider profiles, with their tests. The MCP half's browser behaviour was
checked by hand against the public Solana upstream.

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
`composeServers({ env, override, signedIn })` and `features/skills/server.mjs`
`composeSkills({ env, override, signedIn })`, each calling the shared composer
and its own validator; the route passes `sourcesEnv().SOURCES` as `override`,
so the composers stay pure over their arguments.

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

### A bypass is a provider's, and credentials ride only for a signed-in caller

Explorer's public endpoint answers without a bypass; only a deployment behind
Vercel's bot protection needs one. So the shipped Explorer entry is served to
every caller, and its `MCP_EXPLORER_BYPASS` is optional. A bypass is an entry
field, `protection: { provider, secret }`, rather than a literal header. The
registry `PROTECTION_PROVIDERS` in `features/mcp/model/protection.mjs` says
which header the gateway sends and which query parameter the browser sends.
The browser needs the query parameter because a custom header from the browser
must pass the upstream's CORS preflight. A deployment off Vercel adds a row.

The gateway's credentials belong to the deployment: an entry's `headers`,
`queryParams`, `authToken`, and `protection`. `/api/mcp` answers any caller
from any site, so a credential sent for every caller would let anyone use the
deployment's keys through it. The bypass would get them past the upstream's
bot protection, and `MCP_EXPLORER_TOKEN` past an Explorer that gates on
`MCP_ACCESS_KEYS`. So the gateway lists every entry for everyone and sends its
credentials only for a caller signed in from this site's origin. Anyone else
reaches the upstream without them, which works against a public endpoint and
fails against a gated one. A user with their own key for a server adds it as
a browser entry with that key.

The session is a database read, so `api/mcp.mjs` looks it up only when
signing in would change the answer: a `signedIn` entry, or an entry with
credentials.

Alternative: withholding a protected entry from a signed-out caller, as the
spike first did. It hid Explorer from every bring-your-own-key user although
the public endpoint needs no secret.

Alternative: marking each credential as signed-in only or public. It adds a
field to the entry format, and no shipped entry has a credential meant for
every caller.

Alternative: dropping only the field whose placeholder is unset. It makes an
entry's presence depend on which field was blank, and a server served without
its credential looks broken rather than absent.

### `SOURCES` replaces the catalogue whole

One variable, one format, no merge. An operator who wants the shipped
catalogue minus one entry copies the catalogue into `SOURCES` without it.
`docs/deploy-client-vercel.md` shows the shipped catalogue as the starting
point. The spike's `MCP_SERVERS` is `SOURCES` on this branch, and no
deployment has set the old name.

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

### Community skills: one rule, surfpool first

The shipped catalogue lists a community skill only when it meets the
inclusion rule in `client-v2/docs/agent-sources-and-tools.md`, "Community
skills", and lists one: sendaifun/skills `surfpool`, switched off. A draft of
this change carried 35 of the skills
[solana.com/skills](https://solana.com/skills) lists, chosen by nothing more
than the page listing them. They were removed on 2026-11-02, because no
per-skill rating exists to choose from: the page shows none, and GitHub stars
count a repository, while 21 of those 35 skills shared one repository. The
rule replaces a rating, and surfpool was the first skill checked against it,
on the same day. The page's Foundation entries
are files under `solana-dev`'s `references/`, which `read_skill_reference`
already reaches, so they need no entries. The Solana Developer MCP already
indexes `solana.com/docs`, the agent pages included, and
`solana.com/developers`, so no skill is added for the docs.

What every community skill gets, shipped or added through `SOURCES`:

- **Pinned to a commit.** `validateSkills` rejects a community entry whose
  `baseUrl` is not
  `https://raw.githubusercontent.com/<owner>/<repo>/<commit>/<path>/` with a
  40-character commit hash. A skill's text enters the model's context, and a
  branch would let its owner change what every deployment's model reads.
  The rule sits in the validator rather than in a test over the shipped list,
  so it holds for `SOURCES` too and has a case that fails on an unpinned
  entry whatever the shipped list holds.
- **Our own short descriptions.** Every checked skill's name and description
  sit in the prompt. A `SKILL.md` frontmatter description can run to a
  paragraph, and reading it means a request per skill on every panel open, so
  the entry carries one sentence written for the catalogue.
- **Starts unchecked.** The shipped entry carries `enabled: false` and no
  `signedIn`, as the rule requires, so the skills route lists it to every
  caller, a user with their own key included, and a third party's text enters
  the prompt only after the user checks its skill.
- **A fold in the tab.** The Foundation skills stay at the top; community
  skills sit under a fold with a count of those checked, so a long list does
  not push the MCP section out of view. With none listed, the fold, its
  heading, and its count are absent.

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
- [Each checked skill lengthens the prompt] → A community skill starts
  unchecked when its entry carries `enabled: false`, and each carries a
  one-sentence description.
- [A useful community skill goes unnoticed because it starts off] → The
  community fold shows the count checked and each skill's description; a
  deployment that wants one on by default sets `SOURCES` with that entry's
  `enabled` left out.
- [A useful community skill is missing from the shipped list] → A
  deployment adds one through `SOURCES`; the shipped list grows by one entry
  at a time, each checked against the inclusion rule.

- [A `SOURCES` typo takes the whole gateway and skills route down] → Both
  routes fail with the error naming `SOURCES`, `scripts/check-agent-env.mjs`
  gains a `SOURCES` check so a Vercel build with a broken value fails, and
  the docs show how to print the shipped catalogue as the text to copy.
- [A withheld skill lowers answer quality for a user who did not choose that]
  → The tab says which skills the server lists; an operator who withholds
  `playground-env` does so knowingly, and the docs say what each shipped skill
  is for.
- [The skills route adds one request per panel open] → It is fetched with the
  gateway's list at the same points, and a failure degrades to no skills with
  a note rather than an error.
- [An early review thread on #82 names a spike file that is gone] → The spike's
  `features/mcp/model/catalogue.mjs` is `shared/config/sources.mjs` on this
  branch, its placeholder rules are in `shared/lib/catalogue/compose.mjs`, and
  its tests moved with them; `features/mcp/model/compose.mjs` keeps only the
  MCP rules.

## Migration Plan

No data changes. Each task ships behind the existing environment: a
deployment with no `SOURCES` serves what it served before task 1, with
`MCP_EXPLORER_*` meaning what they meant. Rollback is reverting the PR.
