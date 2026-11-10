import { FC, useRef } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { Icon } from "@/shared/ui/icon";
import { MenuItemText } from "@/shared/ui/menu-extras";

import { PgExplorer, PgView } from "../../../../utils";
import type { useExplorerContextMenu } from "./useExplorerContextMenu";

/**
 * Radix drops the promise an `onSelect` returns, so a run that fails would
 * be an unhandled rejection with nothing on screen; catch it into the same
 * handler the explorer's run buttons use.
 */
const telling = (run: () => Promise<unknown>, action: string) => () => {
  run().catch(reportButtonFailure(action));
};

type ExplorerContextMenuProps = Pick<
  ReturnType<typeof useExplorerContextMenu>,
  | "itemData"
  | "ctxNewItem"
  | "renameItem"
  | "deleteItem"
  | "runBuild"
  | "runDeploy"
  | "runClient"
  | "runClientFolder"
  | "runTest"
  | "runTestFolder"
  | "handleMenu"
>;

export const ExplorerContextMenu: FC<
  React.PropsWithChildren<ExplorerContextMenuProps>
> = ({
  itemData,
  ctxNewItem,
  renameItem,
  deleteItem,
  runBuild,
  runDeploy,
  runClient,
  runClientFolder,
  runTest,
  runTestFolder,
  handleMenu,
  children,
}) => {
  // Choosing New File or New Folder opens the inline input. Radix's focus trap
  // keeps the input from taking focus while the menu is open, and Radix would
  // then return focus to the trigger on close, so the input is focused once
  // the menu has let go. Every other item keeps Radix's return to the trigger
  // (a dialog moves the focus itself).
  const openedInput = useRef(false);
  const newItem = () => {
    openedInput.current = true;
    ctxNewItem();
  };

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) openedInput.current = false;
        else PgExplorer.removeCtxSelectedEl();
      }}
    >
      <ContextMenuTrigger
        asChild
        onContextMenu={(ev) => {
          // Radix skips its own handler once the default is prevented, and the
          // browser's menu stays shut too: no menu at all on the root folder.
          if (!handleMenu(ev)) ev.preventDefault();
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(ev) => {
          if (!openedInput.current) return;
          const input = document.querySelector<HTMLInputElement>(
            `#${PgView.ids.ROOT_DIR} input`
          );
          if (!input) return;
          ev.preventDefault();
          input.focus();
        }}
      >
        {itemData.isFolder && (
          <>
            <ContextMenuItem onSelect={newItem}>
              <Icon name="new-file" />
              <MenuItemText>New File</MenuItemText>
              <ContextMenuShortcut>ALT+N</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={newItem}>
              <Icon name="new-folder" />
              <MenuItemText>New Folder</MenuItemText>
              <ContextMenuShortcut>ALT+N</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
        <ContextMenuItem onSelect={renameItem}>
          <Icon name="edit" />
          <MenuItemText>Rename</MenuItemText>
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={deleteItem}>
          <Icon name="delete" />
          <MenuItemText>Delete</MenuItemText>
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
        {itemData.isProgramFolder && (
          <>
            <ContextMenuItem onSelect={telling(runBuild, "build")}>
              <Icon name="build" />
              <MenuItemText>Build</MenuItemText>
            </ContextMenuItem>
            <ContextMenuItem onSelect={telling(runDeploy, "deploy")}>
              <Icon name="deploy" />
              <MenuItemText>Deploy</MenuItemText>
            </ContextMenuItem>
          </>
        )}
        {itemData.isClient && (
          <ContextMenuItem onSelect={telling(runClient, "run the client")}>
            <Icon name="run" />
            <MenuItemText>Run</MenuItemText>
          </ContextMenuItem>
        )}
        {itemData.isClientFolder && (
          <ContextMenuItem
            onSelect={telling(runClientFolder, "run the client")}
          >
            <Icon name="run" />
            <MenuItemText>Run All</MenuItemText>
          </ContextMenuItem>
        )}
        {itemData.isTest && (
          <ContextMenuItem onSelect={telling(runTest, "run the test")}>
            <Icon name="test" />
            <MenuItemText>Test</MenuItemText>
          </ContextMenuItem>
        )}
        {itemData.isTestFolder && (
          <ContextMenuItem onSelect={telling(runTestFolder, "run the tests")}>
            <Icon name="test" />
            <MenuItemText>Test All</MenuItemText>
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
