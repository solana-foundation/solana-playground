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

/** Thrown from the transport's fetch, so only the call whose request 404'd carries it */
class McpSessionExpiredError extends Error {
  constructor() {
    super("The MCP server no longer knows this session.");
    this.name = "McpSessionExpiredError";
  }
}

const findUnreachable = (error: unknown): McpUnreachableError | undefined => {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e instanceof McpUnreachableError) return e;
  }
};

const isSessionExpired = (error: unknown): boolean => {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e instanceof McpSessionExpiredError) return true;
  }
  return false;
};

/** One client and the calls still running on it */
interface Session {
  client: Promise<MCPClient>;
  running: number;
  retired: boolean;
}

/**
 * Connect to an MCP server. The session opens on the first call.
 *
 * A call the server rejects for an expired session (HTTP 404 on a request
 * that carried a session id) is repeated once on a new session, which every
 * call that failed on the same expired session shares.
 *
 * @throws {McpUnreachableError} from any call, when the browser cannot reach the host
 * @example List a server's tools
 * ```ts
 * const tools = await connectMcp({ url: "/api/mcp?server[]=explorer" }).listTools();
 * ```
 */
export const connectMcp = (server: McpServer): McpConnection => {
  let current: Session | undefined;

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
      throw new McpSessionExpiredError();
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

  const connected = (): Session => {
    if (!current) {
      const session: Session = { client: open(), running: 0, retired: false };
      current = session;
      session.client.catch(() => {
        // The caller awaiting the client gets the error; this only forgets the failed session
        if (current === session) current = undefined;
      });
    }
    return current;
  };

  const closeQuietly = (stale: Session) =>
    stale.client
      .then((c) => c.close())
      .catch((e) =>
        log.debug("Closing a stale MCP client failed", {
          context: { error: String(e) },
        })
      );

  const run = async <T>(
    session: Session,
    operation: (c: MCPClient) => Promise<T>
  ): Promise<T> => {
    session.running++;
    try {
      return await operation(await session.client);
    } finally {
      session.running--;
      if (session.retired && session.running === 0) void closeQuietly(session);
    }
  };

  // Closing rejects every request still pending on the client, so it waits for the last call to settle
  const retire = (session: Session) => {
    if (session.retired) return;
    session.retired = true;
    if (current === session) current = undefined;
    log.debug("Reopening an expired MCP session", {
      context: { url: server.url },
    });
    if (session.running === 0) void closeQuietly(session);
  };

  const withSession = async <T>(
    operation: (c: MCPClient) => Promise<T>
  ): Promise<T> => {
    const session = connected();
    try {
      return await run(session, operation);
    } catch (e) {
      const unreachable = findUnreachable(e);
      if (unreachable) throw unreachable;
      if (!isSessionExpired(e)) throw e;

      retire(session);
      return run(connected(), operation);
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
      const session = current;
      current = undefined;
      if (session) await (await session.client).close();
    },
  };
};
