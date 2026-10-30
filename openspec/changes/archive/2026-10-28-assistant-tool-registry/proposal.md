# Proposal

## Why

The assistant's tools, skills and MCP defaults are assembled ad hoc inside the
panel (`views/sidebar/assistant/model/tools.ts`, `skill-tools.ts`,
`grounding/registry.ts`), and the gateway restates the Solana MCP upstream in
`api/mcp.mjs`. Nothing makes the default agent and a user on their own key
offer the same set: the first time either side gains a tool, they drift
(HOO-1749).

## What Changes

- A new entity slice `entities/agent-tools` holds the one list of what the assistant
  offers, as data: every built-in tool's name, description, argument schema
  and whether it needs the user's approval; the skill catalogue (id, name,
  description, where its files come from); and the default MCP upstreams.
- The slice has two doors: `index.ts` for the browser and `server.mjs` for
  server code under `api/`, so the server rail can import the same list
  without a build step.
- The panel stops declaring tools itself. It binds a runner to each declared
  name, and a test fails when the panel and the registry disagree on the set
  of names, or when a tool declared as needing approval runs without asking.
- The skill picker, the prompt's skill catalogue and the skill tools read the
  registry's catalogue. The bundled skill's text stays a browser asset, bound
  to its catalogue entry by id.
- No telemetry events are added, renamed or removed: the slice is an entity
  (data, no user action) and sends none, and the panel's tool calls log as
  they do today.
- User-visible consequence: none today. Tool names, descriptions, approval
  cards and skills read exactly as before. What changes is that parity
  between the two backends is enforced by a test instead of promised.

## Capabilities

### New Capabilities

- `assistant-tool-registry`: the single declared set of tools, skills and MCP
  defaults the assistant offers, shared by the panel and the server rail, and
  the checks that keep the panel to it.

### Modified Capabilities

None.

## Impact

- Code: new `client-v2/src/entities/agent-tools/`; `test-api` also runs
  `src/entities/**/model/**/*.test.mjs`; edits to
  `views/sidebar/assistant/model/tools.ts`, `model/skill-tools.ts`,
  `grounding/registry.ts` and their tests.
- Builds on `@/shared/lib/ai` (`ToolDefinition`, `ToolSchema`, `toSdkTools`)
  from the ai SDK transport (#47, HOO-1754); no change to it.
- Out of scope:
  - `client-v2/api/` (Alexander's lane). `api/agent.mjs` keeps forwarding the
    tools the browser sends; `api/mcp.mjs` keeps its own Solana literal. Both
    can import `entities/agent-tools/server.mjs`; switching them is a server
    change, named in the PR for its owner.
  - Running tools on the server. Every tool still runs in the browser behind
    the same approval card, whichever backend drives the turn. Whether the
    default agent should ever execute tools server-side is an open product
    question for Slava, not decided here.
  - MCP-discovered tools stay dynamic (`model/mcp-tools.ts`): they are listed
    by each server at runtime and cannot be declared ahead of time.
  - No UI change, no new dependency, no storage change.
