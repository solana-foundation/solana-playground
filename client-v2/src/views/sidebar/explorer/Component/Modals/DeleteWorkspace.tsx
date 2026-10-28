import type { FC } from "react";

import { ModalFrame } from "@/widgets/overlays";
import { Warning } from "../../../../../components/Icons";
import { PgExplorer } from "../../../../../utils";

interface DeleteWorkspaceProps {
  /** Which workspace to delete; defaults to the one the user is in */
  name?: string;
  /** Adds the line about losing lesson progress */
  isLesson?: boolean;
}

export const DeleteWorkspace: FC<
  React.PropsWithChildren<DeleteWorkspaceProps>
> = ({ name, isLesson }) => {
  const workspaceName = name ?? PgExplorer.currentWorkspaceName;

  return (
    <ModalFrame
      name="delete-workspace"
      title
      buttonProps={{
        text: "Delete",
        variant: "destructive",
        onSubmit: () => PgExplorer.deleteWorkspace(workspaceName),
      }}
    >
      <div className="flex items-center justify-center">
        <div className="[&>svg]:size-12">
          <Warning color="warning" />
        </div>
        <div className="ml-4 flex flex-col">
          <span className="font-bold break-all">
            Are you sure you want to delete workspace '{workspaceName}'?
          </span>
          <span className="mt-2 text-[0.75rem] text-[color:var(--text-secondary)]">
            This action is irreversible!
          </span>
          <span className="mt-2 text-[0.75rem] text-[color:var(--text-secondary)]">
            - All files and folders will be deleted.
          </span>
          <span className="mt-2 text-[0.75rem] text-[color:var(--text-secondary)]">
            - Program credentials will be deleted.
          </span>
          {/* Progress lives in `.workspace/tutorial-storage.json`, inside the
              directory about to be removed */}
          {isLesson && (
            <span className="mt-2 text-[0.75rem] text-[color:var(--text-secondary)]">
              - Your progress through the lesson is lost.
            </span>
          )}
        </div>
      </div>
    </ModalFrame>
  );
};
