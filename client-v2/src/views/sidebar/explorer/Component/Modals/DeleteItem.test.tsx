import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { Modal } from "@/shared/ui/modal";
import {
  ModalIdContext,
  ModalLayerContext,
} from "@/widgets/overlays/ui/modal-layer";

// The `utils` barrel needs a booted app; the dialog reads the explorer's
// files to name and count what goes
const utils = vi.hoisted(() => ({
  PgExplorer: {
    files: {} as Record<string, { content?: string }>,
    // The tree's paths are relative to the project; the files map's are full
    convertToFullPath: (path: string) => `/ws${path}`,
    getItemNameFromPath: (path: string) =>
      path.replace(/\/$/, "").split("/").pop()!,
    deleteItem: vi.fn(),
    // A selection is left, so the dialog has nothing to reselect after a delete
    getSelectedEl: () => ({}),
  },
  PgCommon: {
    appendSlash: (path: string) => (path.endsWith("/") ? path : `${path}/`),
  },
  PgView: { closeModal: vi.fn() },
}));
vi.mock("../../../../../utils", () => utils);

import { DeleteItem } from "./DeleteItem";

beforeEach(() => {
  utils.PgExplorer.deleteItem.mockReset().mockResolvedValue(undefined);
  utils.PgExplorer.files = {
    "/ws/src/lib.rs": { content: "" },
    "/ws/src/utils/math.rs": { content: "" },
    "/ws/src/utils/deep/io.rs": { content: "" },
    "/ws/src/one/single.rs": { content: "" },
    // Shares `utils` as a prefix, so a count without the slash would take it in
    "/ws/src/utils2/other.rs": { content: "" },
    "/ws/src/empty/": {},
    "/ws/src/hollow/inner/": {},
  };
});

const draw = (path: string) =>
  render(
    <Modal open>
      <ModalIdContext.Provider value="delete">
        <ModalLayerContext.Provider value>
          <DeleteItem path={path} />
        </ModalLayerContext.Provider>
      </ModalIdContext.Provider>
    </Modal>
  );

const title = () => screen.getByRole("heading").textContent;

it("names a file, says it cannot be undone, with Cancel focused", () => {
  draw("/src/lib.rs");
  expect(title()).toBe("Delete lib.rs?");
  expect(screen.getByText("You can't undo this.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Cancel" })
  );
});

it("counts a folder's files at any depth", () => {
  draw("/src/utils/");
  expect(title()).toBe("Delete utils and the 2 files in it?");
});

it("says the 1 file for a folder holding one", () => {
  draw("/src/one/");
  expect(title()).toBe("Delete one and the 1 file in it?");
});

it("names an empty folder alone", () => {
  draw("/src/empty/");
  expect(title()).toBe("Delete empty?");
});

it("names a folder holding only empty folders alone", () => {
  draw("/src/hollow/");
  expect(title()).toBe("Delete hollow?");
});

it("deletes the item it names on Delete", async () => {
  draw("/src/utils/");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(utils.PgExplorer.deleteItem).toHaveBeenCalledWith("/src/utils/")
  );
});
