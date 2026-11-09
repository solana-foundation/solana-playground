/* eslint-disable unicorn/no-null -- the explorer and the editor-lines hook take null */
import { act, render as rtl, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestDoc } from "@/entities/tutorial";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { PgExplorer } from "@/utils";

const { useEditorLines, callPanel, noop } = vi.hoisted(() => ({
  noop: () => ({ dispose: () => {} }),
  useEditorLines: vi.fn(),
  callPanel: {
    isOpen: false,
    callable: false,
    dot: false,
    close: vi.fn(),
    toggle: vi.fn(),
    onDidChange: () => ({ dispose: () => {} }),
  },
}));

// The utils barrel needs build-time globals the unit runner does not define;
// the workspace reads only these
vi.mock("@/utils", () => ({
  PgCommon: {
    appendSlash: (path: string) => (path.endsWith("/") ? path : `${path}/`),
    getOS: () => "MacOS",
  },
  PgExplorer: {
    currentWorkspaceName: "Hello Anchor",
    isTemporary: false,
    getProjectRootPath: () => "/project",
    convertToFullPath: (path: string) => `/project/${path}`,
    files: { "/project/src/lib.rs": {} },
    currentFilePath: "/project/src/lib.rs",
    openFile: vi.fn(),
    onDidOpenFile: noop,
    onDidCreateItem: noop,
    onDidDeleteItem: noop,
  },
  PgTutorial: {
    current: {
      name: "Hello Anchor",
      definition: {
        intro: { files: { "src/lib.rs": "" } },
        steps: [{ file: "src/lib.rs", beats: [] }],
        docs: [
          { file: "idl.md", title: "IDL", url: "https://anchor-lang.com/idl" },
        ],
      },
      docPages: { "idl.md": "The IDL page" },
    },
    pageNumber: 1,
    onDidChange: noop,
  },
}));
vi.mock("@/hooks", () => ({ useRenderOnChange: () => undefined }));
vi.mock("@/utils/editor", () => ({ PgEditor: { focus: vi.fn() } }));
vi.mock("@/views/flow/state/stage", () => ({
  PgFlow: { state: { build: "idle", deploy: "idle" }, onDidChange: noop },
}));
vi.mock("@/views/sidebar/assistant/bridge/build-output", () => ({
  PgBuildOutput: { onDidChange: noop },
}));
vi.mock("@/features/tutorial-conversation", () => ({
  PgCallPanel: callPanel,
  PgConversation: { onDidChange: noop },
}));
vi.mock("@/components/EditorWithTabs", async () => {
  const { createContext } = await import("react");
  return { EditorTabsShown: createContext(true) };
});
vi.mock("@/components/Markdown", () => ({
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));
vi.mock("./use-editor-lines", () => ({ useEditorLines }));
vi.mock("./use-log-requests", () => ({ useLogRequests: () => undefined }));
vi.mock("./use-terminal-facts", () => ({ pickedDiagnostic: () => null }));

import type { TutorialWorkspaceProps } from "./TutorialWorkspace";
import TutorialWorkspace from "./TutorialWorkspace";

/** The app mounts one TooltipProvider at its root */
const render = (ui: ReactElement) => rtl(ui, { wrapper: TooltipProvider });

// The workspace and the head's strip measure themselves, which jsdom cannot
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  useEditorLines.mockClear();
  callPanel.isOpen = false;
});

const workspace = (layout: TutorialWorkspaceProps["layout"]) =>
  render(
    <TutorialWorkspace
      layout={layout}
      console={{ open: false, setOpen: vi.fn() }}
      keys={{ files: "⌘E", terminal: "⌘J" }}
      marks={() => ({ written: [3] })}
    >
      <div data-testid="stage-content" />
    </TutorialWorkspace>
  );

