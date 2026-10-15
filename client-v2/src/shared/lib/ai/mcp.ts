import { createMCPClient } from "@ai-sdk/mcp";
import type { MCPClient } from "@ai-sdk/mcp";

import { createLogger } from "../logger";

const log = createLogger("ai:mcp");

/**
 * Raised when the browser could not reach the host, rather than the server
 * answering with an error.
 *
 * `fetch` reports a missing `access-control-allow-origin` as a bare
 * `TypeError`, indistinguishable from a dead host; this names both.
 */
export class McpUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpUnreachableError";
  }
}

/** An MCP server reached over Streamable HTTP */
export interface McpServer {
  url: string;
  /** Sent on every request, such as `authorization` */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

/** One tool as the server describes it */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** What a tool call gave back, flattened to text */
export interface McpToolResult {
  text: string;
  isError: boolean;
}

export interface McpConnection {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  /** Ends the session; the next call opens a new one */
  close(): Promise<void>;
}

const findUnreachable = (error: unknown): McpUnreachableError | undefined => {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e instanceof McpUnreachableError) return e;
  }
};

/**
 * Connect to an MCP server. The session opens on the first call.
 *
 * A call the server rejects for an expired session (HTTP 404 on a request
 * that carried a session id) opens a new session and is repeated once.
 *
 * @throws {McpUnreachableError} from any call, when the browser cannot reach the host
 * @example List a server's tools
 * ```ts
 * const tools = await connectMcp({ url: "/api/mcp?server[]=explorer" }).listTools();
 * ```
 */
export const connectMcp = (server: McpServer): McpConnection => {
  let client: Promise<MCPClient> | undefined;
  let expired = false;

  const send: typeof fetch = async (input, init) => {
    let response: Response;
    try {
      response = await (server.fetch ?? globalThis.fetch)(input, init);
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      throw new McpUnreachableError(
        "The browser blocked this request or the host did not answer. The " +
          "server has to send CORS headers to be callable from a page. " +
          `(${e.message})`
      );
    }
    // Detected here: a 404 whose body is a JSON-RPC error for the request skips the transport's expiry hook
    if (
      response.status === 404 &&
      new Headers(init?.headers).has("mcp-session-id")
    ) {
      expired = true;
    }
    return response;
  };

  const open = () =>
    createMCPClient({
      transport: {
        type: "http",
        url: new URL(server.url, globalThis.location?.href).href,
        headers: server.headers,
        fetch: send,
      },
      // The servers we reach speak the session-based protocol; probing costs a round trip
      protocolVersionDiscovery: false,
    });

  const connected = () => {
    if (!client) {
      const opening = open();
      client = opening;
      opening.catch(() => {
        // The caller awaiting `opening` gets the error; this only forgets the failed client
        if (client === opening) client = undefined;
      });
    }
    return client;
  };

  const closeQuietly = (stale: Promise<MCPClient>) =>
    stale
      .then((c) => c.close())
      .catch((e) =>
        log.debug("Closing a stale MCP client failed", {
          context: { error: String(e) },
        })
      );

  const withSession = async <T>(
    operation: (c: MCPClient) => Promise<T>
  ): Promise<T> => {
    try {
      return await operation(await connected());
    } catch (e) {
      const unreachable = findUnreachable(e);
      if (unreachable) throw unreachable;
      if (!expired || !client) throw e;

      expired = false;
      log.debug("Reopening an expired MCP session", {
        context: { url: server.url },
      });
      void closeQuietly(client);
      client = undefined;
      return operation(await connected());
    }
  };

  return {
    listTools: () =>
      withSession(async (c) => {
        const { tools } = await c.listTools();
        return tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
        }));
      }),
    callTool: (name, args) =>
      withSession(async (c) => {
        const result = await c.callTool({ name, arguments: args });
        const content = (result.content ?? []) as Array<{
          type?: string;
          text?: string;
        }>;
        const text = content
          .filter((block) => block.type === "text" && block.text)
          .map((block) => block.text)
          .join("\n\n");
        return {
          text: text || JSON.stringify(result),
          isError: result.isError === true,
        };
      }),
    close: async () => {
      const current = client;
      client = undefined;
      if (current) await (await current).close();
    },
  };
};
