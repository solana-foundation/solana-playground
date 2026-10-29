import { loadAi } from "@/shared/lib/ai";
import { createLogger } from "@/shared/lib/logger";
import { MCP_TIMEOUT_MS } from "../config";
import { serverUrl } from "./config";
import { mcpTelemetry } from "./telemetry";
import type {
  McpCallOptions,
  McpConnection,
  McpToolResult,
} from "@/shared/lib/ai";
import type { McpEventParams, McpServerKind } from "./telemetry";
import type { McpServerEntry } from "./types";

export type { McpTool } from "@/shared/lib/ai";

const log = createLogger("mcp:client");

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

// Gateway entries are relative URLs on GATEWAY, as listGatewayServers builds them
const kindOf = (server: McpServerEntry): McpServerKind =>
  server.url.trim().split(/[?#]/)[0] === GATEWAY ? "gateway" : "user";

/** What a connection is opened with: the URL with its query parameters, and the headers with the token */
interface Target {
  url: string;
  headers: Record<string, string>;
}

/** A connection and what it was opened with */
interface Held extends Target {
  connection: McpConnection;
}

const targetOf = (server: McpServerEntry): Target => ({
  url: serverUrl(server),
  headers: {
    ...(server.authToken?.trim()
      ? { authorization: `Bearer ${server.authToken.trim()}` }
      : {}),
    ...server.headers,
  },
});

const sameHeaders = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
  );
};

const sameTarget = (a: Target, b: Target) =>
  a.url === b.url && sameHeaders(a.headers, b.headers);

/** Whether two entries reach the same server the same way, so one's session and tools are the other's */
export const sameConnection = (a: McpServerEntry, b: McpServerEntry) =>
  sameTarget(targetOf(a), targetOf(b));

// One per entry id, so an edited or removed entry's session can be closed rather than left open
const connections = new Map<string, Held>();

// Per entry id, so a call that started before its entry was removed cannot store a connection for it afterwards
const removals = new Map<string, number>();

const closeQuietly = (held: Held) =>
  held.connection.close().catch((e) =>
    log.debug("Closing an MCP connection failed", {
      context: { error: String(e) },
    })
  );

const connectionFor = (
  server: McpServerEntry,
  connectMcp: Awaited<ReturnType<typeof loadAi>>["connectMcp"]
) => {
  const { url, headers } = targetOf(server);

  const held = connections.get(server.id);
  if (held && sameTarget(held, { url, headers })) return held.connection;
  if (held) void closeQuietly(held);

  const kind = kindOf(server);
  const connection = connectMcp({
    url,
    headers,
    timeout: MCP_TIMEOUT_MS,
    onSessionReopened: () =>
      mcpTelemetry.track("mcp_session_reopened", { server: kind }),
  });
  connections.set(server.id, { url, headers, connection });
  return connection;
};

/**
 * Close the connection of an entry that was removed. An entry that was only
 * edited needs no call: its next request replaces the connection.
 */
export const closeConnection = (serverId: string) => {
  removals.set(serverId, (removals.get(serverId) ?? 0) + 1);
  const held = connections.get(serverId);
  if (!held) return;
  connections.delete(serverId);
  void closeQuietly(held);
};

/**
 * Run one operation on a server's connection.
 *
 * @throws {McpUnreachableError} when the browser cannot reach the host, naming the gateway
 * @throws when the entry was removed after the call started
 */
const withConnection = async <T>(
  server: McpServerEntry,
  operation: (connection: McpConnection) => Promise<T>
) => {
  const removed = removals.get(server.id);
  const { connectMcp, McpUnreachableError } = await loadAi();
  if (removals.get(server.id) !== removed) {
    throw new Error(`The MCP server "${server.name}" was removed.`);
  }
  try {
    return await operation(connectionFor(server, connectMcp));
  } catch (e) {
    if (!(e instanceof McpUnreachableError)) throw e;
    throw new McpUnreachableError(
      `${e.message} A host that refuses the browser is reached through the ` +
        `${GATEWAY} gateway, as an upstream configured in \`api/mcp.mjs\`.`
    );
  }
};

