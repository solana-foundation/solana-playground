## 1. MCP tool approval ([plan](plans/1-mcp-tool-approval.md))

- [x] 1.1 Add the `tool` approval request shape and gate user-added MCP servers' calls on it in the MCP adapter (refusal on deny, nothing sent)
- [x] 1.2 Draw the `tool` request on the approval card: question, the tool's name, JSON arguments, host
- [x] 1.3 Report `assistant_approval_answered` with `kind: "tool"`
- [x] 1.4 Unit tests: approved call runs, declined, cut and changed-entry calls send nothing, gateway server unattended, card renders
