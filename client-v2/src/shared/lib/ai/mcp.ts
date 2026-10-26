import { createMCPClient } from "@ai-sdk/mcp";
import type { MCPClient } from "@ai-sdk/mcp";

import { createLogger } from "../logger";

const log = createLogger("ai:mcp");

/** A streamed answer that ends without a response leaves the SDK's request pending forever, so every request gets this deadline */
const FALLBACK_MCP_TIMEOUT_MS = 60_000;

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

/** Raised when a request, or opening a session, outlives the connection's timeout */
export class McpTimeoutError extends Error {
  constructor(timeout: number) {
    super(`The MCP request timed out after ${timeout} ms.`);
    this.name = "McpTimeoutError";
  }
}

/** An MCP server reached over Streamable HTTP */
export interface McpServer {
  url: string;
  /** Sent on every request, such as `authorization` */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  /** Milliseconds each request, and opening a session, may take, {@link FALLBACK_MCP_TIMEOUT_MS} unless set */
  timeout?: number;
  /** Called once for each expired session the connection replaces, however many calls failed on it */
  onSessionReopened?: () => void;
}

/** Per-call options of {@link McpConnection} */
export interface McpCallOptions {
  /** Called when the call runs again on a new session, before it does */
  onRetry?: () => void;
  /** Cancels the request and rejects the call */
  signal?: AbortSignal;
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
  listTools(options?: McpCallOptions): Promise<McpTool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: McpCallOptions
  ): Promise<McpToolResult>;
  /** Ends the connection for good: running calls finish, then the session closes, and every later call rejects */
  close(): Promise<void>;
}

/** Thrown from the transport's fetch, so only the call whose request 404'd carries it */
class McpSessionExpiredError extends Error {
  constructor() {
    super("The MCP server no longer knows this session.");
    this.name = "McpSessionExpiredError";
  }
}

/** Thrown from the transport's fetch for the inbound stream's GET, which no call awaits */
class McpInboundStreamError extends Error {
  constructor(cause: unknown) {
    super("The MCP inbound stream could not reach the host.", { cause });
    this.name = "McpInboundStreamError";
  }
}

const findUnreachable = (error: unknown): McpUnreachableError | undefined => {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e instanceof McpUnreachableError) return e;
  }
};

/** Whether the server no longer knew the session; a call's own rejection carries it only when the reopened session expired too */
export const isMcpSessionExpired = (error: unknown): boolean => {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e instanceof McpSessionExpiredError) return true;
  }
  return false;
};

/** The URL without credentials, query, or fragment, any of which can carry a token */
const redactUrl = (href: string) => {
  const url = new URL(href);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
};

