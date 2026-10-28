import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import { Modal } from "@/shared/ui/modal";
import {
  ModalIdContext,
  ModalLayerContext,
} from "@/widgets/overlays/ui/modal-layer";

// The `utils` barrel needs a booted app; the modal uses three of its parts,
// and its icons' `Svg` reads `PgTheme` for styles that do not matter here
const utils = vi.hoisted(() => ({
  PgFramework: {
    exportWorkspace: vi.fn(),
    isUnknownFramework: (e: unknown) =>
      e instanceof Error && e.message === "Could not identify framework",
  },
  PgView: { setToast: vi.fn(), closeModal: vi.fn() },
  PgExplorer: { currentWorkspaceName: "open-one" },
  PgTheme: { convertToCSS: () => "", getColor: () => "inherit" },
}));
vi.mock("../../../../../utils", () => utils);
vi.mock("../../../../../components/Markdown", () => ({ default: () => null }));

import { ExportWorkspace } from "./ExportWorkspace";

let logs: ReturnType<typeof logMemory>;
beforeEach(() => {
  logs = logMemory();
  initLogger({ providers: [logs] });
  utils.PgFramework.exportWorkspace.mockReset().mockResolvedValue({});
  utils.PgView.setToast.mockReset();
  utils.PgView.closeModal.mockReset();
});
afterEach(() => resetLogger());

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
  expect(utils.PgFramework.exportWorkspace).toHaveBeenCalledWith({
    name: "beta",
  });
});

it("tells the user a conversion failed and exports as is", async () => {
  utils.PgFramework.exportWorkspace
    .mockRejectedValueOnce(new Error("Could not identify framework"))
    .mockResolvedValueOnce({});
  draw("beta");

  fireEvent.click(screen.getByRole("button", { name: /convert and export/i }));

  await waitFor(() =>
    expect(utils.PgView.closeModal).toHaveBeenCalledWith(null, "export")
  );
  expect(utils.PgFramework.exportWorkspace.mock.calls).toEqual([
    [{ convert: true, name: "beta" }],
    [{ name: "beta" }],
  ]);
  expect(toastNames()).toEqual(["export-convert-failed"]);
});

it("does not report a project of no known framework, only notes it", async () => {
  utils.PgFramework.exportWorkspace
    .mockRejectedValueOnce(new Error("Could not identify framework"))
    .mockResolvedValueOnce({});
  draw("beta");

  fireEvent.click(screen.getByRole("button", { name: /convert and export/i }));

  await waitFor(() =>
    expect(utils.PgView.closeModal).toHaveBeenCalledWith(null, "export")
  );
  expect(logs.entries.filter((entry) => entry.report)).toEqual([]);
});

it("reports a conversion that failed for another reason", async () => {
  const failure = new Error("convertFromPlayground blew up");
  utils.PgFramework.exportWorkspace
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce({});
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
  utils.PgFramework.exportWorkspace.mockRejectedValue(new Error("ENOENT"));
  draw("beta");

  fireEvent.click(screen.getByRole("button", { name: /convert and export/i }));

  await waitFor(() => expect(toastNames()).toEqual(["export-failed"]));
  expect(utils.PgView.closeModal).not.toHaveBeenCalled();
});

it("tells the user an export failed, and reports it", async () => {
  const failure = new Error("quota exceeded");
  utils.PgFramework.exportWorkspace.mockRejectedValue(failure);
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
});

it("names the open project when given no name", () => {
  draw();
  expect(screen.getByText("Export open-one")).toBeTruthy();
});