const listFailure = async (
  error: unknown
): Promise<McpEventParams<"mcp_tools_list_failed">["reason"]> => {
  const { isMcpSessionExpired, McpTimeoutError, McpUnreachableError } =
    await loadAi();
  if (error instanceof McpUnreachableError) return "unreachable";
  if (error instanceof McpTimeoutError) return "timeout";
  if (isMcpSessionExpired(error)) return "session-expired";
  return "other";
};

const callFailure = async (
  error: unknown,
  signal: AbortSignal | undefined
): Promise<McpEventParams<"mcp_tool_called">["outcome"]> => {
  if (signal?.aborted) return "aborted";
  const { McpTimeoutError } = await loadAi();
  return error instanceof McpTimeoutError ? "timeout" : "failed";
};

/** List a server's tools, as it describes them */
export const listTools = async (server: McpServerEntry) => {
  const kind = kindOf(server);
  try {
    const tools = await withConnection(server, (connection) =>
      connection.listTools()
    );
    mcpTelemetry.track("mcp_tools_listed", {
      server: kind,
      tools: tools.length,
    });
    return tools;
  } catch (e) {
    mcpTelemetry.track("mcp_tools_list_failed", {
      server: kind,
      reason: await listFailure(e),
    });
    throw e;
  }
};

/**
 * Call one tool, with arguments matching the tool's own schema.
 *
 * @returns the text content, and whether the server flagged it as an error
 */
