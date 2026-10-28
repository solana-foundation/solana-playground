# Design

## Context

See proposal.md for why. Today `createTools(bridge)` in
`views/sidebar/assistant/model/tools.ts` returns `ToolDefinition`s whose
`name`, `description` and `schema` are written inline next to their `run`;
`createSkillTools()` does the same for the three skill tools, and
`grounding/registry.ts` holds `SKILLS` with the bundled skill's markdown
imported in place. The default backend (`api/agent.mjs`) forwards the `tools`
the browser sends, so it has no list of its own. `api/mcp.mjs` writes the
Solana upstream inline.

Constraints from the repo: `api/*.mjs` runs as plain Node ESM with no build
step and cannot resolve `@/`; lint (`eslint-layers.js`) lets server code reach
a slice only through its `server.mjs`, and forbids browser code from importing
a `server.mjs`. Precedent for a value shared by both: `features/auth/config.mjs`
(plain ESM, `allowJs`, imported by `index.ts` and `server.mjs`).

## Goals / Non-Goals

**Goals:**

- One data module both sides import; parity enforced by tests, not by review.
- No behaviour change in the panel: same names, descriptions, schemas, order
  of tools the model sees, approval cards and skills.

**Non-Goals:**

- Executing tools on the server, or changing `api/` in any way.
- Declaring MCP-discovered tools (they are runtime data).
- Moving the skill loaders (`grounding/skills.ts`) or MCP client out of the
  panel.

## Decisions

### A new entity slice `entities/agent-tools`, plain ESM at its core

`model/registry.mjs` holds the data with JSDoc typedefs; `index.ts` re-exports
it and those typedefs for the browser (through `allowJs`) and adds
`bindTool(name, run)`, which
builds a `ToolDefinition` from a declaration and throws on an undeclared name;
`server.mjs` re-exports the same bindings for `api/`. The core imports nothing
(no `@/`, no `ai`, no `zod`), so it cannot pull a browser module into Node. A
`node --test` case loads `server.mjs` in plain Node, as Vercel does; `test-api`
gains the `src/entities/**/model/**/*.test.mjs` glob for it.

- Why `entities`, not `features`: the registry is a domain object and what
  reads it, not a user action. A feature slice must declare telemetry
  (`app/slice-structure.test.ts`), and this one has no events to send; and a
  feature cannot import another feature, whereas any future agent feature or
  widget can import an entity. `api/` may reach entities through `server.mjs`.
- Alternative: put it in `shared/`. Rejected: the skill descriptions carry
  playground domain knowledge, which `shared/` must not, and `shared/` has no
  server door.

### Declarations carry data only; runners stay in the panel

A declaration is `{ name, description, schema, approval }`. Each panel tool is
written as `bindTool("<name>", run)`, its runner closing over the bridge and
`PgAssistant` as today; `bindTool` copies name, description and schema from the
declaration and throws on an undeclared name. A declaration with no runner
shows up in the parity test, which compares the panel's tools with the
registry's in order. The `approval` flag is metadata for the server rail and for the test
that every gated tool asks; the gating itself stays inside each `run`, as the
`ai` transport spec requires.

- Alternative: declarations with optional runners. Rejected: it couples the
  data module to `PgAssistant` and the bridge, which Node cannot load.
- This is my call while Slava is away (ask "server-exec"): the default agent
  only declares tools and the browser executes them. If he decides the server
  should execute some, server runners go in `api/` (Alexander's lane) keyed by
  the same names; the registry does not change shape.

### Tool order is preserved

`createTools` today yields skill tools, then MCP tools, then the six project
tools. The registry lists the nine built-ins in that same relative order, and
the panel inserts MCP tools between the skill and project groups as now, so
the prompt prefix the model sees is byte-identical (keeps provider prompt
caching warm).

### Skill catalogue without content

`SKILLS` moves to the registry as `{ id, name, description, source }` where a
bundled source is `{ type: "bundled" }` with no content, because Node cannot
import `.md`. `grounding/registry.ts` keeps the `.md` import and binds content
by id (`BUNDLED_CONTENT[id]`), exporting the same `SKILLS: SkillEntry[]` its
callers read today, so `grounding/skills.ts`, `prompt.ts`, `store.ts` and
`Grounding.tsx` are untouched. A test fails if a bundled entry has no content.

### Default MCP upstreams declared, gateway not switched

`DEFAULT_MCP_SERVERS = [{ id: "solana", name: "Solana Developer MCP", url:
"https://mcp.solana.com/mcp" }]`. The panel does not consume it: it already
asks the gateway for its server list, and `LOCAL_MCP_SERVERS` stays empty by
design. The export exists for `api/mcp.mjs` to replace its literal; that
switch is Alexander's. Explorer is env-driven with secrets and stays in the
gateway.

## Risks / Trade-offs

- [The gateway's literal and the registry drift until Alexander switches] →
  The PR names the switch; a server-side follow-up imports the export. Until
  then both say the same thing, checked by eye in review.
- [A JSDoc-typed `.mjs` loses some type precision at the browser door] →
  tool names widen to `string`, so an undeclared name fails in `bindTool` at
  load and in the parity test rather than in tsc; the schema typedef is checked
  structurally against `ToolSchema` where `bindTool` returns a
  `ToolDefinition`.
- [The server rail ignores the export] → The registry is still the panel's
  single source, so parity holds for every tool the browser sends to
  `/api/agent`, which today is every tool.

## Migration Plan

Pure refactor in the browser; ships in one PR into `scope/ai-rail`. Rollback
is a revert. No storage, no API, no flag.

## Open Questions

- Should the default agent ever execute tools server-side? (Slava; parked as
  an ask.) Does not change this change's specs or tasks: the registry's shape
  serves either answer.
