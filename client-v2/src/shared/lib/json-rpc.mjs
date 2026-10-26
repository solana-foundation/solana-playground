// @ts-check
// JSON-RPC 2.0 envelopes, built by `api/mcp.mjs` and by the fake MCP servers
// in the browser tests. `.mjs` so Node can import it directly; `allowJs` lets
// the TypeScript side import the same file (see `features/auth/config.mjs`).

/** @typedef {string | number} RpcId */

/**
 * A success answer to the request `id`.
 *
 * @param {RpcId} id
 * @param {unknown} result
 */
export const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });

/**
 * An error answer to the request `id`.
 *
 * @param {RpcId | null | undefined} id
 * @param {number} code
 * @param {string} message
 */
export const rpcError = (id, code, message) => ({
  jsonrpc: "2.0",
  // JSON-RPC requires an id in every response, and null when the request's was unreadable
  id: id ?? null,
  error: { code, message },
});

/**
 * A request with the fixed id `1`, for a caller that sends one request per
 * connection. `params` is omitted when absent.
 *
 * @param {string} method
 * @param {unknown} [params]
 */
export const rpcRequest = (method, params) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  ...(params === undefined ? {} : { params }),
});
