# Proposal

## Why

The assistant calls the tools of a connected MCP server as soon as the model asks, with the server's credentials
attached. Text injected into the assistant's context can therefore make it act on a server the user added, on the
user's behalf, without the user seeing it (row A7 of the security register,
[HOO-2877](https://linear.app/solana-fndn/issue/HOO-2877)). Writing a file, building and deploying already wait for
the user's approval; MCP tool calls are the one acting path that does not.

## What Changes

- A tool call on an MCP server the user added waits for the approval card that file writes, builds and deploys
  already use. The card asks "Call `<tool>` on `<server>`?", shows the tool's name, the arguments as JSON, and the
  host the call goes to.
- Allow runs the call as before; its result reaches the assistant. Deny answers the model with a refusal and sends
  nothing to the server.
- Calls on the servers the deployment itself offers through the gateway (today Solana Developer MCP and Solana
  Explorer MCP, documentation and read-only chain data, the operator's credentials) run without a card. Decided by
  Slava on 2026-11-16: a card on every documentation lookup would cost a click per grounding call, and the risk A7
  names is the user's own servers and credentials.
- Telemetry: `assistant_approval_answered` gains the `kind` value `tool` for an answered MCP card. No event is added,
  renamed or removed; the `mcp_*` events are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-mcp`: a tool call on a user-added server needs the user's approval; a declined call reaches no server;
  the answer is reported.

## Impact

- Code: the assistant's MCP tool adapter (`views/sidebar/assistant/model/mcp-tools.ts`), the approval request type
  in the assistant store, the approval card (`widgets/assistant/ui/BaseApprovalCard.tsx`), the telemetry catalogue.
- Saved chats gain a third approval card shape; a thread saved with one and opened by an older build shows the
  card's question with an empty command line.
- Out of scope: approval for the gateway's own servers; remembering an answer ("always allow this tool"); tutorial
  mode, where MCP tools are already off; any change to `/api/mcp` or other server code.
