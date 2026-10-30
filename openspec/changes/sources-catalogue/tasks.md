# Tasks

Every task is HOO-2318. One task per PR. 1.1 and 3.1 may run at the same
time; 1.2 and 2.1 may run at the same time once 1.1 has merged; every other
task depends on the ones it names. The spike on branch `spike/mcp-config`
is the starting point for 1.1, 1.2, 3.1, and 3.2; its files are moved and
renamed as [design.md](design.md), "Decisions", says, never kept as they are.

## 1. The catalogue and the gateway

- [ ] 1.1 `src/shared/config/sources.mjs` (`SOURCES_CATALOGUE`: the `solana`
      and `explorer` servers and the `playground-env` and `solana-dev` skills,
      with the `MCP_EXPLORER_*` placeholders), `src/shared/lib/catalogue/compose.mjs`
      (`composeCatalogue({ env, override, signedIn })`), `sourcesEnv()` in
      `src/shared/config/server-env.mjs` reading `SOURCES`, and a `SOURCES`
      parse check in `scripts/check-agent-env.mjs`; verify
      `compose.test.mjs` under `yarn test-api` holds one case per scenario of
      "A placeholder is filled from the environment", "An optional credential
      resolved empty is not sent", "The override replaces the catalogue", "A
      signed-in entry is withheld from a signed-out caller", and "One
      catalogue holds both kinds of source" in
      [specs/client-v2-sources/spec.md](specs/client-v2-sources/spec.md),
      each failing for a wrong implementation it names
- [ ] 1.2 `features/mcp/model/entry.mjs` (`validateServers`, the shape rules
      moved out of `model/config.ts`, which keeps its messages and its
      browser-only URL check), `features/mcp/server.mjs` exporting
      `composeServers({ env, signedIn })` and `protectionHeaders`,
      `features/mcp/model/protection.mjs` (`PROTECTION_PROVIDERS` with the
      `vercel` row; `validateServers` checks `protection`; the browser's
      `serverUrl` sends it as a query parameter), `api/mcp.mjs` composing its
      upstreams through it, sending an entry's `headers`, `queryParams`, and
      `authToken` upstream, and its `protection` only for a caller signed in
      on this site, the Explorer withheld-reason hints removed,
      `mcpExplorerEnv()` removed, `.env.example` and
      `docs/deploy-client-vercel.md` describing `SOURCES`, the placeholders,
      and the shipped catalogue as the text to copy (depends on 1.1); verify
      `mcp.integration.spec.ts` holds "A signed-in caller on this site" and
      "A caller who is not signed in on this site", `protection.test.mjs`
      holds the provider rules, `api/mcp.test.mjs` holds "Two servers through
      the override", and a `curl` of `GET /api/mcp` against `yarn dev` with
      no `SOURCES` lists `solana` and `explorer` signed out

## 2. The skills slice and route

- [ ] 2.1 `features/skills`: `grounding/registry.ts`, `grounding/types.ts`,
      and `grounding/skills.ts` moved from `views/sidebar/assistant/` with
      their tests, `index.ts` as the public API, `model/telemetry.ts`
      declaring `skills_toggled` as
      [specs/client-v2-skills/spec.md](specs/client-v2-skills/spec.md)
      describes it, the prefix `skills` in `shared/lib/telemetry/prefixes.ts`,
      `model/entry.mjs` (`validateSkills`), `server.mjs` exporting
      `composeSkills({ env, signedIn })`, `listGatewaySkills` fetching
      `GET /api/skills`, and `api/skills.mjs` with `api/skills.test.mjs`
      (depends on 1.1); verify `src/app/slice-structure.test.ts` passes with
      the new slice, `api/skills.test.mjs` holds "The shipped catalogue signed
      out", "A remote skill's base URL from the environment", and a 405 on
      POST, and the slice's tests hold "The server lists both shipped
      skills", "A bundled id the bundle does not know", and "A path that
      climbs out"
- [ ] 2.2 The assistant reads the server's skills: `PgAssistant.loadSkills`
      called where `loadMcpServers` is, `model/prompt.ts` and
      `model/skill-tools.ts` reading the loaded list through
      `enabledSkillIds`, `Component/Grounding.tsx` listing the loaded skills
      with the note for a failed route, and `docs/assistant-context.md`
      saying the server decides which skills exist, copied with
      `yarn sync-assistant-context` (depends on 2.1); verify `store.test.ts`
      and `Grounding.test.tsx` hold "A skill withheld by the operator" and
      "The skills route is unreachable", and `prompt.test.ts` shows the
      catalogue naming only the loaded skills
- [ ] 2.3 Community skills: the 37 entries from solana.com/skills in
      `SOURCES_CATALOGUE`, each remote at the commit the page pins, with a
      one-sentence description, `enabled: false`, and no `signedIn`, as
      [design.md](design.md), "Community skills from solana.com/skills", says;
      `enabled: false` honoured by `validateSkills` and the store's initial
      `enabledSkillIds`; the Sources tab's community fold with its count; a
      help tip and "Entry format" link for skills, as the additional-servers
      section has; a "Skill entries" section in
      `client-v2/docs/agent-sources-and-tools.md` (depends on 2.2); verify a
      node test fails on a community `baseUrl` that names a branch and on a
      community entry that is not `enabled: false` or is `signedIn`, the PR
      lists every entry's `SKILL.md` answering 200 at its pinned URL, and the
      tab's tests hold "A community skill that starts off" and "A user with
      their own key"

## 3. The selection

- [ ] 3.1 `supportsTools` on `ModelProviderProfile`, `true` on every
      profile, `model/provider.ts` passing no tools when it is `false`, and
      `Component/Grounding.tsx` showing the one-sentence notice in place of
      the lists; verify `provider.test.ts` holds "A profile that declares no
      tool support" through a test profile, and `Grounding.test.tsx` shows the
      sentence and no checkbox for it
- [ ] 3.2 A checkbox per server: `PgAssistant.setMcpServerEnabled` with the
      gateway's choice kept apart from the gateway's list and a user entry's
      choice in its `enabled` field, `mcp_server_toggled` declared in
      `features/mcp/model/telemetry.ts` and fired from the setter,
      `skills_toggled` fired from `setSkillEnabled`, the server rows in
      `Component/Grounding.tsx` with the console for checked servers only and
      the draft left alone when dirty (depends on 1.2 and 2.1); verify
      `store.test.ts` asserts both events through the memory provider and
      holds "A gateway server switched off" at the tool level,
      `Grounding.test.tsx` holds "A user-added server switched on" and "A
      toggle while the editor is dirty", and a `yarn dev` walk-through of
      "The selection lives in memory" and "A skill switched off" is in the
      PR with dated screenshots

## 4. Integration

- [ ] 4.1 Walk through every `(manual)` scenario of the three delta specs
      against `yarn dev` with `MCP_EXPLORER_BYPASS` set and unset, signed in
      and out, and with a `SOURCES` of two servers and one skill (depends on
      2.3 and 3.2); verify the PR lists each scenario with its outcome and the
      `spec:coverage` report names none of this change's scenarios as
      uncovered
