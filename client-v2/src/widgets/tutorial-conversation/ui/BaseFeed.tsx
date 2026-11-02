import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { StepJumpVia } from "@/entities/tutorial";
import type { StepBarItem, Turn } from "@/features/tutorial-conversation";
import { liveStepIndex, stepBeside } from "../model/step-bar";
import BaseBackPill from "./BaseBackPill";
import BaseStepBar from "./BaseStepBar";
import { typing } from "./keys";

/** A jumped-to divider lands this far under the step bar, in px */
export const UNDER_BAR = 12;
/** Under 24rem of chat width the step bar is one button */
const NARROW_PX = 24 * 16;
const FLASH_MS = 700;
const SCROLL_MS = 320;
/** How long a jump's smooth scroll may take to settle before scrolling counts as the learner's */
const JUMP_SETTLE_MS = 700;

export interface BaseFeedProps {
  turns: readonly Turn[];
  /** The one card that acts, or null after the finish */
  live: Turn | null;
  steps: readonly StepBarItem[];
  /** The step bar's hairline, 0 to 1 */
  progress: number;
  /** Draw one turn; `live` says whether it is the card that acts */
  renderTurn: (turn: Turn, live: boolean) => ReactNode;
  /** The feed moved to step `index`'s divider, from the live step `from` */
  onJump: (index: number, from: number, via: StepJumpVia) => void;
  /** The back pill took the learner to the live card; `step` is its index, null before Start */
  onBack: (step: number | null) => void;
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The first control of a card, to take focus when the pill brings it back */
const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Whether the element is under 24rem wide; false where nothing can measure it */
const useNarrow = (ref: RefObject<HTMLElement | null>) => {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width < NARROW_PX)
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
};

/**
 * The lesson as one feed: the step bar, then the turns in a `role="log"`,
 * then the back pill while the live card is off screen or the feed is on
 * another step. A step bar segment, an item of its narrow menu or ⌥↑ / ⌥↓
 * (unless a field has focus) scrolls a divider to 12 px under the bar and
 * flashes it once; the lesson's progress is untouched. The step the feed is
 * scrolled into is the bar's "viewing" one. Turns older than the page load
 * render whole.
 */
const BaseFeed = ({
  turns,
  live,
  steps,
  progress,
  renderTurn,
  onJump,
  onBack,
}: BaseFeedProps) => {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dividers = useRef(new Map<string, HTMLElement>());
  const liveCard = useRef<HTMLDivElement | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  /** Until when the feed's scroll is a jump's, in ms since the epoch */
  const jumping = useRef(0);
  const [liveOffScreen, setLiveOffScreen] = useState(false);
  const narrow = useNarrow(root);
  const liveIndex = liveStepIndex(steps);

  const jump = (index: number, via: StepJumpVia) => {
    const divider = dividers.current.get(steps[index]?.id ?? "");
    const box = scroller.current;
    if (!divider || !box) return;
    box.scrollTo?.({
      top: divider.offsetTop - UNDER_BAR,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
    if (!reducedMotion()) {
      divider.animate?.(
        [
          {
            backgroundColor:
              "color-mix(in oklab, var(--brand-purple) 14%, transparent)",
          },
          { backgroundColor: "transparent" },
        ],
        { duration: FLASH_MS, easing: "ease-out" }
      );
    }
    // The scroll this starts is the jump's, not the learner's: its events
    // must not move "viewing" again, as the bottom rule in `onScroll` would
    // when the target and everything after it fit on screen
    jumping.current = Date.now() + (reducedMotion() ? 100 : JUMP_SETTLE_MS);
    setViewing(index === liveIndex ? null : index);
    onJump(index, liveIndex ?? index, via);
  };

  // ⌥↑ and ⌥↓ through the dividers, up to the live step. Through a ref, so
  // the listener subscribes once and still reads this render's state
  const keyJump = useRef(jump);
  keyJump.current = jump;
  const position = useRef<number | null>(null);
  position.current = viewing ?? liveIndex;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      // In a field ⌥↑ and ⌥↓ move the caret
      if (typing(e.target)) return;
      const from = position.current;
      if (from === null) return;
      const to = stepBeside(steps, from, e.key === "ArrowUp" ? -1 : 1);
      if (to === null) return;
      e.preventDefault();
      keyJump.current(to, "key");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [steps]);

  // Scrolling by hand moves "viewing" to the divider under the bar. A feed
  // scrolled to its bottom is on the live step: a short live step never
  // brings its divider up to the bar, so the divider test alone would name
  // the step before it
  const onScroll = () => {
    const box = scroller.current;
    if (!box || Date.now() < jumping.current) return;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 1) {
      setViewing(null);
      return;
    }
    let under: number | null = null;
    steps.forEach((step, index) => {
      const divider = dividers.current.get(step.id);
      if (divider && divider.offsetTop <= box.scrollTop + UNDER_BAR + 1) {
        under = index;
      }
    });
    setViewing(under === liveIndex ? null : under);
  };

  // Whether the live card is on screen, for the pill
  useEffect(() => {
    const card = liveCard.current;
    setLiveOffScreen(false);
    if (!card || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setLiveOffScreen(!entry.isIntersecting),
      { root: scroller.current }
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, [live?.id]);

  // A reload opens on the live card; a new turn scrolls into view unless the
  // learner is reading another step
  const opened = useRef(false);
  const count = turns.length;
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (!opened.current) {
      opened.current = true;
      liveCard.current?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    if (viewing === null) {
      box.scrollTo?.({
        top: box.scrollHeight,
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    }
    // Only a change in the number of turns scrolls; reading elsewhere holds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const back = () => {
    const card = liveCard.current;
    card?.scrollIntoView?.({
      block: "nearest",
      behavior: reducedMotion() ? "auto" : "smooth",
    });
    // After the scroll, so focus does not jump the feed first
    window.setTimeout(
      () =>
        card
          ?.querySelector<HTMLElement>(FOCUSABLE)
          ?.focus({ preventScroll: true }),
      reducedMotion() ? 0 : SCROLL_MS
    );
    setViewing(null);
    setLiveOffScreen(false);
    onBack(liveIndex);
  };

  const showPill = live !== null && (liveOffScreen || viewing !== null);
  const pillLabel =
    live?.kind === "intro" || liveIndex === null
      ? "Back to the start"
      : `Back to step ${liveIndex + 1}`;

  return (
    <div ref={root} className="relative flex min-h-0 flex-1 flex-col">
      <BaseStepBar
        steps={steps}
        live={liveIndex}
        viewing={viewing}
        progress={progress}
        narrow={narrow}
        onJump={jump}
      />
      <div
        ref={scroller}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <div
          role="log"
          aria-live="polite"
          aria-label="Tutorial"
          className="flex flex-col gap-5 px-5 pt-4 pb-4"
        >
          {turns.map((turn) => {
            const isLive = turn.id === live?.id;
            return (
              <div
                key={turn.id}
                data-turn={turn.kind}
                ref={(el) => {
                  if (turn.kind === "divider" && turn.step) {
                    if (el) dividers.current.set(turn.step, el);
                    else dividers.current.delete(turn.step);
                  }
                  if (isLive) liveCard.current = el;
                }}
                className={
                  turn.whole
                    ? "rounded-control"
                    : "rounded-control motion-safe:animate-rise"
                }
              >
                {renderTurn(turn, isLive)}
              </div>
            );
          })}
        </div>
      </div>
      {showPill && <BaseBackPill label={pillLabel} onClick={back} />}
    </div>
  );
};

export default BaseFeed;
