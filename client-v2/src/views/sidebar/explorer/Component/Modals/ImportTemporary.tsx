import { useState } from "react";

import { trackImport } from "@/features/project-files";
import { FieldError } from "@/shared/ui/field";
import { ModalFrame } from "@/widgets/overlays";

import Input from "../../../../../components/Input";
import { PgExplorer } from "../../../../../utils";
import { useLimitRefusal } from "./useLimitRefusal";

export const ImportTemporary = () => {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const { limitError, guard } = useLimitRefusal();

  const importTemporary = async () => {
    await trackImport(
      () => PgExplorer.createWorkspace(name, { fromTemporary: true }),
      "temporary"
    );
  };

  return (
    <ModalFrame
      name="import-temporary"
      title
      buttonProps={{
        text: "Import",
        onSubmit: guard(importTemporary),
        disabled: !!error,
      }}
    >
      <FieldError data-testid="explorer-limit-error" className="mb-2">
        {limitError}
      </FieldError>
      <div className="mb-2 font-bold">Project name</div>
      <Input
        autoFocus
        value={name}
        onChange={(ev) => setName(ev.target.value)}
        validator={PgExplorer.isWorkspaceNameValid}
        error={error}
        setError={setError}
        placeholder="project name..."
      />
    </ModalFrame>
  );
};
