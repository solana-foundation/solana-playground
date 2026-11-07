/* eslint-disable unicorn/no-null -- `TreeInput.createdIn` returns null for a starter file */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DocTab } from "../model/tree";
import { treeRows } from "../model/tree";
import BaseFilesSheet from "./BaseFilesSheet";

const LIB = "src/lib.rs";
const CLIENT = "client/client.ts";

const rowsWith = (docs: DocTab[]) =>
  treeRows({
    files: [LIB, CLIENT],
    present: new Set([LIB, CLIENT]),
    open: LIB,
    live: LIB,
    createdIn: () => null,
    docs,
  });

const sheet = (docs: DocTab[]) => {
  const on = { onOpenChange: vi.fn(), onPick: vi.fn(), onPickDoc: vi.fn() };
  render(<BaseFilesSheet open rows={rowsWith(docs)} {...on} />);
  return on;
};

const IDL: DocTab = { file: "idl.md", title: "IDL" };

describe("BaseFilesSheet", () => {
  it("titles the sheet Files", () => {
    sheet([]);
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", { name: "Files" })
    ).toBeTruthy();
  });

  it("shows no section headings for a tutorial without docs", () => {
    sheet([]);
    expect(screen.queryByText("All files")).toBeNull();
    expect(screen.queryByText("Docs")).toBeNull();
    expect(screen.getByRole("treeitem", { name: /lib\.rs/ })).toBeTruthy();
  });

  it("lists the files under All files, then the pages under Docs", () => {
    sheet([IDL]);
    const all = screen.getByRole("region", { name: "All files" });
    const docs = screen.getByRole("region", { name: "Docs" });
    expect(within(all).getByRole("treeitem", { name: /lib\.rs/ })).toBeTruthy();
    expect(within(all).queryByRole("treeitem", { name: "IDL" })).toBeNull();
    expect(within(docs).getByRole("treeitem", { name: "IDL" })).toBeTruthy();
    expect(
      all.compareDocumentPosition(docs) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("opens a picked file and closes", async () => {
    const on = sheet([IDL]);
    await userEvent.click(screen.getByRole("treeitem", { name: /client\.ts/ }));
    expect(on.onPick).toHaveBeenCalledWith(CLIENT);
    expect(on.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens a tapped doc page and closes", async () => {
    const on = sheet([IDL]);
    await userEvent.click(screen.getByRole("treeitem", { name: "IDL" }));
    expect(on.onPickDoc).toHaveBeenCalledWith("idl.md");
    expect(on.onPick).not.toHaveBeenCalled();
    expect(on.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("gives every row a fingertip's height", () => {
    sheet([IDL]);
    for (const row of screen.getAllByRole("treeitem")) {
      if (row.tagName === "BUTTON") expect(row.classList).toContain("h-11");
    }
  });
});