describe("TutorialWorkspace", () => {
  it("draws the phone's code head and not the frame's head on the phone", () => {
    workspace("phone");
    expect(screen.getByTestId("tutorial-workspace")).toBeTruthy();
    expect(
      screen.getByTestId("tutorial-phone-code-head").textContent
    ).toContain("lib.rs");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: /Terminal/ })).toBeNull();
  });

  it("draws the frame's head and no phone head in the frame", () => {
    workspace("frame");
    expect(screen.queryByTestId("tutorial-phone-code-head")).toBeNull();
    expect(screen.getByRole("button", { name: /Terminal/ })).toBeTruthy();
  });

  it("draws the frame with no project open, as after deleting the last one", () => {
    // The explorer throws on a path while no workspace is current, and the
    // delete re-renders the frame before the route leaves the lesson
    const explorer = PgExplorer as unknown as Record<string, unknown>;
    const { convertToFullPath } = explorer;
    explorer.currentWorkspaceName = undefined;
    explorer.convertToFullPath = () => {
      throw new Error("Current workspace not found");
    };
    try {
      workspace("frame");
      expect(screen.getByTestId("tutorial-workspace")).toBeTruthy();
    } finally {
      explorer.currentWorkspaceName = "Hello Anchor";
      explorer.convertToFullPath = convertToFullPath;
    }
  });

  it("draws nothing around the stage with no layout", () => {
    workspace(undefined);
    expect(screen.queryByTestId("tutorial-workspace")).toBeNull();
    expect(screen.queryByTestId("tutorial-phone-code-head")).toBeNull();
    expect(screen.getByTestId("stage-content")).toBeTruthy();
    expect(requestDoc({ file: "idl.md" })).toBe(false);
  });

  it("brings a doc page the assistant asks for to the front on the phone", () => {
    workspace("phone");
    let isShown = false;
    act(() => {
      isShown = requestDoc({ file: "idl.md" });
    });
    expect(isShown).toBe(true);
    expect(
      screen.getByTestId("tutorial-doc-page").getAttribute("aria-label")
    ).toBe("IDL");
    expect(
      screen.getByTestId("tutorial-phone-code-head").textContent
    ).toContain("IDL");
  });

  it("opens a doc at the section a link named, and says so in the event", () => {
    // Dropped first: the collector buffers what earlier tests sent
    resetTelemetry();
    const events = memoryProvider();
    initTelemetry({ providers: [events] });
    try {
      workspace("frame");
      let isShown = false;
      act(() => {
        isShown = requestDoc({ file: "idl.md", section: "discriminators" });
      });
      expect(isShown).toBe(true);
      expect(
        screen.getByTestId("tutorial-doc-page").getAttribute("aria-label")
      ).toBe("IDL");
      const opened = events.events.filter(
        (e) => e.name === "tutorial_workspace_doc_opened"
      );
      expect(opened.map((e) => e.params)).toStrictEqual([
        { doc: "idl.md", via: "assistant", section: "discriminators" },
      ]);

      // The page already in front: a second section scrolls, no event
      act(() => {
        requestDoc({ file: "idl.md", section: "accounts" });
      });
      expect(
        events.events.filter((e) => e.name === "tutorial_workspace_doc_opened")
      ).toHaveLength(1);
    } finally {
      resetTelemetry();
    }
  });

  it("sends no section key for a page picked in the tree", async () => {
    resetTelemetry();
    const events = memoryProvider();
    initTelemetry({ providers: [events] });
    try {
      workspace("phone");
      await userEvent.click(screen.getByRole("button", { name: "Files" }));
      await userEvent.click(screen.getByRole("treeitem", { name: "IDL" }));
      const opened = events.events.filter(
        (e) => e.name === "tutorial_workspace_doc_opened"
      );
      expect(opened.map((e) => e.params)).toStrictEqual([
        { doc: "idl.md", via: "tree" },
      ]);
    } finally {
      resetTelemetry();
    }
  });

  it("lists the files and the docs in the phone's Files sheet", async () => {
    workspace("phone");
    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByRole("region", { name: "All files" })).toBeTruthy();
    await userEvent.click(screen.getByRole("treeitem", { name: "IDL" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByTestId("tutorial-doc-page").getAttribute("aria-label")
    ).toBe("IDL");
    // The head's picker names the page; the strip says only that it is read only
    expect(
      within(screen.getByTestId("tutorial-doc-page")).getByText("Read only")
    ).toBeTruthy();

    // No tabs on the phone: the sheet is the way back to a file
    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    await userEvent.click(screen.getByRole("treeitem", { name: /lib\.rs/ }));
    expect(screen.queryByTestId("tutorial-doc-page")).toBeNull();
  });

  it("hands the line marks and the stage to the editor's line states on the phone", () => {
    workspace("phone");
    const last = useEditorLines.mock.lastCall?.[0];
    expect(last?.root).toBeInstanceOf(HTMLElement);
    expect(last?.marks.written).toEqual([3]);
  });

  it("shows the Call panel as a sheet on the phone", () => {
    callPanel.isOpen = true;
    workspace("phone");
    expect(screen.getByRole("dialog", { name: "Call" })).toBeTruthy();
  });

  it("closes the phone's Call sheet on Escape", async () => {
    callPanel.isOpen = true;
    workspace("phone");
    await userEvent.keyboard("{Escape}");
    expect(callPanel.close).toHaveBeenCalledTimes(1);
  });
});
