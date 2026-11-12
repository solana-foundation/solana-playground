/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import { render as rtl, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";

import type { DocTab } from "../model/tree";
import { treeRows } from "../model/tree";
import BaseWorkspaceHead from "./BaseWorkspaceHead";

/** The app mounts one TooltipProvider at its root */
const render = (ui: ReactElement) => rtl(ui, { wrapper: TooltipProvider });

// The strip measures its edges with a `ResizeObserver`, which jsdom lacks
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
afterEach(() => vi.unstubAllGlobals());

const LIB = "src/lib.rs";
const CLIENT = "client/client.ts";

const rows = (docs: DocTab[], open: string) =>
  treeRows({
    files: [LIB, CLIENT],
    present: new Set([LIB, CLIENT]),
    open,
    live: LIB,
    createdIn: () => null,
    docs,
  });

/** No doc tab open */
const noDocs = () => ({ tabs: [], onOpen: vi.fn(), onClose: vi.fn() });

/** The head with the tree's open state held as the connected part holds it */
const Harness = ({
  canDock = false,
  onPick = vi.fn(),
  onDock = vi.fn(),
  terminalOpen = false,
}: {
  canDock?: boolean;
  onPick?: (path: string) => void;
  onDock?: () => void;
  terminalOpen?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(CLIENT);
  return (
    <BaseWorkspaceHead
      tabs={[LIB, CLIENT]}
      active={file}
      onOpen={setFile}
      docs={noDocs()}
      tree={{
        open,
        docked: false,
        canDock,
        rows: rows([], file),
        onToggle: () => setOpen(!open),
        onClose: () => setOpen(false),
        onPick: (path) => {
          onPick(path);
          setFile(path);
          setOpen(false);
        },
        onPickDoc: vi.fn(),
        onDock,
      }}
      terminal={{ open: terminalOpen, onToggle: vi.fn() }}
      filesKey="⌘E"
      terminalKey="⌘J"
    />
  );
};

describe("BaseWorkspaceHead", () => {
  it("shows the tabs in the project's order, none with a close button", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["lib.rs", "client.ts"]);
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("holds Files and Terminal only at its end, pressed while open", () => {
    render(<Harness terminalOpen />);
    expect(
      screen
        .getByRole("button", { name: "Terminal" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen
        .getAllByRole("button", { name: "Files" })
        .map(
          (b) =>
            b.getAttribute("aria-pressed") ?? b.getAttribute("aria-expanded")
        )
    ).toEqual(["false", "false"]);
    expect(
      screen.queryByRole("button", { name: /build|deploy|run/i })
    ).toBeNull();
  });

  it("opens the tree from the active tab and picks lib.rs from client.ts", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const chevron = within(
      screen.getByRole("tab", { name: "client.ts" })
        .parentElement as HTMLElement
    ).getByRole("button", { name: "Files" });
    await userEvent.click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    const tree = await screen.findByRole("tree", { name: "Files" });
    await userEvent.click(
      within(tree).getByRole("treeitem", { name: /lib\.rs/ })
    );
    expect(onPick).toHaveBeenCalledWith(LIB);
    expect(screen.queryByRole("tree")).toBeNull();
    // client.ts is still one click away
    expect(screen.getByRole("tab", { name: "client.ts" })).toBeTruthy();
  });

  it("moves with the arrows, opens with Enter, and Esc returns focus to the chevron", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const chevron = () =>
      screen
        .getAllByRole("button", { name: "Files" })
        .find((b) => b.hasAttribute("aria-expanded")) as HTMLElement;
    await userEvent.click(chevron());
    await screen.findByRole("tree");
    // Focus lands on the open file
    expect(document.activeElement?.textContent).toContain("client.ts");
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement?.textContent).toContain("lib.rs");
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement?.textContent).toContain("lib.rs");
    await userEvent.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("tree")).toBeNull();
    expect(document.activeElement).toBe(chevron());
    expect(onPick).not.toHaveBeenCalled();

    await userEvent.click(chevron());
    await screen.findByRole("tree");
    await userEvent.keyboard("{ArrowUp}{Enter}");
    expect(onPick).toHaveBeenCalledWith(LIB);
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("offers the pin only when the workspace is wide enough to dock", async () => {
    const onDock = vi.fn();
    const { unmount } = render(<Harness />);
    await userEvent.click(
      screen.getByRole("button", { name: "Files", pressed: false })
    );
    await screen.findByRole("tree");
    expect(
      screen.queryByRole("button", { name: "Dock beside the editor" })
    ).toBeNull();
    unmount();

    render(<Harness canDock onDock={onDock} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Files", pressed: false })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Dock beside the editor" })
    );
    expect(onDock).toHaveBeenCalledOnce();
  });

  it("marks a file a later step creates and will not pick it", async () => {
    const onPick = vi.fn();
    render(
      <BaseWorkspaceHead
        tabs={[LIB]}
        active={LIB}
        onOpen={vi.fn()}
        docs={noDocs()}
        tree={{
          open: true,
          docked: false,
          canDock: false,
          rows: treeRows({
            files: [LIB, CLIENT],
            present: new Set([LIB]),
            open: LIB,
            live: LIB,
            createdIn: () => 3,
            docs: [],
          }),
          onToggle: vi.fn(),
          onClose: vi.fn(),
          onPick,
          onPickDoc: vi.fn(),
          onDock: vi.fn(),
        }}
        terminal={{ open: false, onToggle: vi.fn() }}
        filesKey="⌘E"
        terminalKey="⌘J"
      />
    );
    const client = await screen.findByRole("treeitem", { name: /client\.ts/ });
    expect(client.textContent).toContain("Created in step 3");
    expect((client as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("img", { name: "This step's file" })).toBeTruthy();
  });

  it("draws an open doc after the files, with a close button the files lack", async () => {
    const onClose = vi.fn();
    const onOpen = vi.fn();
    render(
      <BaseWorkspaceHead
        tabs={[LIB]}
        active={LIB}
        onOpen={vi.fn()}
        docs={{
          tabs: [{ file: "idl.md", title: "IDL" }],
          active: "idl.md",
          onOpen,
          onClose,
        }}
        tree={{
          open: false,
          docked: false,
          canDock: false,
          rows: rows([], LIB),
          onToggle: vi.fn(),
          onClose: vi.fn(),
          onPick: vi.fn(),
          onPickDoc: vi.fn(),
          onDock: vi.fn(),
        }}
        terminal={{ open: false, onToggle: vi.fn() }}
        filesKey="⌘E"
        terminalKey="⌘J"
      />
    );
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "lib.rs",
      "IDL",
    ]);
    expect(
      screen.getByRole("tab", { name: "IDL" }).getAttribute("aria-selected")
    ).toBe("true");
    // lib.rs keeps its tab, out of the front, and with no tree toggle
    expect(
      screen.getByRole("tab", { name: "lib.rs" }).getAttribute("aria-selected")
    ).toBe("false");
    expect(
      screen.queryByRole("button", { name: "Files", expanded: false })
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Close/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Close IDL" }));
    expect(onClose).toHaveBeenCalledWith("idl.md");
    await userEvent.click(screen.getByRole("tab", { name: "IDL" }));
    expect(onOpen).toHaveBeenCalledWith("idl.md");
  });

  it("picks a doc page from the tree's Docs folder", async () => {
    const onPickDoc = vi.fn();
    render(
      <BaseWorkspaceHead
        tabs={[LIB]}
        active={LIB}
        onOpen={vi.fn()}
        docs={noDocs()}
        tree={{
          open: true,
          docked: false,
          canDock: false,
          rows: rows([{ file: "idl.md", title: "IDL" }], LIB),
          onToggle: vi.fn(),
          onClose: vi.fn(),
          onPick: vi.fn(),
          onPickDoc,
          onDock: vi.fn(),
        }}
        terminal={{ open: false, onToggle: vi.fn() }}
        filesKey="⌘E"
        terminalKey="⌘J"
      />
    );
    const docs = await screen.findByRole("treeitem", { name: "Docs" });
    await userEvent.click(within(docs).getByRole("treeitem", { name: "IDL" }));
    expect(onPickDoc).toHaveBeenCalledWith("idl.md");
  });
});
