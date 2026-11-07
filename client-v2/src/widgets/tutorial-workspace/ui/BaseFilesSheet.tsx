import type { FC } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";

import type { TreeRow } from "../model/tree";
import { DOCS_FOLDER } from "../model/tree";
import BaseFileTreeList from "./BaseFileTreeList";
import { SHEET, SHEET_HANDLE, SHEET_HEAD } from "./sheet-chrome";

/** A section's label, caption-sized, on the rows' edge */
const LABEL = "px-2 pt-2 pb-1 text-caption text-muted-foreground";

/** The section that lists the tutorial's own files */
const ALL_FILES = "All files";

export interface BaseFilesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tree's rows (`treeRows`), the doc pages' under the Docs folder */
  rows: TreeRow[];
  onPick: (path: string) => void;
  /** A doc page picked, by its Markdown file */
  onPickDoc: (file: string) => void;
}

/**
 * The phone's file tree, under the Code head's file name (prototype
 * `FilesSheet`): the desktop tree's rows at a thumb's height. A tutorial with
 * doc pages lists its files under "All files" and the pages under the
 * heading the desktop tree names their folder by; one without lists the
 * files alone. A pick shows the file or the page and closes.
 */
const BaseFilesSheet: FC<BaseFilesSheetProps> = ({
  open,
  onOpenChange,
  rows,
  onPick,
  onPickDoc,
}) => {
  const pick = (path: string) => {
    onPick(path);
    onOpenChange(false);
  };
  const pickDoc = (file: string) => {
    onPickDoc(file);
    onOpenChange(false);
  };
  // `treeRows` puts the Docs folder last, straight over its pages: the heading
  // takes the folder's place, and the pages sit on the rows' edge under it
  const firstDoc = rows.findIndex((row) => row.kind === "doc");
  const files = firstDoc === -1 ? rows : rows.slice(0, firstDoc - 1);
  const docs = rows.flatMap((row) =>
    row.kind === "doc" ? [{ ...row, depth: 0 }] : []
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className={SHEET}>
        <div aria-hidden="true" className={SHEET_HANDLE} />
        <SheetHeader className={SHEET_HEAD}>
          <SheetTitle>Files</SheetTitle>
          <SheetDescription className="sr-only">
            Pick a file to show it
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 overflow-y-auto px-2 pb-[max(env(safe-area-inset-bottom),16px)]">
          {docs.length === 0 ? (
            <BaseFileTreeList
              rows={files}
              tall
              onPick={pick}
              onPickDoc={pickDoc}
            />
          ) : (
            <>
              <section aria-label={ALL_FILES}>
                <h3 className={LABEL}>{ALL_FILES}</h3>
                <BaseFileTreeList
                  rows={files}
                  tall
                  onPick={pick}
                  onPickDoc={pickDoc}
                />
              </section>
              <section aria-label={DOCS_FOLDER} className="mt-2">
                <h3 className={LABEL}>{DOCS_FOLDER}</h3>
                <BaseFileTreeList
                  rows={docs}
                  label={DOCS_FOLDER}
                  tall
                  onPick={pick}
                  onPickDoc={pickDoc}
                />
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default BaseFilesSheet;
