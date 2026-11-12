import { TriangleAlert, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
import { CopyButton } from "@/shared/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropZone,
  DropZoneDescription,
  DropZoneIcon,
  DropZoneTitle,
} from "@/shared/ui/drop-zone";
import { Input } from "@/shared/ui/input";

/** The line under the field or the drop zone after an action */
export type KeypairNote =
  | "changed"
  | "invalid"
  | "removed"
  | "refused"
  | undefined;

export interface BaseProgramKeypairProps {
  /** The id a deploy goes to: the custom id, else the keypair's; undefined with neither */
  programId: string | undefined;
  hasKeypair: boolean;
  /** A custom program id overrides the keypair's */
  customId: boolean;
  /** The custom id differs from the keypair's, so a first deploy refuses */
  mismatch: boolean;
  note: KeypairNote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dialog that asks before the keypair is replaced is open */
  confirming: boolean;
  /** What the dialog asks about: a new keypair, or an imported file's */
  replacing: "new" | "import";
  /** A deploy is running and reads the keypair again for its last transaction */
  held: boolean;
  onNew: () => void;
  onConfirmNew: () => void;
  onCancelNew: () => void;
  /** "Save keypair" in the dialog: downloads the keypair about to be replaced */
  onSaveOld: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
  /** The field's text changed: a note about the last press is stale */
  onEdit: () => void;
  /** "Change program id" with the field's text, trimmed */
  onChangeId: (text: string) => void;
  onRemoveCustomId: () => void;
}

const FIELD_NOTES = {
  changed: { text: "Program id changed", error: false },
  invalid: { text: "Not a valid public key", error: true },
  removed: { text: "Custom id removed", error: false },
} as const;

const REFUSED =
  "That file is not a program keypair: expected the 64-number JSON the Solana CLI writes.";

const MISMATCH =
  "This program id does not match the program keypair. A first deploy needs the keypair for this id: import it, remove the custom id, or create a new keypair.";

/**
 * The legacy sidebar's program id controls, folded as the last row of the
 * Deploy stage's facts: "Program id" and the id, a press away from its field
 * and keypair actions. Every control is quiet: Deploy is the stage's one
 * accent action.
 */
const BaseProgramKeypair = (p: BaseProgramKeypairProps) => {
  const [text, setText] = useState(p.programId ?? "");
  // A new id (a build's first keypair, an import, a change) replaces the
  // text, as the legacy field did; typing alone does not
  useEffect(() => setText(p.programId ?? ""), [p.programId]);
  const edited = text.trim() !== (p.programId ?? "");
  // A green "changed" beside the mismatch warning would contradict it
  const fieldNote =
    p.note && p.note !== "refused" && !(p.note === "changed" && p.mismatch)
      ? FIELD_NOTES[p.note]
      : undefined;

  return (
    <section aria-label="Program id" className="flex w-full flex-col">
      <Collapsible open={p.open} onOpenChange={p.onOpenChange}>
        {/* A row of the stage's summary: the name at the left, the id and
            the fold's mark at the right; named "Program id" alone, so the id
            is read once, in the field */}
        <CollapsibleHeading
          aria-label="Program id"
          className="min-h-10 w-full justify-between gap-4 px-4 py-2 text-caption font-normal"
        >
          <span className="shrink-0 whitespace-nowrap">Program id</span>
          <span className="flex min-w-0 items-center gap-1.5 text-foreground">
            {p.programId && (
              <code className="min-w-0 truncate font-mono" title={p.programId}>
                {p.programId}
              </code>
            )}
            <CollapsibleChevron />
          </span>
        </CollapsibleHeading>
        {/* Closed, the content keeps no edge or padding of its own, so the
            card ends at the row */}
        <CollapsibleContent className="flex flex-col gap-3 border-t border-border px-4 py-3 text-left data-[state=closed]:hidden">
          {p.mismatch && (
            <Callout variant="warning" aria-label="Program id mismatch">
              <TriangleAlert />
              <CalloutDescription>{MISMATCH}</CalloutDescription>
            </Callout>
          )}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Input
                aria-label="Program id"
                className="font-mono text-code"
                placeholder="Your program's public key"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  p.onEdit();
                }}
                disabled={p.held}
                spellCheck={false}
                autoComplete="off"
              />
              <CopyButton
                value={text}
                label="Copy the program id"
                onError={reportButtonFailure("copy the program id")}
              />
            </div>
            <p className="text-caption text-muted-foreground">
              Only the upgrade authority can upgrade the program.
            </p>
            {fieldNote && (
              <p
                role="status"
                className={
                  fieldNote.error
                    ? "text-caption text-destructive"
                    : "text-caption text-success"
                }
              >
                {fieldNote.text}
              </p>
            )}
            {edited && (
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                disabled={p.held}
                onClick={() => p.onChangeId(text.trim())}
              >
                Change program id
              </Button>
            )}
          </div>
          {/* The actions on the id itself, one row, one quiet variant */}
          <div className="flex flex-wrap gap-2">
            {p.customId && (
              <Button
                size="sm"
                variant="outline"
                disabled={p.held}
                onClick={p.onRemoveCustomId}
              >
                Remove custom id
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={p.held}
              onClick={p.onNew}
            >
              New keypair
            </Button>
            {p.hasKeypair && !p.customId && (
              <Button size="sm" variant="outline" onClick={p.onExport}>
                Export keypair
              </Button>
            )}
          </div>
          <DropZone
            aria-label="Import keypair"
            accept=".json,application/json"
            className="py-5"
            disabled={p.held}
            onFiles={(files) => files[0] && p.onImport(files[0])}
          >
            <DropZoneIcon>
              <Upload />
            </DropZoneIcon>
            <DropZoneTitle>Drop a program keypair here</DropZoneTitle>
            <DropZoneDescription>
              or press to choose a .json file
            </DropZoneDescription>
          </DropZone>
          {p.note === "refused" && (
            <p role="alert" className="text-caption text-destructive">
              {REFUSED}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
      <Dialog
        open={p.confirming && !p.held}
        onOpenChange={(open) => !open && p.onCancelNew()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {p.replacing === "import"
                ? "Replace the program keypair?"
                : "Create a new program keypair?"}
            </DialogTitle>
            <DialogDescription>
              {p.replacing === "import"
                ? "The keypair from the file takes this program's place."
                : "This will create a brand new keypair for your program."}
              {p.customId && " It also removes the custom program id."}
            </DialogDescription>
          </DialogHeader>
          <Callout variant="warning">
            <TriangleAlert />
            <CalloutDescription>
              The old keypair will be lost if you don&apos;t save it.
            </CalloutDescription>
          </Callout>
          <DialogFooter>
            {p.hasKeypair && (
              <Button variant="outline" onClick={p.onSaveOld}>
                Save keypair
              </Button>
            )}
            <Button onClick={p.onConfirmNew}>
              {p.replacing === "import" ? "Replace" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default BaseProgramKeypair;
