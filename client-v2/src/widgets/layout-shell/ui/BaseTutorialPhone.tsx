import { useEffect, useRef } from "react";

import { Outlet } from "@/shared/lib/outlet";
import { cn } from "@/shared/lib/utils";
import { BOTTOM_BAR_PX, PHONE_CONSOLE_BAR_PX } from "@/views/flow/tokens";

import type { TutorialPhoneSlot } from "./BaseLayoutShell";

/** How far a swipe must travel sideways to change space, in px */
export const SWIPE_MIN_DX = 56;
/** A swipe from this close to the left edge is the browser's back gesture */
const EDGE_PX = 20;

export interface BaseTutorialPhoneProps {
  phone: TutorialPhoneSlot;
  stageNode: HTMLDivElement;
  consoleNode: HTMLDivElement;
  consoleOpen: boolean;
  /** From `LAYOUT_BREAKPOINTS.phone` to the frame: the chat is centred */
  tablet: boolean;
}

/**
 * Whether Monaco's scroller `el` holds lines wider than itself. Monaco
 * scrolls by hand under `overflow: hidden`, with its lines in
 * `.lines-content`, which it sizes to the widest line.
 */
const editorScrollsSideways = (el: Element) => {
  if (!el.classList.contains("monaco-scrollable-element")) return false;
  const lines = el.querySelector<HTMLElement>(".lines-content");
  return !!lines && lines.scrollWidth > el.clientWidth;
};

/**
 * Whether `from`, or anything between it and `until`, scrolls sideways: a
 * swipe there is that element's scroll (Monaco, a code block), not a change
 * of space.
 */
const scrollsSideways = (from: EventTarget | null, until: Element) => {
  for (
    let el = from instanceof Element ? from : undefined;
    el && el !== until;
    el = el.parentElement ?? undefined
  ) {
    if (editorScrollsSideways(el)) return true;
    if (el.scrollWidth <= el.clientWidth) continue;
    const { overflowX } = getComputedStyle(el);
    if (overflowX === "auto" || overflowX === "scroll") return true;
  }
  return false;
};

/**
 * A tutorial below the frame's width: the head over Chat and Code side by
 * side, one in view. The strip slides between them; the one out of view is
 * inert, so focus and screen readers stay in the shown one. Code is the
 * stage over the console, both outlets the shell owns, so they move here
 * from the frame without remounting.
 */
const BaseTutorialPhone = ({
  phone,
  stageNode,
  consoleNode,
  consoleOpen,
  tablet,
}: BaseTutorialPhoneProps) => {
  const viewport = useRef<HTMLDivElement>(null);
  // Read by the listeners, which are bound once
  const current = useRef(phone);
  current.current = phone;

  // Native listeners on the viewport's node: Code's stage and console are
  // portalled in from the shell (`Outlet`), so React's own pointer events
  // from them bubble to the shell, never here; the DOM's do
  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    let start: { x: number; y: number } | undefined;
    const down = (event: PointerEvent) => {
      // A mouse drag selects text; only a finger or a pen swipes
      const touch =
        event.pointerType === "touch" || event.pointerType === "pen";
      start =
        touch && event.clientX >= EDGE_PX && !scrollsSideways(event.target, box)
          ? { x: event.clientX, y: event.clientY }
          : undefined;
    };
    const up = (event: PointerEvent) => {
      const from = start;
      start = undefined;
      if (!from) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      // Mostly sideways: a vertical scroll of the feed that drifts is not a
      // swipe
      if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) < 2 * Math.abs(dy)) {
        return;
      }
      const { space, onSpace } = current.current;
      if (dx < 0 && space === "chat") onSpace("code", "swipe");
      if (dx > 0 && space === "code") onSpace("chat", "swipe");
    };
    const cancel = () => (start = undefined);
    box.addEventListener("pointerdown", down);
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", cancel);
    return () => {
      box.removeEventListener("pointerdown", down);
      box.removeEventListener("pointerup", up);
      box.removeEventListener("pointercancel", cancel);
    };
  }, []);

  const code = phone.space === "code";
  return (
    <div
      data-testid="tutorial-phone"
      className="flex h-full min-h-0 w-full flex-col pb-[env(safe-area-inset-bottom,0px)]"
    >
      {phone.head}
      {/* `touch-pan-y`: the browser keeps the feed's vertical scroll and
          leaves a sideways move to the swipe, instead of cancelling it */}
      <div
        ref={viewport}
        className="relative min-h-0 flex-1 touch-pan-y overflow-hidden"
      >
        <div
          className={cn(
            "flex h-full w-[200%] transition-transform duration-300 motion-reduce:transition-none",
            code && "-translate-x-1/2"
          )}
        >
          <section
            aria-label="Chat"
            inert={code}
            className="flex h-full w-1/2 min-w-0 flex-col"
          >
            {tablet ? (
              <div className="mx-auto flex min-h-0 w-full max-w-[640px] flex-1 flex-col px-8">
                {phone.chat}
              </div>
            ) : (
              phone.chat
            )}
          </section>
          <section
            aria-label="Code"
            inert={!code}
            className="flex h-full w-1/2 min-w-0 flex-col"
          >
            <Outlet node={stageNode} className="flex min-h-0 flex-1 flex-col" />
            <Outlet
              node={consoleNode}
              // Closed, the console is its bar: the body stays mounted (the
              // terminal keeps its buffer) and is clipped, as on the pager.
              // Open, it takes a share of the space and leaves the editor
              // room above it. Folded, it is the bar's height: 44 px below
              // 768 px, the wide 28 in the tablet band
              className={cn(
                "flex min-h-0 shrink-0 flex-col",
                consoleOpen
                  ? "h-[42dvh] max-h-[42dvh] min-h-32"
                  : "overflow-hidden"
              )}
              style={
                consoleOpen
                  ? undefined
                  : { height: tablet ? BOTTOM_BAR_PX : PHONE_CONSOLE_BAR_PX }
              }
            />
          </section>
        </div>
      </div>
    </div>
  );
};

export default BaseTutorialPhone;
