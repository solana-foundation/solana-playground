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
  type MockInstance,
  vi,
} from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import { Modal } from "@/shared/ui/modal";
import { requireFor } from "@/test-utils/require-for";
import { PgView as PgViewDirect } from "@/utils/view";
import { ModalIdContext } from "@/widgets/overlays";
import { ModalLayerContext } from "@/widgets/overlays/ui/modal-layer";

// The `utils` barrel needs a booted app; the modal uses a few of its parts,
// and its icons' `Svg` reads `PgTheme` for styles that do not matter here
const utils = vi.hoisted(() => {
  class ImportCancelledError extends Error {}
  // The dialog's limit guard reads it: a refusal other than a limit passes on
  class ExplorerLimitError extends Error {}
  return {
    ImportCancelledError,
    ExplorerLimitError,
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
    PgGithub: {
      import: vi.fn(),
      isValidUrl: (url: string) => url.startsWith("https://github.com/"),
    },
    PgRouter: { getPathUrl: (u: string) => u, navigate: vi.fn() },
    PgView: { closeModal: vi.fn(), classNames: { ERROR: "error" } },
    PgTheme: { convertToCSS: () => "", getColor: () => "inherit" },
  };
});
vi.mock("../../../../../utils", () => utils);

const gist = vi.hoisted(() => ({
  importGist: vi.fn(),
  isGistUrl: (url: string) => url.startsWith("https://gist.github.com/"),
}));
vi.mock("@/features/gist", () => gist);

import { IMPORTED } from "./imported";
import { ImportGithub } from "./ImportGithub";

let toast: MockInstance<typeof PgViewDirect.setToast>;
beforeEach(() => {
  initLogger({ providers: [logMemory()] });
  utils.PgGithub.import.mockReset();
  gist.importGist.mockReset();
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

/** The row of the "Anchor - Hello" example */
const exampleRow = () =>
  requireFor("the example's row")(
    requireFor("the example's title container")(
      screen.getByText("Anchor - Hello").closest("div")
    ).parentElement
  );

/** The example's own Import, not the dialog's submit */
const importExample = () => {
  const row = exampleRow();
  fireEvent.click(within(row).getByRole("button", { name: /^import$/i }));
};

it("closes the dialog as imported once an example is imported", async () => {
  utils.PgGithub.import.mockResolvedValue(undefined);
  draw();

  importExample();

  // The settings page closes on that answer, so the opened project shows
  await waitFor(() =>
    expect(utils.PgView.closeModal).toHaveBeenCalledWith(
      IMPORTED,
      "import-github"
    )
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

/** Type the URL into the dialog's field and press its own Import */
const submitUrl = (url: string) => {
  const field = screen.getByPlaceholderText(
    "https://github.com/... or https://gist.github.com/..."
  );
  fireEvent.change(field, { target: { value: url } });
  const submit = screen
    .getAllByRole("button", { name: /^import$/i })
    .find((button) => button.getAttribute("type") === "submit");
  if (!submit) throw new Error("The dialog has no submit button.");
  fireEvent.click(submit);
};

it("closes the dialog as imported when an example is opened", () => {
  draw();
  const row = exampleRow();

  fireEvent.click(within(row).getByRole("button", { name: /^open$/i }));

  expect(utils.PgRouter.navigate).toHaveBeenCalledWith(
    "/https://github.com/a/b"
  );
  expect(utils.PgView.closeModal).toHaveBeenCalledWith(
    IMPORTED,
    "import-github"
  );
});

it("closes the dialog as imported once the URL's project is imported", async () => {
  utils.PgGithub.import.mockResolvedValue(undefined);
  const close = vi
    .spyOn(PgViewDirect, "closeModal")
    .mockImplementation(() => {});
  draw();

  submitUrl("https://github.com/c/d");

  await waitFor(() =>
    expect(close).toHaveBeenCalledWith(IMPORTED, "import-github")
  );
  expect(utils.PgGithub.import).toHaveBeenCalledWith("https://github.com/c/d");
  close.mockRestore();
});

it("asks for a GitHub or gist URL", () => {
  draw();

  expect(screen.getByText("GitHub or gist URL")).toBeTruthy();
});

it("imports a gist URL as a gist, from the dialog", async () => {
  gist.importGist.mockResolvedValue(undefined);
  draw();

  submitUrl("https://gist.github.com/alice/0123abcd");

  await waitFor(() =>
    expect(gist.importGist).toHaveBeenCalledWith(
      "https://gist.github.com/alice/0123abcd",
      "dialog"
    )
  );
  expect(utils.PgGithub.import).not.toHaveBeenCalled();
});

it("still imports a repository URL as a repository", async () => {
  utils.PgGithub.import.mockResolvedValue(undefined);
  draw();

  submitUrl("https://github.com/alice/repo");

  await waitFor(() =>
    expect(utils.PgGithub.import).toHaveBeenCalledWith(
      "https://github.com/alice/repo"
    )
  );
  expect(gist.importGist).not.toHaveBeenCalled();
});

it("shows why a gist could not be imported and stays open", async () => {
  gist.importGist.mockRejectedValue(
    new Error('Gist "0123abcd" was not found on GitHub.')
  );
  draw();

  submitUrl("https://gist.github.com/alice/0123abcd");

  expect(
    await screen.findByText('Gist "0123abcd" was not found on GitHub.')
  ).toBeTruthy();
  expect(utils.PgView.closeModal).not.toHaveBeenCalled();
});
