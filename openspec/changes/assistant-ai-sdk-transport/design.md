# Design

## Context

See proposal.md, "Why". Before this change, `model/index.ts`
`createProvider` picked one of two loops: `createOpenAiProvider`
(`model/openai.ts`, a hand-written chat-completions loop that also drove the
default backend through `DEFAULT_BACKEND_URL`, `/api/agent`) and
`createAnthropicProvider` (`model/anthropic.ts`, the `@anthropic-ai/sdk` Tool
Runner, which resumed `pause_turn` itself and declared `server`-executor MCP
servers to Anthropic's connector on `mcp-client-2025-11-20`). Each loop had
its own `MAX_ITERATIONS`. Both shared the tool registry (`createTools` in
`model/tools.ts`), the approval gate inside each tool's `run`, and the store
calls on `PgAssistant`. `grounding/mcp-client.ts` spoke MCP Streamable HTTP
by hand for every `browser`-executor server and for the `/api/mcp` gateway.

`api/agent.mjs` forwards only `messages`, `tools`, and `tool_choice` from the
client (`FORWARDED`) and sets the model and streaming itself.

#70 (`ai-sdk-transport-verdict`) built the OpenAI-compatible loop on
`streamText` from `ai@7.0.138` and found: the SDK builds under CRA 5,
`tool({ inputSchema: jsonSchema(schema), execute: run })` carries the registry
unchanged, a `run` that awaits the approval holds the SDK's loop, the stored
thread is unchanged, Gemini's `extra_content` and index-less tool deltas pass,
and the default `maxRetries: 2` sends a 429 three times.

## Goals / Non-Goals

**Goals:**

- One module through which any part of `client-v2` talks to a model, with no
  domain knowledge.
- The assistant on that module with no change a user sees, apart from the
  `server` executor (proposal.md, "What Changes").
- The guarantees in `specs/client-v2-ai/spec.md`, each held by a unit test.

**Non-Goals:**

- `useChat`, UI messages, and the SDK's `needsApproval`.
- Any change to `api/agent.mjs`.
- A second consumer of the module.

## Module design: `client-v2/src/shared/lib/ai/`

Nothing here imports `PgAssistant`, playground tools, prompts, or the store.
Callers inject behaviour through callbacks. The module follows the
`shared/lib/logger` conventions: `index.ts` is the public API with types
exported separately, files are kebab-case, tests are co-located `*.test.ts`,
and each file logs through `createLogger("ai:<module>")`.

| File | Public API | Responsibility |
| --- | --- | --- |
| `types.ts` | `ToolDefinition`, `ToolSchema`, `ModelConnection` | Vendor-neutral tool shape, moved from `assistant/model/types.ts`. A `ToolDefinition`'s schema is either a plain JSON Schema (`ToolSchema`) or a zod 4 schema; with a zod schema, `run(input)` gets the inferred type. `ModelConnection` is a union discriminated by `provider`: the default backend takes no key and an optional model, Anthropic takes a key and a model, and an OpenAI-compatible provider takes a base URL, a model, and an optional key; each takes an optional `fetch`. |
| `models.ts` | `createModel(connection): LanguageModel` | Maps a connection to an SDK model: `@ai-sdk/openai-compatible` for OpenAI-compatible providers, `@ai-sdk/anthropic` for Anthropic (with the browser-access header). A custom `fetch` lets the default backend keep posting to `/api/agent`. |
| `default-backend.ts` | `DEFAULT_BACKEND_URL` | The default backend's route, in a file of its own so a static import of it does not bring `models.ts` and the SDK into the boot chunk (see "Decision: the SDK loads on first use"). |
| `tools.ts` | `toSdkTools(defs): ToolSet` | `tool({ inputSchema, execute: run })` per definition: a JSON Schema goes through `jsonSchema(schema)`, a zod schema is passed as is. An `execute` that awaits an approval holds the step loop. |
| `run-turn.ts` | `runTurn(options): Promise<TurnResult>`, `AiTurnError` | Wraps `streamText` with `maxRetries: 0`, `stopWhen: isStepCount(maxSteps)`, the abort `signal`, and the `pause_turn` resume up to `maxResumes`. Takes `instructions` (the system messages, with their provider options), `providerOptions`, `maxOutputTokens` (without it `@ai-sdk/anthropic` caps a model it does not know at 4096), and `apiKey`, which is redacted from every error. Streams text, reasoning, and tool events to callbacks (`onText`, `onReasoning`, `onToolCall`). Turns a refusal or an in-stream error into a thrown `AiTurnError`. Returns the updated `ModelMessage[]` history and `reachedStepLimit`, true when the model still wanted tools at the step limit. |
| `mcp.ts` | `connectMcp(server)`, `McpUnreachableError` | `@ai-sdk/mcp` over HTTP with headers, our reconnect after a stale session, and CORS failures raised as `McpUnreachableError`. Returns `{ listTools, callTool, close }` so callers map results to `ToolDefinition`. |
| `redact.ts` | `redactKey`, `REDACTED_KEY` | Moved from `assistant/model/redact-key.ts`, with `MIN_REDACTED_KEY_LENGTH`; error text never carries the caller's key. |
| `fake-provider.ts` | none (test-only) | Fakes of the chat-completions and Anthropic Messages streams and a recording `fetch`, for the module's tests and its callers' tests. Not exported from `index.ts`. |
| `runtime.ts` | none (internal) | Re-exports the SDK-backed values: `createModel`, `runTurn`, `AiTurnError`, `DEFAULT_MAX_STEPS`, `DEFAULT_MAX_RESUMES`, `toSdkTools`, `connectMcp`, `McpUnreachableError`. Reached only through `loadAi`. |
| `index.ts` | `loadAi()`, `redactKey`, `REDACTED_KEY`, `MIN_REDACTED_KEY_LENGTH`, `DEFAULT_BACKEND_URL`, every type above | The only import path: `@/shared/lib/ai`. `loadAi()` resolves to the `runtime.ts` exports. |

The default backend's base URL is resolved against `location`: the SDK parses
it with `new URL`, which rejects a relative URL.

`AiTurnError` carries `status`, the HTTP status when the provider answered
with one, `body`, that response's body with the key redacted, and `kind`:
`provider`, `refusal`, or `paused`. `body` lets a caller read fields its own
backend puts in a refusal without the module knowing them. Its messages are
neutral, with no advice to the user; a caller adds its own wording by
`kind`, as the assistant does for a refusal. When a failed response's body
does not match the provider's error object, so the SDK's message is only the
status text, the message is `<status> <statusText> — <body>` with the body
redacted and cut to 300 characters, as in the old loops: a backend that
answers `{ error: "<sentence>" }`, as `/api/agent` does, still shows its
sentence.

A paused step does not count against `maxSteps`: the resume continues that
step, and resumes have their own limit.

Constants the module owns: `DEFAULT_MAX_STEPS`, which replaces the two
`MAX_ITERATIONS`, and `DEFAULT_MAX_RESUMES`, which replaces `MAX_RESUMES` in
`model/anthropic.ts`.

## The assistant on the module (`client-v2/src/views/sidebar/assistant/`)

- `model/openai.ts` and `model/anthropic.ts` become one `model/provider.ts`
  implementing the existing `Provider { send(input, signal) }`. It builds the
  model with `createModel`, the system messages with `systemPrompt()` and
  `describeProject()`, the tools with `toSdkTools(createTools())` on every
  turn (so MCP tools discovered since the last turn are offered), and calls
  `runTurn` with the connection's key, wiring the callbacks to `PgAssistant`
  (`startAssistantMessage`, `appendToAssistantMessage`). `addToolCall` stays
  inside the tools' own `run`.
- One reply bubble per model request: it opens on the first non-empty delta
  and closes at a tool call, so text that follows a tool lands below that
  tool's items, and no bubble is ever empty, which is what `discardIfEmpty`
  achieved in the old loops. A change between reasoning and text inside a
  bubble starts a new paragraph (`"\n\n"`).
- Provider-specific behaviour is data, not a second loop: per-provider
  `providerOptions` (Anthropic adaptive thinking with `display: "updates"` and
  `drop_block`, `effort`, `fallbacks`, `cache_control` on the first system
  message, `maxOutputTokens: 64000`) and whether reasoning reaches the bubble
  (Anthropic only, as before). `@ai-sdk/anthropic` adds the thinking and
  fallback betas itself from those options.
- History is `ModelMessage[]`, seeded from `toReplayMessages`, which does not
  change. A turn that fails leaves the history as it was, as
  `model/anthropic.ts` did, so a refused prompt is not re-sent with every
  later turn.
- The assistant's wording, on top of the module's neutral errors: a refusal
  ends with "Rephrase it, or switch backends."; a turn that reaches the step
  limit says the model was still calling tools after `DEFAULT_MAX_STEPS`
  rounds; a turn with no text and no tool call adds "returned an empty
  response" on every backend. A 401 from the default backend whose `body`
  has `reason: SIGNED_OUT_REASON` (`default-backend-sign-in`) is shown as
  that body's `error` sentence and calls `PgSession.refresh()`, so the
  store's session listener returns the panel to the picker; the check lives
  in `model/provider.ts`, not in the module.
- `grounding/mcp-client.ts` keeps `listGatewayServers` and calls `connectMcp`,
  one connection per server entry as it reaches the wire (id, URL with
  `queryParams`, headers with `authToken`). It adds to `McpUnreachableError`
  that a host refusing the browser is reached through the `/api/mcp`
  gateway. `model/mcp-tools.ts` maps its tools.
- The `server` executor goes: `executor` in `grounding/types.ts`, its
  validation in `grounding/config.ts`, `SERVER_EXECUTORS` and its text in
  `Component/Grounding.tsx`, the executor badge and notice in
  `Component/ServerConsole.tsx`, the `executor === "browser"` filters in
  `store.ts` and `model/mcp-tools.ts`, and the connector code in
  `model/anthropic.ts`.
- `@anthropic-ai/sdk` is removed.
- `api/agent.mjs` stays chat-completions in, chat-completions out.
  `stream_options` is not added to `FORWARDED`: usage reporting is HOO-1751's.
- Every value the assistant takes from the module at boot (`redactKey`,
  `DEFAULT_BACKEND_URL`) is a static import of `@/shared/lib/ai`; everything
  that needs the SDK comes from `loadAi()` on the first turn or the first MCP
  call.

## Decisions

### Decision: adopt the `ai` SDK, superseding #70

The SDK maintains the provider wire formats, the MCP client, and auth, which
our two loops and `mcp-client.ts` maintain by hand. #70's objections are
answered in the module, not by keeping the loops: `runTurn` sets
`maxRetries: 0` and the step limit on every call, and resumes `pause_turn`
from `rawFinishReason`. The connector objection goes with the `server`
executor.

Alternatives:

- **Keep our own loops** (the #70 verdict). Rejected: every provider quirk, MCP
  revision, and auth scheme stays ours, in two loops and a third protocol
  client.
- **The SDK on the OpenAI-compatible path only, `anthropic.ts` kept** (what
  #70 probed). Rejected: it pays the bundle cost and still leaves two
  transport styles and the hand-written MCP client.
- **The full SDK: `useChat`, UI messages, `needsApproval`.** Rejected: it
  replaces the store, the approval cards, and the stored thread format
  (HOO-1737) with the SDK's own.

### Decision: typed tool schemas use zod 4

`ToolDefinition` accepts either a plain JSON Schema (`ToolSchema`, which the
existing tools use) or a zod 4 schema, and with a zod schema `run(input)`
gets the inferred type. `toSdkTools` passes a JSON Schema through
`jsonSchema()` and a zod schema as is. The existing tools keep their JSON
Schema; this change rewrites no tool.

zod ships whatever we choose. Checked on 2026-10-15: `ai@7.0.141`,
`@ai-sdk/provider-utils@5.0.60`, and `@ai-sdk/mcp` declare
`zod: ^3.25.76 || ^4.1.8` as a required peer, and `@ai-sdk/anthropic@4.0.80`
imports zod in its own sources to validate responses and options. zod 4
produces both the JSON Schema the model needs (`z.toJSONSchema`) and the
TypeScript type from one definition.

Alternatives:

- **superstruct.** Rejected: it is in `yarn.lock` through the Solana
  libraries, but it is a second validator beside zod and has no JSON Schema
  output without a converter.
- **io-ts.** Rejected: it adds io-ts and fp-ts, has no JSON Schema output,
  and has no SDK support.
- **Plain JSON Schema only.** Kept as an accepted input, but rejected as the
  only one: the input types are written by hand.

### Decision: one `runTurn`, the only caller of `streamText`

`ai@7` `streamText` defaults to `stopWhen = isStepCount(1)` and to retries.
Both defaults are wrong for every caller here, so no caller reaches
`streamText` directly: `runTurn` sets both, and the step-limit and 429 tests
fail if either is lost.

### Decision: the `pause_turn` resume is ours

`@ai-sdk/anthropic@4.0.80` maps `pause_turn` to `stop` and keeps it in
`finishReason.raw`; `ai@7.0.141` exposes `rawFinishReason` on the result and
on each step. The step loop continues only after our own tool calls, so
`runTurn` checks `rawFinishReason`, appends the paused content to the history
and calls `streamText` again, up to `maxResumes`. Past the limit it throws
`AiTurnError`, as `model/anthropic.ts` did past `MAX_RESUMES`.

### Decision: drop the `server` executor

`@ai-sdk/anthropic@4.0.80` sends connector requests on
`mcp-client-2025-04-04` with no `mcp_toolset`, where `model/anthropic.ts`
used `mcp-client-2025-11-20` with toolsets. Every MCP server runs as a
browser tool, directly or through the `/api/mcp` gateway, which serves the
hosts that refuse the browser. The `McpUnreachableError` text stops
suggesting a server-side executor and points at the gateway.

The gateway exists because some hosts refuse the browser. Checked on
2026-10-15 with curl and `Origin: https://beta.solpg.io`:
`mcp.solana.com/mcp` answers the CORS preflight with 405 and no
`access-control-*` headers, and answers `POST initialize` with 200 and no
`access-control-allow-origin`, so a browser cannot call it and a server can.
`explorer.solana.com/mcp` sends `access-control-allow-origin: *`.

Explorer goes through the gateway for another reason: to keep one server
list and to keep the optional `MCP_EXPLORER_TOKEN` off the client.

The Anthropic backend keeps the Solana and Explorer MCP servers, as browser
tools through the gateway, exactly like the default backend.
This depends on branch `feat/assistant-sources-on-by-default`, where
`upstreams()` in `api/mcp.mjs` always lists `explorer`.

`connectMcp` reopens a session on its own: `@ai-sdk/mcp` does not. It treats
an HTTP 404 on a request that carried `mcp-session-id` as an expired
session, because a 404 whose body is a JSON-RPC error for the request
bypasses the transport's own expiry hook. It sets
`protocolVersionDiscovery: false`: the servers it reaches speak the
session-based protocol, and the probe costs a round trip per session.

Alternative: keep the connector through `providerOptions` on the older beta.
Rejected: a second MCP path for one provider, on a beta Anthropic has
replaced.

Reopen when `@ai-sdk/anthropic` supports the connector beta that
`model/anthropic.ts` used (`mcp-client-2025-11-20` with `mcp_toolset`). The
connector can then return through `providerOptions.anthropic.mcpServers`, if
saving the browser's round trip per MCP call matters. It brings `pause_turn`
back with it.

### Decision: the SDK loads on first use

The assistant panel loads on boot, and #70 measured `ai` plus one provider
at +205 KB gzip there; importing all five packages from the boot path raised
`main` from 122.53 kB to 451.95 kB gzip. Nothing needs the SDK before the
first turn or the first MCP call, so `@/shared/lib/ai` exports it only
through `loadAi()`, a dynamic `import()` of `runtime.ts`, and the bundler
puts it in a chunk of its own. The light values a caller needs at once
(`redactKey`, which `PgAssistant.addError` runs synchronously, and
`DEFAULT_BACKEND_URL`) and every type stay static exports of the same path,
so there is still one public path.

`index.ts` cannot both re-export `runtime.ts`'s modules statically and keep
them out of the boot chunk. Checked with `craco build` on 2026-10-15: with
static re-exports, a static import of `redactKey` kept the barrel and every
module it re-exports in the assistant's chunk, and the dynamic `import()` of
the same barrel split nothing off. For the same reason `DEFAULT_BACKEND_URL`
lives in `default-backend.ts`, not in `models.ts`.

Alternatives:

- **Deep imports of `redact.ts` and `default-backend.ts`.** Rejected: a
  second import path into the module.
- **`"sideEffects": false` for the module's folder**, so the bundler drops
  unused re-exports. Rejected: it needs a nested `package.json` or an
  app-wide flag, and keeps the split dependent on the bundler's analysis.

Cost: the first turn and the first MCP call wait for one more chunk.

### Decision: the default backend keeps `/api/agent` through `fetch`

`@ai-sdk/openai-compatible` appends `/chat/completions` to its base URL, and
`/api/agent` is a full path. `createModel` gives the default backend a custom
`fetch` that sends every request to `DEFAULT_BACKEND_URL` with no key.
`api/agent.mjs` ignores every field outside `FORWARDED`, so the `model` and
`stream` fields the SDK adds do not reach the upstream as the client wrote
them.

Alternative: a second route that speaks the SDK's protocol. Rejected: it moves
the transport to the server, which is out of scope.

### Decision: scenarios are held by unit tests and marked `(manual)`

`spec:coverage` counts a scenario as covered only by a Playwright test titled
`client-v2-ai: <scenario>` or by a `(manual)` mark. The guarantees are
unit-level: they need a fake model or `fetch`, which the browser suite cannot
inject. Every scenario is marked `(manual)`, as `feedback-widget` does for
scenarios held by interaction tests, and this table names the test that holds
each one. The assistant's own behaviour stays covered by the browser specs in
task 3.1.

| Scenario | Test file |
| --- | --- |
| A model that keeps calling tools | `shared/lib/ai/run-turn.test.ts` |
| A paused turn is resumed | `shared/lib/ai/run-turn.test.ts` |
| A turn that keeps pausing | `shared/lib/ai/run-turn.test.ts` |
| A 429 from the provider | `shared/lib/ai/run-turn.test.ts` |
| Abort mid-stream | `shared/lib/ai/run-turn.test.ts` |
| An error frame mid-stream | `shared/lib/ai/run-turn.test.ts` |
| A refusal | `shared/lib/ai/run-turn.test.ts` |
| A tool waiting for approval | `shared/lib/ai/tools.test.ts` |
| A tool with a zod schema | `shared/lib/ai/tools.test.ts` |
| A stale MCP session | `shared/lib/ai/mcp.test.ts` |
| A host that refuses the browser | `shared/lib/ai/mcp.test.ts` |
| Each provider's endpoint and auth header | `shared/lib/ai/models.test.ts` (`it.each`) |
| A turn on the default backend | `shared/lib/ai/models.test.ts` |
| A provider error that quotes the key | `shared/lib/ai/redact.test.ts` |

## Risks / Trade-offs

- [Bundle: the SDK, imported from the assistant, would load on boot] → the
  SDK loads on first use ("Decision: the SDK loads on first use"). Measured
  on 2026-10-15 with `craco build` and per-file `gzip -9`, f77a3b43 against
  this change's implementation: the boot path (`main` and the chunks it
  requests at start-up) falls from 1,907.6 kB to 1,850.2 kB gzip (-57.5 kB),
  because `@anthropic-ai/sdk` leaves the vendor chunk that loads on boot; the
  chunk holding the assistant falls from 216.2 kB to 213.6 kB. The SDK sits in
  two chunks only `loadAi()` requests: `ai`, `@ai-sdk/*` and `zod` at
  257.3 kB, and the module's runtime at 2.6 kB. Total JS grows by 201.2 kB
  gzip, from 6,383.5 kB to 6,584.7 kB.
- [A static value export added to `index.ts` from a module that imports the
  SDK brings the SDK back into the boot path, with no error] → task 5.1
  searches the built chunks for the SDK.
- [The `pause_turn` resume depends on `rawFinishReason` carrying the
  provider's raw value] → the versions are pinned in `package.json`, and the
  resume tests fail on an upgrade that drops it.
- [A caller that reaches `streamText` without `runTurn` gets one step and two
  retries] → `runTurn` is the only caller; the step-limit and 429 tests guard
  its settings.
- [Dropping the `server` executor stops Anthropic from calling a server the
  browser cannot reach] → `parseServers` ignores the field, so the
  configuration still loads; the server is called from the browser, and the
  Sources tab explains a CORS refusal. A host that refuses the browser is
  added as a gateway upstream in `api/mcp.mjs`, which is a deploy.
- [TypeScript is pinned at 5.0.4; #70 found SDK types that use `NoInfer`
  (TS 5.4) degrade to `any` under `skipLibCheck`] → `yarn test-types` passes
  per #70; the module's own signatures are typed explicitly, not inferred
  from SDK generics.

## Migration Plan

Each task lands as one PR, in the order of `tasks.md`. Until task 4.1, the
old loops stay in the tree, unused after task 3.1, so reverting 3.2 and 3.1
restores the old transport and the `server` executor. Task 3.2 leaves
`model/anthropic.ts` compiling by declaring no connector server, since
`McpServerEntry` has no `executor` to select one by. Task 4.1 deletes the
old loops, `model/redact-key.ts`, the re-exports of the moved types, and
`@anthropic-ai/sdk`, so restoring the old transport after it means reverting
4.1 first. No stored data
changes: threads keep their format, and `parseServers` accepts a
configuration that still names `executor`.

## Open Questions

- When the `(manual)` marks on the `client-v2-ai` scenarios can go. A
  follow-up ticket (to file) teaches `scripts/spec-coverage.mjs` to accept
  vitest test titles, so the marks can be replaced by the tests in the
  scenario table.
- Whether `pause_turn` still occurs once no MCP server runs on Anthropic's
  side. It was observed after long connector rounds; whether other causes
  remain is unverified. The resume costs little to keep; task 5.2's
  walk-through records whether any turn paused.
