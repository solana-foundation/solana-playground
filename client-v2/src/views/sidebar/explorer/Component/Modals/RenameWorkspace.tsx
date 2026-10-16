import type { FC } from "react";
import { useEffect, useRef, useState } from "react";

import Input from "../../../../../components/Input";
import Modal from "../../../../../components/Modal";
import { PgCommon, PgExplorer, PgView } from "../../../../../utils";

interface RenameWorkspaceProps {
  /** Which workspace to rename; defaults to the one the user is in */
  name?: string;
}

export const RenameWorkspace: FC<RenameWorkspaceProps> = ({ name }) => {
  const workspaceName = name ?? PgExplorer.currentWorkspaceName!;
  const [newName, setNewName] = useState(workspaceName);
  const [error, setError] = useState("");

  const renameWorkspace = async () => {
    if (workspaceName === newName) return;

    try {
      PgView.setSidebarLoading(true);
      // Another workspace is renamed where it lies, and announced so sync
      // uploads the new name; the current one is renamed as before
      await PgCommon.transition(
        PgExplorer.renameWorkspace(newName, {
          from: workspaceName,
          announce: true,
        })
      );
    } finally {
      PgView.setSidebarLoading(false);
    }
  };
  // Select input text on mount
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  return (
    <Modal
      title={`Rename workspace '${workspaceName}'`}
      buttonProps={{
        text: "Rename",
        onSubmit: renameWorkspace,
        disabled: !!error,
        size: "small",
      }}
    >
      <Input
        ref={inputRef}
        value={newName}
        onChange={(ev) => setNewName(ev.target.value)}
        validator={PgExplorer.isWorkspaceNameValid}
        error={error}
        setError={setError}
      />
    </Modal>
  );
};
