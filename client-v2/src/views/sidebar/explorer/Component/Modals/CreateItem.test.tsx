import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

// The `utils` barrel needs a booted app; the input asks the explorer where
// the new item goes and creates it there
const utils = vi.hoisted(() => {
  class ExplorerLimitError extends Error {}
  return {
    ExplorerLimitError,
    PgExplorer: {
      PATHS: { ROOT_DIR_PATH: "/" },
      errors: {
        ALREADY_EXISTS: "Already exists",
        INVALID_NAME: "Invalid name",
      },
      isTemporary: false,
      createItem: vi.fn(),
      getCtxSelectedEl: () => undefined,
      getSelectedEl: () => undefined,
      getParentPathFromEl: () => "/ws/src/",
      getCanonicalPath: (path: string) => path,
      getItemPathFromEl: () => "/ws/src/lib.rs",
      getItemTypeFromPath: () => ({ file: true }),
      getRelativePath: (path: string) => path.replace(/^\/ws\//, ""),
      isItemNameValid: () => true,
      removeCtxSelectedEl: vi.fn(),
      getElFromPath: () => undefined,
      setSelectedEl: vi.fn(),
    },
    PgCommon: {
      joinPaths: (...paths: string[]) => paths.join(""),
    },
    PgView: {
      events: { NEW_ITEM_PORTAL_SET: "new-item-portal-set" },
      classNames: { TOUCHED: "touched", ERROR: "error" },
    },
  };
});
vi.mock("../../../../../utils", async () => ({
  ExplorerLimitError: utils.ExplorerLimitError,
  PgExplorer: utils.PgExplorer,
  PgCommon: utils.PgCommon,
  PgView: utils.PgView,
  PgKeybind: (await import("../../../../../utils/keybind")).PgKeybind,
}));
vi.mock("../../../../../components/LangIcon", () => ({
  default: () => undefined,
}));

import { CreateItem } from "./CreateItem";

beforeEach(() => {
  utils.PgExplorer.createItem.mockReset();
});

/** Open the New File input, type `name` and press Enter */
const create = async (name: string) => {
  render(<CreateItem />);
  const portal = document.createElement("div");
  portal.append(document.createElement("div"));
  document.body.append(portal);
  act(() => {
    document.dispatchEvent(
      new CustomEvent(utils.PgView.events.NEW_ITEM_PORTAL_SET, {
        detail: portal,
      })
    );
  });
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: name } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
};

/** The line under the input; the field renders nothing while it is empty */
const refusal = () =>
  screen.queryByTestId("explorer-limit-error")?.textContent ?? "";

it("names the item it could not create on an unexpected failure", async () => {
  utils.PgExplorer.createItem.mockRejectedValue(
    new DOMException("The quota has been exceeded.", "QuotaExceededError")
  );

  await create("notes.md");

  expect(refusal()).toBe("Could not create notes.md.");
});

it("shows a limit's rule", async () => {
  utils.PgExplorer.createItem.mockRejectedValue(
    new utils.ExplorerLimitError("A project can have at most 50 files.")
  );

  await create("notes.md");

  expect(refusal()).toBe("A project can have at most 50 files.");
});

it("shows the explorer's own refusal", async () => {
  utils.PgExplorer.createItem.mockRejectedValue(new Error("Already exists"));

  await create("lib.rs");

  expect(refusal()).toBe("Already exists");
});
