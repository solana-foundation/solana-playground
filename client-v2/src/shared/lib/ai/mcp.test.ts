import { connectMcp, McpUnreachableError } from "./mcp";

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
  });

/**
 * A session-based MCP server that forgets its first session after `initialize`.
 * The tool named `failing` errors on any session once the first expiry is sent,
 * and the expiry's body waits for `releaseExpiry`, so that error lands first.
 */
const serverWithExpiringSession = ({ failing }: { failing?: string } = {}) => {
  const methods: string[] = [];
  const toolCalls: string[] = [];
  let sessions = 0;
  let live: string | undefined;
  let expirySent: () => void = () => undefined;
  const firstExpiry = new Promise<void>((resolve) => (expirySent = resolve));
  let releaseExpiry: () => void = () => undefined;
  const expiryReleased = new Promise<void>(
    (resolve) => (releaseExpiry = resolve)
  );

  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "POST") return new Response(null, { status: 405 });

    const message = JSON.parse(String(init?.body));
    methods.push(message.method);
    if (message.method === "tools/call") toolCalls.push(message.params.name);
    const session = new Headers(init?.headers).get("mcp-session-id");

    if (message.method === "initialize") {
      const id = `s${++sessions}`;
      live = id;
      return json(
        {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fake", version: "1" },
          },
        },
        { "mcp-session-id": id }
      );
    }
    if (message.id === undefined) return new Response(null, { status: 202 });

    if (failing !== undefined && message.params?.name === failing) {
      await firstExpiry;
      return json({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: "Tool failed" },
      });
    }

    // The first session expires as soon as it is used
    if (session !== live || session === "s1") {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32001, message: "Session not found" },
      });
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
    return json({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: "ok" }] },
    });
  });

  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    methods,
    toolCalls,
    releaseExpiry,
  };
};

describe("connectMcp", () => {
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
