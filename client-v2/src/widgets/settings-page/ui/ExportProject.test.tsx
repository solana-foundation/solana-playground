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

import ExportProject, { OpenProjectLine } from "./ExportProject";

describe("Settings › Project export", () => {
  it("names the open project and exports that one", async () => {
    render(
      <>
        <OpenProjectLine phone={false} />
        <ExportProject />
      </>
    );

    expect(screen.getByTestId("settings-open-project").textContent).toBe(
      "Exports my-anchor-app, the project open now."
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Export project" })
    );
    expect(exportWorkspace).toHaveBeenCalledWith({ name: "my-anchor-app" });
  });
});
