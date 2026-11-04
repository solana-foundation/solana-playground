import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PATH = "/project/src/lib.rs";

/** The Monaco model of the file, which the user types into */
const { model, explorer } = vi.hoisted(() => {
  const buffer = {
    uri: { path: "/project/src/lib.rs" },
    text: "",
    getValue: () => buffer.text,
    setValue: (text: string) => {
      buffer.text = text;
    },
  };
  const pgExplorer = {
    convertToFullPath: (path: string) => path,
    getFileContent: vi.fn(),
    createItem: vi.fn(),
    onDidDeleteItem: vi.fn(),
    onDidMoveItem: vi.fn(),
    editorBuffers: {
      read: (path: string) =>
        path === "/project/src/lib.rs" ? buffer.text : undefined,
      write: () => {},
      discard: () => {},
    },
  };
  return { model: buffer, explorer: pgExplorer };
});

vi.mock("monaco-editor", () => ({
  editor: { getModels: () => [model] },
}));
vi.mock("../../../../utils", () => ({ PgExplorer: explorer }));
vi.mock("../../../flow/lessons", () => ({ PgLesson: {} }));

import { realBridge } from "./playground-bridge";

describe("realBridge", () => {
  /** What the explorer holds, which autosave updates about 500 ms after typing */
  let saved: string | undefined;

  beforeEach(() => {
    saved = "fn saved() {}";
    model.text = saved;
    explorer.getFileContent.mockImplementation(() => saved);
    explorer.createItem.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("readFile", () => {
    it("reads what the user typed before autosave has it", () => {
      model.text = "fn typed() {}";

      expect(realBridge.readFile(PATH)).toBe("fn typed() {}");
    });

    it("reads no file for a path the explorer no longer holds", () => {
      saved = undefined;

      expect(realBridge.readFile(PATH)).toBeNull();
    });
  });

  describe("applyPatch", () => {
    /** Stands in for the write, during which the user types `typed` */
    const typingDuringWrite = (typed: string) =>
      explorer.createItem.mockImplementation(async () => {
        model.text = typed;
      });

    it("puts the patch in the editor", async () => {
      explorer.createItem.mockResolvedValue(undefined);

      await realBridge.applyPatch({ path: PATH, content: "patched" });

      expect(model.text).toBe("patched");
    });

    it("folds in a line typed during the write", async () => {
      model.text = "one\ntwo\nthree\nfour\nfive";
      typingDuringWrite("one\ntwo\nthree\nfour\nfive typed");

      await realBridge.applyPatch({
        path: PATH,
        content: "ONE\ntwo\nthree\nfour\nfive",
      });

      expect(model.text).toBe("ONE\ntwo\nthree\nfour\nfive typed");
    });

    it("keeps the typing when it overlaps the patch", async () => {
      model.text = "one";
      typingDuringWrite("one typed");

      await realBridge.applyPatch({ path: PATH, content: "patched" });

      expect(model.text).toBe("one typed");
    });
  });
});
