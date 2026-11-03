// The header's Share: what it opens, and that it hides with no project open.
// Its own file because it mocks the dialog's opener.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import ShareButton from "./ShareButton";
import { openShareGistDialogFor } from "./ShareGistDialog";

// The real `@/utils` boots the settings, which need the build's globals
const explorer = vi.hoisted(() => ({
  current: undefined as string | undefined,
}));
vi.mock("@/utils", () => ({
  PgExplorer: {
    get currentWorkspaceName() {
      return explorer.current;
    },
    fs: {},
    onDidSwitchWorkspace: () => ({ dispose: () => {} }),
    onDidRenameWorkspace: () => ({ dispose: () => {} }),
  },
}));
// The opener for a source, kept so a test reads what it was called with
const opener = vi.hoisted(() => ({
  open: vi.fn<
    (
      readFiles: () => Promise<Record<string, string>>,
      name: string
    ) => Promise<unknown>
  >(),
}));
vi.mock("./ShareGistDialog", () => ({
  openShareGistDialogFor: vi.fn(() => opener.open),
}));
vi.mock("@/widgets/app-nav", () => ({
  readProjectFiles: async () => ({ "src/lib.rs": "x" }),
}));

afterEach(() => {
  vi.mocked(openShareGistDialogFor).mockClear();
  opener.open.mockClear();
});

const openProject = (name: string | undefined) => {
  explorer.current = name;
};

it("opens the share dialog for the open project, from the header", async () => {
  openProject("counter");
  render(<ShareButton />);

  const share = screen.getByRole("button", { name: "Share counter" });
  expect(share.id).toBe("flow-share");
  expect(share.textContent).toBe("Share");
  await act(async () => fireEvent.click(share));

  expect(openShareGistDialogFor).toHaveBeenCalledWith("header");
  expect(opener.open).toHaveBeenCalledTimes(1);
  const [readFiles, name] = opener.open.mock.calls[0];
  expect(name).toBe("counter");
  expect(await readFiles()).toEqual({ "src/lib.rs": "x" });
});

it("draws nothing while no project is open", () => {
  openProject(undefined);
  const { container } = render(<ShareButton />);
  expect(container.innerHTML).toBe("");
});
