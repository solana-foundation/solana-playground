import type { FC } from "react";

import { PgSession } from "@/features/auth";
import { ModalFrame } from "@/widgets/overlays";
import { useRenderOnChange } from "../../../../../hooks/useRenderOnChange";
import { PgExplorer } from "../../../../../utils";

interface DeleteWorkspaceProps {
  /** Which workspace to delete; defaults to the one the user is in */
  name?: string;
  /** Adds the line about losing lesson progress */
  isLesson?: boolean;
}

/**
 * Spec 11's project delete: names the project and says what goes, with
 * Cancel focused so Enter does not delete.
 */
export const DeleteWorkspace: FC<
  React.PropsWithChildren<DeleteWorkspaceProps>
> = ({ name, isLesson }) => {
  const workspaceName = name ?? PgExplorer.currentWorkspaceName;
  // Read here, not passed in: the session may still be loading when the
  // dialog opens, and the account line must appear once it is read
  useRenderOnChange(PgSession.onDidChange);
  const signedIn = PgSession.get() !== null;

  return (
    <ModalFrame
      name="delete-workspace"
      title={`Delete ${workspaceName}?`}
      openFocus="cancel"
      buttonProps={{
        text: "Delete project",
        variant: "destructive",
        onSubmit: () => PgExplorer.deleteWorkspace(workspaceName),
      }}
    >
      <div className="flex flex-col gap-2 text-control font-read text-muted-foreground">
        <p>Its files and its program keypair are deleted from this browser.</p>
        {/* Progress lives in `.workspace/tutorial-storage.json`, inside the
            directory about to be removed */}
        {isLesson && <p>Your progress in this lesson is lost.</p>}
        {signedIn && (
          <p>It's also deleted from your account and your other devices.</p>
        )}
      </div>
    </ModalFrame>
  );
};
