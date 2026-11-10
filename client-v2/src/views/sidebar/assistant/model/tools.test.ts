import { NetworkRefusedError } from "@/commands/deploy/network-refused";
import { requireFor } from "@/test-utils/require-for";

import type { PlaygroundBridge } from "../bridge/playground-bridge";
import { PgPatchUndo } from "../patch-undo";
import { type AssistantMode, PgAssistant } from "../store";
import { READING_TOOLS } from "./reading-tools";
import { createTools, notInContext } from "./tools";

vi.mock("./skill-tools", () => ({ createSkillTools: () => [] }));
vi.mock("./mcp-tools", () => ({ createMcpTools: () => [] }));
// Only the default value is needed here; reaching the real one drags in the
// utils barrel, which wants webpack-injected globals
vi.mock("../bridge/playground-bridge", () => ({ realBridge: {} }));

/** The files the write_file cases treat as in the conversation's context */
const IN_CONTEXT = ["src/lib.rs", "src/a.rs", "src/b.rs"];
/** The real normaliser is the entity's; a leading `/` is all these cases use */
const toProjectPath = (path: string) => path.replace(/^\/+/, "");

/** A bridge whose context is `context`, every file of it holding `content` */
const bridgeIn =
  (context: readonly string[]) =>
  (content: string | null): PlaygroundBridge =>
    ({
      readFile: () => content,
      applyPatch: vi.fn(async () => {}),
      listContextFiles: () => context,
      toProjectPath,
    } as unknown as PlaygroundBridge);
const bridge = bridgeIn(IN_CONTEXT);

const writeFile = (b: PlaygroundBridge) =>
  requireFor("the write_file tool")(
    createTools(b).find((tool) => tool.name === "write_file")
  );

/** The id of the approval card added most recently */
const latestCard = () =>
  PgAssistant.items.filter((i) => i.kind === "approval").slice(-1)[0].id;

beforeEach(() => PgAssistant.clear());

