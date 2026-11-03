import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    mcpTelemetry: actual.mcpTelemetry,
  };
});

import { loadAi } from "@/shared/lib/ai";
import { initializeResult } from "@/shared/lib/ai/__fixtures__/fake-mcp";
import { rpcResult } from "@/shared/lib/json-rpc.mjs";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

import { createMcpTools } from "./model/mcp-tools";
import { createSkillTools } from "./model/skill-tools";
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

describe("switching a source", () => {
  let tracked: ReturnType<typeof memoryProvider>;

  beforeEach(() => {
    tracked = memoryProvider();
    initTelemetry({ providers: [tracked] });
  });

  afterEach(() => {
    resetTelemetry();
    vi.restoreAllMocks();
  });

  it("A gateway server switched off: declares no tools from it, and the same tools once it is on again", async () => {
    PgAssistant.setMcpServers([]);
    mcp.listGatewayServers.mockResolvedValueOnce([gatewayEntry("solana")]);
    await PgAssistant.loadMcpServers();
    await discovered(gatewayEntry("solana"), [
      { name: "search", inputSchema: {} },
    ]);

    PgAssistant.setMcpServerEnabled("solana", false);
    expect(PgAssistant.enabledMcpServers).toEqual([]);
    expect(createMcpTools()).toEqual([]);

    PgAssistant.setMcpServerEnabled("solana", true);
    expect(createMcpTools().map((tool) => tool.name)).toEqual([
      "solana__search",
    ]);
  });

  it.each([
    ["a gateway server", gatewayEntry("solana"), "gateway"],
    ["a user-added server", entry("extra"), "user"],
  ] as const)(
    "reports %s switched off by kind, never by id",
    async (_label, server, kind) => {
      PgAssistant.setMcpServers(kind === "user" ? [server] : []);
      mcp.listGatewayServers.mockResolvedValueOnce(
        kind === "gateway" ? [server] : []
      );
      await PgAssistant.loadMcpServers();

      PgAssistant.setMcpServerEnabled(server.id, false);

      expect(tracked.events).toEqual([
        {
          name: "mcp_server_toggled",
          params: { server: kind, enabled: false },
        },
      ]);
      PgAssistant.setMcpServers([]);
    }
  );

  /** `GET /api/skills` answers with these skills */
  const skillsRoute = (skills: unknown[]) =>
    vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(JSON.stringify({ skills }), { status: 200 })
      );

  const playgroundEnv = {
    id: "playground-env",
    name: "Playground build environment",
    description: "What compiles here.",
    enabled: true,
    source: { type: "bundled" },
  };

  const listedOff = {
    id: "orca",
    name: "Orca",
    description: "Orca Whirlpools.",
    enabled: false,
    source: {
      type: "remote",
      baseUrl: "https://skills.test/orca/",
      entry: "SKILL.md",
    },
    community: { repo: "sendaifun/skills" },
  };

  it("A skill withheld by the operator: listed nowhere, and load_skill refuses its id", async () => {
    skillsRoute([playgroundEnv]);
    await PgAssistant.loadSkills();

    const loadSkill = createSkillTools().find((t) => t.name === "load_skill");
    const refusal = await loadSkill?.run({ id: "solana-dev" }, {});

    expect(PgAssistant.skills.map((skill) => skill.id)).toEqual([
      "playground-env",
    ]);
    expect(refusal).toMatch(/^Could not load solana-dev: .*"solana-dev"/);
  });

  it("The skills route is unreachable: no skill, and the list says why", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch")
    );

    await PgAssistant.loadSkills();

    expect(PgAssistant.skills).toEqual([]);
    expect(PgAssistant.enabledSkills).toEqual([]);
    expect(PgAssistant.skillsUnavailable).toBe(true);
  });

  it("A community skill listed off: not enabled until checked, and each switch reported once", async () => {
    skillsRoute([playgroundEnv, listedOff]);
    await PgAssistant.loadSkills();
    expect(PgAssistant.enabledSkillIds).toEqual(["playground-env"]);

    PgAssistant.setSkillEnabled("orca", true);
    expect(PgAssistant.enabledSkillIds).toEqual(["playground-env", "orca"]);
    PgAssistant.setSkillEnabled("orca", false);

    expect(tracked.events).toEqual([
      { name: "skills_toggled", params: { id: "orca", enabled: true } },
      { name: "skills_toggled", params: { id: "orca", enabled: false } },
    ]);
  });

  it("keeps the user's choice when the skills are listed again", async () => {
    skillsRoute([playgroundEnv, listedOff]);
    await PgAssistant.loadSkills();
    PgAssistant.setSkillEnabled("orca", true);

    await PgAssistant.loadSkills();

    expect(PgAssistant.enabledSkillIds).toContain("orca");
    PgAssistant.setSkillEnabled("orca", false);
  });

  it.each([
    ["a listing", (answer: Answer) => answer.ok([playgroundEnv, listedOff])],
    ["a failure", (answer: Answer) => answer.fail()],
  ])(
    "keeps the later skills listing when the earlier call answers %s after it",
    async (_label, answerEarlier) => {
      const earlier = heldAnswer();
      vi.spyOn(globalThis, "fetch")
        .mockReturnValueOnce(earlier.response)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ skills: [playgroundEnv] }))
        );
      const first = PgAssistant.loadSkills();
      await PgAssistant.loadSkills();

      answerEarlier(earlier);
      await first;

      expect(PgAssistant.skills.map((skill) => skill.id)).toEqual([
        "playground-env",
      ]);
      expect(PgAssistant.skillsUnavailable).toBe(false);
    }
  );

  it("discovers MCP tools while the skills route has not answered", async () => {
    PgAssistant.setMcpServers([]);
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    mcp.listGatewayServers.mockResolvedValueOnce([gatewayEntry("docs")]);
    mcp.listTools.mockResolvedValueOnce([{ name: "search", inputSchema: {} }]);

    void PgAssistant.initMcp();

    await vi.waitFor(() => expect(PgAssistant.mcpTools.docs).toBeDefined());
  });
});

/** A `/api/skills` answer the test gives when it chooses */
interface Answer {
  response: Promise<Response>;
  ok(skills: unknown[]): void;
  fail(): void;
}

const heldAnswer = (): Answer => {
  let resolve: (response: Response) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const response = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    response,
    ok: (skills) => resolve(new Response(JSON.stringify({ skills }))),
    fail: () => reject(new TypeError("Failed to fetch")),
  };
};

it("keeps the later gateway server list when the earlier call answers after it", async () => {
  PgAssistant.setMcpServers([]);
  let answerEarlier: (servers: McpServerEntry[]) => void = () => {};
  mcp.listGatewayServers
    .mockReturnValueOnce(
      new Promise<McpServerEntry[]>((resolve) => {
        answerEarlier = resolve;
      })
    )
    .mockResolvedValueOnce([]);
  const first = PgAssistant.loadMcpServers();
  await PgAssistant.loadMcpServers();

  answerEarlier([gatewayEntry("team")]);
  await first;

  expect(PgAssistant.gatewayMcpServers).toEqual([]);
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
