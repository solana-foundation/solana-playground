import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ExportProfile } from "@/features/project-files";
import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider as telemetryMemory,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { Modal } from "@/shared/ui/modal";
import {
  ModalIdContext,
  ModalLayerContext,
} from "@/widgets/overlays/ui/modal-layer";

// The `utils` barrel needs a booted app; the modal uses three of its parts,
// and its icons' `Svg` reads `PgTheme` for styles that do not matter here
const utils = vi.hoisted(() => ({
  PgFramework: {
    isUnknownFramework: (e: unknown) =>
      e instanceof Error && e.message === "Could not identify framework",
  },
  PgView: { setToast: vi.fn(), closeModal: vi.fn() },
  PgExplorer: { currentWorkspaceName: "open-one" },
  PgTheme: { convertToCSS: () => "", getColor: () => "inherit" },
}));
vi.mock("../../../../../utils", () => utils);

// The slice's flow and its conversion event are tested in the slice; the
// export's outcome events are `project-files`'s, sent by the dialog and read
// here from the memory provider
const slice = await vi.hoisted(async () => {
  const { TEST_ENDPOINT } = await import("@/test-utils/endpoints.mjs");
  class DownloadError extends Error {
    constructor(readonly profile: ExportProfile, message: string) {
      super(message);
    }
  }
  return {
    DEFAULT_KEYPAIR_PATH: "~/.config/solana/id.json",
    KEYPAIR_VARIABLE: "SOLANA_KEYPAIR",
    RPC_URL_VARIABLE: "SOLANA_RPC_URL",
    // The mapping is the slice's and tested there
    exportedEndpoint: () => TEST_ENDPOINT.DEVNET,
    DownloadError,
    exportAsIs: vi.fn(),
    exportConverted: vi.fn(),
    readProjectKind: vi.fn(),
    isDownloadFailure: (e: unknown) => e instanceof DownloadError,
  };
});
vi.mock("@/features/project-export", () => slice);
vi.mock("../../../../../components/Markdown", () => ({ default: () => null }));

import { ExportWorkspace } from "./ExportWorkspace";

let logs: ReturnType<typeof logMemory>;
let sent: ReturnType<typeof telemetryMemory>;
beforeEach(() => {
  logs = logMemory();
  initLogger({ providers: [logs] });
  sent = telemetryMemory();
  initTelemetry({ providers: [sent] });
  slice.exportAsIs.mockReset().mockResolvedValue(2);
  slice.exportConverted
    .mockReset()
    .mockResolvedValue({ readme: "# readme", profile: "anchor", files: 3 });
  slice.readProjectKind.mockReset().mockResolvedValue("program");
  utils.PgView.setToast.mockReset();
  utils.PgView.closeModal.mockReset();
});
afterEach(() => {
  resetLogger();
  resetTelemetry();
});

const draw = (name?: string) =>
  render(
    <Modal open>
      <ModalIdContext.Provider value="export">
        <ModalLayerContext.Provider value>
          <ExportWorkspace name={name} />
        </ModalLayerContext.Provider>
      </ModalIdContext.Provider>
    </Modal>
  );

/** The dialog's export events, apart from the frame's own `overlay_*` ones */
const exportEvents = () =>
  sent.events.filter(({ name }) => name.startsWith("project_"));

const toastNames = () =>
  utils.PgView.setToast.mock.calls.map(
    ([, props]) => (props as { options: { name: string } }).options.name
  );

it("exports the named project as is", async () => {
  draw("beta");
  expect(screen.getByText("Export beta")).toBeTruthy();

  fireEvent.click(
    screen.getByRole("button", { name: /export without changes/i })
  );

  await waitFor(() =>
    expect(utils.PgView.closeModal).toHaveBeenCalledWith(null, "export")
  );
  expect(slice.exportAsIs).toHaveBeenCalledWith("beta");
  expect(slice.exportConverted).not.toHaveBeenCalled();
  expect(exportEvents()).toEqual([
    {
      name: "project_exported",
      params: { via: "dialog", converted: false, profile: "as-is", files: 2 },
    },
  ]);
});

it("counts a converted export once, as converted", async () => {
  draw("beta");

  fireEvent.click(screen.getByRole("button", { name: /convert and export/i }));

  await waitFor(() =>
    expect(exportEvents()).toEqual([
      {
        name: "project_exported",
        params: { via: "dialog", converted: true, profile: "anchor", files: 3 },
      },
    ])
  );
  expect(slice.exportAsIs).not.toHaveBeenCalled();
});

it("tells the user a conversion failed and exports as is", async () => {
  slice.exportConverted.mockRejectedValueOnce(
    new Error("Could not identify framework")
  );
  draw("beta");

  fireEvent.click(screen.getByRole("button", { name: /convert and export/i }));

  await waitFor(() =>
    expect(utils.PgView.closeModal).toHaveBeenCalledWith(null, "export")
  );
  expect(slice.exportConverted).toHaveBeenCalledWith("beta");
  expect(slice.exportAsIs).toHaveBeenCalledWith("beta");
  expect(toastNames()).toEqual(["export-convert-failed"]);
  // The fallback is one export, of the files as they are
  expect(exportEvents()).toEqual([
    {
      name: "project_exported",
      params: { via: "dialog", converted: false, profile: "as-is", files: 2 },
    },
  ]);
});

