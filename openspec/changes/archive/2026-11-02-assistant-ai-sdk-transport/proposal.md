# Proposal

## Why

The assistant talks to models through two hand-written loops
(`model/openai.ts`, `model/anthropic.ts`) and a hand-written MCP client
(`grounding/mcp-client.ts`), so every provider quirk, MCP protocol revision,
and auth scheme is ours to follow. The Vercel `ai` SDK maintains those. This
change moves model access into one module, `@/shared/lib/ai`, built on the
SDK, and makes the assistant its first consumer.

This change supersedes the verdict of `ai-sdk-transport-verdict` (#70,
HOO-1753), which kept our own loops, and replaces the scope of HOO-1754. The
verdict weighed the SDK against what the C rail needs (HOO-1751, HOO-1788)
and found it gave nothing there. This change weighs it against the cost of
maintaining two loops and an MCP client, which the verdict did not, and
answers the verdict's objections:

- Retries: `ai@7` `streamText` defaults to retries and to
  `stopWhen = isStepCount(1)`. The module sets `maxRetries: 0` and a step
  limit on every call, so a 429 from the cost gate (HOO-1751) is sent once.
- `pause_turn`: `@ai-sdk/anthropic@4.0.80` maps it to `stop` but keeps it in
  `finishReason.raw`, and `ai@7.0.141` exposes `rawFinishReason` on the
  result and on each step. The SDK's step loop continues only on our own tool
  calls, so the module resumes a paused turn itself, as `anthropic.ts` did.
- The MCP connector beta: `@ai-sdk/anthropic@4.0.80` sends connector requests
  on `mcp-client-2025-04-04` with no `mcp_toolset`. The change drops the
  `server` MCP executor instead, so every MCP server runs as a browser tool,
  directly or through the `/api/mcp` gateway, and the connector is not used.
- Bundle: #70 expected the SDK to add about 205 KB gzip to the boot path.
  This change loads the SDK through `loadAi()` on the first turn or the first
  MCP call, so the boot path does not carry it, and the boot path shrinks by
  57.5 kB gzip because `@anthropic-ai/sdk` leaves it. Total JS grows by
  201.2 kB gzip. [design.md](design.md), "Risks / Trade-offs", has the
  measurement.

## What Changes

- A module, `client-v2/src/shared/lib/ai/`, with one public path,
  `@/shared/lib/ai`: `redactKey`, `REDACTED_KEY`, the types
  `ToolDefinition`, `ToolSchema`, `ModelConnection`, and `loadAi()`, which
  loads `createModel`, `toSdkTools`, `runTurn`, `connectMcp`,
  `McpUnreachableError`, `McpTimeoutError`, and `AiTurnError`. It has no
  domain knowledge: callers inject behaviour through callbacks. Its step
  limit, resume limit, MCP timeout, and default backend route are private
  fallbacks; each caller passes its own values from its `config.ts`
  (`views/sidebar/assistant/config.ts`, `features/mcp/config.ts`). A
  `ToolDefinition` takes either a plain JSON Schema or a zod 4 schema, whose
  inferred type reaches `run`;
  the existing tools keep their JSON Schema.
- The assistant's two loops become one `model/provider.ts` that implements
  the existing `Provider { send(input, signal) }` on `runTurn`.
  Provider-specific behaviour (Anthropic thinking, effort, fallbacks, betas,
  `cache_control`) becomes per-provider data, not a second loop: one profile
  per model provider in `model/model-providers/`, registered by provider id.
- The browser MCP client moves from `views/sidebar/assistant/grounding/` to
  the feature slice `features/mcp`, with `index.ts` as its public API:
  `listGatewayServers`, `listTools`, `callTool`, `closeConnection`,
  `parseServers`, `serializeServers`, the server entry and tool types, and
  `LOCAL_MCP_SERVERS`. It calls `connectMcp` for the MCP protocol. A
  connection follows its server entry: changing the entry's URL or
  credentials, or removing it, closes the previous connection. Skills stay in
  the assistant.
