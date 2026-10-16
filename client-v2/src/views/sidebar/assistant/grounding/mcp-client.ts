import { serverUrl } from "./config";
import type { McpServerEntry } from "./types";

/** The protocol revision we negotiate; also sent as a header on every call */
const PROTOCOL_VERSION = "2025-06-18";

/** One tool as the server describes it */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** What `tools/call` gave back, flattened to something renderable */
export interface McpResult {
  text: string;
  isError: boolean;
}

/**
 * Raised when the browser refused the request rather than the server.
 *
 * `fetch` reports a missing `access-control-allow-origin` as a bare
 * `TypeError` indistinguishable from a dead host, so this carries the
 * distinction the console needs to explain what is wrong.
 */
export class McpUnreachableError extends Error {}

/** A negotiated session, kept per server so a call is one round trip */
interface Session {
  url: string;
  id: string | null;
}

const sessions = new Map<string, Session>();

let nextId = 0;

/** Headers the server expects; only ones its CORS policy allows will arrive */
const headersFor = (server: McpServerEntry, session: Session | null) => ({
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": PROTOCOL_VERSION,
  ...(session?.id ? { "mcp-session-id": session.id } : {}),
  ...(server.authToken?.trim()
    ? { authorization: `Bearer ${server.authToken.trim()}` }
    : {}),
  ...server.headers,
});

/**
 * Pull the JSON-RPC payload out of a response body.
 *
 * Streamable HTTP answers with either `application/json` or a `text/event-stream`
 * carrying one `data:` event. This is a second SSE reader rather than a reuse of
 * the one in `model/openai.ts`, which is typed to chat-completions deltas.
 */
const readPayload = (body: string, contentType: string | null) => {
  if (!contentType?.includes("text/event-stream")) {
    return JSON.parse(body) as Record<string, unknown>;
  }

  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
    }
  }
  throw new Error("The server sent an event stream with no data.");
};

/**
 * One JSON-RPC round trip.
 *
 * @throws {McpUnreachableError} when the browser blocked it or the host is down
 * @throws {Error} when the server answered with a failure
 */
const rpc = async (
  server: McpServerEntry,
  session: Session | null,
  method: string,
  params?: Record<string, unknown>
) => {
  const url = session?.url ?? serverUrl(server);
  const id = ++nextId;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: headersFor(server, session),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  } catch (e) {
    throw new McpUnreachableError(
      `The browser blocked this request or the host did not answer. The ` +
        `server has to send CORS headers to be callable from a page; if it ` +
        `does not, it needs a server-side executor instead. (${
          e instanceof Error ? e.message : String(e)
        })`
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}${
        text ? ` — ${text.slice(0, 300)}` : ""
      }`
    );
  }

  const payload = readPayload(text, response.headers.get("content-type"));
  const error = payload.error as { message?: string } | undefined;
  if (error) throw new Error(error.message ?? "The server returned an error.");

  return {
    result: (payload.result ?? {}) as Record<string, unknown>,
    // Only readable because the server exposes it; absent on stateless servers
    sessionId: response.headers.get("mcp-session-id"),
  };
};

/** Negotiate a session, or reuse the one we already have */
const connect = async (server: McpServerEntry) => {
  const existing = sessions.get(server.id);
  if (existing) return existing;

  const url = serverUrl(server);
  const { sessionId } = await rpc(server, { url, id: null }, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "solana-playground", version: "0.1.0" },
  });

  const session: Session = { url, id: sessionId };
  sessions.set(server.id, session);

  // Required by the spec before any other request; a server that does not care
  // ignores it, so a failure here is not worth failing the connection over
  try {
    await rpc(server, session, "notifications/initialized");
  } catch {}

  return session;
};

/** Forget a server's session, so the next call renegotiates */
export const disconnect = (serverId: string) => sessions.delete(serverId);

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
 * @throws {McpUnreachableError} when the gateway is not serving (a plain
 * `craco start` without the API middleware, say)
 */
export const listGatewayServers = async (): Promise<McpServerEntry[]> => {
  let response: Response;
  try {
    response = await fetch(GATEWAY, {
      headers: { accept: "application/json" },
    });
  } catch (e) {
    throw new McpUnreachableError(
      `Could not reach the MCP gateway at ${GATEWAY}: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  if (!response.ok) {
    throw new McpUnreachableError(
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
    executor: "browser" as const,
  }));
};

/**
 * Run an operation, renegotiating once if the server rejected our session.
 *
 * Sessions expire and serverless MCP servers are often stateless, so a stale
 * id is an ordinary occurrence rather than an error worth surfacing.
 */
const withSession = async <T>(
  server: McpServerEntry,
  operation: (session: Session) => Promise<T>
): Promise<T> => {
  try {
    return await operation(await connect(server));
  } catch (e) {
    if (e instanceof McpUnreachableError) throw e;
    disconnect(server.id);
    return operation(await connect(server));
  }
};

/**
 * List a server's tools.
 *
 * @param server which server
 * @returns its tools, as it describes them
 */
export const listTools = (server: McpServerEntry) =>
  withSession(server, async (session) => {
    const { result } = await rpc(server, session, "tools/list");
    return (result.tools ?? []) as McpTool[];
  });

/**
 * Call one tool.
 *
 * @param server which server
 * @param name the tool's name, as the server spells it
 * @param args arguments matching the tool's own schema
 * @returns the text content, and whether the server flagged it as an error
 */
export const callTool = (
  server: McpServerEntry,
  name: string,
  args: Record<string, unknown>
) =>
  withSession(server, async (session) => {
    const { result } = await rpc(server, session, "tools/call", {
      name,
      arguments: args,
    });

    const content = (result.content ?? []) as Array<{
      type?: string;
      text?: string;
    }>;
    const text = content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n\n");

    const outcome: McpResult = {
      text: text || JSON.stringify(result),
      isError: result.isError === true,
    };
    return outcome;
  });
