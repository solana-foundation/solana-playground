import { createTools } from "./tools";
import { PgAssistant } from "../store";
import { PgPatchUndo } from "../patch-undo";
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

  it("leaves an applied patch undoable, and a failed or rejected one not", async () => {
    const file = { content: "old" };
    const b = {
      readFile: () => file.content,
      applyPatch: vi.fn(async ({ content }: { content: string }) => {
        file.content = content;
      }),
    } as unknown as PlaygroundBridge;

    const applied = writeFile(b).run({ path: "src/lib.rs", content: "new" });
    await Promise.resolve();
    const card = latestCard();
    PgAssistant.resolveApproval(card, true);
    await applied;

    const item = PgAssistant.items.find((i) => i.id === card);
    expect(item?.kind === "approval" && PgPatchUndo.can(item, b)).toBe(true);

    vi.mocked(b.applyPatch).mockRejectedValueOnce(new Error("disk"));
    const failed = writeFile(b).run({ path: "src/lib.rs", content: "newer" });
    await Promise.resolve();
    const failedCard = latestCard();
    PgAssistant.resolveApproval(failedCard, true);
    await failed;

    file.content = "newer";
    const failedItem = PgAssistant.items.find((i) => i.id === failedCard);
    expect(
      failedItem?.kind === "approval" && PgPatchUndo.can(failedItem, b)
    ).toBe(false);
  });
});
