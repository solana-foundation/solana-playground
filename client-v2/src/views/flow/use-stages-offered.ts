import { useConversationStarted } from "@/widgets/tutorial-conversation";

import { useRenderOnChange } from "../../hooks";
import { PgExplorer, PgTutorial } from "../../utils";
import { offersStages } from "./stages-offered";

/** `offersStages` for the tutorial in the URL, re-read as it changes */
export const useStagesOffered = (): boolean => {
  useRenderOnChange(PgTutorial.onDidChangeCurrent);
  // Upstream's Start makes the workspace, as can sync or an import while its
  // About page is open; on a cold load the explorer learns its workspaces
  // after the first render
  useRenderOnChange(PgTutorial.onDidChange);
  useRenderOnChange(PgExplorer.onDidInit);
  useRenderOnChange(PgExplorer.onDidCreateWorkspace);
  useRenderOnChange(PgExplorer.onDidDeleteWorkspace);
  const current = PgTutorial.current;
  const conversationStarted = useConversationStarted(current?.name ?? "");

  if (!current) return offersStages({ kind: "none" });
  if (current.definition) {
    return offersStages({ kind: "definition", conversationStarted });
  }
  return offersStages({
    kind: "upstream",
    name: current.name,
    workspaces: PgExplorer.allWorkspaceNames,
  });
};
