import { useRenderOnChange } from "@/hooks";
import { PgExplorer } from "@/utils";
import { readProjectFiles } from "@/widgets/app-nav";
import BaseShareButton from "./BaseShareButton";
import { openShareGistDialogFor } from "./ShareGistDialog";

/**
 * The frame header's Share, connected: opens the share dialog for the open
 * project, and draws nothing while no project is open. The stage bar it sits
 * in is desktop-only, so a phone shares from the open project's row.
 */
const ShareButton = () => {
  useRenderOnChange(PgExplorer.onDidSwitchWorkspace);
  useRenderOnChange(PgExplorer.onDidRenameWorkspace);
  const name = PgExplorer.currentWorkspaceName;
  // eslint-disable-next-line unicorn/no-null -- a component that draws nothing returns `null`; React's types refuse `undefined`
  if (!name) return null;
  return (
    <BaseShareButton
      name={name}
      // The dialog counts and reports its own outcome
      onShare={() =>
        void openShareGistDialogFor("header")(
          () => readProjectFiles(name, PgExplorer.fs),
          name
        )
      }
    />
  );
};

export default ShareButton;
