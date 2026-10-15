import { RefObject } from "react";

import { PgExplorer } from "../../../../utils";
import { useOnClickOutside } from "../../../../hooks";

/** The context menu's content, which Radix portals to the body. */
export const MENU_CONTENT_SELECTOR = '[data-slot="context-menu-content"]';

/**
 * Reset the context-selected element on clicks outside of the explorer.
 *
 * A click on a menu item must not count as outside: it would clear the
 * selection that `renameItem` and `deleteItem` read before the item's
 * `onSelect` runs.
 */
export const useResetCtxSelected = (
  wrapperRef: RefObject<HTMLElement | null>
) =>
  useOnClickOutside(
    wrapperRef,
    PgExplorer.removeCtxSelectedEl,
    true,
    MENU_CONTENT_SELECTOR
  );
