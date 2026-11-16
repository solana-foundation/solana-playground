# Plan: 1 MCP tool approval

Goal: tasks 1.1-1.4 of [tasks.md](https://github.com/hoodieshq/solana-playground/blob/213529bb47f646629e701a350b5a9562cd98be35/openspec/changes/mcp-tool-approval/tasks.md) in one PR, test first.

1. `mcp-tools.test.ts`: failing tests for a user-added server (card asked with `type: "tool"`, server, tool, host,
   arguments; Deny returns a refusal and `callTool` is never called; a cut turn sends nothing; Allow runs and records
   the outcome on the card) and for a gateway server (no card, call sent). Existing tests answer the card with Allow.
2. Store: `ToolApproval` in `ApprovalRequest`; `PgAssistant.isGatewayMcpServer(id)`.
3. Adapter: ask before `addToolCall`/`callTool` when the server is not the gateway's; outcome via
   `setApprovalOutcome` / `setApprovalFailure`.
4. `BaseApprovalCard`: draw `tool` (question title, the tool's name without `$`, JSON arguments, effect naming the host); a test.
5. Telemetry: `assistant_approval_answered.kind` gains `"tool"`.
6. Verify: `yarn run check`; screenshots of the card (before: the call ran with no card; after: the card) via
   Playwright with a fake MCP server.
