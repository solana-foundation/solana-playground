import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

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
import { ConversionError } from "@/utils/import-error";
import { PgView as PgViewDirect } from "@/utils/view";
import { ModalIdContext } from "@/widgets/overlays";
import { ModalLayerContext } from "@/widgets/overlays/ui/modal-layer";

// The `utils` barrel needs a booted app; the dialog uses a few of its parts
const utils = vi.hoisted(() => {
  // The dialog's limit guard reads it: a refusal other than a limit passes on
  class ExplorerLimitError extends Error {}
  return {
    ExplorerLimitError,
    PgExplorer: {
      createWorkspace: vi.fn(),
      isWorkspaceNameValid: () => true,
    },
    PgFramework: { importFiles: vi.fn() },
    PgView: {
      setModal: vi.fn(),
      classNames: { ERROR: "error", TOUCHED: "touched" },
    },
  };
});
vi.mock("../../../../../utils", () => utils);

// The `hooks` barrel pulls in wallet and connection hooks the dialog does not
// use; it needs only to know it is still open
vi.mock("../../../../../hooks", () => ({
  useMounted: () => ({ current: true }),
}));

// The real area is a dropzone, which jsdom cannot drop files on: a button
// stands in for the drop, and the area's message shows as text
vi.mock("../../../../../components/UploadArea", () => ({
  default: ({
    onDrop,
    error,
  }: {
    onDrop: (files: unknown[]) => Promise<void>;
    error: string;
  }) => (
    <div>
      <button type="button" onClick={() => void onDrop([{ path: "lib.rs" }])}>
        Drop files
      </button>
      {error && <div data-testid="upload-error">{error}</div>}
    </div>
  ),
}));

import { ImportFs } from "./ImportFs";

// The frame closes the dialog through `@/utils/view`, not the barrel
let close: MockInstance<typeof PgViewDirect.closeModal>;
let sent: ReturnType<typeof telemetryMemory>;
beforeEach(() => {
  sent = telemetryMemory();
  initTelemetry({ providers: [sent] });
  initLogger({ providers: [logMemory()] });
  utils.PgExplorer.createWorkspace.mockReset();
  utils.PgFramework.importFiles.mockReset();
  close = vi.spyOn(PgViewDirect, "closeModal").mockImplementation(() => {});
});
afterEach(() => {
  close.mockRestore();
  resetLogger();
  resetTelemetry();
});

/** The project events the dialog sent, by name and parameters */
const projectEvents = () =>
  sent.events
    .filter((event) => event.name.startsWith("project_"))
    .map(({ name, params }) => ({ name, params }));

const draw = () =>
  render(
    <Modal open>
      <ModalIdContext.Provider value="import-fs">
        <ModalLayerContext.Provider value>
          <ImportFs />
        </ModalLayerContext.Provider>
      </ModalIdContext.Provider>
    </Modal>
  );

const drop = () =>
  fireEvent.click(screen.getByRole("button", { name: "Drop files" }));

const submitButton = () => screen.getByRole("button", { name: /^import$/i });

it("counts a drop that is not a program as an unsupported import", async () => {
  utils.PgFramework.importFiles.mockRejectedValue(
    new ConversionError("Could not find a program in the files.", "unsupported")
  );
  draw();

  drop();

  expect((await screen.findByTestId("upload-error")).textContent).toBe(
    "Could not find a program in the files."
  );
  expect(projectEvents()).toEqual([
    {
      name: "project_import_failed",
      params: { via: "files", reason: "unsupported" },
    },
  ]);
});

it("counts the dropped files once their project is created", async () => {
  utils.PgFramework.importFiles.mockResolvedValue([["/src/lib.rs", ""]]);
  utils.PgExplorer.createWorkspace.mockResolvedValue(undefined);
  draw();

  drop();
  await waitFor(() =>
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false)
  );
  // A drop is not an import yet: the project exists only after the submit
  expect(projectEvents()).toEqual([]);
  fireEvent.click(submitButton());

  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledWith("", {
    files: [["/src/lib.rs", ""]],
  });
  expect(projectEvents()).toEqual([
    { name: "project_imported", params: { via: "files" } },
  ]);
});

it("counts a project that could not be created from the files", async () => {
  utils.PgFramework.importFiles.mockResolvedValue([["/src/lib.rs", ""]]);
  utils.PgExplorer.createWorkspace.mockRejectedValue(
    new Error("Workspace already exists.")
  );
  draw();

  drop();
  await waitFor(() =>
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false)
  );
  fireEvent.click(submitButton());

  // Not a limit refusal, so the guard passes it on and the frame shows it
  expect(await screen.findByText(/Workspace already exists/)).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  expect(projectEvents()).toEqual([
    {
      name: "project_import_failed",
      params: { via: "files", reason: "other" },
    },
  ]);
});
