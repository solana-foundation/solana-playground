import {
  ComponentPropsWithoutRef,
  forwardRef,
  MouseEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import styled, { css } from "styled-components";

import Button from "../Button";
import LangIcon from "../LangIcon";
import { Close } from "../Icons";
import { PgExplorer, PgTheme } from "../../utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { MenuItemText } from "@/shared/ui/menu-extras";
import type { SortableItemCommonProps } from "../Dnd/Sortable";

interface TabProps extends ComponentPropsWithoutRef<"div"> {
  path: string;
  index: number;
}

const Tab = forwardRef<HTMLDivElement, TabProps>(
  ({ path, index, ...props }, ref) => {
    const [isSelected, setIsSelected] = useState(false);

    const fileName = useMemo(
      () => PgExplorer.getItemNameFromPath(path),
      [path]
    );

    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const changeTab = useCallback(
      (ev: MouseEvent<HTMLDivElement>) => {
        if (!closeButtonRef.current?.contains(ev.target as Node)) {
          PgExplorer.openFile(path);
        }
      },
      [path]
    );

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
          <Wrapper
            onClick={changeTab}
            title={path}
            ref={ref}
            isSelected={isSelected}
            isCurrent={path === PgExplorer.currentFilePath}
            {...(props as SortableItemCommonProps)}
          >
            <LangIcon path={path} />
            <Name>{fileName}</Name>
            <Button
              ref={closeButtonRef}
              kind="icon"
              onClick={closeFile}
              title="Close (Alt+W)"
            >
              <Close />
            </Button>
          </Wrapper>
        </ContextMenuTrigger>
        {/* Every label is a MenuItemText: one element to match, and the shortcut stays at the far edge */}
        <ContextMenuContent>
          <ContextMenuItem onSelect={closeFile}>
            <MenuItemText>Close</MenuItemText>
            <ContextMenuShortcut>ALT+W</ContextMenuShortcut>
          </ContextMenuItem>
          {PgExplorer.tabs.length > 1 && (
            <ContextMenuItem onSelect={closeOthers}>
              <MenuItemText>Close Others</MenuItemText>
            </ContextMenuItem>
          )}
          {PgExplorer.tabs.length - 1 > index && (
            <ContextMenuItem onSelect={closeToTheRight}>
              <MenuItemText>Close To The Right</MenuItemText>
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={closeAll}>
            <MenuItemText>Close All</MenuItemText>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }
);

const Wrapper = styled.div<
  { isSelected: boolean; isCurrent: boolean } & SortableItemCommonProps
>`
  ${({ theme, isSelected, isCurrent, isDragging, isDragOverlay }) => css`
    & button {
      ${!isCurrent && "opacity: 0;"}
      margin: 0 0.25rem 0 0.5rem;

      & svg {
        width: 0.875rem;
        height: 0.875rem;
      }
    }

    &:hover button {
      opacity: 1;
    }

    ${PgTheme.convertToCSS(theme.components.tabs.tab.default)};
    ${isSelected && PgTheme.convertToCSS(theme.components.tabs.tab.selected)};
    ${isCurrent && PgTheme.convertToCSS(theme.components.tabs.tab.current)};
    ${isDragging && PgTheme.convertToCSS(theme.components.tabs.tab.drag)};
    ${isDragOverlay &&
    PgTheme.convertToCSS(theme.components.tabs.tab.dragOverlay)};
  `}
`;

const Name = styled.span`
  margin-left: 0.375rem;
  white-space: nowrap;
`;

export default Tab;
