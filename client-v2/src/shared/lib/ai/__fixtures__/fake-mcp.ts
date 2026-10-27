// Test-only answers for fake MCP servers; nothing outside tests imports this

/** The `initialize` result of a fake server that offers tools, echoing the client's protocol version */
export const initializeResult = (params: { protocolVersion: string }) => ({
  protocolVersion: params.protocolVersion,
  capabilities: { tools: {} },
  serverInfo: { name: "fake", version: "1" },
});
