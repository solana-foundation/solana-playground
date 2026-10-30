/**
 * A remote MCP server, called from the browser: directly when its host sends
 * CORS headers, otherwise through the `/api/mcp` gateway.
 *
 * - `authToken` is sent as a bearer token.
 * - `queryParams` rides in the URL. It is the only way to pass a credential a
 *   server wants outside the `Authorization` header (a Vercel
 *   `x-vercel-protection-bypass`, for instance), and the only way past a CORS
 *   policy that does not allow that header name.
 * - `headers` is sent on every request. A header the server's
 *   `Access-Control-Allow-Headers` omits fails preflight rather than being
 *   ignored.
 * - `protection` is a bot-protection bypass; its provider decides how the
 *   secret is sent (`PROTECTION_PROVIDERS` in `protection.mjs`).
 */
export interface McpServerEntry {
  /** Prefixes the server's tool names, so it must be unique */
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  authToken?: string;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  protection?: McpProtection;
}

/** A bot-protection bypass: a provider named in `PROTECTION_PROVIDERS` (`protection.mjs`), and its secret */
export interface McpProtection {
  provider: string;
  secret: string;
}
