import { expect, it, vi } from "vitest";
import type { McpServerEntry, McpTool } from "@/features/mcp";

const mcp = vi.hoisted(() => ({
  closeConnection: vi.fn(),
  listGatewayServers: vi.fn(),
  listTools: vi.fn(),
}));
vi.mock("@/features/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/mcp")>();
  return {
    LOCAL_MCP_SERVERS: actual.LOCAL_MCP_SERVERS,
    sameConnection: actual.sameConnection,
    // A real listing unless a test queues an answer of its own
    listTools: (server: McpServerEntry) =>
      mcp.listTools(server) ?? actual.listTools(server),
    callTool: actual.callTool,
    // Recorded, and still closes, so a test can see which requests a closed entry gets
    closeConnection: (id: string) => {
      mcp.closeConnection(id);
      actual.closeConnection(id);
    },
    listGatewayServers: mcp.listGatewayServers,
  };
});

import { loadAi } from "@/shared/lib/ai";
import { initializeResult } from "@/shared/lib/ai/__fixtures__/fake-mcp";
import { rpcResult } from "@/shared/lib/json-rpc.mjs";
import { createMcpTools } from "./model/mcp-tools";
import { PgAssistant } from "./store";

const entry = (id: string): McpServerEntry => ({
  id,
  name: id,
  url: `https://${id}.test/mcp`,
  enabled: true,
});

const gatewayEntry = (id: string): McpServerEntry => ({
  id,
  name: id,
  url: `/api/mcp?server[]=${id}`,
  enabled: true,
});

/** A local `explorer` applied while the gateway lacks it, then a gateway that serves `explorer` */
const gatewayTakesOverExplorer = async (afterLocal = async () => {}) => {
  mcp.listGatewayServers.mockResolvedValueOnce([]);
  await PgAssistant.loadMcpServers();
  PgAssistant.setMcpServers([entry("explorer")]);
  await afterLocal();
  mcp.listGatewayServers.mockResolvedValueOnce([gatewayEntry("explorer")]);
  await PgAssistant.loadMcpServers();
};

/** Cache `tools` under `server`'s id, the way discovery does */
const discovered = (server: McpServerEntry, tools: McpTool[]) => {
  mcp.listTools.mockResolvedValueOnce(tools);
  return PgAssistant.discoverToolsOf(server);
};

/** Every MCP server answers with one `search` tool; returns each request's URL and method */
const fakeMcpServers = () => {
  const requests: Array<{ url: string; method: string }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "DELETE") {
      requests.push({ url, method: "DELETE" });
      return new Response(null, { status: 200 });
    }
    const message = JSON.parse(String(init?.body));
    requests.push({ url, method: message.method });
    if (message.id === undefined) return new Response(null, { status: 202 });
    const results: Record<string, () => unknown> = {
      initialize: () => initializeResult(message.params),
      "tools/list": () => ({
        tools: [{ name: "search", inputSchema: { type: "object" } }],
      }),
      "tools/call": () => ({ content: [{ type: "text", text: "done" }] }),
    };
    const result = results[message.method]();
    return new Response(JSON.stringify(rpcResult(message.id, result)), {
      headers: { "content-type": "application/json", "mcp-session-id": url },
    });
  });
  return requests;
};

it("closes the connection of a local entry the user removes, and only that one", () => {
  PgAssistant.setMcpServers([entry("kept"), entry("removed")]);

  PgAssistant.setMcpServers([entry("kept")]);

  expect(mcp.closeConnection.mock.calls).toEqual([["removed"]]);
});

it("closes the connection of a gateway entry the gateway stops serving", async () => {
  PgAssistant.setMcpServers([]);
  mcp.listGatewayServers.mockResolvedValueOnce([entry("explorer")]);
  await PgAssistant.loadMcpServers();
  mcp.closeConnection.mockClear();
  mcp.listGatewayServers.mockResolvedValueOnce([]);

  await PgAssistant.loadMcpServers();

  expect(mcp.closeConnection.mock.calls).toEqual([["explorer"]]);
});

it("keeps one entry per id, the gateway's, when the gateway takes over a local entry's id, and builds its tools", async () => {
  await gatewayTakesOverExplorer();
  await discovered(gatewayEntry("explorer"), [
    { name: "search", inputSchema: {} },
  ]);
  const { toSdkTools } = await loadAi();

  expect(PgAssistant.mcpServers).toEqual([gatewayEntry("explorer")]);
  expect(() => toSdkTools(createMcpTools())).not.toThrow();
});

it("shows a local entry the gateway took over as replaced, and uses it again once the gateway stops serving its id", async () => {
  await gatewayTakesOverExplorer();
  expect(PgAssistant.shadowedMcpServers).toEqual([entry("explorer")]);
  mcp.listGatewayServers.mockResolvedValueOnce([]);

  await PgAssistant.loadMcpServers();

  expect(PgAssistant.mcpServers).toEqual([entry("explorer")]);
  expect(PgAssistant.shadowedMcpServers).toEqual([]);
});

it("drops the tools discovered on a local entry when the gateway takes over its id", async () => {
  await gatewayTakesOverExplorer(() =>
    discovered(entry("explorer"), [{ name: "local", inputSchema: {} }])
  );

  expect(PgAssistant.mcpTools.explorer).toBeUndefined();
});

it.each([
  ["discovery of every server", () => PgAssistant.discoverMcpTools(true)],
  [
    "the console's discovery",
    () => PgAssistant.discoverToolsOf(entry("explorer")),
  ],
])(
  "keeps a local entry's tools out of the cache when %s ends after the gateway took over its id",
  async (_, discover) => {
    let answer: (tools: McpTool[]) => void = () => {};
    mcp.listTools.mockReturnValueOnce(
      new Promise<McpTool[]>((resolve) => {
        answer = resolve;
      })
    );
    let discovering: Promise<void> = Promise.resolve();
    await gatewayTakesOverExplorer(async () => {
      discovering = discover();
    });

    answer([{ name: "local", inputSchema: {} }]);
    await discovering;

    expect(PgAssistant.mcpTools.explorer).toBeUndefined();
  }
);

it("sends a local entry's URL nothing but the session's close once the gateway takes over its id", async () => {
  const requests = fakeMcpServers();
  await gatewayTakesOverExplorer(() => PgAssistant.discoverMcpTools(true));
  const takeover = requests.length;

  await PgAssistant.discoverMcpTools(true);
  await createMcpTools()[0].run({}, {});

  const toLocal = (from: number) =>
    requests
      .slice(from)
      .filter((r) => r.url.startsWith("https://explorer"))
      .map((r) => r.method);
  await vi.waitFor(() => expect(toLocal(0)).toContain("DELETE"));
  expect(toLocal(takeover).filter((m) => m !== "DELETE")).toEqual([]);
  expect(requests.slice(takeover).map((r) => r.method)).toContain("tools/call");
});
