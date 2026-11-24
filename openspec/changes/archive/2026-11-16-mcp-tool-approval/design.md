# Design

## Context

Acting tools in `views/sidebar/assistant/model/tools.ts` call `PgAssistant.requestApproval`, which adds an approval
item to the thread and holds the agent loop until `resolveApproval`. The card (`BaseApprovalCard`) draws two request
shapes: `patch` and `command` (`build` | `deploy`). MCP tools are built in `mcp-tools.ts` from
`PgAssistant.enabledMcpServers`, which joins the gateway's servers (`gatewayMcpServers`) and the user's own
(`localMcpServers`; a local entry whose id the gateway serves is left out).

## Goals / Non-Goals

**Goals:** one gate, in the MCP adapter, so every provider's loop gets it; reuse the existing card and its states.

**Non-Goals:** per-tool "always allow"; approval for gateway servers; changes to the MCP client or the gateway.

## Decisions

- **A third request shape, `tool`**, rather than widening `command.name` to any string. `command` is matched on its
  name in the card, the codec tests and telemetry; a separate shape carries `server`, `tool`, `host` and the
  arguments as pretty-printed JSON without loosening those. The card's command body is reused: the tool's name (no `$`:
  an MCP call is not a terminal command), then the arguments, then the effect line.
- **Gate by origin, not by name.** A server needs approval when its id is not one the gateway serves at call time.
  Reading it at call time, like the entry itself, means a server the gateway starts or stops offering mid-turn is
  judged as it is now.
- **The gate sits before `addToolCall` and `callTool`.** A declined or cut call returns a refusal string to the model
  and never builds a request, so "nothing reaches the server" holds by construction; the outcome is recorded on the
  card with `setApprovalOutcome` / `setApprovalFailure`, as build and deploy do.
- **Arguments shown in full**, in the card's scrolling body. Truncating what the user approves would let the hidden
  part carry the payload.

## Risks / Trade-offs

- [A gateway server could one day offer a tool that acts] → the gateway is configured by the operator
  (`SOURCES`); adding an acting server there is a deployment decision, and the spec names the rule so it is visible.
- [Concurrent tool calls in one turn] → each call asks its own card and gets its own id, as build and deploy do.
- [An older build opening a saved `tool` card] → it shows the question with an empty command line; nothing breaks.

## Migration Plan

None: no stored data changes shape for existing cards.
