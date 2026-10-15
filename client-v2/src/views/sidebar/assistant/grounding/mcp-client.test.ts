import { listTools } from "./mcp-client";

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
  });

/** A session-less MCP server with one tool, recording every request */
const fakeServer = () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    const message = JSON.parse(String(init?.body));
    if (message.id === undefined) return new Response(null, { status: 202 });
    if (message.method === "initialize") {
      return json({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "fake", version: "1" },
        },
      });
    }
    return json({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] },
    });
  });
  return requests;
};

describe("the MCP client", () => {
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
      expect(request.headers.get("authorization")).toBe("Bearer token-1");
      expect(request.headers.get("x-extra")).toBe("1");
    }
  });

  it("points an unreachable host at the gateway", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch")
    );

    const failure = listTools({
      id: "refusing",
      name: "Refusing",
      url: "https://mcp.test/mcp",
      enabled: true,
    });

    await expect(failure).rejects.toMatchObject({
      name: "McpUnreachableError",
      message: expect.stringContaining("/api/mcp"),
    });
  });
});
