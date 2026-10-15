# Tasks

Every task is HOO-1754, whose scope this change replaces, except 6.1, which
closes HOO-1753. One task per PR, in this order. 2.2 and 2.3 may run at the
same time, and so may 5.1 and 5.2; every other task depends on the one
before it as stated.

## 1. Dependencies

- [x] 1.1 Add `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic`,
      `@ai-sdk/mcp` and `zod` as direct dependencies of `client-v2`, pinned to
      the versions the design names or later patch releases; verify
      `craco build` and `yarn test-types` pass with each package imported once
      from a throwaway file (not committed), and a browser request through
      `@ai-sdk/anthropic` is not refused for CORS. May share its PR with 2.1

## 2. The shared module `@/shared/lib/ai`

- [x] 2.1 `types.ts` (`ToolDefinition` and `ToolSchema` moved from
      `assistant/model/types.ts`, `ModelConnection`), `redact.ts` (moved from
      `assistant/model/redact-key.ts`), `models.ts` (`createModel`) and
      `index.ts`; the assistant imports the moved symbols from
      `@/shared/lib/ai` (depends on 1.1); verify `models.test.ts` (one
      `it.each` row per provider id: endpoint and auth header; the default
      backend's requests go to `/api/agent` with no key) and `redact.test.ts`
      pass, and each fails against a wrong mapping it names
- [x] 2.2 `tools.ts` (`toSdkTools`) and `run-turn.ts` (`runTurn`,
      `AiTurnError`, `DEFAULT_MAX_STEPS`, `DEFAULT_MAX_RESUMES`) (depends on
      2.1); verify `run-turn.test.ts` and `tools.test.ts` hold the step limit,
      the `pause_turn` resume and its limit, one request on a 429, abort with
      no further request, `AiTurnError` on an in-stream error frame cut
      mid-chunk and on a refusal, an `execute` awaiting approval holding
      the next request, and a zod tool schema reaching the request as JSON
      Schema; each test fails for a wrong implementation the others
      miss
- [x] 2.3 `mcp.ts` (`connectMcp`, `McpUnreachableError`) on `@ai-sdk/mcp`
      over HTTP with headers (depends on 2.1; may run beside 2.2); verify
      `mcp.test.ts` holds the reconnect after a stale session and
      `McpUnreachableError` on a `fetch` `TypeError`

## 3. The assistant on the module

- [x] 3.1 `model/provider.ts` implements `Provider` on `runTurn` for every
      provider id, with per-provider `providerOptions` as data;
      `createProvider` in `model/index.ts` returns it (depends on 2.2). Port
      the cases of `model/openai.test.ts` and `model/anthropic.test.ts` that
      still apply (Gemini `extra_content` echo, index-less tool deltas,
      thinking paragraphs, refusal category, request params, the default
      backend's signed-out refusal) to `model/provider.test.ts` against a
      fake model or `fetch`; verify `yarn test-unit`, `yarn test-api`, and
      the e2e specs `assistant-reconnect`, `assistant-sign-in`,
      `chat-threads`, `fix-with-assistant` and `thread-restore` pass. A `server`-executor server gets no tools from
      this task until 3.2 lands
- [x] 3.2 `grounding/mcp-client.ts` keeps `listGatewayServers` and calls
      `connectMcp`; `model/mcp-tools.ts` maps its tools. Remove the `server`
      executor: `executor` and `McpExecutor` in `grounding/types.ts`, its
      validation in `grounding/config.ts`, `SERVER_EXECUTORS` and its text in
      `Component/Grounding.tsx`, the executor badge and notice in
      `Component/ServerConsole.tsx`, the executor filters in `store.ts` and
      `model/mcp-tools.ts`, the connector mention in the Anthropic entry of
      `PROVIDERS`; the `McpUnreachableError` text points at the `/api/mcp`
      gateway (depends on 2.3 and 3.1); verify a `config.ts` test that a
      configuration naming `"executor": "server"` loads and yields a browser
      server, and the e2e specs of 3.1 pass

## 4. Remove the old transport

- [x] 4.1 Delete `model/openai.ts`, `model/anthropic.ts`, their tests,
      `model/redact-key.ts`, the hand-written protocol part of
      `grounding/mcp-client.ts`, and `@anthropic-ai/sdk`; update
      `docs/assistant-context.md` (transport, MCP servers, no `server`
      executor) and run `yarn sync-assistant-context` (depends on 3.1 and
      3.2); verify `yarn run check` passes and a search of `client-v2/src`
      and `docs/` finds no `createOpenAiProvider`, `createAnthropicProvider`,
      `@anthropic-ai/sdk`, `SERVER_EXECUTORS`, `McpExecutor` or
      `MAX_ITERATIONS`

## 5. Measure and walk through

- [x] 5.1 Two production builds, at the commit before 1.1 and after 4.1;
      record per-file gzip sizes and the boot chunk's delta in `design.md`,
      "Risks / Trade-offs" (depends on 4.1); verify the figures replace the
      #70 estimate there, and a search of the built chunks finds the SDK only
      in the chunks `loadAi()` requests
- [ ] 5.2 Walk through the default backend signed in, an Anthropic key, and an OpenAI
      or Gemini key; on each, a tool turn with an approval, an MCP call to an
      `explorer__*` tool, Stop mid-turn, and a reload that restores the
      thread; record the results, and whether any turn paused, in
      `design.md` (depends on 4.1; may run beside 5.1); verify every
      combination has a recorded result

## 6. Close the verdict

- [ ] 6.1 Draft, for a human to post: the PR description from the repository
      template, saved untracked as `.github/assistant-ai-sdk.pr.md`, and a
      review comment on #70, saved untracked in `.github/`, that says this
      change supersedes the verdict and why (HOO-1753; depends on 5.1 and 5.2); verify both files exist and the
      comment names this change
