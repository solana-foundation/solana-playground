import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

/**
 * Stand-ins for the explorer, the view and the Files column's New file flow:
 * the `@/utils` barrels need a booted app.
 */
const app = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    files: [] as string[],
    emit: () => listeners.forEach((listener) => listener()),
    onNeedRender: (cb: () => void) => {
      listeners.add(cb);
      return { dispose: () => listeners.delete(cb) };
    },
    showFiles: vi.fn(),
    setModal: vi.fn(),
    createItem: vi.fn(async () => {}),
  };
});
vi.mock("@/utils/explorer", () => ({
  PgExplorer: {
    getAllFiles: () => app.files,
    onNeedRender: app.onNeedRender,
  },
}));
vi.mock("@/utils/view", () => ({
  PgView: { showFiles: app.showFiles, setModal: app.setModal },
}));
vi.mock("@/utils/common", () => ({ PgCommon: { sleep: async () => {} } }));
vi.mock("@/views/flow/gallery/NewWorkspaceModal", () => ({
  default: () => <></>,
}));
vi.mock("@/views/sidebar/explorer/Component/useCreateItem", () => ({
  useCreateItem: () => ({ createItem: app.createItem }),
}));

import NoFileOpen from "./NoFileOpen";

beforeEach(() => {
  app.files = ["/src/lib.rs"];
  vi.clearAllMocks();
});

it("asks for the Files column while the project has files", async () => {
  render(<NoFileOpen />);
  await userEvent.click(screen.getByRole("button", { name: "Show files" }));
  expect(app.showFiles).toHaveBeenCalledTimes(1);
});

it("switches to the no-files state once the last file goes", () => {
  render(<NoFileOpen />);
  expect(screen.getByRole("heading", { name: "No file open" })).toBeTruthy();
  app.files = [];
  act(() => app.emit());
  expect(
    screen.getByRole("heading", { name: "This project has no files" })
  ).toBeTruthy();
});

it("adds a file through the Files column's own New file flow", async () => {
  app.files = [];
  render(<NoFileOpen />);
  await userEvent.click(screen.getByRole("button", { name: "Add a file" }));
  expect(app.showFiles).toHaveBeenCalledTimes(1);
  expect(app.createItem).toHaveBeenCalledTimes(1);
});

it("starts a project in the new workspace modal", async () => {
  app.files = [];
  render(<NoFileOpen />);
  await userEvent.click(
    screen.getByRole("button", { name: "Start a project" })
  );
  expect(app.setModal).toHaveBeenCalledTimes(1);
});