it("does not report a project of no known framework, only notes it", async () => {
  slice.exportConverted.mockRejectedValueOnce(
    new Error("Could not identify framework")
  );
  draw("beta");

  fireEvent.click(screen.getByRole("button", { name: /convert and export/i }));

  await waitFor(() =>
    expect(utils.PgView.closeModal).toHaveBeenCalledWith(null, "export")
  );
  expect(logs.entries.filter((entry) => entry.report)).toEqual([]);
});

it("reports a conversion that failed for another reason", async () => {
  const failure = new Error("convertFromPlayground blew up");
  slice.exportConverted.mockRejectedValueOnce(failure);
  draw("beta");

  fireEvent.click(screen.getByRole("button", { name: /convert and export/i }));

  await waitFor(() => expect(toastNames()).toEqual(["export-convert-failed"]));
  expect(logs.entries).toEqual([
    expect.objectContaining({
      error: failure,
      report: true,
      context: { step: "convert" },
    }),
  ]);
});

it("says only that the export failed when the fallback fails too", async () => {
  // A project that cannot be read fails the conversion and the plain export
  slice.exportConverted.mockRejectedValue(new Error("ENOENT"));
  slice.exportAsIs.mockRejectedValue(new Error("ENOENT"));
  draw("beta");

  fireEvent.click(screen.getByRole("button", { name: /convert and export/i }));

  await waitFor(() => expect(toastNames()).toEqual(["export-failed"]));
  expect(utils.PgView.closeModal).not.toHaveBeenCalled();
  expect(exportEvents()).toEqual([
    {
      name: "project_export_failed",
      params: { via: "dialog", profile: "as-is" },
    },
  ]);
});

it("tells the user an export failed, and reports it", async () => {
  const failure = new Error("quota exceeded");
  slice.exportAsIs.mockRejectedValue(failure);
  draw("beta");

  fireEvent.click(
    screen.getByRole("button", { name: /export without changes/i })
  );

  await waitFor(() => expect(toastNames()).toEqual(["export-failed"]));
  expect(utils.PgView.closeModal).not.toHaveBeenCalled();
  expect(logs.entries).toEqual([
    expect.objectContaining({
      ns: "explorer:export-workspace",
      error: failure,
      report: true,
    }),
  ]);
  expect(exportEvents()).toEqual([
    {
      name: "project_export_failed",
      params: { via: "dialog", profile: "as-is" },
    },
  ]);
});

it("names the open project when given no name", () => {
  draw();
  expect(screen.getByText("Export open-one")).toBeTruthy();
});

it("asks to make a project with no program a Node project", async () => {
  slice.readProjectKind.mockResolvedValue("no-program");
  draw("beta");

  expect(await screen.findByText("Make it a Node project?")).toBeTruthy();
  expect(screen.queryByText("Convert the project layout?")).toBeNull();
  expect(screen.getByText("package.json")).toBeTruthy();
  expect(screen.getByText(slice.exportedEndpoint())).toBeTruthy();
  expect(screen.getByText(slice.DEFAULT_KEYPAIR_PATH)).toBeTruthy();
  expect(screen.getByText(slice.RPC_URL_VARIABLE)).toBeTruthy();
  expect(slice.readProjectKind).toHaveBeenCalledWith("beta");
  // Both buttons keep their labels
  expect(
    screen.getByRole("button", { name: /convert and export/i })
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /export without changes/i })
  ).toBeTruthy();
});

it("keeps the layout question for a project with a program", async () => {
  draw("beta");

  await waitFor(() => expect(slice.readProjectKind).toHaveBeenCalled());
  expect(screen.getByText("Convert the project layout?")).toBeTruthy();
});

it("converts a project with no program with no fallback toast", async () => {
  slice.readProjectKind.mockResolvedValue("no-program");
  slice.exportConverted.mockResolvedValue({
    readme: "# beta",
    profile: "typescript",
    files: 7,
  });
  draw("beta");

  fireEvent.click(screen.getByRole("button", { name: /convert and export/i }));

  await waitFor(() =>
    expect(slice.exportConverted).toHaveBeenCalledWith("beta")
  );
  expect(slice.exportAsIs).not.toHaveBeenCalled();
  expect(toastNames()).toEqual([]);
});

it("does not fall back when the converted zip did not download, and counts the zip's profile", async () => {
  slice.exportConverted.mockRejectedValueOnce(
    new slice.DownloadError("anchor", "quota")
  );
  draw("beta");

  fireEvent.click(screen.getByRole("button", { name: /convert and export/i }));

  await waitFor(() => expect(toastNames()).toEqual(["export-failed"]));
  expect(slice.exportAsIs).not.toHaveBeenCalled();
  expect(utils.PgView.closeModal).not.toHaveBeenCalled();
  expect(exportEvents()).toEqual([
    {
      name: "project_export_failed",
      params: { via: "dialog", profile: "anchor" },
    },
  ]);
});

it("keeps the layout question when the project cannot be read", async () => {
  slice.readProjectKind.mockRejectedValue(new Error("EIO"));
  draw("beta");

  await waitFor(() =>
    expect(logs.entries).toEqual([expect.objectContaining({ level: "warn" })])
  );
  expect(screen.getByText("Convert the project layout?")).toBeTruthy();
  expect(toastNames()).toEqual([]);
});
