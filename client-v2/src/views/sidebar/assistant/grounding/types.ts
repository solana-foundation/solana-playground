/** Where a skill's files come from */
export type SkillSource =
  /** Shipped in the bundle, so it survives a network failure */
  | { type: "bundled"; content: string }
  /**
   * Fetched at runtime. `baseUrl` must send `access-control-allow-origin`;
   * `raw.githubusercontent.com` sends `*`.
   */
  | { type: "remote"; baseUrl: string; entry: string };

/**
 * A body of ecosystem knowledge the model loads when it decides it needs it.
 *
 * Only `name` and `description` reach the prompt — the content arrives as a
 * tool result, which keeps the cached prompt prefix byte-stable.
 */
export interface SkillEntry {
  id: string;
  name: string;
  /** One line the model reads when deciding whether to load this */
  description: string;
  source: SkillSource;
}

/**
 * Who calls an MCP server on our behalf.
 *
 * A property of the server's own reachability, not of the connected backend:
 * MCP tools are ordinary tools, and any backend that calls tools can use them.
 * What varies is only who performs the call.
 *
 * - `browser` — we call it ourselves. Works on every backend, and in the
 *   console with no model at all. Needs the server to send CORS headers.
 * - `server` — something server-side calls it, because the browser cannot.
 *   Anthropic's connector today; our own gateway later. Only available on
 *   backends that provide such an executor.
 */
export type McpExecutor = "browser" | "server";

/**
 * A remote MCP server.
 *
 * What reaches the server depends on the executor:
 *
 * - `authToken` is a bearer token on both paths.
 * - `queryParams` rides in the URL on both. It is the only way to pass a
 *   credential a server wants outside the `Authorization` header — a Vercel
 *   `x-vercel-protection-bypass`, for instance — and on `browser` it is also
 *   the only way past a CORS policy that does not allow that header name.
 * - `headers` is sent on `browser` only; the connector's server definition has
 *   no header map. Note a header the server's `Access-Control-Allow-Headers`
 *   omits will fail preflight rather than be ignored.
 */
export interface McpServerEntry {
  /** Also the `mcp_server_name` the connector references; must be unique */
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  executor: McpExecutor;
  authToken?: string;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
}