/** The error and its causes as one line, with the server's URL redacted */
const describeError = (error: unknown, href: string) => {
  const parts: string[] = [];
  for (
    let e = error;
    e !== undefined;
    e = e instanceof Error ? e.cause : undefined
  ) {
    parts.push(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  }
  return parts.join(" <- ").split(href).join(redactUrl(href));
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
 * @throws {McpTimeoutError} from any call that outlives the timeout
 * @example List a server's tools
 * ```ts
 * const tools = await connectMcp({ url: "/api/mcp?server[]=explorer" }).listTools();
 * ```
 */
export const connectMcp = (server: McpServer): McpConnection => {
  let current: Session | undefined;
  let closed = false;
  const timeout = server.timeout ?? FALLBACK_MCP_TIMEOUT_MS;
  const href = new URL(server.url, globalThis.location?.href).href;

  // The SDK's own timeout rejects with an error a caller cannot tell from a server fault
  const withTimeout = async <T>(
    signal: AbortSignal | undefined,
    act: (signal: AbortSignal) => Promise<T>
  ): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new McpTimeoutError(timeout)),
      timeout
    );
    const forward = () => controller.abort(signal?.reason);
    if (signal?.aborted) forward();
    signal?.addEventListener("abort", forward, { once: true });
    try {
      return await act(controller.signal);
    } catch (e) {
      const reason: unknown = controller.signal.reason;
      if (reason instanceof McpTimeoutError) throw reason;
      throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    }
  };

  const send: typeof fetch = async (input, init) => {
    const inbound = init?.method === "GET";
    let response: Response;
    try {
      response = await (server.fetch ?? globalThis.fetch)(input, init);
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      if (inbound) throw new McpInboundStreamError(e);
      throw new McpUnreachableError(
        "The browser blocked this request or the host did not answer. The " +
          "server has to send CORS headers to be callable from a page. " +
          `(${e.message})`
      );
    }
    if (
      response.status === 404 &&
      new Headers(init?.headers).has("mcp-session-id")
    ) {
      // The SDK would forget the session id, so the next call's 404 would no longer read as an expiry and reopen it
      if (inbound) {
        log.debug("The MCP inbound stream's session expired", {
          context: { url: redactUrl(href) },
        });
        return new Response(null, { status: 405 });
      }
      // Detected here: a 404 whose body is a JSON-RPC error for the request skips the transport's expiry hook
      throw new McpSessionExpiredError();
    }
    // The SDK reports a 400 on the optional inbound stream as a failure, though servers without that stream answer it so
    if (inbound && response.status === 400) {
      return new Response(null, { status: 405 });
    }
    return response;
  };

  const open = () =>
    withTimeout(undefined, (signal) =>
      createMCPClient({
        transport: {
          type: "http",
          url: href,
          headers: server.headers,
          fetch: send,
        },
        // The servers we reach speak the session-based protocol; probing costs a round trip
        protocolVersionDiscovery: false,
        initializationOptions: { signal },
        // The SDK reports every transport failure here, awaited or not; a call raises an unreachable host or an expired session itself, so those stay at debug
        onUncaughtError: (error) => {
          const context = {
            url: redactUrl(href),
            error: describeError(error, href),
          };
          if (error instanceof McpInboundStreamError) {
            log.warn("The MCP inbound stream failed", { context });
            return;
          }
          if (findUnreachable(error) || isMcpSessionExpired(error)) {
            log.debug("An MCP request failed; its call raises it", {
              context,
            });
            return;
          }
          log.warn("The MCP transport failed", { context });
        },
      })
    );

  const connected = (): Session => {
    if (closed) throw new Error("The MCP connection is closed.");
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
    if (session.retired) return false;
    session.retired = true;
    if (current === session) current = undefined;
    if (session.running === 0) void closeQuietly(session);
    return true;
  };

  const withSession = async <T>(
    operation: (c: MCPClient) => Promise<T>,
    options?: McpCallOptions
  ): Promise<T> => {
    const session = connected();
    try {
      return await run(session, operation);
    } catch (e) {
      const unreachable = findUnreachable(e);
      if (unreachable) throw unreachable;
      if (!isMcpSessionExpired(e)) throw e;

      if (retire(session)) {
        log.debug("Reopening an expired MCP session", {
          context: { url: redactUrl(href) },
        });
        server.onSessionReopened?.();
      }
      options?.onRetry?.();
      return run(connected(), operation);
    }
  };

  return {
    listTools: (options) =>
      withSession(
        (c) =>
          withTimeout(options?.signal, async (signal) => {
            const { tools } = await c.listTools({ options: { signal } });
            return tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema as Record<string, unknown>,
            }));
          }),
        options
      ),
    callTool: (name, args, options) =>
      withSession(
        (c) =>
          withTimeout(options?.signal, async (signal) => {
            const result = await c.callTool({
              name,
              arguments: args,
              options: { signal },
            });
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
        options
      ),
    close: async () => {
      closed = true;
      if (current) retire(current);
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, beforeEach, afterEach } =
    import.meta.vitest;

  describe("shared/lib/ai/mcp", () => {
    let initLogger: typeof import("../logger").initLogger;
    let memoryProvider: typeof import("../logger").memoryProvider;
    let resetLogger: typeof import("../logger").resetLogger;
    let rpcResult: typeof import("../json-rpc.mjs").rpcResult;
    let rpcError: typeof import("../json-rpc.mjs").rpcError;
    let initializeResult: typeof import("./__fixtures__/fake-mcp").initializeResult;

    beforeAll(async () => {
      ({ initLogger, memoryProvider, resetLogger } = await import("../logger"));
      ({ rpcResult, rpcError } = await import("../json-rpc.mjs"));
      ({ initializeResult } = await import("./__fixtures__/fake-mcp"));
    });

    const json = (body: unknown, headers: Record<string, string> = {}) => {
      const all = new Headers(headers);
      all.set("content-type", "application/json");
      return new Response(JSON.stringify(body), { headers: all });
    };

    /**
     * A session-based MCP server that forgets its first session after `initialize`.
     * The tool named `failing` errors on any session once the first expiry is sent,
     * and the expiry's body waits for `releaseExpiry`, so that error lands first.
     */
    const serverWithExpiringSession = ({
      failing,
    }: { failing?: string } = {}) => {
      const methods: string[] = [];
      const toolCalls: string[] = [];
      let sessions = 0;
      let live: string | undefined;
      let expirySent: () => void = () => undefined;
      const firstExpiry = new Promise<void>(
        (resolve) => (expirySent = resolve)
      );
      let releaseExpiry: () => void = () => undefined;
      const expiryReleased = new Promise<void>(
        (resolve) => (releaseExpiry = resolve)
      );

      const fetch = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          const method = init?.method ?? "GET";
          if (method !== "POST") return new Response(null, { status: 405 });

          const message = JSON.parse(String(init?.body));
          methods.push(message.method);
          if (message.method === "tools/call")
            toolCalls.push(message.params.name);
          const session = new Headers(init?.headers).get("mcp-session-id");

          if (message.method === "initialize") {
            const id = `s${++sessions}`;
            live = id;
            return json(
              rpcResult(message.id, initializeResult(message.params)),
              { "mcp-session-id": id }
            );
          }
          if (message.id === undefined)
            return new Response(null, { status: 202 });

          if (failing !== undefined && message.params?.name === failing) {
            await firstExpiry;
            return json(rpcError(message.id, -32603, "Tool failed"));
          }

          // The first session expires as soon as it is used
          if (session !== live || session === "s1") {
            const body = JSON.stringify(
              rpcError(message.id, -32001, "Session not found")
            );
            expirySent();
            return new Response(
              failing === undefined
                ? body
                : new ReadableStream({
                    async start(controller) {
                      await expiryReleased;
                      controller.enqueue(new TextEncoder().encode(body));
                      controller.close();
                    },
                  }),
              { status: 404, headers: { "content-type": "application/json" } }
            );
          }
          return json(
            rpcResult(message.id, { content: [{ type: "text", text: "ok" }] })
          );
        }
      );

      return {
        fetch: fetch as unknown as typeof globalThis.fetch,
        methods,
        toolCalls,
        releaseExpiry,
      };
    };

    /**
     * A session-based MCP server that refuses the inbound stream with a 400 and
     * answers `tools/call` with an event stream that `stream` shapes.
     */
    const serverWithStreamedCall = (stream: "ends" | "malformed" | "open") => {
      const methods: string[] = [];
      const signals: Array<AbortSignal | null | undefined> = [];
      const fetch = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === "GET")
            return new Response(null, { status: 400 });

          const message = JSON.parse(String(init?.body));
          methods.push(message.method);
          if (message.method === "initialize") {
            return json(
              rpcResult(message.id, initializeResult(message.params)),
              { "mcp-session-id": "s1" }
            );
          }
          if (message.id === undefined)
            return new Response(null, { status: 202 });

          signals.push(init?.signal);
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              if (stream === "malformed") {
                controller.enqueue(
                  new TextEncoder().encode(
                    "event: message\ndata: {not json\n\n"
                  )
                );
              }
              if (stream !== "open") controller.close();
            },
          });
          return new Response(body, {
            headers: { "content-type": "text/event-stream" },
          });
        }
      );

      return {
        fetch: fetch as unknown as typeof globalThis.fetch,
        calls: fetch.mock.calls,
        methods,
        signals,
      };
    };

    /**
     * A session-based MCP server whose `tools/call` answers only once `release`
     * runs, and whose inbound stream's GET is answered by `get`.
     */
    const gatedServer = (
      get: (init?: RequestInit) => Response = () =>
        new Response(null, { status: 405 })
    ) => {
      const methods: string[] = [];
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => (release = resolve));

      const fetch = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === "GET" || init?.method === "DELETE") {
            methods.push(init.method);
            return init.method === "GET"
              ? get(init)
              : new Response(null, { status: 200 });
          }
          const message = JSON.parse(String(init?.body));
          methods.push(message.method);
          if (message.method === "initialize") {
            return json(
              rpcResult(message.id, initializeResult(message.params)),
              { "mcp-session-id": "s1" }
            );
          }
          if (message.id === undefined)
            return new Response(null, { status: 202 });
          await released;
          return json(
            rpcResult(message.id, { content: [{ type: "text", text: "ok" }] })
          );
        }
      );

      return {
        fetch: fetch as unknown as typeof globalThis.fetch,
        methods,
        release,
      };
    };

    const settle = () => new Promise((resolve) => setImmediate(resolve));
    let logged: ReturnType<typeof memoryProvider>;

    beforeEach(() => {
      logged = memoryProvider();
      initLogger({ providers: [logged] });
    });
    afterEach(() => resetLogger());

    const warnings = () => logged.entries.filter((e) => e.level === "warn");

    it("rejects a call whose event stream ends without an answer once the timeout passes", async () => {
      const { fetch } = serverWithStreamedCall("ends");
      const connection = connectMcp({
        url: "https://mcp.test/mcp",
        fetch,
        timeout: 20,
      });

      await expect(connection.callTool("echo", {})).rejects.toThrow(
        "timed out"
      );
    });

    it("gives a call FALLBACK_MCP_TIMEOUT_MS when the server sets no timeout", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const { fetch, methods } = serverWithStreamedCall("open");
        const connection = connectMcp({ url: "https://mcp.test/mcp", fetch });
        const settled = vi.fn();

        const call = connection.callTool("echo", {});
        call.catch(settled);
        while (!methods.includes("tools/call")) await settle();
        await vi.advanceTimersByTimeAsync(FALLBACK_MCP_TIMEOUT_MS - 1);
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        await expect(call).rejects.toBeInstanceOf(McpTimeoutError);
      } finally {
        vi.useRealTimers();
      }
    });

    it("lets a running call finish before it closes the session", async () => {
      const { fetch, methods, release } = gatedServer();
      const connection = connectMcp({ url: "https://mcp.test/mcp", fetch });

      const call = connection.callTool("echo", {});
      await vi.waitFor(() => expect(methods).toContain("tools/call"));
      await connection.close();
      expect(methods).not.toContain("DELETE");
      release();

      await expect(call).resolves.toEqual({ text: "ok", isError: false });
      await vi.waitFor(() => expect(methods).toContain("DELETE"));
    });

    it("refuses a call made after close, without opening a session for it", async () => {
      const { fetch, methods, release } = gatedServer();
      release();
      const connection = connectMcp({ url: "https://mcp.test/mcp", fetch });
      await connection.callTool("echo", {});

      await connection.close();

      await expect(connection.callTool("echo", {})).rejects.toThrow("closed");
      expect(methods.filter((m) => m === "initialize")).toHaveLength(1);
    });

    it("stops an inbound stream whose session expired instead of reconnecting it", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const { fetch, methods, release } = gatedServer(
          (init) =>
            new Response(null, {
              status: new Headers(init?.headers).has("mcp-session-id")
                ? 404
                : 405,
            })
        );
        release();
        const connection = connectMcp({ url: "https://mcp.test/mcp", fetch });

        await connection.callTool("echo", {});
        for (let i = 0; i < 5; i++) await settle();
        const opened = methods.filter((m) => m === "GET").length;
        await vi.runAllTimersAsync();

        expect(opened).toBeGreaterThan(0);
        expect(methods.filter((m) => m === "GET")).toHaveLength(opened);
      } finally {
        vi.useRealTimers();
      }
    });

    it("warns, with its cause, when the inbound stream cannot reach the host", async () => {
      const { fetch, methods, release } = gatedServer(() => {
        throw new TypeError("Failed to fetch");
      });
      release();
      const connection = connectMcp({ url: "https://mcp.test/mcp", fetch });

      await connection.callTool("echo", {});
      await vi.waitFor(() => expect(methods).toContain("GET"));

      await vi.waitFor(() =>
        expect(warnings()[0]).toMatchObject({
          message: "The MCP inbound stream failed",
          context: { error: expect.stringContaining("Failed to fetch") },
        })
      );
    });

    it("warns, with the URL stripped of credentials and query, about a stream message it cannot parse, and not about a refused inbound stream", async () => {
      const { fetch } = serverWithStreamedCall("malformed");
      const connection = connectMcp({
        url: "https://user:secret-pass@mcp.test/mcp?token=secret-token",
        fetch,
        timeout: 20,
      });

      await connection.callTool("echo", {}).catch(() => undefined);

      expect(warnings()).toHaveLength(1);
      expect(warnings()[0].context).toMatchObject({
        url: "https://mcp.test/mcp",
      });
      expect(JSON.stringify(logged.entries)).not.toMatch(/secret-(pass|token)/);
    });

    it("rejects an aborted call, cancels its request, and sends nothing more", async () => {
      const { fetch, calls, methods, signals } = serverWithStreamedCall("open");
      const connection = connectMcp({ url: "https://mcp.test/mcp", fetch });
      const controller = new AbortController();

      const call = connection.callTool(
        "echo",
        {},
        { signal: controller.signal }
      );
      await vi.waitFor(() => expect(methods).toContain("tools/call"));
      const sent = calls.length;
      controller.abort();

      await expect(call).rejects.toThrow("aborted");
      expect(signals[0]?.aborted).toBe(true);
      expect(calls).toHaveLength(sent);
    });

    it("opens a new session and repeats a call the server rejects as expired", async () => {
      const { fetch, methods } = serverWithExpiringSession();
      const connection = connectMcp({ url: "https://mcp.test/mcp", fetch });

      const result = await connection.callTool("echo", {});

      expect(result).toEqual({ text: "ok", isError: false });
      expect(methods.filter((m) => m === "initialize")).toHaveLength(2);
      expect(methods.filter((m) => m === "tools/call")).toHaveLength(2);
    });

    it("repeats each of two concurrent calls the server rejects as expired, on one new session", async () => {
      const { fetch, methods } = serverWithExpiringSession();
      const connection = connectMcp({ url: "https://mcp.test/mcp", fetch });

      const results = await Promise.all([
        connection.callTool("echo", {}),
        connection.callTool("echo", {}),
      ]);

      expect(results).toEqual([
        { text: "ok", isError: false },
        { text: "ok", isError: false },
      ]);
      expect(methods.filter((m) => m === "initialize")).toHaveLength(2);
    });

    it("sends once a call that fails for another reason while a concurrent call hits an expired session", async () => {
      const { fetch, toolCalls, releaseExpiry } = serverWithExpiringSession({
        failing: "broken",
      });
      const connection = connectMcp({ url: "https://mcp.test/mcp", fetch });

      const echo = connection.callTool("echo", {});
      const broken = connection.callTool("broken", {});

      await expect(broken).rejects.toThrow("Tool failed");
      expect(toolCalls.filter((name) => name === "broken")).toHaveLength(1);
      releaseExpiry();
      await expect(echo).resolves.toEqual({ text: "ok", isError: false });
    });

    it("raises McpUnreachableError when fetch rejects with a TypeError", async () => {
      const fetch = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      const connection = connectMcp({
        url: "https://mcp.test/mcp",
        fetch: fetch as unknown as typeof globalThis.fetch,
      });

      await expect(connection.listTools()).rejects.toBeInstanceOf(
        McpUnreachableError
      );
    });
  });
}
