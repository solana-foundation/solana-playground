import {
  ComponentPropsWithoutRef,
  forwardRef,
  useCallback,
  useMemo,
  useState,
} from "react";

import { BaseEditorTab, EditorTabDrag } from "./BaseEditorTab";
import LangIcon from "../LangIcon";
import { PgExplorer } from "../../utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { MenuItemText } from "@/shared/ui/menu-extras";
import type { SortableItemCommonProps } from "../Dnd/Sortable";

type SortableFlags = Partial<
  Pick<SortableItemCommonProps, "isDragging" | "isDragOverlay">
>;

interface TabProps
  extends Omit<ComponentPropsWithoutRef<"div">, "onSelect">,
    SortableFlags {
  path: string;
  index: number;
  /** The sortable's item component, handed back to every item */
  Item?: unknown;
  /** dnd-kit's sortable state, on the drag overlay only */
  sortable?: unknown;
}

const dragOf = ({
  isDragging,
  isDragOverlay,
}: SortableFlags): EditorTabDrag | undefined => {
  if (isDragOverlay) return "overlay";
  if (isDragging) return "source";
  return undefined;
};

const Tab = forwardRef<HTMLDivElement, TabProps>(
  (
    {
      path,
      index,
      // Props `Dnd.Sortable` spreads into every item. `Item` and `sortable`
      // (on the overlay) are not DOM attributes. `id` is one, but the
      // sortable's would replace the path the tab takes as its id
      Item: _Item,
      sortable: _sortable,
      id: _id,
      isDragging,
      isDragOverlay,
      ...props
    },
    ref
  ) => {
    const [isSelected, setIsSelected] = useState(false);

    const fileName = useMemo(
      () => PgExplorer.getItemNameFromPath(path),
      [path]
    );

    const changeTab = useCallback(() => PgExplorer.openFile(path), [path]);

    const closeFile = useCallback(() => PgExplorer.closeFile(path), [path]);

    const closeOthers = useCallback(() => {
      PgExplorer.tabs
        .filter((tabPath) => tabPath !== path)
        .forEach((tabPath) => PgExplorer.closeFile(tabPath));
    }, [path]);

    const closeToTheRight = useCallback(() => {
      const tabIndex = PgExplorer.tabs.findIndex((tabPath) => tabPath === path);
      PgExplorer.tabs
        .slice(tabIndex + 1)
        .forEach((tabPath) => PgExplorer.closeFile(tabPath));
    }, [path]);

    const closeAll = useCallback(() => {
      // Clone the tabs before closing because `PgExplorer.closeFile` mutates
      // the existing tabs array
      [...PgExplorer.tabs].forEach((tabPath) => PgExplorer.closeFile(tabPath));
    }, []);

    return (
      <ContextMenu onOpenChange={setIsSelected}>
        <ContextMenuTrigger asChild>
          <BaseEditorTab
            ref={ref}
            path={path}
            name={fileName}
            icon={<LangIcon path={path} />}
            current={path === PgExplorer.currentFilePath}
            menuOpen={isSelected}
            onSelect={changeTab}
            onClose={closeFile}
            drag={dragOf({ isDragging, isDragOverlay })}
            {...props}
          />
        </ContextMenuTrigger>
        {/* Every label is a MenuItemText: one element to match, and the shortcut stays at the far edge */}
        <ContextMenuContent>
          <ContextMenuItem onSelect={closeFile}>
            <MenuItemText>Close</MenuItemText>
            <ContextMenuShortcut>Alt+W</ContextMenuShortcut>
          </ContextMenuItem>
          {PgExplorer.tabs.length > 1 && (
            <ContextMenuItem onSelect={closeOthers}>
              <MenuItemText>Close others</MenuItemText>
            </ContextMenuItem>
          )}
          {PgExplorer.tabs.length - 1 > index && (
            <ContextMenuItem onSelect={closeToTheRight}>
              <MenuItemText>Close to the right</MenuItemText>
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={closeAll}>
            <MenuItemText>Close all</MenuItemText>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }
);

export default Tab;
