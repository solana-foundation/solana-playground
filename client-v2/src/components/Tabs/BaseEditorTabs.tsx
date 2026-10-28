import { KeyboardEvent, ReactNode, useEffect, useRef } from "react";

import { EditorTabs } from "@/shared/ui/editor-tabs";

interface BaseEditorTabsProps {
  id?: string;
  /** The current tab's key (its path): when it changes, that tab scrolls
   * into view */
  current?: string;
  children: ReactNode;
  /** Sits after the tabs, outside the tab list and its scroll */
  end?: ReactNode;
}

type MoveKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

/** Where the arrow, Home and End keys move focus, from trigger `from` of
 * `count` */
const MOVES: Record<MoveKey, (from: number, count: number) => number> = {
  ArrowLeft: (from, count) => (from - 1 + count) % count,
  ArrowRight: (from, count) => (from + 1) % count,
  Home: () => 0,
  End: (_from, count) => count - 1,
};

const isMoveKey = (key: string): key is MoveKey => Object.hasOwn(MOVES, key);

/** A tab in the row, without the copy a drag carries over it */
const TAB = '[data-slot="editor-tab"]:not([data-drag="overlay"])';

/** The triggers in the row */
const TRIGGERS = `${TAB} [role="tab"]`;

/** The current tab's trigger */
const CURRENT = `${TAB} [role="tab"][aria-selected="true"]`;

/** Moves focus between the triggers only: a tab opens its file on Enter or
 * Space (manual activation), so walking the row opens nothing. */
const moveFocus = (ev: KeyboardEvent<HTMLDivElement>) => {
  if (!isMoveKey(ev.key)) return;
  const move = MOVES[ev.key];
  const triggers = [
    ...ev.currentTarget.querySelectorAll<HTMLElement>(TRIGGERS),
  ];
  // Focus may be on a tab's close button rather than its trigger
  const tab = (ev.target as Element).closest('[data-slot="editor-tab"]');
  const from = triggers.findIndex((trigger) => tab?.contains(trigger));
  if (from === -1) return;
  ev.preventDefault();
  triggers[move(from, triggers.length)].focus();
};

/** Scrolls `row` sideways by the least that brings `tab` into it, its start
 * edge first when it is wider than the row. Not `scrollIntoView`: that
 * scrolls every container around the row too, and on a phone one of them is
 * the pager, which a swipe would then lose (HOO-2290). */
const showInRow = (row: HTMLElement, tab: HTMLElement) => {
  const bounds = row.getBoundingClientRect();
  const { left, right } = tab.getBoundingClientRect();
  if (left < bounds.left) row.scrollLeft += left - bounds.left;
  else if (right > bounds.right) row.scrollLeft += right - bounds.right;
};

/** px per line of a wheel that counts in lines (Firefox's mouse wheel) */
const LINE_PX = 16;

/** The wheel's vertical travel in px, whatever unit it counts in */
const verticalPx = (ev: WheelEvent, row: HTMLElement) => {
  if (ev.deltaMode === 1) return ev.deltaY * LINE_PX;
  if (ev.deltaMode === 2) return ev.deltaY * row.clientWidth;
  return ev.deltaY;
};

/** A plain mouse wheel only scrolls up and down, and the row's scrollbar is
 * hidden: a mostly vertical wheel over a row that overflows scrolls it
 * sideways instead. Anything else (a trackpad's sideways swipe, a row that
 * fits) is left to the browser. */
const scrollSideways = (ev: WheelEvent) => {
  const row = ev.currentTarget as HTMLElement;
  if (row.scrollWidth <= row.clientWidth) return;
  if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;
  ev.preventDefault();
  row.scrollLeft += verticalPx(ev, row);
};

/** Tab row: the tabs scroll sideways inside it (scrollbar hidden, so the
 * wheel and the current tab scroll it), and `end` stays pinned beside them. */
export const BaseEditorTabs = ({
  id,
  current,
  children,
  end,
}: BaseEditorTabsProps) => {
  const listRef = useRef<HTMLDivElement>(null);

  // A file opened from the explorer becomes current wherever its tab is.
  // The whole tab comes into view, its close button included, not only the
  // trigger.
  useEffect(() => {
    const list = listRef.current;
    const tab = list
      ?.querySelector(CURRENT)
      ?.closest<HTMLElement>('[data-slot="editor-tab"]');
    if (list && tab) showInRow(list, tab);
  }, [current]);

  // React's own wheel listener is passive and cannot stop the page scrolling
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.addEventListener("wheel", scrollSideways, { passive: false });
    return () => list.removeEventListener("wheel", scrollSideways);
  }, []);

  return (
    <div
      id={id}
      className="flex h-10 items-stretch overflow-hidden border-b border-border bg-surface-base"
    >
      <EditorTabs
        ref={listRef}
        onKeyDown={moveFocus}
        className="h-auto min-w-0 flex-1 overflow-y-hidden border-b-0"
      >
        {children}
      </EditorTabs>
      {end}
    </div>
  );
};
