import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** What the mocked explorer reports; each test sets its own */
const given = vi.hoisted(() => ({
  /** The project's stable id; a rename changes the name, never this */
  workspace: "a" as string | undefined,
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

import { requireFor } from "../../../test-utils/require-for";
import { forgetColumn } from "./kept-column";
import LeftPanel from "./LeftPanel";

const draw = (collapsed: boolean) =>
  render(<LeftPanel collapsed={collapsed} />);

const body = () =>
  requireFor("the left panel body")(
    document.getElementById("flow-left-tabpanel")
  );
// Before, not after: Testing Library unmounts the last panel after this
// file's own hooks, and that unmount keeps it again
beforeEach(() => {
  forgetColumn();
  given.workspace = "a";
  given.treeMounts = 0;
});

describe("LeftPanel in the flush frame", () => {
  it.each([false, true])(
    "has no fold strip of its own (collapsed: %s): the editor head folds it",
    (collapsed) => {
      draw(collapsed);
      expect(screen.queryByRole("button", { name: /files/i })).toBeNull();
      expect(screen.queryByRole("button", { name: "New file" })).toBeNull();
    }
  );

  it("shows the tree and its New file footer", () => {
    draw(false);
    expect(document.getElementById("root-dir")).not.toBeNull();
    expect(screen.getByRole("button", { name: "+ New file" })).toBeTruthy();
    expect(given.treeMounts).toBe(1);
  });

  // The editor head names the column and hides it (DES-205)
  it("has no head of its own", () => {
    draw(false);
    expect(screen.queryByRole("button", { name: "Hide files" })).toBeNull();
    expect(screen.queryByText("Files", { exact: true })).toBeNull();
  });

  it("draws nothing while hidden", () => {
    const { container } = draw(true);
    // Not even its landmark: an empty, unnamed <aside> is still listed by a
    // screen reader
    expect(container.firstChild).toBeNull();
  });
});

describe("LeftPanel across an unmount", () => {
  it("keeps nothing while no project is open", () => {
    given.workspace = undefined;
    const first = draw(false);
    body().scrollTop = 120;
    first.unmount();

    given.workspace = "a";
    draw(false);
    expect(body().scrollTop).toBe(0);
  });

  it("keeps nothing from the phone's sheet", () => {
    const sheet = render(<LeftPanel collapsed={false} sheet />);
    body().scrollTop = 120;
    sheet.unmount();

    draw(false);
    expect(body().scrollTop).toBe(0);
  });

  it("keeps the scroll when it is hidden in place", () => {
    const panel = draw(false);
    body().scrollTop = 120;
    fireEvent.scroll(body());
    panel.rerender(<LeftPanel collapsed />);
    panel.rerender(<LeftPanel collapsed={false} />);
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

  it("keeps the scroll across an unmount", () => {
    const first = draw(false);
    body().scrollTop = 120;
    fireEvent.scroll(body());
    first.unmount();

    draw(false);
    expect(body().scrollTop).toBe(120);
  });

  it("keeps for the project open when the column hides", () => {
    // The column can mount before the explorer has opened its project
    given.workspace = undefined;
    const first = draw(false);
    given.workspace = "a";
    body().scrollTop = 120;
    first.unmount();

    draw(false);
    expect(body().scrollTop).toBe(120);
  });

  it("ignores another project's memory", () => {
    const first = draw(false);
    body().scrollTop = 120;
    fireEvent.scroll(body());
    first.unmount();

    given.workspace = "b";
    draw(false);
    expect(body().scrollTop).toBe(0);
  });
});
