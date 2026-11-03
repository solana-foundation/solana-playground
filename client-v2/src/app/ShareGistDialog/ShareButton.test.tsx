// The header's Share: what it opens, and that it hides with no project open.
// Its own file because it mocks the dialog's opener.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import ShareButton from "./ShareButton";
import { openShareGistDialog } from "./ShareGistDialog";

// The real `@/utils` boots the settings, which need the build's globals
const explorer = vi.hoisted(() => ({ current: null as string | null }));
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
vi.mock("./ShareGistDialog", () => ({
  openShareGistDialog: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/widgets/app-nav", () => ({
  readProjectFiles: async () => ({ "src/lib.rs": "x" }),
}));

afterEach(() => {
  vi.mocked(openShareGistDialog).mockClear();
});

const openProject = (name: string | null) => {
  explorer.current = name;
};

it("opens the share dialog for the open project, from the header", async () => {
  openProject("counter");
  render(<ShareButton />);

  const share = screen.getByRole("button", { name: "Share counter" });
  expect(share.id).toBe("flow-share");
  expect(share.textContent).toBe("Share");
  await act(async () => fireEvent.click(share));

  expect(openShareGistDialog).toHaveBeenCalledTimes(1);
  const [name, readFiles, source] =
    vi.mocked(openShareGistDialog).mock.calls[0];
  expect(name).toBe("counter");
  expect(source).toBe("header");
  expect(await readFiles()).toEqual({ "src/lib.rs": "x" });
});

it("draws nothing while no project is open", () => {
  openProject(null);
  const { container } = render(<ShareButton />);
  expect(container.innerHTML).toBe("");
});
