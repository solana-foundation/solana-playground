import { FC } from "react";

import { ModalFrame } from "@/widgets/overlays";
import { Warning } from "../../../../../components/Icons";
import { PgExplorer } from "../../../../../utils";

interface ReplaceItemProps {
  fromPath: string;
  toPath: string;
}

export const ReplaceItem: FC<React.PropsWithChildren<ReplaceItemProps>> = ({
  fromPath,
  toPath,
}) => {
  const itemName = PgExplorer.getItemNameFromPath(toPath);

  const replaceItem = async () => {
    await PgExplorer.renameItem(fromPath, toPath, {
      skipNameValidation: true,
      override: true,
    });
  };

  return (
    <ModalFrame
      name="replace-item"
      title
      buttonProps={{
        text: "Replace",
        onSubmit: replaceItem,
      }}
    >
      <div className="flex items-center justify-center">
        <div className="size-8 [&>svg]:size-full">
          <Warning color="warning" />
        </div>
        <div className="ml-4 flex flex-col">
          <span className="font-bold">
            '{itemName}' already exists. Do you want to replace it?
          </span>
          <span className="mt-2 text-[0.75rem] text-[color:var(--text-secondary)]">
            This action is irreversible.
          </span>
        </div>
      </div>
    </ModalFrame>
  );
};