describe("write_file", () => {
  it("does not ask for approval when the content is unchanged", async () => {
    const result = await writeFile(bridge("same")).run({
      path: "src/lib.rs",
      content: "same",
    });

    expect(result).toContain("already contains exactly that content");
    expect(PgAssistant.items).toHaveLength(0);
    expect(PgAssistant.status).toBe("idle");
  });

  it("asks for approval when the content differs", async () => {
    const pending = writeFile(bridge("old")).run({
      path: "src/lib.rs",
      content: "new",
    });

    // The approval card holds the tool open until the user clicks
    await Promise.resolve();
    expect(PgAssistant.items).toHaveLength(1);
    expect(PgAssistant.status).toBe("awaiting");

    PgAssistant.resolveApproval(latestCard(), false);
    expect(await pending).toContain("rejected");
  });

  it("records each outcome on its own card when two run at once", async () => {
    // The Anthropic runner executes a turn's tool calls concurrently, so two
    // cards can be open together. Reading "the latest approval" after the
    // await gave both outcomes to the second card and none to the first.
    const b = bridge("old");
    const first = writeFile(b).run({ path: "src/a.rs", content: "a" });
    const second = writeFile(b).run({ path: "src/b.rs", content: "b" });
    await Promise.resolve();

    const [a, z] = PgAssistant.items;
    PgAssistant.resolveApproval(a.id, true);
    PgAssistant.resolveApproval(z.id, true);
    await Promise.all([first, second]);

    const outcomes = PgAssistant.items.map((item) =>
      item.kind === "approval" ? [item.request, item.outcome] : null
    );
    expect(outcomes).toEqual([
      [expect.objectContaining({ path: "src/a.rs" }), "Wrote src/a.rs"],
      [expect.objectContaining({ path: "src/b.rs" }), "Wrote src/b.rs"],
    ]);
  });

  it("marks the card failed with the explorer's reason when the write is refused", async () => {
    const b = bridge("old");
    vi.mocked(b.applyPatch).mockRejectedValue(
      new Error("A file can be at most 128 KB.")
    );
    const pending = writeFile(b).run({ path: "src/lib.rs", content: "new" });
    await Promise.resolve();
    PgAssistant.resolveApproval(latestCard(), true);

    expect(await pending).toBe(
      "Could not write src/lib.rs: A file can be at most 128 KB."
    );
    expect(PgAssistant.items[0]).toMatchObject({
      status: "failed",
      outcome: "not written: A file can be at most 128 KB.",
    });
  });
  it("never reports a write that happened as not written", async () => {
    const b = bridge("old");
    vi.spyOn(PgPatchUndo, "wrote").mockImplementation(() => {
      throw new Error("undo store full");
    });
    const pending = writeFile(b).run({ path: "src/lib.rs", content: "new" });
    await Promise.resolve();
    PgAssistant.resolveApproval(latestCard(), true);

    const said = await Promise.resolve(pending).catch((e: Error) => e.message);
    expect(b.applyPatch).toHaveBeenCalled();
    expect(said).not.toMatch(/Could not write/);
    expect(PgAssistant.items[0]).not.toMatchObject({ status: "failed" });
    vi.restoreAllMocks();
  });

  it("leaves an applied patch undoable, and a failed or rejected one not", async () => {
    const file = { content: "old" };
    const b = {
      readFile: () => file.content,
      applyPatch: vi.fn(async ({ content }: { content: string }) => {
        file.content = content;
      }),
      listContextFiles: () => IN_CONTEXT,
      toProjectPath,
    } as unknown as PlaygroundBridge;

    const applied = writeFile(b).run({ path: "src/lib.rs", content: "new" });
    await Promise.resolve();
    const card = latestCard();
    PgAssistant.resolveApproval(card, true);
    await applied;

    const item = PgAssistant.items.find((i) => i.id === card);
    expect(item?.kind === "approval" && PgPatchUndo.canWith(b)(item)).toBe(
      true
    );

    vi.mocked(b.applyPatch).mockRejectedValueOnce(new Error("disk"));
    const failed = writeFile(b).run({ path: "src/lib.rs", content: "newer" });
    await Promise.resolve();
    const failedCard = latestCard();
    PgAssistant.resolveApproval(failedCard, true);
    await failed;

    file.content = "newer";
    const failedItem = PgAssistant.items.find((i) => i.id === failedCard);
    expect(
      failedItem?.kind === "approval" && PgPatchUndo.canWith(b)(failedItem)
    ).toBe(false);
  });
});

describe("write_file outside the context", () => {
  it("does not tell the model a guess matches a file it may not read", async () => {
    const pending = writeFile(bridgeIn([])("secret")).run({
      path: "secret/other.rs",
      content: "secret",
    });

    await Promise.resolve();
    // The approval card, not the "already contains" answer: that answer would
    // confirm the guessed content of a file outside the context
    expect(PgAssistant.status).toBe("awaiting");
    PgAssistant.resolveApproval(latestCard(), false);
    expect(await pending).not.toContain("already contains");
  });

  it("writes the path the model spelt with a leading slash as the project's", async () => {
    const pending = writeFile(bridge("old")).run({
      path: "/src/lib.rs",
      content: "new",
    });
    await Promise.resolve();

    const card = PgAssistant.items.find((i) => i.kind === "approval");
    expect(card?.kind === "approval" && card.request).toEqual(
      expect.objectContaining({ path: "src/lib.rs" })
    );
    PgAssistant.resolveApproval(latestCard(), false);
    await pending;
  });

  it("refuses a path that leaves the project", async () => {
    const b = {
      // eslint-disable-next-line unicorn/no-null -- `PlaygroundBridge.readFile` gives `null` for a missing file
      readFile: () => null,
      applyPatch: vi.fn(async () => {}),
      listContextFiles: () => IN_CONTEXT,
      toProjectPath: () => undefined,
    } as unknown as PlaygroundBridge;

    expect(
      await writeFile(b).run({ path: "../outside.rs", content: "x" })
    ).toContain("outside the project");
    expect(b.applyPatch).not.toHaveBeenCalled();
  });
});

