import { MouseEvent, useCallback, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { DeleteItem, RenameItem } from "./Modals";
import {
  PgCommand,
  PgCommon,
  PgExplorer,
  PgGlobal,
  PgLanguage,
  PgView,
} from "../../../../utils";
import { useRenderOnChange } from "../../../../hooks";

const log = createLogger("explorer:context-menu");

const reportMenuActionFailure = (action: string, err: unknown) => {
  log.error(err, { report: true, context: { action } });
  PgView.setToast(
    () => <span>Could not open that. Reload and try again.</span>,
    {
      options: { name: "menu-action-failed" },
    }
  );
};

export type ItemData = {
  [K in
    | "isFolder"
    | "isProgramFolder"
    | "isClient"
    | "isClientFolder"
    | "isTest"
    | "isTestFolder"]?: boolean;
};

export const useExplorerContextMenu = () => {
  const buildLoading = useRenderOnChange(PgGlobal.onDidChangeBuildLoading);
  const deployState = useRenderOnChange(PgGlobal.onDidChangeDeployState);

  const [itemData, setItemData] = useState<ItemData>({});
  const [ctxSelectedPath, setCtxSelectedPath] = useState("");

  /**
   * Prepare the menu for the right-clicked element.
   *
   * @returns `false` when the target has no menu: the root folder, or an
   * element that is not an explorer item. The caller then prevents the
   * default, so the browser's own menu stays shut too.
   */
  const handleMenu = useCallback((ev: MouseEvent<HTMLElement>): boolean => {
    // Add selected style to the item
    let itemEl: Node | null = ev.target as Node;
    while (itemEl && itemEl.nodeName !== "DIV") {
      itemEl = itemEl.parentNode;
    }
    if (!itemEl) return false;
    const selectedEl = itemEl as HTMLDivElement;

    // Root dir is not allowed to be selected as it cannot be renamed or deleted.
    // Right-clicking it is ordinary, so it is not logged.
    if (selectedEl.id === PgView.ids.ROOT_DIR) return false;

    // A section header ("Program", "Client") and its buttons are as ordinary a
    // right-click as the root folder: no menu, and nothing to log.
    if (selectedEl.closest("[data-section]")) return false;

    const itemType = PgExplorer.getItemTypeFromEl(selectedEl);
    if (!itemType) {
      log.warn("context menu on an element that is not an explorer item", {
        context: { id: selectedEl.id },
      });
      return false;
    }

    const itemPath = PgExplorer.getItemPathFromEl(selectedEl)!;
    const itemName = PgExplorer.getItemNameFromPath(itemPath);

    const itemData: ItemData = {
      isFolder: itemType.folder,
      isProgramFolder:
        itemType.folder && itemName === PgExplorer.PATHS.SRC_DIRNAME,
      isClient:
        itemType.file &&
        PgLanguage.getIsPathJsLike(itemPath) &&
        !itemPath.includes(".test"),
      isClientFolder:
        itemType.folder && itemName === PgExplorer.PATHS.CLIENT_DIRNAME,
      isTest:
        itemType.file &&
        PgLanguage.getIsPathJsLike(itemPath) &&
        itemPath.includes(".test"),
      isTestFolder:
        itemType.folder && itemName === PgExplorer.PATHS.TESTS_DIRNAME,
    };

    // Convert the `undefined` values to `false` in order to show them only
    // when necessary.
    for (const key of PgCommon.keys(itemData)) {
      itemData[key] ??= false;
    }
    setItemData(itemData);

    const ctxPath = PgExplorer.getItemPathFromEl(selectedEl);
    if (ctxPath) setCtxSelectedPath(ctxPath);
    PgExplorer.setCtxSelectedEl(selectedEl);
    return true;
  }, []);

  const getPath = useCallback(() => {
    if (!ctxSelectedPath) {
      return PgExplorer.getItemPathFromEl(PgExplorer.getSelectedEl()!)!;
    }

    return ctxSelectedPath;
  }, [ctxSelectedPath]);

  // Functions
  const ctxNewItem = useCallback(() => {
    const ctxSelected = PgExplorer.getElFromPath(getPath())!;
    if (!ctxSelected.classList.contains(PgView.classNames.OPEN)) {
      ctxSelected.classList.add(PgView.classNames.OPEN);
      ctxSelected.nextElementSibling?.classList.remove(
        PgView.classNames.HIDDEN
      );
    }

    PgView.setNewItemPortal(ctxSelected.nextElementSibling);
    setTimeout(() => PgExplorer.setCtxSelectedEl(ctxSelected));
  }, [getPath]);

  // Radix ignores the promise an `onSelect` returns, so a rejection (a dialog
  // chunk that failed to load) would be unhandled and the click would seem to
  // do nothing. Catch it here, log it for the team and tell the user.
  const renameItem = useCallback(async () => {
    if (!PgExplorer.getCtxSelectedEl()) return;
    try {
      await PgView.setModal(<RenameItem path={getPath()} />);
    } catch (err) {
      reportMenuActionFailure("rename", err);
    }
  }, [getPath]);

  const deleteItem = useCallback(async () => {
    if (!PgExplorer.getCtxSelectedEl()) return;
    try {
      await PgView.setModal(<DeleteItem path={getPath()} />);
    } catch (err) {
      reportMenuActionFailure("delete", err);
    }
  }, [getPath]);

  const addProgram = useCallback(async () => {
    await PgExplorer.createItem(
      PgCommon.joinPaths(PgExplorer.PATHS.SRC_DIRNAME, "lib.rs")
    );
  }, []);

  const addClient = useCallback(async () => {
    await PgCommand.run.execute();
  }, []);

  const addTests = useCallback(async () => {
    await PgCommand.test.execute();
  }, []);

  const runBuild = useCallback(async () => {
    await PgCommand.build.execute();
  }, []);

  const runDeploy = useCallback(async () => {
    await PgCommand.deploy.execute();
  }, []);

  const runClient = useCallback(async () => {
    await PgCommand.run.execute(getPath());
  }, [getPath]);

  const runTest = useCallback(async () => {
    await PgCommand.test.execute(getPath());
  }, [getPath]);

  const runClientFolder = useCallback(async () => {
    await PgCommand.run.execute();
  }, []);

  const runTestFolder = useCallback(async () => {
    await PgCommand.test.execute();
  }, []);

  return {
    handleMenu,
    ctxNewItem,
    renameItem,
    deleteItem,
    addProgram,
    addClient,
    addTests,
    runBuild,
    runDeploy,
    runClient,
    runTest,
    runClientFolder,
    runTestFolder,
    itemData,
    buildLoading,
    deployState,
  };
};
