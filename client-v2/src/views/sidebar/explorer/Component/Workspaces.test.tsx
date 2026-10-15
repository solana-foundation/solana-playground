import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { initLogger, resetLogger } from "@/shared/lib/logger";
import type { LogEntry } from "@/shared/lib/logger";

// The utils barrel reads a build-time global and cannot load under vitest;
// the real `PgCommon` splits the names, the rest are spies
vi.mock("../../../../utils", async () => {
  const { PgCommon } = await import("../../../../utils/common");
  return {
    PgCommon,
    PgExplorer: { switchWorkspace: () => Promise.resolve() },
    PgTutorial: {
      isWorkspaceTutorial: (name: string) => name.startsWith("Tutorial "),
      open: () => Promise.resolve(),
    },
    PgView: { setModal: () => {} },
  };
});

const explorer: {
  allWorkspaceNames: string[];
  currentWorkspaceName: string | undefined;
} = {
  allWorkspaceNames: ["alpha", "Tutorial One", "beta"],
  currentWorkspaceName: "alpha",
};
vi.mock("../../../../hooks", () => ({ useExplorer: () => explorer }));

// Only the select is under test: the modals, buttons and icons pull in the
// theme, which needs the same build-time global
vi.mock("./Modals", () => ({}));
vi.mock("../../../../components/Button", () => ({ default: () => null }));
vi.mock("../../../../components/Text", () => ({ default: () => null }));
vi.mock("../../../../components/Icons", () => ({}));

import { PgExplorer, PgTutorial } from "../../../../utils";
import { WorkspaceSelect } from "./Workspaces";

// Radix Select calls these while opening; jsdom implements none of them
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  explorer.allWorkspaceNames = ["alpha", "Tutorial One", "beta"];
  explorer.currentWorkspaceName = "alpha";
  vi.restoreAllMocks();
  resetLogger();
});

const open = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Project" }));
  return user;
};

describe("WorkspaceSelect", () => {
  it("renders without a current workspace and stays controlled", () => {
    explorer.currentWorkspaceName = undefined;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(<WorkspaceSelect />);
    explorer.currentWorkspaceName = "alpha";
    rerender(<WorkspaceSelect />);

    const warned = error.mock.calls.some((c) =>
      /controlled|uncontrolled/i.test(String(c[0]))
    );
    expect(warned).toBe(false);
  });

  it("groups projects and tutorials", async () => {
    render(<WorkspaceSelect />);
    await open();

    const projects = await screen.findByRole("group", { name: "Projects" });
    expect(projects.textContent).toContain("alpha");
    expect(projects.textContent).toContain("beta");
    expect(projects.textContent).not.toContain("Tutorial One");
    const tutorials = screen.getByRole("group", { name: "Tutorials" });
    expect(tutorials.textContent).toContain("Tutorial One");
  });

  it("has no Tutorials group without tutorials", async () => {
    explorer.allWorkspaceNames = ["alpha", "beta"];
    render(<WorkspaceSelect />);
    await open();

    await screen.findByRole("group", { name: "Projects" });
    expect(screen.queryByRole("group", { name: "Tutorials" })).toBeNull();
  });

  it("opens a picked tutorial through PgTutorial", async () => {
    const tutorialOpen = vi.spyOn(PgTutorial, "open");
    const switchWorkspace = vi.spyOn(PgExplorer, "switchWorkspace");
    render(<WorkspaceSelect />);
    const user = await open();

    await user.click(
      await screen.findByRole("option", { name: "Tutorial One" })
    );

    expect(tutorialOpen).toHaveBeenCalledWith("Tutorial One");
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it("switches to a picked project through PgExplorer", async () => {
    const tutorialOpen = vi.spyOn(PgTutorial, "open");
    const switchWorkspace = vi.spyOn(PgExplorer, "switchWorkspace");
    render(<WorkspaceSelect />);
    const user = await open();

    await user.click(await screen.findByRole("option", { name: "beta" }));

    expect(switchWorkspace).toHaveBeenCalledWith("beta");
    expect(tutorialOpen).not.toHaveBeenCalled();
  });

  it("reports a failed switch and leaves no rejection unhandled", async () => {
    const entries: LogEntry[] = [];
    initLogger({ providers: [{ log: (entry) => entries.push(entry) }] });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const failure = new Error("switch failed");
    vi.spyOn(PgExplorer, "switchWorkspace").mockRejectedValue(failure);
    render(<WorkspaceSelect />);
    const user = await open();

    await user.click(await screen.findByRole("option", { name: "beta" }));

    await waitFor(() => expect(entries).toHaveLength(1));
    expect(entries[0].ns).toBe("explorer:workspaces");
    expect(entries[0].level).toBe("error");
    expect(entries[0].error).toBe(failure);
    expect(entries[0].report).toBe(true);
    expect(entries[0].context).toEqual({ workspace: "beta" });
    // a rejection is reported on the next turn of the loop
    await new Promise((resolve) => setTimeout(resolve));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
