// Test-only JSON-RPC envelopes for fake MCP servers; nothing outside tests imports this

type RpcId = string | number;

/** A JSON-RPC success answer */
export const rpcResult = (id: RpcId, result: unknown) => ({
  jsonrpc: "2.0",
  id,
  result,
});

/** A JSON-RPC error answer */
export const rpcError = (id: RpcId, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** The `initialize` result of a fake server that offers tools, echoing the client's protocol version */
export const initializeResult = (params: { protocolVersion: string }) => ({
  protocolVersion: params.protocolVersion,
  capabilities: { tools: {} },
  serverInfo: { name: "fake", version: "1" },
});
