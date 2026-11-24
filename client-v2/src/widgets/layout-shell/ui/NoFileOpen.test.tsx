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
    requestNewFile: vi.fn(),
  };
});
vi.mock("@/utils/explorer", () => ({
  PgExplorer: {
    getAllFiles: () => app.files,
    onNeedRender: app.onNeedRender,
  },
}));
vi.mock("@/utils/view", () => ({
  PgView: { showFiles: app.showFiles },
}));
vi.mock("../model/new-file-request", () => ({
  requestNewFile: app.requestNewFile,
}));

import NoFileOpen from "./NoFileOpen";

beforeEach(() => {
  app.files = ["/src/lib.rs"];
  vi.clearAllMocks();
});

it("asks for the Files column while the project has files", async () => {
  render(<NoFileOpen onStartProject={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Show files" }));
  expect(app.showFiles).toHaveBeenCalledTimes(1);
});

it("switches to the no-files state once the last file goes", () => {
  render(<NoFileOpen onStartProject={() => {}} />);
  expect(screen.getByRole("heading", { name: "No file open" })).toBeTruthy();
  app.files = [];
  act(() => app.emit());
  expect(
    screen.getByRole("heading", { name: "This project has no files" })
  ).toBeTruthy();
});

it("adds a file by asking the Files tree for one", async () => {
  app.files = [];
  render(<NoFileOpen onStartProject={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Add a file" }));
  expect(app.requestNewFile).toHaveBeenCalledTimes(1);
});

it("hands Start a project to the caller", async () => {
  app.files = [];
  const onStartProject = vi.fn();
  render(<NoFileOpen onStartProject={onStartProject} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Start a project" })
  );
  expect(onStartProject).toHaveBeenCalledTimes(1);
});
