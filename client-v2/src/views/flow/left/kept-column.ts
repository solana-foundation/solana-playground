/** The column's tabs, shown in a lesson */
export type Tab = "steps" | "files";

/**
 * What the files column held when it last unmounted, in which project
 * (`PgExplorer.currentWorkspaceId`, which a rename keeps).
 * Hidden by ⌘E or the stage bar, the column leaves the layout and unmounts
 * (design.md, "Frame chrome (5.25)"), so its scroll and its lesson tab are
 * put back from here when it comes back; the tree keeps its folders on its
 * own (`kept-tree.ts`).
 */
export type KeptColumn = { workspace: string; tab: Tab; scrollTop: number };

let kept: KeptColumn | null = null;

export const keepColumn = (column: KeptColumn) => {
  kept = column;
};

/**
 * The column kept for `workspace`; none with no project open or when the
 * memory is another project's. Kept per project and overwritten by the next
 * hide, so a switch away and back still finds it.
 */
export const keptColumn = (
  workspace: string | undefined
): Omit<KeptColumn, "workspace"> | null =>
  workspace && kept?.workspace === workspace
    ? { tab: kept.tab, scrollTop: kept.scrollTop }
    : null;

/**
 * Sets the tab the column opens on for `workspace`, keeping the kept scroll
 * when the memory is that project's (0 otherwise); nothing without a
 * project. The objective band's "Show the steps" uses it on the phone, where
 * the Files sheet mounts the column fresh and reads its tab from here.
 */
export const keepTab = (workspace: string | undefined, tab: Tab) => {
  if (!workspace) return;
  keepColumn({
    workspace,
    tab,
    scrollTop: keptColumn(workspace)?.scrollTop ?? 0,
  });
};

/** Drops the memory; for tests */
export const forgetColumn = () => {
  kept = null;
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach } = import.meta.vitest;

  describe("views/flow/left/kept-column", () => {
    describe("keepTab", () => {
      beforeEach(() => {
        forgetColumn();
        keepColumn({ workspace: "a", tab: "files", scrollTop: 120 });
      });

      it("keeps the scroll of the same project", () => {
        keepTab("a", "steps");
        expect(keptColumn("a")).toEqual({ tab: "steps", scrollTop: 120 });
      });

      it("starts another project at the top", () => {
        keepTab("b", "steps");
        expect(keptColumn("b")).toEqual({ tab: "steps", scrollTop: 0 });
        // One memory: the other project's is replaced, not kept beside it
        expect(keptColumn("a")).toBeNull();
      });

      it("does nothing with no project open", () => {
        keepTab(undefined, "steps");
        expect(keptColumn("a")).toEqual({ tab: "files", scrollTop: 120 });
      });
    });
  });
}
