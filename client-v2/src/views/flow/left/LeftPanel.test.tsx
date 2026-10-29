import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** What the mocked explorer and lesson report; each test sets its own */
const given = vi.hoisted(() => ({
  /** The project's stable id; a rename changes the name, never this */
  workspace: "a" as string | undefined,
  lesson: { path: null as unknown, record: [] as unknown[] },
  /** Whether the frontier step can be passed without proof */
  canPass: false,
  pass: vi.fn(),
  /** The panel's lesson subscription, to fire a change */
  listener: null as ((state: unknown) => void) | null,
  /** How many times the tree mounted */
  treeMounts: 0,
}));

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../utils", () => ({
  PgExplorer: {
    get currentWorkspaceId() {
      return given.workspace;
    },
  },
}));

vi.mock("../../sidebar/explorer/Component", async () => {
  const { useEffect } = await import("react");
  return {
    default: function Tree() {
      useEffect(() => {
        given.treeMounts += 1;
      }, []);
      return <div id="root-dir">tree</div>;
    },
  };
});
vi.mock("../../sidebar/explorer/Component/useCreateItem", () => ({
  useCreateItem: () => ({ createItem: vi.fn() }),
}));

// The lessons module reaches the `@/utils` barrel, whose generated globals
// exist only in a booted app
vi.mock("../lessons", () => ({
  INITIAL_LESSON_STATE: { path: null, record: [] },
  PgLesson: {
    get state() {
      return given.lesson;
    },
    onDidChange: (cb: (state: unknown) => void) => {
      given.listener = cb;
      cb(given.lesson);
      return { dispose: () => {} };
    },
    canPass: () => given.canPass,
    pass: () => given.pass(),
  },
  cursorStep: () => ({ verifiedBy: "a passing test" }),
  foldRecord: () => null,
}));
vi.mock("../lessons/StepRail", () => ({
  default: () => <div data-testid="step-rail" />,
}));

import LeftPanel, { isLessonTab } from "./LeftPanel";
import { forgetColumn } from "./kept-column";

