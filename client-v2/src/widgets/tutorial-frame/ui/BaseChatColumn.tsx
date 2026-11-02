import { useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { CHAT_WIDTH } from "../model/chat-width";
import type { ResizeSource } from "../model/telemetry";
import BaseChatHead from "./BaseChatHead";
import type { BaseChatHeadProps } from "./BaseChatHead";

export interface BaseChatColumnProps extends BaseChatHeadProps {
  /** The column's width in px, already held to its range */
  width: number;
  /** The range the handle announces and Home and End go to */
  min: number;
  max: number;
  /** A drag moved the edge; the width follows it until the drag ends */
  onWidthChange: (width: number) => void;
  /** The learner settled on a width: a drag ended, or a key moved the edge */
  onWidthPick: (width: number, via: Exclude<ResizeSource, "reset">) => void;
  /** A double click hands the width back to the window */
  onReset: () => void;
  /** The feed and the composer */
  children: ReactNode;
}

/**
 * The chat's column, between the rail and the workspace (the prototype's
 * `Column`): the head, then what the conversation puts under it. Its right
 * edge drags, takes the arrow keys once focused, and a double click hands the
 * width back to the window. Draws only what it is given; `ChatColumn` holds
 * the width.
 */
const BaseChatColumn = ({
  width,
  min,
  max,
  onWidthChange,
  onWidthPick,
  onReset,
  children,
  ...head
}: BaseChatColumnProps) => {
  const drag = useRef<{ x: number; width: number; last: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // The second press of a double click must not start a drag of its own
    if (e.detail > 1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, width, last: width };
  };
  // The edge is on the column's right, so moving it right widens the column
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.clientX === d.x) return;
    d.last = d.width + e.clientX - d.x;
    onWidthChange(d.last);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // A press that did not move picks nothing, so a double click can reset
    if (d.last !== d.width) onWidthPick(d.last, "drag");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.shiftKey ? CHAT_WIDTH.step * 4 : CHAT_WIDTH.step;
    const to: Record<string, number> = {
      ArrowRight: width + by,
      ArrowLeft: width - by,
      Home: min,
      End: max,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    onWidthPick(to[e.key], "key");
  };

  return (
    <aside
      aria-label="Tutorial chat"
      style={{ width }}
      className="relative flex min-h-0 shrink-0 flex-col border-r border-border"
    >
      <BaseChatHead {...head} />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {/* 9 px to grab, centred on the 1 px border, which lights up while it
          is held or focused */}
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize the chat column"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={width}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onReset}
        onKeyDown={onKeyDown}
        className={cn(
          "group absolute inset-y-0 -right-[5px] z-20 w-[9px] cursor-col-resize touch-none outline-none",
          "after:absolute after:inset-y-0 after:left-1 after:w-px after:transition-colors after:duration-150 hover:after:bg-border focus-visible:after:w-0.5 focus-visible:after:bg-ring active:after:bg-ring motion-reduce:after:transition-none"
        )}
      />
    </aside>
  );
};

export default BaseChatColumn;
