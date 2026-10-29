import type { McpServerEntry } from "@/features/mcp";

const mcp = vi.hoisted(() => ({ callTool: vi.fn(), listTools: vi.fn() }));
vi.mock("@/features/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/mcp")>();
  return {
    LOCAL_MCP_SERVERS: actual.LOCAL_MCP_SERVERS,
    sameConnection: actual.sameConnection,
    listTools: mcp.listTools,
    listGatewayServers: actual.listGatewayServers,
    closeConnection: vi.fn(),
    callTool: mcp.callTool,
  };
});

import { PgAssistant } from "../store";
import { createMcpTools } from "./mcp-tools";

const server: McpServerEntry = {
  id: "srv",
  name: "Srv",
  url: "https://srv.test/mcp",
  enabled: true,
};

const echo = async () => {
  PgAssistant.setMcpServers([server]);
  mcp.listTools.mockResolvedValueOnce([{ name: "echo", inputSchema: {} }]);
  await PgAssistant.discoverToolsOf(server);
  const [tool] = createMcpTools();
  return tool;
};

it("calls an entry edited after its tools were built with the edited URL and token only", async () => {
  mcp.callTool.mockResolvedValue({ text: "done", isError: false });
  const tool = await echo();
  const edited: McpServerEntry = {
    id: "srv",
    name: "Srv",
    url: "https://srv.test/v2",
    enabled: true,
    authToken: "new-token",
  };
  PgAssistant.setMcpServers([edited]);
  const before = mcp.callTool.mock.calls.length;

  await tool.run({}, {});

  expect(mcp.callTool.mock.calls.slice(before).map(([entry]) => entry)).toEqual(
    [edited]
  );
});

it("refuses, with no request, a call to an entry removed after its tools were built", async () => {
  const tool = await echo();
  PgAssistant.setMcpServers([]);
  const before = mcp.callTool.mock.calls.length;

  const answer = await tool.run({}, {});

  expect(answer).toContain("removed or turned off");
  expect(mcp.callTool.mock.calls).toHaveLength(before);
});

it("passes the turn's abort signal to the call", async () => {
  mcp.callTool.mockResolvedValue({ text: "done", isError: false });
  const controller = new AbortController();

  await (await echo()).run({ q: 1 }, { signal: controller.signal });

  expect(mcp.callTool).toHaveBeenCalledWith(
    server,
    "echo",
    { q: 1 },
    { signal: controller.signal }
  );
});

it("records no failure for a call that Stop ended", async () => {
  const controller = new AbortController();
  mcp.callTool.mockImplementation(async () => {
    controller.abort();
    throw new Error("Request was aborted");
  });
  const recorded = vi.spyOn(PgAssistant, "addToolCall");

  await (await echo()).run({}, { signal: controller.signal });

  expect(recorded.mock.calls).toEqual([["echo on Srv"]]);
});
