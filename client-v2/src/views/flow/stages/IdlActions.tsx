import type { FC } from "react";
import { useState } from "react";

import { programName } from "@/entities/idl";
import { createLogger } from "@/shared/lib/logger";
import { Button } from "@/shared/ui/button";

import ImportButton from "../../../components/ImportButton";
import { useRenderOnChange } from "../../../hooks";
import { PgCommon, PgProgramInfo } from "../../../utils";
import { PgFlow } from "../state/stage";

const log = createLogger("flow:idl-actions");

const LOAD_HINT =
  "Replaces the IDL this browser uses in Interact \u2014 nothing is written on-chain";

/**
 * Which door to the IDL: `download` saves the IDL in use; `upload` loads a
 * file picked through a button and names the IDL beside it (Interact's
 * toolbar); `upload-button` is the same button without the name, for a
 * stage that lists the IDL among its facts (Deploy, `useIdlName`).
 */
export type IdlActionsMode = "download" | "upload" | "upload-button";

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

/**
 * How an IDL action looks: an outlined button beside other actions
 * (Interact's toolbar and its no-IDL stage, the outlines under Deploy's
 * pill), a link in Build succeeded's downloads row
 */
type IdlLook = "outline" | "link";

/**
 * Saves the IDL in use, the build's or an uploaded one. Nothing while there
 * is none: a disabled Download IDL under "Build succeeded" read as a broken
 * promise
 */
const DownloadIdl = ({ look }: { look: IdlLook }) => {
  const idl = useRenderOnChange(PgProgramInfo.onDidChangeIdl);
  // eslint-disable-next-line unicorn/no-null -- a component renders nothing as null
  if (!idl) return null;
  return (
    <Button asChild variant={look}>
      <a href={PgCommon.getDataUrl(idl)} download="idl.json">
        Download IDL
      </a>
    </Button>
  );
};

/**
 * Loads an IDL file into this browser; false when the file is not an Anchor
 * IDL. The file is read outside the refusal: a file that cannot be read is
 * not the user's malformed IDL, so that throw goes to the caller
 */
export const loadIdlFile = async (file: File) => {
  const text = await file.text();
  let parsed;
  try {
    parsed = parseIdl(text);
  } catch (e) {
    // The user's own file, not a fault of ours: say so and log it quietly
    log.warn("Refused an IDL file", {
      context: { name: file.name, reason: String(e) },
    });
    return false;
  }
  PgProgramInfo.update({ idl: parsed });
  return true;
};

/** Takes the user to Interact, where the IDL in use is called */
export const openInteract = () => PgFlow.setStage("interact");

/** Names the IDL in use by its program, so the user can tell which is loaded */
const idlLabel = (idl: object) => {
  const name = programName(idl);
  return name ? `IDL \u00b7 ${name}` : "IDL loaded";
};

/**
 * Loads an IDL file into this browser, picked through a button. The IDL in
 * use is shared state, so Deploy and Interact, each with its own instance,
 * name the same one; only a refused pick stays with the instance it hit.
 */
const UploadIdl = ({
  look,
  withName,
}: {
  look: IdlLook;
  withName: boolean;
}) => {
  const idl = useRenderOnChange(PgProgramInfo.onDidChangeIdl);
  // The IDL that was in use when a pick here was refused. The refusal shows
  // only while that IDL still is: any new IDL, from a pick here, on the
  // other step or from a build, answers it.
  const [refusal, setRefusal] = useState<{ over: typeof idl }>();
  const refused = refusal !== undefined && refusal.over === idl;

  /** Refuses a file that is not an IDL; a throw after that is ours */
  const load = async (file: File | undefined) => {
    if (!file) return;
    if (!(await loadIdlFile(file))) setRefusal({ over: idl });
  };

  // `ImportButton` reports a throw from `load` itself. The input lets go of
  // the file on every pick: a browser fires no change for the file it already
  // holds, so a file fixed on disk and picked again would be ignored.
  return (
    // One group, so the lines stay beside their button wherever a stage puts it
    <span className="inline-flex flex-wrap items-center gap-2">
      <ImportButton
        accept=".json"
        variant={look}
        title={LOAD_HINT}
        onImport={(ev) => {
          const file = ev.target.files?.[0];
          ev.target.value = "";
          return load(file);
        }}
      >
        Upload IDL
      </ImportButton>
      {refused && (
        <span role="alert" className="font-mono text-xs text-error">
          That file is not an Anchor IDL.
        </span>
      )}
      {withName && idl && (
        <span role="status" className="font-mono text-xs text-muted-foreground">
          {idlLabel(idl)}
        </span>
      )}
    </span>
  );
};

/**
 * Labels promise no more than what happens in the browser: "Download IDL"
 * saves the IDL in use, "Upload IDL" replaces the IDL
 * this app uses -- neither touches the chain.
 */
const IdlActions: FC<{ mode: IdlActionsMode; look?: IdlLook }> = ({
  mode,
  look = "outline",
}) =>
  mode === "download" ? (
    <DownloadIdl look={look} />
  ) : (
    // "upload-button" leaves the IDL's name to the stage, which shows it
    // among its facts (`useIdlName`)
    <UploadIdl look={look} withName={mode === "upload"} />
  );

/** The IDL in use, by its program's name, for a stage that lists it; undefined while none */
export const useIdlName = () => {
  const idl = useRenderOnChange(PgProgramInfo.onDidChangeIdl);
  if (!idl) return undefined;
  return programName(idl) ?? "loaded";
};

export default IdlActions;
