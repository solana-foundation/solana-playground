import { connectMcp, McpUnreachableError } from "./mcp";

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
  });

/** A session-based MCP server that forgets its first session after `initialize` */
const serverWithExpiringSession = () => {
  const methods: string[] = [];
  let sessions = 0;
  let live: string | undefined;

  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "POST") return new Response(null, { status: 405 });

    const message = JSON.parse(String(init?.body));
    methods.push(message.method);
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

    // The first session expires as soon as it is used
    if (session !== live || session === "s1") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32001, message: "Session not found" },
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

  return { fetch: fetch as unknown as typeof globalThis.fetch, methods };
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
