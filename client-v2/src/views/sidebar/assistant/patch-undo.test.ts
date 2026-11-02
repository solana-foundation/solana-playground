import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaygroundBridge } from "./bridge/playground-bridge";
import { PgPatchUndo } from "./patch-undo";
import { PgAssistant } from "./store";
import {
  clearFailures,
  getFailures,
} from "@/features/persistence/model/diagnostics";
import type { ChatItem } from "./store";

// The real bridge reaches the explorer and the settings, which need the
// build's globals; every test here hands the module a bridge of its own
vi.mock("./bridge/playground-bridge", () => ({ realBridge: {} }));

type ApprovalItem = Extract<ChatItem, { kind: "approval" }>;

describe("PgPatchUndo", () => {
  /** A bridge over one file, recording what it is asked to write */
  const fakeBridge = (content: string | null) => {
    const file = { content };
    const bridge = {
      readFile: () => file.content,
      applyPatch: vi.fn(async ({ content }: { content: string }) => {
        file.content = content;
      }),
      deleteFile: vi.fn(async () => {
        file.content = null;
      }),
    } as unknown as PlaygroundBridge;
    return { bridge, file };
  };

  /** An applied patch card, as the store holds it after Apply */
  const applied = async (before: string | null, after: string) => {
    const asked = PgAssistant.requestApproval({
      type: "patch",
      path: "src/lib.rs",
      before,
      after,
    });
    const card = PgAssistant.items[PgAssistant.items.length - 1];
    PgAssistant.resolveApproval(card.id, true);
    await asked;
    return PgAssistant.items.find((i): i is ApprovalItem => i.id === card.id)!;
  };

  beforeEach(() => {
    PgAssistant.clear();
  });

  it("can undo a patch this tab wrote while the file holds it", async () => {
    const card = await applied("old", "new");
    const { bridge } = fakeBridge("new");
    expect(PgPatchUndo.can(card, bridge)).toBe(false);
    PgPatchUndo.wrote(card.id);
    expect(PgPatchUndo.can(card, bridge)).toBe(true);
  });

  it("cannot undo a card restored from history", async () => {
    const card = await applied("old", "new");
    const { bridge } = fakeBridge("new");
    expect(PgPatchUndo.can(card, bridge)).toBe(false);
    expect(await PgPatchUndo.undo(card, bridge)).toBe("not-undoable");
    expect(bridge.applyPatch).not.toHaveBeenCalled();
  });

  it("puts an edited file back and marks the card undone", async () => {
    const card = await applied("old", "new");
    PgPatchUndo.wrote(card.id);
    const { bridge, file } = fakeBridge("new");

    expect(await PgPatchUndo.undo(card, bridge)).toBe("undone");

    expect(file.content).toBe("old");
    expect(card.undo).toBe("done");
    expect(card.outcome).toBe("undone, src/lib.rs is back as it was");
    expect(card.updatedAt).toBeDefined();
    expect(PgPatchUndo.can(card, bridge)).toBe(false);
  });

  it("deletes a file the patch created", async () => {
    const card = await applied(null, "new");
    PgPatchUndo.wrote(card.id);
    const { bridge, file } = fakeBridge("new");

    expect(await PgPatchUndo.undo(card, bridge)).toBe("undone");

    expect(bridge.deleteFile).toHaveBeenCalledWith("src/lib.rs");
    expect(file.content).toBeNull();
  });

  it("keeps the id a build wrote into declare_id!", async () => {
    const card = await applied(
      'declare_id!("11111111111111111111111111111111");\nold',
      'declare_id!("11111111111111111111111111111111");\nnew'
    );
    PgPatchUndo.wrote(card.id);
    const { bridge, file } = fakeBridge('declare_id!("Built1111");\nnew');

    expect(PgPatchUndo.can(card, bridge)).toBe(true);
    await PgPatchUndo.undo(card, bridge);

    expect(file.content).toBe('declare_id!("Built1111");\nold');
  });

  it("puts back the id a patch changed when no build ran since", async () => {
    const card = await applied(
      'declare_id!("Before1111");\nfn main() {}',
      'declare_id!("Patched111");\nfn main() {}'
    );
    PgPatchUndo.wrote(card.id);
    const { bridge, file } = fakeBridge(
      'declare_id!("Patched111");\nfn main() {}'
    );

    await PgPatchUndo.undo(card, bridge);

    expect(file.content).toBe('declare_id!("Before1111");\nfn main() {}');
  });

  it("keeps a build's id over the one a patch wrote", async () => {
    const card = await applied(
      'declare_id!("Before1111");\nold',
      'declare_id!("Patched111");\nnew'
    );
    PgPatchUndo.wrote(card.id);
    const { bridge, file } = fakeBridge('declare_id!("Built1111");\nnew');

    await PgPatchUndo.undo(card, bridge);

    expect(file.content).toBe('declare_id!("Built1111");\nold');
  });

  it("offers no Undo, and reports why, while the file cannot be read", async () => {
    clearFailures();
    const card = await applied("old", "new");
    PgPatchUndo.wrote(card.id);
    const { bridge } = fakeBridge("new");
    bridge.readFile = () => {
      throw new Error("no current workspace");
    };

    expect(PgPatchUndo.can(card, bridge)).toBe(false);
    expect(PgPatchUndo.can(card, bridge)).toBe(false);
    expect(getFailures().map((f) => f.what)).toEqual([
      expect.stringContaining("src/lib.rs"),
    ]);

    // Readable again: Undo is back, and the next outage is reported again
    bridge.readFile = () => "new";
    expect(PgPatchUndo.can(card, bridge)).toBe(true);
    bridge.readFile = () => {
      throw new Error("no current workspace");
    };
    expect(PgPatchUndo.can(card, bridge)).toBe(false);
    expect(getFailures()).toHaveLength(2);
  });

  it("writes nothing over an edit made after Apply, and says so", async () => {
    const card = await applied("old", "new");
    PgPatchUndo.wrote(card.id);
    const { bridge, file } = fakeBridge("new, edited");

    expect(PgPatchUndo.can(card, bridge)).toBe(false);
    expect(await PgPatchUndo.undo(card, bridge)).toBe("moved-on");

    expect(file.content).toBe("new, edited");
    expect(card.undo).toBeUndefined();
    expect(PgAssistant.items[PgAssistant.items.length - 1]).toMatchObject({
      kind: "notice",
      text: "You edited src/lib.rs after applying. Use undo in the editor.",
    });
  });

  it("takes a patch back once when pressed twice", async () => {
    const card = await applied("old", "new");
    PgPatchUndo.wrote(card.id);
    const { bridge } = fakeBridge("new");

    const results = await Promise.all([
      PgPatchUndo.undo(card, bridge),
      PgPatchUndo.undo(card, bridge),
    ]);

    expect(results).toEqual(["undone", "not-undoable"]);
    expect(bridge.applyPatch).toHaveBeenCalledTimes(1);
  });

  it("says so, reported, when the card is gone by the time the file is back", async () => {
    const card = await applied("old", "new");
    PgPatchUndo.wrote(card.id);
    const { bridge, file } = fakeBridge("new");
    const { initLogger, memoryProvider, resetLogger } = await import(
      "@/shared/lib/logger"
    );
    const logs = memoryProvider();
    initLogger({ providers: [logs] });
    vi.mocked(bridge.applyPatch).mockImplementationOnce(async ({ content }) => {
      file.content = content;
      // A workspace switch lands while the write runs
      PgAssistant.clear();
    });

    try {
      expect(await PgPatchUndo.undo(card, bridge)).toBe("undone");
      expect(file.content).toBe("old");
      expect(logs.entries.map((e) => [e.ns, e.level, e.report])).toContainEqual(
        ["assistant:patch-undo", "warn", true]
      );
    } finally {
      resetLogger();
    }
  });

  it("writes nothing for a file deleted after Apply", async () => {
    const card = await applied("old", "new");
    PgPatchUndo.wrote(card.id);
    const { bridge } = fakeBridge(null);

    expect(PgPatchUndo.can(card, bridge)).toBe(false);
    expect(await PgPatchUndo.undo(card, bridge)).toBe("moved-on");
    expect(bridge.applyPatch).not.toHaveBeenCalled();
  });

  it("marks the card undone when the write landed and what followed failed", async () => {
    const card = await applied("old", "new");
    PgPatchUndo.wrote(card.id);
    const { bridge, file } = fakeBridge("new");
    vi.mocked(bridge.applyPatch).mockImplementationOnce(async ({ content }) => {
      file.content = content;
      throw new Error("the editor's model could not load");
    });

    await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("model");

    expect(file.content).toBe("old");
    expect(card.undo).toBe("done");
    expect(PgPatchUndo.can(card, bridge)).toBe(false);
  });

  it("marks a created file's card undone when the delete landed and what followed failed", async () => {
    const card = await applied(null, "new");
    PgPatchUndo.wrote(card.id);
    const { bridge, file } = fakeBridge("new");
    vi.mocked(bridge.deleteFile).mockImplementationOnce(async () => {
      file.content = null;
      throw new Error("the explorer could not refresh");
    });

    await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("refresh");

    expect(card.undo).toBe("done");
  });

  describe("a failed write that strands the card", () => {
    beforeEach(() => clearFailures());

    it("says so on the card, offers the original and reports it, when the file holds neither", async () => {
      const card = await applied("old", "new");
      PgPatchUndo.wrote(card.id);
      const { bridge, file } = fakeBridge("new");
      vi.mocked(bridge.applyPatch).mockImplementationOnce(async () => {
        // Another tab writes while this one fails
        file.content = "someone else's edit";
        throw new Error("disk");
      });

      await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("disk");

      expect(card.undo).toBe("stranded");
      expect(PgPatchUndo.can(card, bridge)).toBe(false);
      expect(card.outcome).toBe(
        "Undo did not finish: src/lib.rs changed while Undo wrote it."
      );
      expect(PgPatchUndo.original(card)).toBe("old");
      expect(getFailures().map((f) => f.what)).toEqual([
        "undo src/lib.rs: it changed while Undo wrote it",
      ]);
    });

    it("says so, reports it and keeps Undo when the file cannot be read back", async () => {
      const card = await applied("old", "new");
      PgPatchUndo.wrote(card.id);
      const { bridge } = fakeBridge("new");
      vi.mocked(bridge.applyPatch).mockRejectedValueOnce(new Error("disk"));
      const read = vi.spyOn(bridge, "readFile");
      read.mockReturnValueOnce("new").mockImplementationOnce(() => {
        throw new Error("the explorer is gone");
      });

      await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("disk");

      expect(card.outcome).toBe(
        "Undo did not finish: src/lib.rs could not be read back."
      );
      expect(PgPatchUndo.original(card)).toBe("old");
      expect(getFailures().map((f) => f.what)).toEqual([
        "undo src/lib.rs: read it back after the write failed",
      ]);
      // The file still holds the patch once it reads: Undo is offered, and
      // a retry that lands clears the copy
      expect(PgPatchUndo.can(card, bridge)).toBe(true);
      expect(await PgPatchUndo.undo(card, bridge)).toBe("undone");
      expect(card.undo).toBe("done");
      expect(card.outcome).toBe("undone, src/lib.rs is back as it was");
      expect(PgPatchUndo.original(card)).toBeNull();
    });

    it("finishes a retry whose earlier write had landed though it could not be read back", async () => {
      const card = await applied("old", "new");
      PgPatchUndo.wrote(card.id);
      const { bridge, file } = fakeBridge("new");
      vi.mocked(bridge.applyPatch).mockImplementationOnce(
        async ({ content }) => {
          file.content = content;
          throw new Error("the editor's model could not load");
        }
      );
      const read = vi.spyOn(bridge, "readFile");
      read.mockReturnValueOnce("new").mockImplementationOnce(() => {
        throw new Error("the explorer is gone");
      });

      await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("model");
      expect(file.content).toBe("old");

      // The card offers Undo, and the press finishes it
      expect(PgPatchUndo.can(card, bridge)).toBe(true);
      expect(await PgPatchUndo.undo(card, bridge)).toBe("undone");
      expect(card.outcome).toBe("undone, src/lib.rs is back as it was");
      expect(PgAssistant.items.some((i) => i.kind === "notice")).toBe(false);
    });

    it("drops the warning when a later failed attempt finds the patch whole", async () => {
      const card = await applied("old", "new");
      PgPatchUndo.wrote(card.id);
      const { bridge } = fakeBridge("new");
      vi.mocked(bridge.applyPatch).mockRejectedValue(new Error("disk"));
      vi.spyOn(bridge, "readFile")
        .mockReturnValueOnce("new")
        .mockImplementationOnce(() => {
          throw new Error("the explorer is gone");
        });

      await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("disk");
      expect(card.outcome).toContain("Undo did not finish");

      await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("disk");
      expect(card.outcome).toBe("wrote src/lib.rs");
      expect(PgPatchUndo.original(card)).toBeNull();
      expect(PgPatchUndo.can(card, bridge)).toBe(true);
    });

    it("logs, and keeps nothing, when the card is gone by the time the write fails", async () => {
      const card = await applied("old", "new");
      PgPatchUndo.wrote(card.id);
      const { bridge, file } = fakeBridge("new");
      const { initLogger, memoryProvider, resetLogger } = await import(
        "@/shared/lib/logger"
      );
      const logs = memoryProvider();
      initLogger({ providers: [logs] });
      vi.mocked(bridge.applyPatch).mockImplementationOnce(async () => {
        file.content = "someone else's edit";
        PgAssistant.clear();
        throw new Error("disk");
      });

      try {
        await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("disk");
        expect(PgPatchUndo.original(card)).toBeNull();
        expect(
          logs.entries.map((e) => [e.ns, e.level, e.report])
        ).toContainEqual(["assistant:patch-undo", "warn", true]);
      } finally {
        resetLogger();
      }
    });

    it("offers nothing to copy for a created file, and says it did not exist", async () => {
      const card = await applied(null, "new");
      PgPatchUndo.wrote(card.id);
      const { bridge, file } = fakeBridge("new");
      vi.mocked(bridge.deleteFile).mockImplementationOnce(async () => {
        file.content = "someone else's edit";
        throw new Error("disk");
      });

      await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("disk");

      expect(card.outcome).toBe(
        "Undo did not finish: src/lib.rs changed while Undo wrote it. It did not exist before the patch."
      );
      expect(card.undo).toBe("stranded");
      expect(PgPatchUndo.can(card, bridge)).toBe(false);
      expect(PgPatchUndo.original(card)).toBeNull();
    });
  });

  it("offers Undo again when a created file's delete failed before it landed", async () => {
    const card = await applied(null, "new");
    PgPatchUndo.wrote(card.id);
    const { bridge } = fakeBridge("new");
    vi.mocked(bridge.deleteFile).mockRejectedValueOnce(new Error("disk"));

    await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("disk");

    expect(card.undo).toBeUndefined();
    expect(PgPatchUndo.can(card, bridge)).toBe(true);
    expect(card.outcome).toBeUndefined();
    expect(PgPatchUndo.original(card)).toBeNull();
  });

  it("offers Undo again when a write failed before it landed, under the build's id", async () => {
    const card = await applied(
      'declare_id!("11111111111111111111111111111111");\nold',
      'declare_id!("11111111111111111111111111111111");\nnew'
    );
    PgPatchUndo.wrote(card.id);
    const { bridge } = fakeBridge('declare_id!("Built1111");\nnew');
    vi.mocked(bridge.applyPatch).mockRejectedValueOnce(new Error("disk"));

    await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("disk");

    expect(card.undo).toBeUndefined();
    expect(PgPatchUndo.can(card, bridge)).toBe(true);
    expect(PgPatchUndo.original(card)).toBeNull();
  });

  it("marks the card undone when the write with the build's id landed and what followed failed", async () => {
    const card = await applied(
      'declare_id!("11111111111111111111111111111111");\nold',
      'declare_id!("11111111111111111111111111111111");\nnew'
    );
    PgPatchUndo.wrote(card.id);
    const { bridge, file } = fakeBridge('declare_id!("Built1111");\nnew');
    vi.mocked(bridge.applyPatch).mockImplementationOnce(async ({ content }) => {
      file.content = content;
      throw new Error("the editor's model could not load");
    });

    await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("model");

    expect(file.content).toBe('declare_id!("Built1111");\nold');
    expect(card.undo).toBe("done");
    expect(PgPatchUndo.original(card)).toBeNull();
  });

  it("can undo again when the write failed", async () => {
    const card = await applied("old", "new");
    PgPatchUndo.wrote(card.id);
    const { bridge } = fakeBridge("new");
    vi.mocked(bridge.applyPatch).mockRejectedValueOnce(new Error("disk"));

    await expect(PgPatchUndo.undo(card, bridge)).rejects.toThrow("disk");

    expect(card.undo).toBeUndefined();
    expect(PgPatchUndo.can(card, bridge)).toBe(true);
  });
});
