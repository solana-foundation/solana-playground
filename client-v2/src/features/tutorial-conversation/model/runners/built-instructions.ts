import { PgExplorer, PgProgramInfo } from "@/utils";

import { PROGRAM_FILE, programInstructions } from "../program-source";

/**
 * The instructions of the program just built: its IDL's, or, when the build
 * returned none (Anchor 1.1.2, HOO-2688), the `pub fn`s of the learner's own
 * `src/lib.rs`, so a build goal still checks what the learner wrote
 */
export const builtInstructions = (): string[] => {
  const named = (PgProgramInfo.idl?.instructions ?? []).map((ix) => ix.name);
  if (named.length) return named;
  const source = PgExplorer.getFileContent(
    PgExplorer.convertToFullPath(PROGRAM_FILE)
  );
  return source ? programInstructions(source) : [];
};
