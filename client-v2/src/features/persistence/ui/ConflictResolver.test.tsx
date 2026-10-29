// Monaco cannot run under jsdom: the controller is replaced, as in
// `BaseConflictResolver.test.tsx`, by one that draws only the overlay nodes
// the hunk controls go into. What a take does to the file is the real code.
vi.mock("./merge-editor/controller", () => ({
  createMergeEditor: (file: import("./merge-editor/merge-file").MergeFile) => {
    const overlay = () =>
      document.body.appendChild(document.createElement("div"));
    const overlays = { left: overlay(), result: overlay(), right: overlay() };
    return {
      layout: {
        overlays,
        hunks: file.hunks.map(({ index }) => ({
          index,
          top: { left: 0, result: 0, right: 0 },
        })),
        bands: { left: [], right: [] },
        folds: [],
        canFold: false,
      },
      onDidChangeLayout: () => ({ dispose: () => undefined }),
      onDidEditResult: () => ({ dispose: () => undefined }),
      decide: (
        index: number,
        side: "left" | "right",
        action: "take" | "dismiss"
      ) => !!file[action](index, side),
      update: () => undefined,
      unfold: () => undefined,
      reveal: () => undefined,
      dispose: () => Object.values(overlays).forEach((node) => node.remove()),
    };
  },
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
// `@types/mocha` also declares a global `it`, without `each`
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConflictResolver } from "./ConflictResolver";
import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { merge3 } from "../model/merge";
import { PgProjectSync } from "../model/project-sync";
import type { FileConflict } from "../model/merge";
import type { Conflict } from "../model/project-sync";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A file whose one conflict is its middle line, read from `server` */
const conflictIn = (path: string, server = "theirs"): FileConflict => {
  const merged = merge3("a\nb\nc", "a\nmine\nc", `a\n${server}\nc`);
  if (merged.kind !== "conflict") throw new Error("expected a conflict");
  return {
    kind: "lines",
    path,
    chunks: merged.chunks,
    localHash: `${path}:local`,
    serverHash: `${path}:${server}`,
  };
};

const divergent = (files: FileConflict[]): Conflict => ({
  projectId: "p1",
  kind: "divergent",
  paths: files.map(({ path }) => path),
  files,
});

const LIB = conflictIn("src/lib.rs");

const button = (name: string) => {
  const found = Array.from(document.querySelectorAll("button")).filter(
    // A hunk's control is named by its tooltip; its label adds which hunk
    (b) =>
      (b.getAttribute("title") ??
        b.getAttribute("aria-label") ??
        b.textContent?.trim()) === name
  );
  expect(found).toHaveLength(1);
  return found[0];
};

const press = (name: string) => act(async () => button(name).click());

describe("ConflictResolver telemetry", () => {
  let container: HTMLDivElement;
  let root: Root;
  let sent: ReturnType<typeof memoryProvider>;
  let conflict: Conflict | null;
  const onClose = vi.fn();

  const names = () => sent.events.map((event) => event.name);

  /** The view open on `files`, the conflict sync holds */
  const open = async (files: FileConflict[]) => {
    conflict = divergent(files);
    await act(async () =>
      root.render(<ConflictResolver projectId="p1" onClose={onClose} />)
    );
  };

  /** Both sides of the one hunk taken */
  const takeBoth = async () => {
    await press("Take this device's lines");
    await press("Take the other device's lines");
  };

  beforeEach(() => {
    sent = memoryProvider();
    initTelemetry({ providers: [sent] });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    vi.spyOn(PgProjectSync, "conflictFor").mockImplementation(() => conflict);
    vi.spyOn(PgProjectSync, "onDidChangeConflicts").mockReturnValue({
      dispose: () => undefined,
    });
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetTelemetry();
    resetLogger();
  });

  it("tracks the view opening with its files and hunks", async () => {
    await open([LIB, conflictIn("tests/index.test.ts")]);
    expect(sent.events).toEqual([
      { name: "sync_resolve_opened", params: { files: 2, hunks: 2 } },
    ]);
  });

  it("tracks a hunk once it is resolved, by the side that resolved it", async () => {
    await open([LIB]);
    await press("Dismiss this device's lines");
    await press("Take the other device's lines");

    expect(sent.events.slice(1)).toEqual([
      {
        name: "sync_resolve_hunk_resolved",
        params: { how: "take", side: "other-device" },
      },
    ]);
  });

  it("tracks an Apply that settles the conflict", async () => {
    vi.spyOn(PgProjectSync, "resolve").mockResolvedValue(true);
    await open([LIB]);
    await takeBoth();
    await press("Apply");

    expect(names()).toEqual([
      "sync_resolve_opened",
      "sync_resolve_hunk_resolved",
      "sync_resolve_applied",
    ]);
    expect(sent.events.at(-1)?.params).toEqual({ files: 1 });
    expect(onClose).toHaveBeenCalled();
  });

  it("tracks an Apply refused because a file changed on the other device", async () => {
    vi.spyOn(PgProjectSync, "resolve").mockImplementation(async () => {
      // Raised again with the newer copy, as the merge does
      conflict = divergent([conflictIn("src/lib.rs", "theirs, again")]);
      return false;
    });
    await open([LIB]);
    await takeBoth();
    await press("Apply");

    expect(sent.events.at(-1)).toEqual({
      name: "sync_resolve_stale",
      params: { files: 1 },
    });
    expect(document.body.textContent).toContain(
      "src/lib.rs changed on the other device."
    );
  });

  it("tracks an Apply that settled nothing with the same copies", async () => {
    vi.spyOn(PgProjectSync, "resolve").mockResolvedValue(false);
    await open([LIB]);
    await takeBoth();
    await press("Apply");

    expect(sent.events.at(-1)).toEqual({
      name: "sync_resolve_apply_failed",
      params: { reason: "refused" },
    });
  });

  it("logs and tracks an Apply that threw", async () => {
    const logged = logMemory();
    initLogger({ providers: [logged] });
    const failure = new Error("lock lost");
    vi.spyOn(PgProjectSync, "resolve").mockRejectedValue(failure);
    await open([LIB]);
    await takeBoth();
    await press("Apply");

    expect(sent.events.at(-1)).toEqual({
      name: "sync_resolve_apply_failed",
      params: { reason: "error" },
    });
    expect(logged.entries).toEqual([
      expect.objectContaining({
        ns: "persistence:resolve",
        level: "error",
        error: failure,
        report: true,
      }),
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ["Keep this version", "keep-local"],
    ["Take the other version", "take-server"],
  ])("tracks %s from the view", async (label, answer) => {
    vi.spyOn(PgProjectSync, "resolve").mockResolvedValue(true);
    await open([LIB]);
    await press(label);

    expect(sent.events.at(-1)).toEqual({
      name: "sync_whole_file_answered",
      params: { answer, from: "view" },
    });
    expect(PgProjectSync.resolve).toHaveBeenCalledWith("p1", answer);
  });

  it("tracks Cancel", async () => {
    await open([LIB]);
    await press("Cancel");

    expect(names()).toEqual(["sync_resolve_opened", "sync_resolve_cancelled"]);
    expect(onClose).toHaveBeenCalled();
  });
});
