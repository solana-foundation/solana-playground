import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// The icons reach the `utils` barrel, whose settings read a global the app
// sets at boot
vi.hoisted(() => {
  vi.stubGlobal("GLOBAL_SETTINGS", { default: {} });
});
vi.mock("@/utils/package", () => ({ PgPackage: {} }));

import BaseExportProject, { BaseOpenProjectLine } from "./BaseExportProject";

const button = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Export project",
  });

describe("BaseOpenProjectLine", () => {
  it("names the project Export takes", () => {
    render(<BaseOpenProjectLine name="my-anchor-app" phone={false} />);

    const line = screen.getByTestId("settings-open-project");
    expect(line.textContent).toBe(
      "Exports my-anchor-app, the project open now."
    );
    // Truncated on one line; the whole name stays in the title
    expect(line.title).toBe(line.textContent);
  });

  it("says when no project is open", () => {
    render(<BaseOpenProjectLine phone={false} />);

    expect(screen.getByTestId("settings-open-project").textContent).toBe(
      "No project is open."
    );
  });
});

describe("BaseExportProject", () => {
  it("reads Export: its row already says Export project and the zip", () => {
    render(<BaseExportProject name="my-anchor-app" onExport={vi.fn()} />);

    expect(button().textContent).toBe("Export");
  });

  it("exports the project it is given", async () => {
    const onExport = vi.fn(async () => {});
    render(<BaseExportProject name="my-anchor-app" onExport={onExport} />);

    await userEvent.click(button());

    expect(onExport).toHaveBeenCalledWith("my-anchor-app");
  });

  it("has nothing to export without a project", () => {
    render(<BaseExportProject onExport={async () => {}} />);

    expect(button().disabled).toBe(true);
  });
});