describe("read_file", () => {
  const files: Record<string, string> = {
    "src/lib.rs": "pub fn in_context() {}",
    "secret/other.rs": "pub fn secret() {}",
  };
  const contextBridge = {
    // eslint-disable-next-line unicorn/no-null -- `PlaygroundBridge.readFile` gives `null` for a missing file
    readFile: (path: string) => files[path] ?? null,
    listContextFiles: () => ["src/lib.rs"],
    toProjectPath: (path: string) =>
      path.startsWith("..") ? undefined : path.replace(/^\.?\/+/, ""),
  } as unknown as PlaygroundBridge;
  const readFile = (path: string) => {
    const tool = createTools(contextBridge).find((t) => t.name === "read_file");
    if (!tool) throw new Error("no read_file tool");
    return tool.run({ path });
  };

  it("reads a file in the context", async () => {
    expect(await readFile("src/lib.rs")).toBe("pub fn in_context() {}");
  });

  it("reads a file in the context however the model spells its path", async () => {
    expect(await readFile("/src/lib.rs")).toBe("pub fn in_context() {}");
    expect(await readFile("./src/lib.rs")).toBe("pub fn in_context() {}");
  });

  it("refuses a file outside the context without its content", async () => {
    const result = await readFile("secret/other.rs");
    expect(result).toBe(notInContext("secret/other.rs"));
    expect(result).not.toContain("pub fn secret");
    expect(result).toContain("+ in the composer");
  });

  it("refuses a path that leaves the project, naming what was asked", async () => {
    expect(await readFile("../etc/passwd")).toBe(notInContext("../etc/passwd"));
  });

  it("offers no tool that lists the project", () => {
    expect(createTools(contextBridge).map((tool) => tool.name)).not.toContain(
      "list_files"
    );
  });
});

describe("build and deploy", () => {
  const commandBridge = (
    over: Partial<Record<"build" | "deploy", () => Promise<unknown>>>,
    buildError: string | null = null
  ): PlaygroundBridge =>
    ({
      build: over.build ?? vi.fn(async () => {}),
      deploy: over.deploy ?? vi.fn(async () => null),
      quoteDeploy: vi.fn(async () => ({
        network: "devnet",
        cost: null,
        playground: false,
      })),
      getProjectContext: () => ({ buildError, cluster: "devnet" }),
    } as unknown as PlaygroundBridge);

  /** Runs a command tool, allows its card, and returns the card it left */
  const allowed = async (b: PlaygroundBridge, name: "build" | "deploy") => {
    const pending = createTools(b)
      .find((tool) => tool.name === name)!
      .run({});
    await Promise.resolve();
    PgAssistant.resolveApproval(latestCard(), true);
    const result = await pending;
    return { result, card: PgAssistant.items[0] };
  };

  it("marks a build with compile errors failed", async () => {
    const { result, card } = await allowed(
      commandBridge({}, "error[E0425]: cannot find value"),
      "build"
    );
    expect(result).toContain("The build failed");
    expect(card).toMatchObject({ status: "failed", outcome: "build failed" });
  });

  it("marks a build that could not run failed with the reason", async () => {
    const { card } = await allowed(
      commandBridge({
        build: vi.fn(async () => {
          throw new Error("build server unreachable");
        }),
      }),
      "build"
    );
    expect(card).toMatchObject({
      status: "failed",
      outcome: "build could not run: build server unreachable",
    });
  });

  it("leaves a successful build applied", async () => {
    const { card } = await allowed(commandBridge({}), "build");
    expect(card).toMatchObject({
      status: "allowed",
      outcome: "build succeeded",
    });
  });

  it("marks a failed deploy failed with the reason", async () => {
    const { result, card } = await allowed(
      commandBridge({
        deploy: vi.fn(async () => {
          throw new Error("insufficient funds");
        }),
      }),
      "deploy"
    );
    expect(result).toBe("The deployment failed: insufficient funds");
    expect(card).toMatchObject({
      status: "failed",
      outcome: "deploy failed: insufficient funds",
    });
  });
});

