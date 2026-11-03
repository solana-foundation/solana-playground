import { createTools, notInContext } from "./tools";
import { PgAssistant } from "../store";
import { PgPatchUndo } from "../patch-undo";
import type { PlaygroundBridge } from "../bridge/playground-bridge";
import { PgAssistant } from "../store";
import { createTools } from "./tools";

vi.mock("./skill-tools", () => ({ createSkillTools: () => [] }));
vi.mock("./mcp-tools", () => ({ createMcpTools: () => [] }));
// Only the default value is needed here; reaching the real one drags in the
// utils barrel, which wants webpack-injected globals
vi.mock("../bridge/playground-bridge", () => ({ realBridge: {} }));

/** The files the write_file cases treat as in the conversation's context */
const IN_CONTEXT = ["src/lib.rs", "src/a.rs", "src/b.rs"];
/** The real normaliser is the entity's; a leading `/` is all these cases use */
const toProjectPath = (path: string) => path.replace(/^\/+/, "");

const bridge = (
  content: string | null,
  context: readonly string[] = IN_CONTEXT
): PlaygroundBridge =>
  ({
    readFile: () => content,
    applyPatch: vi.fn(async () => {}),
    listContextFiles: () => context,
    toProjectPath,
  } as unknown as PlaygroundBridge);

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
    const pending = writeFile(bridge("secret", [])).run({
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
      readFile: () => null,
      applyPatch: vi.fn(async () => {}),
      listContextFiles: () => IN_CONTEXT,
      toProjectPath: () => null,
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
    readFile: (path: string) => files[path] ?? null,
    listContextFiles: () => ["src/lib.rs"],
    toProjectPath: (path: string) =>
      path.startsWith("..") ? null : path.replace(/^\.?\/+/, ""),
  } as unknown as PlaygroundBridge;
  const readFile = (path: string) =>
    createTools(contextBridge)
      .find((tool) => tool.name === "read_file")!
      .run({ path });

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
