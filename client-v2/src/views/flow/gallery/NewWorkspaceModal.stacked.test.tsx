// New project under a dialog stacked on it (an import's "pick a program"):
// `ModalFrame` remounts what sits below it, so New project's own state must
// live above it, or the dialog forgets the Open it is waiting for.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  finishImport: null as null | (() => void),
}));

vi.mock("@/utils", async () => {
  const { PgView } = await import("@/utils/view");
  class ImportCancelledError extends Error {}
  return {
    PgView,
    ImportCancelledError,
    PgCommon: {
      fetchJSON: async () => [
        {
          name: "drift",
          description: "Perps",
          repo: "https://github.com/x/drift",
          icon: "/drift.png",
          framework: "Anchor",
          categories: ["DeFi"],
        },
      ],
    },
    PgTutorial: { all: [], open: vi.fn() },
    PgGithub: {
      // Runs until the test finishes it; the test stacks the picker meanwhile
      import: () =>
        new Promise<void>((resolve) => {
          deps.finishImport = resolve;
        }),
    },
  };
});
vi.mock("@/features/new-project", () => ({
  StartFromScratch: () => null,
}));

import { PgView } from "@/utils/view";
import { ModalFrame, ModalHost } from "@/widgets/overlays";
import NewWorkspaceModal from "./NewWorkspaceModal";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
afterEach(() => {
  vi.unstubAllGlobals();
  deps.finishImport = null;
});

const Pick = () => (
  <ModalFrame name="pick" title="Select the program">
    <p>pick one</p>
  </ModalFrame>
);

const newProject = () =>
  screen.queryByRole("dialog", { name: "What do you want to build?" });

it("closes once an import that stacked a dialog on it finishes", async () => {
  render(<ModalHost />);
  act(() => {
    void PgView.setModal<unknown, { initialTab: "programs" }>(
      NewWorkspaceModal,
      { initialTab: "programs" }
    );
  });
  fireEvent.click(await screen.findByRole("button", { name: "Open drift" }));

  // The import opens its own dialog over New project, the user answers it
  await waitFor(() => expect(deps.finishImport).not.toBeNull());
  act(() => {
    void PgView.setModal(Pick);
  });
  await screen.findByRole("dialog", { name: "Select the program" });
  act(() => PgView.closeTopModal(null));
  await waitFor(() => expect(newProject()).not.toBeNull());

  // While the import still runs, New project still knows it does
  expect(screen.getByRole("button", { name: "Open drift" })).toHaveProperty(
    "disabled",
    true
  );

  await act(async () => deps.finishImport?.());

  await waitFor(() => expect(newProject()).toBeNull());
});

it("leaves another dialog open when an import ends after New project was dismissed", async () => {
  render(<ModalHost />);
  act(() => {
    void PgView.setModal<unknown, { initialTab: "programs" }>(
      NewWorkspaceModal,
      { initialTab: "programs" }
    );
  });
  fireEvent.click(await screen.findByRole("button", { name: "Open drift" }));
  await waitFor(() => expect(deps.finishImport).not.toBeNull());

  // The user dismisses New project and opens something else meanwhile
  act(() => PgView.closeTopModal(null));
  await waitFor(() => expect(newProject()).toBeNull());
  act(() => {
    void PgView.setModal(Pick);
  });
  await screen.findByRole("dialog", { name: "Select the program" });

  await act(async () => deps.finishImport?.());

  expect(
    screen.getByRole("dialog", { name: "Select the program" })
  ).toBeTruthy();
});