describe("build and deploy approvals", () => {
  type Quote = Awaited<ReturnType<PlaygroundBridge["quoteDeploy"]>>;
  const PRICED: Quote = {
    network: "devnet",
    cost: 1_420_000_000,
    playground: true,
  };
  const CONNECTED_WALLET: Quote = {
    network: "devnet",
    cost: 1_420_000_000,
    playground: false,
  };
  const NO_NETWORK: Quote = {
    network: undefined,
    cost: 1_420_000_000,
    playground: true,
  };
  const NO_COST: Quote = {
    network: "devnet",
    // eslint-disable-next-line unicorn/no-null -- `quoteDeploy().cost` is `number | null`, null meaning no estimate
    cost: null,
    playground: true,
  };
  const NO_NETWORK_NO_COST: Quote = {
    network: undefined,
    // eslint-disable-next-line unicorn/no-null -- `quoteDeploy().cost` is `number | null`, null meaning no estimate
    cost: null,
    playground: true,
  };

  /** A bridge whose deploy quote is the one given */
  const commandBridge = (quote: Quote): PlaygroundBridge =>
    ({
      getProjectContext: () => ({
        workspaceName: "hello_anchor",
        cluster: "https://api.devnet.solana.com",
        // eslint-disable-next-line unicorn/no-null -- `ProjectContext.buildError` is `string | null`
        buildError: null,
      }),
      quoteDeploy: async () => quote,
      build: vi.fn(async () => {}),
      // eslint-disable-next-line unicorn/no-null -- `deploy()` answers `null` without a program id
      deploy: vi.fn(async () => null),
    } as unknown as PlaygroundBridge);

  /** The question on the approval card a tool opened */
  const askedWith = async (tool: "build" | "deploy", b: PlaygroundBridge) => {
    const found = createTools(b).find((t) => t.name === tool);
    if (!found) throw new Error(`createTools has no tool named ${tool}`);
    const run = found.run({});
    await vi.waitFor(() => expect(PgAssistant.items).toHaveLength(1));
    const card = PgAssistant.items[0];
    PgAssistant.resolveApproval(card.id, false);
    await run;
    return card.kind === "approval" && card.request.type === "command"
      ? card.request.question
      : undefined;
  };

  it("asks whether to deploy the program to the network, naming the cost", async () => {
    expect(await askedWith("deploy", commandBridge(PRICED))).toBe(
      "Deploy hello_anchor to devnet? It costs about 1.42 devnet SOL from your Playground wallet."
    );
  });

  it("names a connected wallet as the payer when it is not the Playground's", async () => {
    expect(await askedWith("deploy", commandBridge(CONNECTED_WALLET))).toBe(
      "Deploy hello_anchor to devnet? It costs about 1.42 devnet SOL from your wallet."
    );
  });

  it("names no network in the cost while the cluster is unknown", async () => {
    expect(await askedWith("deploy", commandBridge(NO_NETWORK))).toBe(
      "Deploy hello_anchor to the network? It costs about 1.42 SOL from your Playground wallet."
    );
  });

  it("leaves the cost out when it cannot be estimated", async () => {
    expect(await askedWith("deploy", commandBridge(NO_COST))).toBe(
      "Deploy hello_anchor to devnet?"
    );
  });

  it("names the network and leaves the cost out when neither is known", async () => {
    expect(await askedWith("deploy", commandBridge(NO_NETWORK_NO_COST))).toBe(
      "Deploy hello_anchor to the network?"
    );
  });

  it("deploys nothing when the network changed while the approval waited", async () => {
    let cluster = "https://api.devnet.solana.com";
    const deploy = vi.fn(async () => {});
    const b = {
      getProjectContext: () => ({
        workspaceName: "hello_anchor",
        cluster,
        // eslint-disable-next-line unicorn/no-null -- `ProjectContext.buildError` is `string | null`
        buildError: null,
      }),
      quoteDeploy: async () => PRICED,
      deploy,
    } as unknown as PlaygroundBridge;
    const found = createTools(b).find((t) => t.name === "deploy");
    if (!found) throw new Error("createTools has no tool named deploy");
    const run = found.run({});
    await vi.waitFor(() => expect(PgAssistant.items).toHaveLength(1));
    cluster = "https://api.mainnet-beta.solana.com";
    PgAssistant.resolveApproval(PgAssistant.items[0].id, true);

    expect(await run).toContain("nothing was deployed");
    expect(deploy).not.toHaveBeenCalled();
    expect(PgAssistant.items[0]).toMatchObject({
      status: "failed",
      outcome: "not deployed: network changed",
    });
  });

  it("asks whether to build the program", async () => {
    expect(await askedWith("build", commandBridge(NO_COST))).toBe(
      "Build hello_anchor?"
    );
  });
});

