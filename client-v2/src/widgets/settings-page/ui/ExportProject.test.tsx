import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// The utils barrel reads a build-time global and cannot load under vitest
const { exportWorkspace } = vi.hoisted(() => ({
  exportWorkspace: vi.fn<(opts?: { name?: string }) => Promise<object>>(),
}));
vi.mock("@/utils", () => ({ PgFramework: { exportWorkspace } }));
vi.mock("@/hooks", () => ({
  useExplorer: () => ({ currentWorkspaceName: "my-anchor-app" }),
}));

import ExportProject, { useExportRowCopy } from "./ExportProject";

describe("Settings › Project export", () => {
  it("names the open project and exports that one", async () => {
    const Row = () => {
      const copy = useExportRowCopy();
      return <p data-testid="export-row-line">{copy.description}</p>;
    };
    render(
      <>
        <Row />
        <ExportProject />
      </>
    );

    expect(screen.getByTestId("export-row-line").textContent).toBe(
      'All files of "my-anchor-app" as a zip.'
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Export project" })
    );
    expect(exportWorkspace).toHaveBeenCalledWith({ name: "my-anchor-app" });
  });
});
