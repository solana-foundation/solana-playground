import { FC, useEffect, useRef, useState } from "react";

import { FieldError } from "@/shared/ui/field";
import { ModalFrame } from "@/widgets/overlays";

import Input from "../../../../../components/Input";
import { PgCommon, PgExplorer } from "../../../../../utils";
import { useLimitRefusal } from "./useLimitRefusal";

interface RenameItemProps {
  path: string;
}

export const RenameItem: FC<React.PropsWithChildren<RenameItemProps>> = ({
  path,
}) => {
  const itemName = PgExplorer.getItemNameFromPath(path);
  const [newName, setNewName] = useState(itemName);
  const [error, setError] = useState("");
  const { limitError, guard } = useLimitRefusal();

  const rename = async () => {
    const newPath = PgCommon.joinPaths(
      PgExplorer.getParentPathFromPath(path),
      newName
    );
    await PgExplorer.renameItem(path, newPath);
  };

  // Select the file name without the extension on mount
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.setSelectionRange(0, inputRef.current.value.indexOf("."));
  }, []);

  return (
    <ModalFrame
      name="rename-item"
      title={`Rename '${itemName}'`}
      buttonProps={{
        text: "Rename",
        onSubmit: guard(rename),
        disabled: !!error,
      }}
    >
      <FieldError data-testid="explorer-limit-error" className="mb-2">
        {limitError}
      </FieldError>
      <Input
        ref={inputRef}
        autoFocus
        value={newName}
        onChange={(ev) => setNewName(ev.target.value)}
        validator={PgExplorer.isItemNameValid}
        error={error}
        setError={setError}
      />
    </ModalFrame>
  );
};
