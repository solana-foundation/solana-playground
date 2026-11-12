import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

// The utils barrel reads a build-time global and cannot load under vitest;
// the button's icon reads `PgTheme` for styles that do not matter here
vi.mock("@/utils", () => ({
  PgTheme: { convertToCSS: () => "", getColor: () => "inherit" },
}));
// The export's flow is tested in its slice
const { exportAsIs } = vi.hoisted(() => ({
  exportAsIs: vi.fn<(name: string) => Promise<number>>(),
}));
vi.mock("@/features/project-export", () => ({ exportAsIs }));
vi.mock("@/hooks", () => ({
  useExplorer: () => ({ currentWorkspaceName: "my-anchor-app" }),
}));

import ExportProject, { useExportRowCopy } from "./ExportProject";

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  exportAsIs.mockReset().mockResolvedValue(4);
});
afterEach(() => resetTelemetry());

describe("Settings › Project export", () => {
  it("names the open project and exports that one, counted from Settings", async () => {
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
    expect(exportAsIs).toHaveBeenCalledWith("my-anchor-app");
    await waitFor(() =>
      expect(sent.events).toEqual([
        {
          name: "project_exported",
          params: {
            via: "settings",
            converted: false,
            profile: "as-is",
            files: 4,
          },
        },
      ])
    );
  });

  it("counts an export that saved nothing as failed from Settings", async () => {
    exportAsIs.mockRejectedValue(new Error("quota"));
    render(<ExportProject />);

    await userEvent.click(
      screen.getByRole("button", { name: "Export project" })
    );

    await waitFor(() =>
      expect(sent.events).toEqual([
        {
          name: "project_export_failed",
          params: { via: "settings", profile: "as-is" },
        },
      ])
    );
  });
});
