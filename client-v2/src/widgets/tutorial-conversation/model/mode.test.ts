/* eslint-disable layers/curry-order, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { PgConversation } from "@/features/tutorial-conversation";

import { BEGIN_INVITATION } from "./context";
import { tutorialMode } from "./mode";

vi.mock("@/features/tutorial-conversation", () => ({
  PgConversation: {
    state: { context: null },
    view: vi.fn(),
    hint: vi.fn(),
    skip: vi.fn(),
    propose: vi.fn(),
  },
}));
vi.mock("@/utils/explorer", () => ({
  PgExplorer: {
    tabs: [],
    currentFilePath: null,
    // The explorer's own forms: a full path under the workspace's folder
    getRelativePath: (path: string) => path.replace(/^\/hello\//, ""),
    convertToFullPath: (path: string) => `/hello/${path.replace(/^\.?\//, "")}`,
    getFileContent: (path: string) => {
      if (path === "/hello/boom.rs") throw new Error("explorer not ready");
      return path === "/hello/programs/hello/src/lib.rs"
        ? 'use anchor_lang::prelude::*;\n        msg!("Hello, {}!", name);'
        : undefined;
    },
  },
}));
vi.mock("@/views/sidebar/assistant/store", () => ({
  PgAssistant: { addToolCall: vi.fn() },
}));

const conversation = vi.mocked(PgConversation);

/** The live card the view reports: an open question (writing `writes`, if given), or nothing */
const liveIs = (open: boolean, writes?: { file: string; block: string }) =>
  conversation.view.mockReturnValue({
    live: open
      ? { kind: "ask", open: true, beatId: "s1.q1", ask: { writes } }
      : { kind: "intro" },
  } as unknown as ReturnType<typeof PgConversation.view>);

const toolOf = (name: string) => {
  const tool = tutorialMode({ openMenu: vi.fn() }).tools.find(
    (t) => t.name === name
  );
  if (!tool) throw new Error(`the tutorial mode has no ${name} tool`);
  return tool;
};

beforeEach(() => vi.clearAllMocks());

describe("the tutorial's assistant mode", () => {
  it("allows reading and nothing that writes or runs", () => {
    const mode = tutorialMode({ openMenu: vi.fn() });
    expect(mode.allows("read_file")).toBe(true);
    expect(mode.allows("write_file")).toBe(false);
    expect(mode.allows("build")).toBe(false);
    expect(mode.allows("deploy")).toBe(false);
    expect(mode.tools.map((t) => t.name)).toEqual([
      "open_menu",
      "hint",
      "skip",
      "propose_change",
    ]);
  });

  it("posts the open question's hint as the assistant's, and leaves it open", async () => {
    liveIs(true);
    expect(await toolOf("hint").run({})).toContain("The hint is posted");
    expect(conversation.hint).toHaveBeenCalledWith("s1.q1", {
      byAssistant: true,
    });
    expect(conversation.skip).not.toHaveBeenCalled();
  });

  it("has no hint or skip to give without an open question", async () => {
    liveIs(false);
    expect(await toolOf("hint").run({})).toContain("No question is open");
    expect(await toolOf("skip").run({})).toContain("No question is open");
    expect(conversation.hint).not.toHaveBeenCalled();
    expect(conversation.skip).not.toHaveBeenCalled();
  });

  it("skips the open question as its button does, and says what the lesson writes", async () => {
    liveIs(true, { file: "src/lib.rs", block: 'msg!("Hello");' });
    expect(await toolOf("skip").run({})).toContain(
      "writing the answer's code into src/lib.rs"
    );
    expect(conversation.skip).toHaveBeenCalledWith("s1.q1");
    liveIs(true);
    expect(await toolOf("skip").run({})).toBe(
      "Skipped. This question writes no code."
    );
  });

  it("opens the menu through the frame", async () => {
    const openMenu = vi.fn();
    const tool = tutorialMode({ openMenu }).tools.find(
      (t) => t.name === "open_menu"
    );
    await tool?.run({});
    expect(openMenu).toHaveBeenCalledTimes(1);
  });

  it("has the menu invite the learner to begin before Start, and only then", async () => {
    liveIs(false);
    expect(await toolOf("open_menu").run({})).toContain(BEGIN_INVITATION);
    liveIs(true);
    expect(await toolOf("open_menu").run({})).toBe("The menu is open.");
  });

  it("proposes one line with the line as it reads now, and writes nothing", async () => {
    const result = await toolOf("propose_change").run({
      // The model's own form of the path; the card keeps the workspace's
      file: "./programs/hello/src/lib.rs",
      line: 2,
      after: '        msg!("Once upon a time on devnet");',
    });
    expect(result).toContain("the learner decides");
    expect(conversation.propose).toHaveBeenCalledWith({
      id: expect.any(String),
      file: "programs/hello/src/lib.rs",
      line: 2,
      before: '        msg!("Hello, {}!", name);',
      after: '        msg!("Once upon a time on devnet");',
    });
  });

  it("proposes nothing for a missing file, line or change, or more than one line", async () => {
    const propose = toolOf("propose_change");
    expect(
      await propose.run({ file: "nope.rs", line: 1, after: "x" })
    ).toContain("There is no file at nope.rs");
    expect(
      await propose.run({
        file: "programs/hello/src/lib.rs",
        line: 9,
        after: "x",
      })
    ).toContain("has no line 9");
    expect(
      await propose.run({
        file: "programs/hello/src/lib.rs",
        line: 1,
        after: "use anchor_lang::prelude::*;",
      })
    ).toContain("already reads so");
    expect(
      await propose.run({
        file: "programs/hello/src/lib.rs",
        line: 2,
        after: '        msg!("a");\n        msg!("b");',
      })
    ).toContain("one line at a time");
    expect(conversation.propose).not.toHaveBeenCalled();
  });

  it("tells a file the explorer could not read from a missing one", async () => {
    expect(
      await toolOf("propose_change").run({
        file: "boom.rs",
        line: 1,
        after: "x",
      })
    ).toBe("Could not read boom.rs: the project's files could not be read.");
    expect(conversation.propose).not.toHaveBeenCalled();
  });
});