export const callTool = async (
  server: McpServerEntry,
  name: string,
  args: Record<string, unknown>,
  options?: Pick<McpCallOptions, "signal">
): Promise<McpToolResult> => {
  const kind = kindOf(server);
  let retried = false;
  const onRetry = () => {
    retried = true;
  };
  try {
    const result = await withConnection(server, (connection) =>
      connection.callTool(name, args, { onRetry, signal: options?.signal })
    );
    mcpTelemetry.track("mcp_tool_called", {
      server: kind,
      outcome: result.isError ? "tool-error" : "ok",
      retried,
    });
    return result;
  } catch (e) {
    mcpTelemetry.track("mcp_tool_called", {
      server: kind,
      outcome: await callFailure(e, options?.signal),
      retried,
    });
    throw e;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, beforeEach, afterEach } =
    import.meta.vitest;

  describe("features/mcp/model/mcp-client", () => {
    let initTelemetry: typeof import("@/shared/lib/telemetry").initTelemetry;
    let resetTelemetry: typeof import("@/shared/lib/telemetry").resetTelemetry;
    let memoryProvider: typeof import("@/shared/lib/telemetry").memoryProvider;
    let rpcResult: typeof import("@/shared/lib/json-rpc.mjs").rpcResult;
    let rpcError: typeof import("@/shared/lib/json-rpc.mjs").rpcError;
    let initializeResult: typeof import("@/shared/lib/ai/__fixtures__/fake-mcp").initializeResult;
    let sent: ReturnType<typeof memoryProvider>;

    beforeAll(async () => {
      ({ initTelemetry, resetTelemetry, memoryProvider } = await import(
        "@/shared/lib/telemetry"
      ));
      ({ rpcResult, rpcError } = await import("@/shared/lib/json-rpc.mjs"));
      ({ initializeResult } = await import(
        "@/shared/lib/ai/__fixtures__/fake-mcp"
      ));
    });
    beforeEach(() => {
      connections.clear();
      sent = memoryProvider();
      initTelemetry({ providers: [sent] });
    });
    afterEach(() => resetTelemetry());

    const named = (event: string) =>
      sent.events.filter((e) => e.name === event).map((e) => e.params);

    const json = (
      body: unknown,
      headers: Record<string, string> = {},
      status = 200
    ) => {
      const sentHeaders = new Headers(headers);
      sentHeaders.set("content-type", "application/json");
      return new Response(JSON.stringify(body), {
        status,
        headers: sentHeaders,
      });
    };

    interface Recorded {
      url: string;
      method: string;
      session: string | null;
      authorization: string | null;
      extra: string | null;
    }

    interface FakeServer {
      tools?: string[];
      /** `first`: the first session expires on use; `always`: every session does */
      expire?: "never" | "first" | "always";
      /** How `tools/call` answers; `hang` opens an event stream that never sends the answer */
      call?: "ok" | "tool-error" | "rpc-error" | "hang";
    }

    /** A session-based MCP server, recording every request */
    const fakeServer = ({
      tools = [],
      expire = "never",
      call = "ok",
    }: FakeServer = {}) => {
      const requests: Recorded[] = [];
      let sessions = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const headers = new Headers(init?.headers);
        const session = headers.get("mcp-session-id");
        const record = (method: string) =>
          requests.push({
            url: String(input),
            method,
            session,
            authorization: headers.get("authorization"),
            extra: headers.get("x-extra"),
          });
        if (init?.method === "DELETE") {
          record("DELETE");
          return new Response(null, { status: 200 });
        }
        const message = JSON.parse(String(init?.body));
        record(message.method);
        if (message.id === undefined) {
          return new Response(null, { status: 202 });
        }
        if (message.method === "initialize") {
          return json(rpcResult(message.id, initializeResult(message.params)), {
            "mcp-session-id": `s${++sessions}`,
          });
        }
        if (expire === "always" || (expire === "first" && session === "s1")) {
          return json(
            rpcError(message.id, -32001, "Session not found"),
            {},
            404
          );
        }
        if (message.method === "tools/list") {
          return json(
            rpcResult(message.id, {
              tools: tools.map((name) => ({
                name,
                inputSchema: { type: "object" },
              })),
            })
          );
        }
        if (call === "hang") {
          return new Response(new ReadableStream(), {
            headers: { "content-type": "text/event-stream" },
          });
        }
        if (call === "rpc-error") {
          return json(rpcError(message.id, -32603, "Tool failed"));
        }
        return json(
          rpcResult(message.id, {
            content: [{ type: "text", text: "done" }],
            isError: call === "tool-error",
          })
        );
      });
      return requests;
    };

    const userServer = (authToken?: string): McpServerEntry => ({
      id: "user-1",
      name: "User",
      url: "https://mcp.test/mcp",
      enabled: true,
      authToken,
    });

    it("sends an entry's token, headers and query parameters on every request", async () => {
      const requests = fakeServer();

      await listTools({
        id: "wired",
        name: "Wired",
        url: "https://mcp.test/mcp",
        enabled: true,
        authToken: " token-1 ",
        headers: { "x-extra": "1" },
        queryParams: { bypass: "b-1" },
      });

      expect(requests.length).toBeGreaterThan(0);
      for (const request of requests) {
        expect(request.url).toBe("https://mcp.test/mcp?bypass=b-1");
        expect(request.authorization).toBe("Bearer token-1");
        expect(request.extra).toBe("1");
      }
    });

    interface Edit {
      url?: string;
      authToken?: string;
      bypass?: string;
    }

    const editable = ({
      url = "https://mcp.test/mcp",
      authToken = "old",
      bypass = "b-1",
    }: Edit = {}): McpServerEntry => ({
      id: "user-1",
      name: "User",
      url,
      enabled: true,
      authToken,
      queryParams: { bypass },
    });

    it.each([
      [
        "token",
        { authToken: "new" },
        (r: Recorded) => r.authorization,
        "Bearer new",
      ],
      [
        "URL",
        { url: "https://mcp.test/v2" },
        (r: Recorded) => r.url,
        "https://mcp.test/v2?bypass=b-1",
      ],
      [
        "query parameters",
        { bypass: "b-2" },
        (r: Recorded) => r.url,
        "https://mcp.test/mcp?bypass=b-2",
      ],
    ] as const)(
      "closes an entry's connection on a change of %s, and sends the new value",
      async (_, edit, read, expected) => {
        const requests = fakeServer();

        await listTools(editable());
        const before = requests.length;
        await listTools(editable(edit));

        await vi.waitFor(() =>
          expect(requests).toContainEqual({
            url: "https://mcp.test/mcp?bypass=b-1",
            method: "DELETE",
            session: "s1",
            authorization: "Bearer old",
            extra: null,
          })
        );
        const second = requests
          .slice(before)
          .filter((r) => r.method !== "DELETE");
        expect(second.map(read)).toEqual(second.map(() => expected));
      }
    );

    it("refuses a call whose entry was removed while the call started, and keeps no connection for it", async () => {
      const requests = fakeServer();

      const listing = listTools(userServer("t"));
      closeConnection("user-1");

      await expect(listing).rejects.toThrow("was removed");
      expect(connections.has("user-1")).toBe(false);
      expect(requests).toEqual([]);
    });

    it("closes a removed entry's connection", async () => {
      const requests = fakeServer();
      await listTools(userServer("t"));

      closeConnection("user-1");

      await vi.waitFor(() =>
        expect(
          requests.filter((r) => r.method === "DELETE").map((r) => r.session)
        ).toEqual(["s1"])
      );
    });

    it("reports a gateway server's tool count", async () => {
      fakeServer({ tools: ["a", "b"] });

      await listTools({
        id: "explorer",
        name: "Explorer",
        url: "/api/mcp?server[]=explorer",
        enabled: true,
      });

      expect(named("mcp_tools_listed")).toEqual([
        { server: "gateway", tools: 2 },
      ]);
    });

    it("points an unreachable host at the gateway and reports it unreachable", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new TypeError("Failed to fetch")
      );

      const failure = listTools(userServer());

      await expect(failure).rejects.toMatchObject({
        name: "McpUnreachableError",
        message: expect.stringContaining("/api/mcp"),
      });
      expect(named("mcp_tools_list_failed")).toEqual([
        { server: "user", reason: "unreachable" },
      ]);
    });

    it("reports a listing whose reopened session expired too as session-expired", async () => {
      fakeServer({ expire: "always" });

      await expect(listTools(userServer())).rejects.toBeDefined();

      expect(named("mcp_session_reopened")).toEqual([{ server: "user" }]);
      expect(named("mcp_tools_list_failed")).toEqual([
        { server: "user", reason: "session-expired" },
      ]);
    });

    it("reports a listing the server refuses as other", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("nope", { status: 500 })
      );

      await expect(listTools(userServer())).rejects.toBeDefined();

      expect(named("mcp_tools_list_failed")).toEqual([
        { server: "user", reason: "other" },
      ]);
    });

    it("reports one reopen for two calls that failed on one expired session, each retried", async () => {
      fakeServer({ expire: "first" });

      await Promise.all([
        callTool(userServer(), "echo", {}),
        callTool(userServer(), "echo", {}),
      ]);

      expect(named("mcp_session_reopened")).toEqual([{ server: "user" }]);
      expect(named("mcp_tool_called")).toEqual([
        { server: "user", outcome: "ok", retried: true },
        { server: "user", outcome: "ok", retried: true },
      ]);
    });

    it.each([
      ["ok", "ok"],
      ["tool-error", "tool-error"],
      ["rpc-error", "failed"],
    ] as const)(
      "reports a call the server answers with %s as %s, not retried",
      async (call, outcome) => {
        fakeServer({ call });

        await callTool(userServer(), "echo", {}).catch(() => undefined);

        expect(named("mcp_tool_called")).toEqual([
          { server: "user", outcome, retried: false },
        ]);
      }
    );

    it("sends no tool call once its signal is aborted, and reports it aborted", async () => {
      const requests = fakeServer();
      const controller = new AbortController();
      controller.abort();

      await expect(
        callTool(userServer(), "echo", {}, { signal: controller.signal })
      ).rejects.toThrow();

      expect(requests.map((r) => r.method)).not.toContain("tools/call");
      expect(named("mcp_tool_called")).toEqual([
        { server: "user", outcome: "aborted", retried: false },
      ]);
    });

    it("reports a call that outlives the timeout as timeout", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const requests = fakeServer({ call: "hang" });

        const call = callTool(userServer(), "echo", {});
        call.catch(() => undefined);
        while (!requests.some((r) => r.method === "tools/call")) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        await vi.runOnlyPendingTimersAsync();

        await expect(call).rejects.toThrow("timed out");
        expect(named("mcp_tool_called")).toEqual([
          { server: "user", outcome: "timeout", retried: false },
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("puts no URL, token or tool name in an event", async () => {
      fakeServer({ tools: ["secret_tool"] });
      const server = userServer("token-xyz");

      await listTools(server);
      await callTool(server, "secret_tool", { q: 1 });

      const params = JSON.stringify(sent.events.map((e) => e.params));
      expect(sent.events).toHaveLength(2);
      for (const leaked of ["mcp.test", "token-xyz", "secret_tool"]) {
        expect(params).not.toContain(leaked);
      }
    });
  });
}
