import { useMemo } from "react";

import { useRenderOnChange } from "@/hooks";
import { PgTutorial } from "@/utils";
import { NOTHING_RUN, terminalStatus } from "../model/terminal";
import type { TerminalStatus } from "../model/terminal";
import { tutorialFiles } from "../model/tree";
import { useTerminalFacts } from "./use-terminal-facts";

export interface TutorialTerminal {
  status: TerminalStatus;
  /** The drawer's line before anything ran, or null once something has */
  empty: string | null;
}

/**
 * The terminal bar's line in a tutorial (`tutorial-workspace`, "The terminal
 * bar is always on screen"), for the view to hand the console while the
 * frame shows. Always called; it reads the open tutorial's files, or none.
 */
export const useTutorialTerminal = (): TutorialTerminal => {
  useRenderOnChange(PgTutorial.onDidChange);
  const tutorial = PgTutorial.current;
  const definition = tutorial?.definition;
  const files = useMemo(
    () => (definition ? tutorialFiles(definition) : []),
    [definition]
  );
  const facts = useTerminalFacts(tutorial?.name ?? "", files);
  return {
    status: terminalStatus(facts),
    empty: facts.last === null && facts.running === null ? NOTHING_RUN : null,
  };
};
