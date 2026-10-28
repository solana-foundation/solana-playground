import { FC } from "react";

import { ModalFrame } from "@/widgets/overlays";
import { Warning } from "../../../../../components/Icons";
import { PgCommon, PgExplorer } from "../../../../../utils";

interface DeleteItemProps {
  path: string;
}

export const DeleteItem: FC<React.PropsWithChildren<DeleteItemProps>> = ({
  path,
}) => {
  const itemName = PgExplorer.getItemNameFromPath(path);

  const deleteItem = async () => {
    await PgExplorer.deleteItem(path);

    // Select element if there is no selected element
    if (!PgExplorer.getSelectedEl()) {
      const itemPathToSelect =
        PgExplorer.currentFilePath ??
        PgCommon.appendSlash(
          PgCommon.joinPaths(
            PgExplorer.getProjectRootPath(),
            PgExplorer.PATHS.SRC_DIRNAME
          )
        );
      const itemToSelect = PgExplorer.getElFromPath(itemPathToSelect);
      if (itemToSelect) PgExplorer.setSelectedEl(itemToSelect);
    }
  };

  return (
    <ModalFrame
      name="delete-item"
      title
      buttonProps={{
        text: "Delete",
        variant: "destructive",
        onSubmit: deleteItem,
      }}
    >
      <div className="flex items-center justify-center">
        <div className="size-8 [&>svg]:size-full">
          <Warning color="warning" />
        </div>
        <div className="ml-4 flex flex-col">
          <span className="font-bold">
            Are you sure you want to delete '{itemName}'?
          </span>
          <span className="mt-2 text-[0.75rem] text-[color:var(--text-secondary)]">
            This action is irreversible.
          </span>
        </div>
      </div>
    </ModalFrame>
  );
};
