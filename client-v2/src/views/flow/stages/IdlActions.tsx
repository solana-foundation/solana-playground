import { useState } from "react";
import type { FC } from "react";

import ImportButton from "../../../components/ImportButton";
import { createLogger } from "@/shared/lib/logger";
import { Button } from "@/shared/ui/button";
import { useRenderOnChange } from "../../../hooks";
import { PgCommon, PgProgramInfo } from "../../../utils";

const log = createLogger("flow:idl-actions");

const LOAD_HINT =
  "Replaces the IDL this browser uses in Interact \u2014 nothing is written on-chain";

/**
 * Which door to the IDL: `download` saves what the build produced; `upload`
 * loads a file picked through a button, the prototype's secondary action
 * under Deploy's pill and in Interact's toolbar.
 */
export type IdlActionsMode = "download" | "upload";

type Note = { kind: "used"; text: string } | { kind: "refused" };

/** Parses an Anchor IDL file's text; throws when it is not one */
const parseIdl = (text: string) => {
  const parsed = JSON.parse(text);
  // The one field every consumer walks; a JSON file without it would land in
  // Interact as "corrupted IDL" -- refuse it at the door instead
  if (!Array.isArray(parsed?.instructions)) {
    throw new Error("missing `instructions`");
  }
  return parsed;
};

/** Saves the IDL the last build produced */
const DownloadIdl = () => {
  const idl = useRenderOnChange(PgProgramInfo.onDidChangeIdl);
  if (!idl) {
    return (
      <Button variant="outline" disabled title="Build successfully first">
        Download IDL
      </Button>
    );
  }
  return (
    <Button asChild variant="outline">
      <a href={PgCommon.getDataUrl(idl)} download="idl.json">
        Download IDL
      </a>
    </Button>
  );
};

/** Loads an IDL file into this browser, picked through a button */
const UploadIdl = () => {
  const [note, setNote] = useState<Note | null>(null);

  /** Refuses a file that is not an IDL; a throw after that is ours */
  const load = async (file: File | undefined) => {
    if (!file) return;
    // A note from an earlier file must not outlive a failure on this one
    setNote(null);
    // Read outside the try: a file that cannot be read is not the user's
    // malformed IDL, and `ImportButton` reports it
    const text = await file.text();
    let idl;
    try {
      idl = parseIdl(text);
    } catch (e) {
      // The user's own file, not a fault of ours: say so and log it quietly
      log.warn("Refused an IDL file", {
        context: { name: file.name, reason: String(e) },
      });
      setNote({ kind: "refused" });
      return;
    }
    PgProgramInfo.update({ idl });
    setNote({ kind: "used", text: `Using ${idl.name ?? file.name}` });
  };

  const noteLine = note && (
    <span
      role="status"
      className={
        note.kind === "refused"
          ? "font-mono text-xs text-error"
          : "font-mono text-xs text-muted-foreground"
      }
    >
      {note.kind === "refused" ? "Not an Anchor IDL JSON file" : note.text}
    </span>
  );

  // `ImportButton` reports a throw from `load` itself. The input lets go of
  // the file on every pick: a browser fires no change for the file it already
  // holds, so a file fixed on disk and picked again would be ignored.
  return (
    <>
      <ImportButton
        accept=".json"
        title={LOAD_HINT}
        onImport={(ev) => {
          const file = ev.target.files?.[0];
          ev.target.value = "";
          return load(file);
        }}
      >
        Upload IDL
      </ImportButton>
      {noteLine}
    </>
  );
};

/**
 * Labels promise no more than what happens in the browser: "Download IDL"
 * saves what the build already produced, "Upload IDL" replaces the IDL
 * this app uses -- neither touches the chain.
 */
const IdlActions: FC<{ mode: IdlActionsMode }> = ({ mode }) =>
  mode === "download" ? <DownloadIdl /> : <UploadIdl />;

export default IdlActions;