describe("a mode", () => {
  const hint = {
    name: "hint",
    description: "Post the live question's hint",
    schema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false as const,
    },
    run: () => "Posted.",
  };
  const tutorial: AssistantMode = {
    name: "tutorial",
    context: () => "Tutorial: Hello Anchor",
    tools: [hint],
    allows: (name) => name === "read_file",
    refusal: "The lesson builds; offer a change instead.",
  };
  const names = (tools: { name: string }[]) => tools.map((t) => t.name);

  it("leaves the tools as they are without one", () => {
    // eslint-disable-next-line unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
    expect(names(createTools(bridge("old"), null))).toEqual([
      "read_file",
      "get_build_error",
      "write_file",
      "build",
      "deploy",
    ]);
  });

  it("refuses a write-file call in tutorial mode, with no approval card", async () => {
    const write = createTools(bridge("old"), tutorial).find(
      (tool) => tool.name === "write_file"
    );
    const result = await write?.run({ path: "src/lib.rs", content: "new" });

    expect(result).toBe(
      "write_file is not available in this tutorial. The lesson builds; offer a change instead."
    );
    expect(PgAssistant.items).toHaveLength(0);
    expect(PgAssistant.status).toBe("idle");
  });

  it("runs what it allows, and adds its own tools", async () => {
    const tools = createTools(bridge("fn main() {}"), tutorial);
    expect(names(tools)).toContain("hint");
    const read = tools.find((tool) => tool.name === "read_file");
    expect(await read?.run({ path: "src/lib.rs" })).toBe("fn main() {}");
  });

  it("is read by the next createTools, and clearing one leaves the latest other in force", () => {
    const set = PgAssistant.setMode(tutorial);
    expect(names(createTools(bridge("old")))).toContain("hint");
    const other = PgAssistant.setMode({
      name: "other",
      context: () => "",
      tools: [],
      allows: () => true,
      refusal: "",
    });
    try {
      set.dispose();
      expect(PgAssistant.mode?.name).toBe("other");
    } finally {
      other.dispose();
    }
    expect(PgAssistant.mode).toBeNull();
  });

  it("keeps an earlier mode when a later one clears first", () => {
    const first = PgAssistant.setMode(tutorial);
    const second = PgAssistant.setMode({
      name: "other",
      context: () => "",
      tools: [],
      allows: () => true,
      refusal: "",
    });
    try {
      second.dispose();
      expect(PgAssistant.mode).toBe(tutorial);
    } finally {
      first.dispose();
    }
    expect(PgAssistant.mode).toBeNull();
  });
});

describe("READING_TOOLS", () => {
  it("names only tools the assistant has", async () => {
    const { createSkillTools } = await vi.importActual<
      typeof import("./skill-tools")
    >("./skill-tools");
    const real = new Set(
      // eslint-disable-next-line unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
      createTools(bridge(null), null)
        .concat(createSkillTools())
        .map((tool) => tool.name)
    );
    for (const name of READING_TOOLS) expect(real).toContain(name);
  });
});

describe("deploy", () => {
  it("says a deploy the network refused did not start, rather than failed", async () => {
    const tool = requireFor("the deploy tool")(
      createTools({
        getProjectContext: () => ({ cluster: "devnet" }),
        quoteDeploy: async () => ({
          network: "devnet",
          cost: 1_420_000_000,
          playground: true,
        }),
        deploy: async () => {
          throw new NetworkRefusedError(
            "Devnet is not responding. Deploy waits for the network."
          );
        },
      } as unknown as PlaygroundBridge).find((t) => t.name === "deploy")
    );

    const pending = tool.run({});
    await Promise.resolve();
    PgAssistant.resolveApproval(latestCard(), true);

    expect(await pending).toBe(
      "The deploy did not start, and nothing was sent: Devnet is not responding. Deploy waits for the network."
    );
  });
});
