import { FC } from "react";

import { ModalFrame } from "@/widgets/overlays";
import { PgCommon, PgExplorer } from "../../../../../utils";

interface DeleteItemProps {
  path: string;
}

/** How many files sit under a folder path, at any depth */
const countFilesIn = (folderPath: string) => {
  const prefix = PgCommon.appendSlash(PgExplorer.convertToFullPath(folderPath));
  return Object.entries(PgExplorer.files).filter(
    ([itemPath, item]) =>
      itemPath.startsWith(prefix) && item.content !== undefined
  ).length;
};

/** "Delete lib.rs?", or a folder's name with the files that go with it */
const titleOf = (path: string) => {
  const itemName = PgExplorer.getItemNameFromPath(path);
  const count = path.endsWith("/") ? countFilesIn(path) : 0;
  if (count === 0) return `Delete ${itemName}?`;
  const files = count === 1 ? "the 1 file" : `the ${count} files`;
  return `Delete ${itemName} and ${files} in it?`;
};

/**
 * Spec 11's file and folder delete: names the item, counts a folder's files,
 * and opens on Cancel so Enter does not delete.
 */
export const DeleteItem: FC<React.PropsWithChildren<DeleteItemProps>> = ({
  path,
}) => {
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
      title={titleOf(path)}
      openFocus="cancel"
      buttonProps={{
        text: "Delete",
        variant: "destructive",
        onSubmit: deleteItem,
      }}
    >
      <p className="text-control font-read text-muted-foreground">
        You can't undo this.
      </p>
    </ModalFrame>
  );
};
