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
    PgView: { classNames: { ERROR: "error", TOUCHED: "touched" } },
  };
});
vi.mock("../../../../../utils", () => utils);

import { ImportTemporary } from "./ImportTemporary";

// The frame closes the dialog through `@/utils/view`, not the barrel
let close: MockInstance<typeof PgViewDirect.closeModal>;
let sent: ReturnType<typeof telemetryMemory>;
beforeEach(() => {
  sent = telemetryMemory();
  initTelemetry({ providers: [sent] });
  initLogger({ providers: [logMemory()] });
  utils.PgExplorer.createWorkspace.mockReset();
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
      <ModalIdContext.Provider value="import-temporary">
        <ModalLayerContext.Provider value>
          <ImportTemporary />
        </ModalLayerContext.Provider>
      </ModalIdContext.Provider>
    </Modal>
  );

/** Name the project and press the dialog's Import */
const submit = (name: string) => {
  fireEvent.change(screen.getByPlaceholderText("project name..."), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
};

it("counts the temporary project once it is saved", async () => {
  utils.PgExplorer.createWorkspace.mockResolvedValue(undefined);
  draw();

  submit("kept");

  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledWith("kept", {
    fromTemporary: true,
  });
  expect(projectEvents()).toEqual([
    { name: "project_imported", params: { via: "temporary" } },
  ]);
});

it("counts a temporary project that could not be saved", async () => {
  utils.PgExplorer.createWorkspace.mockRejectedValue(
    new Error("Workspace already exists.")
  );
  draw();

  submit("kept");

  // Not a limit refusal, so the guard passes it on and the frame shows it
  expect(await screen.findByText(/Workspace already exists/)).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  expect(projectEvents()).toEqual([
    {
      name: "project_import_failed",
      params: { via: "temporary", reason: "other" },
    },
  ]);
});
