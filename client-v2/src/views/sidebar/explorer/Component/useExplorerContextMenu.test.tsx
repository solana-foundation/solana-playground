import { renderHook } from "@testing-library/react";
import type { MouseEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";

import { useExplorerContextMenu } from "./useExplorerContextMenu";

// The utils barrel needs build-time globals the unit runner does not define.
const explorer = vi.hoisted(() => ({
  getItemTypeFromEl: vi.fn(),
  getItemPathFromEl: vi.fn(),
  getItemNameFromPath: vi.fn(),
  setCtxSelectedEl: vi.fn(),
  getCtxSelectedEl: vi.fn(),
  getSelectedEl: vi.fn(),
}));
const view = vi.hoisted(() => ({ setModal: vi.fn(), setToast: vi.fn() }));
const run = vi.hoisted(() => {
  const answer = { isAgreed: true };
  return {
    answer,
    execute: vi.fn(async () => undefined),
    test: vi.fn(async () => undefined),
    askFirst: vi.fn(async () => answer.isAgreed),
  };
});
vi.mock("@/features/docs-link", () => ({
  PgClientRun: { askFirst: run.askFirst },
}));
vi.mock("../../../../utils", () => ({
  PgCommand: { run: { execute: run.execute }, test: { execute: run.test } },
  PgCommon: { keys: Object.keys },
  PgExplorer: {
    getItemTypeFromEl: explorer.getItemTypeFromEl,
    getItemPathFromEl: explorer.getItemPathFromEl,
    getItemNameFromPath: explorer.getItemNameFromPath,
    setCtxSelectedEl: explorer.setCtxSelectedEl,
    getCtxSelectedEl: explorer.getCtxSelectedEl,
    getSelectedEl: explorer.getSelectedEl,
    PATHS: {},
  },
  PgGlobal: {
    onDidChangeBuildLoading: vi.fn(),
    onDidChangeDeployState: vi.fn(),
  },
  PgLanguage: { getIsPathJsLike: () => false },
  PgView: {
    ids: { ROOT_DIR: "root-dir" },
    setModal: view.setModal,
    setToast: view.setToast,
  },
}));
vi.mock("../../../../hooks", () => ({ useRenderOnChange: () => undefined }));
vi.mock("./Modals", () => ({ DeleteItem: () => null, RenameItem: () => null }));

let logs: ReturnType<typeof logMemory>;
beforeEach(() => {
  logs = logMemory();
  initLogger({ providers: [logs] });
});
afterEach(() => {
  vi.clearAllMocks();
  resetLogger();
});

const eventOn = (target: Node) =>
  ({ target } as unknown as MouseEvent<HTMLElement>);

describe("useExplorerContextMenu handleMenu", () => {
  it("returns false for a target with no DIV above it, instead of throwing", () => {
    const { result } = renderHook(() => useExplorerContextMenu());

    // Detached: the climb reaches `null` before any DIV
    const orphan = document.createElement("span");

    expect(result.current.handleMenu(eventOn(orphan))).toBe(false);
  });

  it("returns false and stays silent for the root folder", () => {
    const { result } = renderHook(() => useExplorerContextMenu());
    const root = document.createElement("div");
    root.id = "root-dir";

    expect(result.current.handleMenu(eventOn(root))).toBe(false);
    expect(logs.entries).toEqual([]);
  });

  it("returns false and stays silent for a section header", () => {
    explorer.getItemTypeFromEl.mockReturnValue(undefined);
    const { result } = renderHook(() => useExplorerContextMenu());
    // The header is a DIV with no `data-path`, inside a section wrapper
    const section = document.createElement("div");
    section.setAttribute("data-section", "");
    const header = document.createElement("div");
    section.appendChild(header);

    expect(result.current.handleMenu(eventOn(header))).toBe(false);
    expect(logs.entries).toEqual([]);
  });

  it("returns false and warns for an element that is not an explorer item", () => {
    explorer.getItemTypeFromEl.mockReturnValue(null);
    const { result } = renderHook(() => useExplorerContextMenu());

    expect(
      result.current.handleMenu(eventOn(document.createElement("div")))
    ).toBe(false);
    expect(
      logs.entries.map((entry) => ({ ns: entry.ns, level: entry.level }))
    ).toEqual([{ ns: "explorer:context-menu", level: "warn" }]);
  });
});

describe("useExplorerContextMenu modal actions", () => {
  it.each(["renameItem", "deleteItem"] as const)(
    "%s reports a modal that fails to open and tells the user",
    async (action) => {
      const failure = new Error("chunk failed");
      explorer.getCtxSelectedEl.mockReturnValue(document.createElement("div"));
      explorer.getSelectedEl.mockReturnValue(document.createElement("div"));
      explorer.getItemPathFromEl.mockReturnValue("/project/src/lib.rs");
      view.setModal.mockRejectedValue(failure);
      const { result } = renderHook(() => useExplorerContextMenu());

      await result.current[action]();

      expect(logs.entries).toHaveLength(1);
      expect(logs.entries[0].ns).toBe("explorer:context-menu");
      expect(logs.entries[0].level).toBe("error");
      expect(logs.entries[0].report).toBe(true);
      expect(logs.entries[0].error).toBe(failure);
      expect(view.setToast).toHaveBeenCalledTimes(1);
      expect(view.setToast.mock.calls[0][1]).toEqual({
        options: { name: "menu-action-failed" },
      });
    }
  );
});

describe("useExplorerContextMenu Run", () => {
  // A link's code must not run from the menu before the user agreed to it.
  // Test on a file runs that file, and a link may name its file `a.test.ts`
  const ASKING = [
    "runClient",
    "runClientFolder",
    "addClient",
    "runTest",
  ] as const;

  it.each(ASKING)(
    "%s asks before the first run of a link's code",
    async (action) => {
      run.answer.isAgreed = false;
      const { result } = renderHook(() => useExplorerContextMenu());

      await result.current[action]();

      expect(run.askFirst).toHaveBeenCalledTimes(1);
      expect(run.execute).not.toHaveBeenCalled();
      expect(run.test).not.toHaveBeenCalled();
    }
  );

  it.each(ASKING)("%s runs once agreed", async (action) => {
    run.answer.isAgreed = true;
    const { result } = renderHook(() => useExplorerContextMenu());

    await result.current[action]();

    expect(run.execute.mock.calls.length + run.test.mock.calls.length).toBe(1);
  });

  // A bare `test` runs only `tests/`, which holds none of a link's code
  it.each(["runTestFolder", "addTests"] as const)(
    "%s runs the tests folder without asking",
    async (action) => {
      run.answer.isAgreed = false;
      const { result } = renderHook(() => useExplorerContextMenu());

      await result.current[action]();

      expect(run.askFirst).not.toHaveBeenCalled();
      expect(run.test).toHaveBeenCalledTimes(1);
    }
  );
});
