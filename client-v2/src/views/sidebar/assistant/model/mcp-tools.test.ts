import type { McpServerEntry } from "@/features/mcp";

const mcp = vi.hoisted(() => ({
  callTool: vi.fn(),
  listTools: vi.fn(),
  listGatewayServers: vi.fn(),
}));
vi.mock("@/features/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/mcp")>();
  return {
    LOCAL_MCP_SERVERS: actual.LOCAL_MCP_SERVERS,
    sameConnection: actual.sameConnection,
    listTools: mcp.listTools,
    listGatewayServers: mcp.listGatewayServers,
    closeConnection: vi.fn(),
    callTool: mcp.callTool,
    mcpTelemetry: actual.mcpTelemetry,
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

/** Answer every approval card the way the user would, with the card it was asked on */
const answerCards = (allowed: boolean) =>
  vi
    .spyOn(PgAssistant, "requestApproval")
    .mockImplementation(async () => ({ id: "card", allowed }));

beforeEach(() => {
  vi.restoreAllMocks();
  mcp.callTool.mockReset();
  answerCards(true);
});

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

describe("a server the user added", () => {
  it("asks on a card naming the tool, the server, its host and the arguments", async () => {
    mcp.callTool.mockResolvedValue({ text: "done", isError: false });
    const asked = answerCards(true);

    await (await echo()).run({ q: 1 }, {});

    expect(asked).toHaveBeenCalledWith({
      type: "tool",
      server: "Srv",
      tool: "echo",
      host: "srv.test",
      input: '{\n  "q": 1\n}',
      effect: "Sends these arguments to srv.test.",
      question: "Call echo on Srv?",
    });
  });

  it("names the user's saved credentials on the card when the entry has some", async () => {
    mcp.callTool.mockResolvedValue({ text: "done", isError: false });
    const asked = answerCards(true);
    const tool = await echo();
    PgAssistant.setMcpServers([
      {
        id: "srv",
        name: "Srv",
        url: "https://srv.test/mcp",
        enabled: true,
        authToken: "token",
      },
    ]);

    await tool.run({}, {});

    expect(asked).toHaveBeenCalledWith(
      expect.objectContaining({
        effect:
          "Sends these arguments to srv.test, with the credentials you saved for Srv.",
      })
    );
  });

  it("runs an allowed call, returns its result and records it on the card", async () => {
    mcp.callTool.mockResolvedValue({ text: "done", isError: false });
    const outcome = vi.spyOn(PgAssistant, "setApprovalOutcome");

    const answer = await (await echo()).run({}, {});

    expect(answer).toBe("done");
    expect(mcp.callTool).toHaveBeenCalledTimes(1);
    expect(outcome).toHaveBeenCalledWith("card", "called");
  });

  it("records a call that failed as failed on its card", async () => {
    mcp.callTool.mockRejectedValue(new Error("boom"));
    const failure = vi.spyOn(PgAssistant, "setApprovalFailure");

    await (await echo()).run({}, {});

    expect(failure).toHaveBeenCalledWith("card", "call failed: boom");
  });

  it("sends nothing to the server for a declined call and tells the model", async () => {
    const tool = await echo();
    answerCards(false);
    const recorded = vi.spyOn(PgAssistant, "addToolCall");

    const answer = await tool.run({ q: 1 }, {});

    expect(answer).toBe("The user declined to call echo on Srv.");
    expect(mcp.callTool).not.toHaveBeenCalled();
    expect(recorded).not.toHaveBeenCalled();
  });

  it("sends nothing when the server's URL changed while the card waited", async () => {
    const tool = await echo();
    vi.spyOn(PgAssistant, "requestApproval").mockImplementation(async () => {
      PgAssistant.setMcpServers([
        {
          id: "srv",
          name: "Srv",
          url: "https://elsewhere.test/mcp",
          enabled: true,
        },
      ]);
      return { id: "card", allowed: true };
    });

    const answer = await tool.run({}, {});

    expect(answer).toContain("changed while the approval waited");
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it("sends nothing when the server's token changed while the card waited", async () => {
    const tool = await echo();
    vi.spyOn(PgAssistant, "requestApproval").mockImplementation(async () => {
      PgAssistant.setMcpServers([
        {
          id: "srv",
          name: "Srv",
          url: "https://srv.test/mcp",
          enabled: true,
          authToken: "other-token",
        },
      ]);
      return { id: "card", allowed: true };
    });

    const answer = await tool.run({}, {});

    expect(answer).toContain("changed while the approval waited");
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it("marks the card failed when the tool reports an error", async () => {
    mcp.callTool.mockResolvedValue({ text: "nope", isError: true });
    const failure = vi.spyOn(PgAssistant, "setApprovalFailure");

    await (await echo()).run({}, {});

    expect(failure).toHaveBeenCalledWith("card", "the tool reported an error");
  });

  it("marks an allowed call that Stop ended as stopped, not failed", async () => {
    const controller = new AbortController();
    mcp.callTool.mockImplementation(async () => {
      controller.abort();
      throw new Error("Request was aborted");
    });
    const outcome = vi.spyOn(PgAssistant, "setApprovalOutcome");
    const failure = vi.spyOn(PgAssistant, "setApprovalFailure");

    await (await echo()).run({}, { signal: controller.signal });

    expect(outcome).toHaveBeenCalledWith(
      "card",
      "stopped: the server may already have acted"
    );
    expect(failure).not.toHaveBeenCalled();
  });

  it("sends nothing when the turn is stopped while the card waits", async () => {
    const tool = await echo();
    vi.restoreAllMocks();
    const controller = new AbortController();
    PgAssistant.beginTurn(controller);

    const running = tool.run({}, { signal: controller.signal });
    expect(PgAssistant.items.at(-1)).toMatchObject({
      kind: "approval",
      status: "pending",
    });
    PgAssistant.stopTurn();

    expect(await running).toContain("declined");
    expect(mcp.callTool).not.toHaveBeenCalled();
    PgAssistant.endTurn(controller);
  });

  it("waits on a real card and sends nothing once it is denied", async () => {
    const tool = await echo();
    vi.restoreAllMocks();

    const running = tool.run({}, {});
    const card = PgAssistant.items.at(-1);
    expect(card).toMatchObject({ kind: "approval", status: "pending" });
    expect(mcp.callTool).not.toHaveBeenCalled();
    PgAssistant.resolveApproval(card?.id ?? "", false);

    expect(await running).toContain("declined");
    expect(mcp.callTool).not.toHaveBeenCalled();
  });
});

it("calls a tool of a server the gateway offers without a card", async () => {
  const gateway: McpServerEntry = {
    id: "docs",
    name: "Docs",
    url: "https://docs.test/mcp",
    enabled: true,
  };
  mcp.listGatewayServers.mockResolvedValueOnce([gateway]);
  await PgAssistant.loadMcpServers();
  PgAssistant.setMcpServers([]);
  mcp.listTools.mockResolvedValueOnce([{ name: "search", inputSchema: {} }]);
  await PgAssistant.discoverToolsOf(gateway);
  mcp.callTool.mockResolvedValue({ text: "found", isError: false });
  const asked = vi.spyOn(PgAssistant, "requestApproval");
  const [tool] = createMcpTools();

  const answer = await tool.run({}, {});

  expect(answer).toBe("found");
  expect(asked).not.toHaveBeenCalled();
  mcp.listGatewayServers.mockResolvedValueOnce([]);
  await PgAssistant.loadMcpServers();
});
