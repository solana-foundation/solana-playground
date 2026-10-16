import { useState } from "react";
import type { FC } from "react";
import { FileJson } from "lucide-react";

import ImportButton from "../../../components/ImportButton";
import { createLogger } from "@/shared/lib/logger";
import { Button } from "@/shared/ui/button";
import {
  DropZone,
  DropZoneDescription,
  DropZoneIcon,
  DropZoneTitle,
} from "@/shared/ui/drop-zone";
import { useRenderOnChange } from "../../../hooks";
import { PgCommon, PgProgramInfo } from "../../../utils";

const log = createLogger("flow:idl-actions");

const LOAD_HINT =
  "Replaces the IDL this browser uses in Interact -- nothing is written on-chain";

/**
 * Which door to the IDL: `download` saves what the build produced; `drop`
 * loads a file dropped or picked on a drop zone; `button` loads one through a
 * compact button, for a toolbar with no room for a drop zone.
 */
export type IdlActionsMode = "download" | "drop" | "button";

type Note = { kind: "used"; text: string } | { kind: "refused" };

/** Parses an Anchor IDL file; throws when it is not one */
const parseIdl = async (file: File) => {
  const parsed = JSON.parse(await file.text());
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

/** Loads an IDL file into this browser, by drop zone or by button */
const LoadIdl = ({ mode }: { mode: "drop" | "button" }) => {
  const [note, setNote] = useState<Note | null>(null);

  /** Refuses a file that is not an IDL; a throw after that is ours */
  const load = async (file: File | undefined) => {
    if (!file) return;
    let idl;
    try {
      idl = await parseIdl(file);
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

  if (mode === "button") {
    // `ImportButton` reports a throw from `load` itself
    return (
      <>
        <ImportButton
          accept=".json"
          title={LOAD_HINT}
          onImport={(ev) => load(ev.target.files?.[0])}
        >
          Load IDL file
        </ImportButton>
        {noteLine}
      </>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <DropZone
        accept=".json"
        onFiles={(files) =>
          load(files[0]).catch((e) => log.error(e, { report: true }))
        }
      >
        <DropZoneIcon>
          <FileJson />
        </DropZoneIcon>
        <DropZoneTitle>Load IDL file</DropZoneTitle>
        <DropZoneDescription>{LOAD_HINT}</DropZoneDescription>
      </DropZone>
      {noteLine}
    </div>
  );
};

/**
 * Labels promise no more than what happens in the browser: "Download IDL"
 * saves what the build already produced, "Load IDL file" replaces the IDL
 * this app uses -- neither touches the chain.
 */
const IdlActions: FC<{ mode: IdlActionsMode }> = ({ mode }) =>
  mode === "download" ? <DownloadIdl /> : <LoadIdl mode={mode} />;

export default IdlActions;
