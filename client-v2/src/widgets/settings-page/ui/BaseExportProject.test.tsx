import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// The icons reach the `utils` barrel, whose settings read a global the app
// sets at boot
vi.hoisted(() => {
  vi.stubGlobal("GLOBAL_SETTINGS", { default: {} });
});
vi.mock("@/utils/package", () => ({ PgPackage: {} }));

import BaseExportProject, { exportRowCopyOf } from "./BaseExportProject";

const button = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Export project",
  });

describe("exportRowCopyOf", () => {
  it("names the project Export takes", () => {
    expect(exportRowCopyOf("my-anchor-app")).toEqual({
      name: "Export current project",
      description: 'All files of "my-anchor-app" as a zip.',
    });
  });

  it("says why Export is disabled when no project is open", () => {
    expect(exportRowCopyOf(undefined)).toEqual({
      name: "Export current project",
      description: "No project is open.",
    });
  });
});

describe("BaseExportProject", () => {
  it("reads Export: its row already says Export current project and the zip", () => {
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