- The `executor` field of an MCP server entry is removed. Every MCP server is
  called from the browser, directly or through the `/api/mcp` gateway; a host
  that refuses the browser is added as a gateway upstream in `api/mcp.mjs`,
  which is a deploy. On the default and OpenAI-compatible backends a `server`
  entry contributed no tools before this change (`createMcpTools` keeps only
  browser servers), so nothing is lost there. Only the Anthropic backend loses the
  connector path, and only for a custom server whose host refuses the
  browser. A configuration that still names `"executor"` keeps loading:
  `parseServers` ignores the field, as it ignores any key it does not know,
  and the server is called from the browser. The Sources tab's help text no
  longer lists the executor, its badge and its "no executor" notice are
  removed, and the Anthropic backend's description no longer mentions Anthropic's MCP
  connector.
- `@anthropic-ai/sdk` is removed. `ai`, `@ai-sdk/openai-compatible`,
  `@ai-sdk/anthropic`, `@ai-sdk/mcp`, and `zod` are added.
- `api/agent.mjs` is unchanged: chat-completions in, chat-completions out.
  The default backend keeps posting to `/api/agent` through a custom `fetch`.
- Telemetry: `features/mcp` adds `mcp_tools_listed`, `mcp_tools_list_failed`,
  `mcp_tool_called`, and `mcp_session_reopened` (prefix `mcp`, logger
  namespace `mcp:client`). The assistant panel stays in the legacy `views/`
  root and the module in `shared/`; neither adds, renames, or removes events.

## Capabilities

### New Capabilities

- `client-v2-ai`: the guarantees of `@/shared/lib/ai` to any caller: the step
  limit, the `pause_turn` resume and its cap, no retries, abort, errors
  raised as `AiTurnError`, an approval that holds the loop, the MCP reconnect
  and `McpUnreachableError`, the provider mapping, the default backend's
  route, and no key in error text.
- `client-v2-mcp`: the browser MCP client of `features/mcp`: connections that
  follow their server entry, and the events the slice reports.

### Modified Capabilities

None. No capability spec describes the assistant panel, so the removal of the
`server` executor is recorded here, under What Changes, and not as a delta.

## Impact

- Code: `client-v2/src/shared/lib/ai/` (added); `client-v2/src/features/mcp/`
  (the browser MCP client, moved from `grounding/` with its tests);
  `client-v2/src/views/sidebar/assistant/`: `model/provider.ts` (added),
  `model/index.ts`, `model/types.ts`, `model/mcp-tools.ts`,
  `model/remembered-backend.ts`, `Component/Connect.tsx`, `store.ts`,
  `grounding/index.ts`, `grounding/types.ts`, `grounding/registry.ts`,
  `Component/Grounding.tsx`, `Component/ServerConsole.tsx`; moved to
  `features/mcp`: `grounding/mcp-client.ts` and `grounding/config.ts`, with
  their tests; deleted: `model/openai.ts`,
  `model/anthropic.ts`, `model/redact-key.ts`, and their tests, ported to
  `model/provider.test.ts`. Docs: `docs/assistant-context.md`, copied with
  `yarn sync-assistant-context`.
- Dependencies: `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic`,
  `@ai-sdk/mcp`, and `zod` added; `@anthropic-ai/sdk` removed. The SDK sits
  in chunks of its own that only `loadAi()` requests (257.3 kB gzip, plus a
  2.6 kB runtime chunk); the boot path falls from 1,907.6 kB to 1,850.2 kB
  gzip. [design.md](design.md), "Risks / Trade-offs", has the per-file
  figures.
- Users: the first turn and the first MCP call of a session download the SDK
  chunks; every page load downloads less JavaScript than before this change.
  Chat, tools, approvals, Stop, stored threads, and the default backend
  behave as before, including the default backend's sign-in gate
  (`default-backend-sign-in`). A server configured with the `server`
  executor is called from the browser instead of by Anthropic, and its tools
  are absent when its host refuses the browser.
- Depends on: branch `feat/assistant-sources-on-by-default`, for the
  `/api/mcp` gateway always listing Explorer; this change is rebased onto it
  before task 2.1.
- Out of scope:
  - `useChat` and the SDK's UI message types. The store, the approval cards,
    and the stored thread format stay ours.
  - Moving the agent loop to the server.
  - Usage reporting and the cost gate (HOO-1751), and the session token
    (HOO-1788). `api/agent.mjs` does not add `stream_options`.
  - Other consumers of the module. Explain on a build error already goes
    through `PgAssistant.requestPrompt`.
