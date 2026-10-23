import { loadAi } from "@/shared/lib/ai";
import { serverUrl } from "./config";
import type { McpConnection, McpToolResult } from "@/shared/lib/ai";
import type { McpServerEntry } from "./types";

export type { McpTool } from "@/shared/lib/ai";

/** Where the gateway lives; each upstream is selected by id */
const GATEWAY = "/api/mcp";

/**
 * Ask the gateway which upstreams it exposes.
 *
 * The server owns this list — the client does not carry its own copy, so
 * enabling an upstream is a deploy plus an env var rather than a client
 * change. Entries come back ready to use.
 *
 * @returns one entry per configured upstream
 * @throws when the gateway is not serving (a plain `craco start` without the
 * API middleware, say)
 */
export const listGatewayServers = async (): Promise<McpServerEntry[]> => {
  let response: Response;
  try {
    response = await fetch(GATEWAY, {
      headers: { accept: "application/json" },
    });
  } catch (e) {
    throw new Error(
      `Could not reach the MCP gateway at ${GATEWAY}: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  if (!response.ok) {
    throw new Error(
      `The MCP gateway answered ${response.status} ${response.statusText}. ` +
        `Run the app with \`yarn dev\`, which serves \`api/\`.`
    );
  }

  const body = (await response.json()) as {
    servers?: Array<{ id: string; name?: string }>;
  };

  return (body.servers ?? []).map((server) => ({
    id: server.id,
    name: server.name ?? server.id,
    url: `${GATEWAY}?server[]=${encodeURIComponent(server.id)}`,
    enabled: true,
  }));
};

// Keyed by everything that reaches the wire, so an edited entry gets a new session
const connections = new Map<string, McpConnection>();

const connectionFor = async (server: McpServerEntry) => {
  const headers: Record<string, string> = {
    ...(server.authToken?.trim()
      ? { authorization: `Bearer ${server.authToken.trim()}` }
      : {}),
    ...server.headers,
  };
  const url = serverUrl(server);
  const key = JSON.stringify([server.id, url, headers]);

  let connection = connections.get(key);
  if (!connection) {
    const { connectMcp } = await loadAi();
    connection = connectMcp({ url, headers });
    connections.set(key, connection);
  }
  return connection;
};

/**
 * Run one operation on a server's connection.
 *
 * @throws {McpUnreachableError} when the browser cannot reach the host, naming the gateway
 */
const withConnection = async <T>(
  server: McpServerEntry,
  operation: (connection: McpConnection) => Promise<T>
) => {
  const { McpUnreachableError } = await loadAi();
  try {
    return await operation(await connectionFor(server));
  } catch (e) {
    if (!(e instanceof McpUnreachableError)) throw e;
    throw new McpUnreachableError(
      `${e.message} A host that refuses the browser is reached through the ` +
        `${GATEWAY} gateway, as an upstream configured in \`api/mcp.mjs\`.`
    );
  }
};

/** List a server's tools, as it describes them */
export const listTools = (server: McpServerEntry) =>
  withConnection(server, (connection) => connection.listTools());

/**
 * Call one tool, with arguments matching the tool's own schema.
 *
 * @returns the text content, and whether the server flagged it as an error
 */
export const callTool = (
  server: McpServerEntry,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> =>
  withConnection(server, (connection) => connection.callTool(name, args));
