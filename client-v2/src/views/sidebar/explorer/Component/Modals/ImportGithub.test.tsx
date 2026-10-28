import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import { Modal } from "@/shared/ui/modal";
import { PgView as PgViewDirect } from "@/utils/view";
import { ModalIdContext } from "@/widgets/overlays";
import { ModalLayerContext } from "@/widgets/overlays/ui/modal-layer";

// The `utils` barrel needs a booted app; the modal uses a few of its parts,
// and its icons' `Svg` reads `PgTheme` for styles that do not matter here
const utils = vi.hoisted(() => {
  class ImportCancelledError extends Error {}
  return {
    ImportCancelledError,
    PgCommon: { transition: <T,>(p: Promise<T>) => p },
    PgFramework: {
      all: [
        {
          name: "Anchor",
          icon: "",
          circleImage: false,
          githubExample: { name: "Hello", url: "https://github.com/a/b" },
        },
      ],
    },
    PgGithub: { import: vi.fn(), isValidUrl: () => true },
    PgRouter: { getPathUrl: (u: string) => u, navigate: vi.fn() },
    PgView: { closeModal: vi.fn(), classNames: { ERROR: "error" } },
    PgTheme: { convertToCSS: () => "", getColor: () => "inherit" },
  };
});
vi.mock("../../../../../utils", () => utils);

import { ImportGithub } from "./ImportGithub";

let toast: MockInstance<typeof PgViewDirect.setToast>;
beforeEach(() => {
  initLogger({ providers: [logMemory()] });
  utils.PgGithub.import.mockReset();
  utils.PgView.closeModal.mockReset();
  toast = vi.spyOn(PgViewDirect, "setToast").mockImplementation(() => {});
});
afterEach(() => {
  toast.mockRestore();
  resetLogger();
});

const draw = () =>
  render(
    <Modal open>
      <ModalIdContext.Provider value="import-github">
        <ModalLayerContext.Provider value>
          <ImportGithub />
        </ModalLayerContext.Provider>
      </ModalIdContext.Provider>
    </Modal>
  );

/** The example's own Import, not the dialog's submit */
const importExample = () => {
  const row = screen.getByText("Anchor - Hello").closest("div")!.parentElement!;
  fireEvent.click(within(row).getByRole("button", { name: /^import$/i }));
};

it("closes the dialog once an example is imported", async () => {
  utils.PgGithub.import.mockResolvedValue(undefined);
  draw();

  importExample();

  await waitFor(() =>
    expect(utils.PgView.closeModal).toHaveBeenCalledWith(null, "import-github")
  );
  expect(toast).not.toHaveBeenCalled();
});

it("keeps the dialog, quietly, when the program selection is closed", async () => {
  utils.PgGithub.import.mockRejectedValue(new utils.ImportCancelledError());
  draw();

  importExample();

  await waitFor(() => expect(utils.PgGithub.import).toHaveBeenCalled());
  // Let the button settle: a failure would be toasted on the next ticks
  await new Promise((r) => setTimeout(r, 0));
  expect(toast).not.toHaveBeenCalled();
  expect(utils.PgView.closeModal).not.toHaveBeenCalled();
});

it("tells the user an example that failed to import", async () => {
  utils.PgGithub.import.mockRejectedValue(new Error("rate limited"));
  draw();

  importExample();

  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  expect(utils.PgView.closeModal).not.toHaveBeenCalled();
});