// A theme that answers every key: the styles are not under test, and the
// real theme's module needs the utils barrel.
const anyTheme: DefaultTheme = new Proxy(
  {},
  {
    get: (_, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : anyTheme,
  }
) as unknown as DefaultTheme;

const draw = (collapsed: boolean, onHide?: () => void) =>
  render(
    <ThemeProvider theme={anyTheme}>
      <LeftPanel collapsed={collapsed} onHide={onHide} />
    </ThemeProvider>
  );

/** A lesson the panel shows its Steps and Files tabs for */
const inLesson = () => {
  given.lesson = { path: { id: "lesson" }, record: [] };
};
const body = () => document.getElementById("flow-left-tabpanel")!;
const tab = (name: "steps" | "files") =>
  document.getElementById(`flow-left-tab-${name}`)!;

// Before, not after: Testing Library unmounts the last panel after this
// file's own hooks, and that unmount keeps it again
beforeEach(() => {
  forgetColumn();
  given.workspace = "a";
  given.lesson = { path: null, record: [] };
  given.canPass = false;
  given.pass.mockReset();
  given.listener = null;
  given.treeMounts = 0;
  // The segmented measures its thumb with one; jsdom has none
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

describe("LeftPanel in a lesson", () => {
  beforeEach(inLesson);

  it("holds Steps and Files in a Segmented named Lesson panel, marking the current tab", () => {
    draw(false);
    const group = document.querySelector('[data-slot="segmented"]');
    expect(group?.getAttribute("aria-label")).toBe("Lesson panel");
    expect(tab("steps").getAttribute("data-state")).toBe("on");
    expect(tab("files").getAttribute("data-state")).toBe("off");
  });

  it("opens on the tab it is told to, over the kept one", () => {
    render(
      <ThemeProvider theme={anyTheme}>
        <LeftPanel collapsed={false} startOn="files" />
      </ThemeProvider>
    );
    expect(tab("files").getAttribute("data-state")).toBe("on");
  });

  it("keeps no tab from a column told where to open", () => {
    const told = render(
      <ThemeProvider theme={anyTheme}>
        <LeftPanel collapsed={false} startOn="files" />
      </ThemeProvider>
    );
    told.unmount();
    draw(false);
    expect(tab("steps").getAttribute("data-state")).toBe("on");
  });

  it("switches to the explorer when Files is pressed", () => {
    draw(false);
    expect(screen.queryByTestId("step-rail")).not.toBeNull();
    expect(document.getElementById("root-dir")).toBeNull();

    fireEvent.click(tab("files"));
    expect(tab("files").getAttribute("data-state")).toBe("on");
    expect(screen.queryByTestId("step-rail")).toBeNull();
    expect(document.getElementById("root-dir")).not.toBeNull();
  });

  it("offers Skip this step only when the step can be passed, and passes it", () => {
    draw(false);
    const skip = () => screen.queryByRole("button", { name: "Skip this step" });
    expect(skip()).toBeNull();

    given.canPass = true;
    // A new object: the same one would bail out of the re-render
    act(() => given.listener?.({ path: { id: "lesson" }, record: [] }));
    fireEvent.click(skip()!);
    expect(given.pass).toHaveBeenCalledTimes(1);
  });
});

describe("isLessonTab", () => {
  it("accepts the two tabs and nothing else", () => {
    expect(isLessonTab("steps")).toBe(true);
    expect(isLessonTab("files")).toBe(true);
    // The Segmented reports a plain string; anything but a tab is ignored
    expect(isLessonTab("")).toBe(false);
    expect(isLessonTab("settings")).toBe(false);
  });
});

describe("LeftPanel in the flush frame", () => {
  it.each([false, true])(
    "has no fold strip of its own (collapsed: %s): the stage bar folds it",
    (collapsed) => {
      draw(collapsed);
      expect(
        screen.queryByRole("button", { name: /project panel/ })
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "New file" })).toBeNull();
    }
  );

  it("shows the tree and its New file footer, and no switch, outside a lesson", () => {
    draw(false);
    expect(document.getElementById("root-dir")).not.toBeNull();
    expect(screen.getByRole("button", { name: "+ New file" })).toBeTruthy();
    // No tab row outside a lesson
    expect(document.querySelector('[data-slot="segmented"]')).toBeNull();
    expect(screen.queryByRole("group", { name: "Lesson panel" })).toBeNull();
    expect(document.getElementById("flow-left-tab-steps")).toBeNull();
    expect(document.getElementById("flow-left-tab-files")).toBeNull();
  });

  /** The prototype's head: "Files" and a way to hide the column */
  it("hides the column from its own head, named with its key", () => {
    const onHide = vi.fn();
    draw(false, onHide);
    const hide = screen.getByRole("button", { name: "Hide files" });
    expect(hide.getAttribute("title")).toBe("Hide files (\u2318E)");
    fireEvent.click(hide);
    expect(onHide).toHaveBeenCalledOnce();
  });

  it("draws no hide button where nothing can hide it", () => {
    draw(false);
    expect(screen.queryByRole("button", { name: "Hide files" })).toBeNull();
  });

  it("draws nothing while hidden", () => {
    const { container } = draw(true);
    // Not even its landmark: an empty, unnamed <aside> is still listed by a
    // screen reader
    expect(container.firstChild).toBeNull();
  });
});

describe("LeftPanel across an unmount", () => {
  it("draws a lesson's Steps tab from its first commit", () => {
    // A first commit without the lesson drew the tree, and the kept scroll
    // landed on it rather than on the step rail
    inLesson();
    draw(false);
    expect(given.treeMounts).toBe(0);
  });

  it("keeps nothing while no project is open", () => {
    given.workspace = undefined;
    inLesson();
    const first = draw(false);
    fireEvent.click(tab("files"));
    first.unmount();

    draw(false);
    expect(tab("steps").getAttribute("data-state")).toBe("on");
  });

  it("keeps the scroll when it is hidden in place", () => {
    const panel = draw(false);
    body().scrollTop = 120;
    fireEvent.scroll(body());
    panel.rerender(
      <ThemeProvider theme={anyTheme}>
        <LeftPanel collapsed />
      </ThemeProvider>
    );
    panel.rerender(
      <ThemeProvider theme={anyTheme}>
        <LeftPanel collapsed={false} />
      </ThemeProvider>
    );
    expect(body().scrollTop).toBe(120);
  });

  it("keeps a scroll made in the frame it hides", () => {
    // The browser sends `scroll` on the next frame, so a hide in the same
    // frame (⌘E right after a scroll) unmounts before the event arrives
    const first = draw(false);
    body().scrollTop = 120;
    first.unmount();

    draw(false);
    expect(body().scrollTop).toBe(120);
  });

  it("keeps the Files tab across an unmount", () => {
    inLesson();
    const first = draw(false);
    fireEvent.click(tab("files"));
    first.unmount();

    draw(false);
    expect(tab("files").getAttribute("data-state")).toBe("on");
  });

  it("keeps the scroll across an unmount", () => {
    const first = draw(false);
    body().scrollTop = 120;
    fireEvent.scroll(body());
    first.unmount();

    draw(false);
    expect(body().scrollTop).toBe(120);
  });

  it("keeps for the project open when the column hides", () => {
    // A lesson mounts the column before the explorer has opened its project
    given.workspace = undefined;
    inLesson();
    const first = draw(false);
    given.workspace = "a";
    fireEvent.click(tab("files"));
    first.unmount();

    draw(false);
    expect(tab("files").getAttribute("data-state")).toBe("on");
  });

  it("ignores another project's memory", () => {
    inLesson();
    const first = draw(false);
    fireEvent.click(tab("files"));
    body().scrollTop = 120;
    fireEvent.scroll(body());
    first.unmount();

    given.workspace = "b";
    draw(false);
    expect(tab("steps").getAttribute("data-state")).toBe("on");
    expect(body().scrollTop).toBe(0);
  });
});
