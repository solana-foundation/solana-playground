import { createTools } from "./tools";
import { PgAssistant } from "../store";
import type { PlaygroundBridge } from "../bridge/playground-bridge";

vi.mock("./skill-tools", () => ({ createSkillTools: () => [] }));
vi.mock("./mcp-tools", () => ({ createMcpTools: () => [] }));
// Only the default value is needed here; reaching the real one drags in the
// utils barrel, which wants webpack-injected globals
vi.mock("../bridge/playground-bridge", () => ({ realBridge: {} }));

const bridge = (content: string | null): PlaygroundBridge =>
  ({
    readFile: () => content,
    applyPatch: vi.fn(async () => {}),
  } as unknown as PlaygroundBridge);

const writeFile = (b: PlaygroundBridge) =>
  createTools(b).find((tool) => tool.name === "write_file")!;

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
      [expect.objectContaining({ path: "src/a.rs" }), "wrote src/a.rs"],
      [expect.objectContaining({ path: "src/b.rs" }), "wrote src/b.rs"],
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
});

describe("build and deploy", () => {
  const commandBridge = (
    over: Partial<Record<"build" | "deploy", () => Promise<unknown>>>,
    buildError: string | null = null
  ): PlaygroundBridge =>
    ({
      build: over.build ?? vi.fn(async () => {}),
      deploy: over.deploy ?? vi.fn(async () => null),
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
