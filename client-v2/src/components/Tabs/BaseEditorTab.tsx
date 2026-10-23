import { ComponentPropsWithoutRef, forwardRef, ReactNode } from "react";

import {
  EditorTab,
  EditorTabClose,
  EditorTabLabel,
  EditorTabTrigger,
} from "@/shared/ui/editor-tabs";
import { cn } from "@/shared/lib/utils";

/** How a tab takes part in a drag: `source` is the tab left in its place,
 * `overlay` the copy that follows the pointer */
export type EditorTabDrag = "source" | "overlay";

export interface BaseEditorTabProps
  extends Omit<
    ComponentPropsWithoutRef<"div">,
    "onSelect" | "role" | "tabIndex" | "id" | "title" | "children"
  > {
  path: string;
  name: string;
  icon: ReactNode;
  current: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onClose: () => void;
  /** Absent while no drag involves this tab */
  drag?: EditorTabDrag;
}

/** One open file, drawn from the design system. Presentational: what a click
 * does comes in through `onSelect` and `onClose`. The rest props (the
 * sortable's listeners, a context menu trigger's handlers) land on the root.
 * The ref is forwarded to the root for the sortable's `setNodeRef` and for
 * `ContextMenuTrigger asChild`, which both need the element. The root is
 * only a frame (`role="presentation"`, not focusable): the trigger is the
 * one `tab` the tab list holds. */
export const BaseEditorTab = forwardRef<HTMLDivElement, BaseEditorTabProps>(
  (
    {
      path,
      name,
      icon,
      current,
      menuOpen,
      onSelect,
      onClose,
      drag,
      className,
      ...props
    },
    ref
  ) => {
    // The copy that follows the pointer is a picture of the tab: it takes no
    // id from the tab it copies, and assistive tech and the keyboard skip it
    const isOverlay = drag === "overlay";
    return (
      <EditorTab
        ref={ref}
        id={isOverlay ? undefined : path}
        title={path}
        inert={isOverlay}
        active={current}
        menuOpen={menuOpen}
        data-drag={drag}
        // The trigger takes the tab's left padding and the gap before close,
        // so a click anywhere up to the close button selects the tab
        className={cn(
          "gap-0 pl-0 data-[drag=source]:opacity-60 data-[drag=overlay]:bg-surface data-[drag=overlay]:text-foreground data-[drag=overlay]:shadow-lg data-[drag=overlay]:ring-1 data-[drag=overlay]:ring-border",
          className
        )}
        {...props}
        // A context menu trigger wrapping the tab hands down its own slot
        // name; the tab keeps the design system's. `BaseEditorTabs`' arrow,
        // Home and End handling (`moveFocus`) finds the tab by it, as do the
        // tests
        data-slot="editor-tab"
        role="presentation"
      >
        <EditorTabTrigger onClick={onSelect} className="pr-1 pl-3">
          {icon}
          <EditorTabLabel>{name}</EditorTabLabel>
        </EditorTabTrigger>
        <EditorTabClose
          aria-label={`Close ${name}`}
          title="Close (Alt+W)"
          onClick={onClose}
          // The drag sensor listens for mousedown on the root
          onMouseDown={(ev) => ev.stopPropagation()}
        />
      </EditorTab>
    );
  }
);
BaseEditorTab.displayName = "BaseEditorTab";
