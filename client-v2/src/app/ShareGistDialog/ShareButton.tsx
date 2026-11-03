import { useRenderOnChange } from "@/hooks";
import { PgExplorer } from "@/utils";
import { readProjectFiles } from "@/widgets/app-nav";
import BaseShareButton from "./BaseShareButton";
import { openShareGistDialog } from "./ShareGistDialog";

/**
 * The frame header's Share, connected: opens the share dialog for the open
 * project, and draws nothing while no project is open. The stage bar it sits
 * in is desktop-only, so a phone shares from the open project's row.
 */
const ShareButton = () => {
  useRenderOnChange(PgExplorer.onDidSwitchWorkspace);
  useRenderOnChange(PgExplorer.onDidRenameWorkspace);
  const name = PgExplorer.currentWorkspaceName;
  if (!name) return null;
  return (
    <BaseShareButton
      name={name}
      // The dialog counts and reports its own outcome
      onShare={() =>
        void openShareGistDialog(
          name,
          () => readProjectFiles(name, PgExplorer.fs),
          "header"
        )
      }
    />
  );
};

export default ShareButton;
