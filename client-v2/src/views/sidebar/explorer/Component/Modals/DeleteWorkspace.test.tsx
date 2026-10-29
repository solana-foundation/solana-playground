import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { Modal } from "@/shared/ui/modal";
import {
  ModalIdContext,
  ModalLayerContext,
} from "@/widgets/overlays/ui/modal-layer";

// The `utils` barrel needs a booted app; the dialog reads the open name and
// deletes through the explorer, and closes through the view
const utils = vi.hoisted(() => ({
  PgExplorer: {
    currentWorkspaceName: "counter",
    deleteWorkspace: vi.fn(),
  },
  PgView: { closeModal: vi.fn() },
}));
vi.mock("../../../../../utils", () => utils);
const session = vi.hoisted(() => ({
  user: null as { id: string } | null,
  listeners: new Set<() => void>(),
}));
vi.mock("@/features/auth", () => ({
  PgSession: {
    get: () => session.user,
    onDidChange: (cb: () => void) => {
      session.listeners.add(cb);
      return { dispose: () => session.listeners.delete(cb) };
    },
  },
}));

import { DeleteWorkspace } from "./DeleteWorkspace";

beforeEach(() => {
  utils.PgExplorer.deleteWorkspace.mockReset().mockResolvedValue(undefined);
  session.user = null;
  session.listeners.clear();
});

const draw = (props: { name?: string; isLesson?: boolean } = {}) =>
  render(
    <Modal open>
      <ModalIdContext.Provider value="delete">
        <ModalLayerContext.Provider value>
          <DeleteWorkspace name={props.name} isLesson={props.isLesson} />
        </ModalLayerContext.Provider>
      </ModalIdContext.Provider>
    </Modal>
  );

const FILES_LINE =
  "Its files and its program keypair are deleted from this browser.";
const LESSON_LINE = "Your progress in this lesson is lost.";
const ACCOUNT_LINE =
  "It's also deleted from your account and your other devices.";

it("names the project and says what goes, with Cancel focused", () => {
  draw();
  expect(screen.getByRole("heading", { name: "Delete counter?" })).toBeTruthy();
  expect(screen.getByText(FILES_LINE)).toBeTruthy();
  expect(screen.queryByText(LESSON_LINE)).toBeNull();
  expect(screen.queryByText(ACCOUNT_LINE)).toBeNull();
  expect(screen.getByRole("button", { name: "Delete project" })).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Cancel" })
  );
});

it("adds the lesson line for a lesson", () => {
  draw({ name: "Hello Anchor", isLesson: true });
  expect(
    screen.getByRole("heading", { name: "Delete Hello Anchor?" })
  ).toBeTruthy();
  expect(screen.getByText(LESSON_LINE)).toBeTruthy();
});

it("adds the account line when signed in", () => {
  session.user = { id: "u1" };
  draw();
  expect(screen.getByText(ACCOUNT_LINE)).toBeTruthy();
});

it("adds the account line once the session is read as signed in", () => {
  draw();
  expect(screen.queryByText(ACCOUNT_LINE)).toBeNull();
  act(() => {
    session.user = { id: "u1" };
    session.listeners.forEach((cb) => cb());
  });
  expect(screen.getByText(ACCOUNT_LINE)).toBeTruthy();
});

it("shows the lesson line and the account line together for a signed-in lesson", () => {
  session.user = { id: "u1" };
  draw({ name: "Hello Anchor", isLesson: true });
  expect(screen.getByText(LESSON_LINE)).toBeTruthy();
  expect(screen.getByText(ACCOUNT_LINE)).toBeTruthy();
});

it("deletes the project it names, not the open one", async () => {
  draw({ name: "alpha" });
  fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
  await waitFor(() =>
    expect(utils.PgExplorer.deleteWorkspace).toHaveBeenCalledWith("alpha")
  );
});

it("deletes the open project when it names none", async () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
  await waitFor(() =>
    expect(utils.PgExplorer.deleteWorkspace).toHaveBeenCalledWith("counter")
  );
});
