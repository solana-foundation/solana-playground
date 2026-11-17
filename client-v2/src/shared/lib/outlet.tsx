import type { CSSProperties, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { createLogger } from "./logger";

const log = createLogger("shared:outlet");

/**
 * A DOM node that outlives the places it is shown in. Content portaled into
 * it keeps its React state and its DOM (an editor, a terminal) while the
 * layout around it changes, because only the node moves. `className` is the
 * node's class at creation: it is read on the first render only, so a later
 * value does not reach it.
 */
export const useOutletNode = (className: string) => {
  const [node] = useState(() => {
    const div = document.createElement("div");
    div.className = className;
    return div;
  });
  return node;
};

/** The content, rendered into `node` from one place that never unmounts */
export const OutletContent = ({
  node,
  children,
}: {
  node: HTMLDivElement;
  children: ReactNode;
}) => createPortal(children, node);

/** What a move would lose: the browser drops it when the node leaves the page */
interface Kept {
  scrolled: { el: Element; top: number; left: number }[];
  focused?: HTMLElement;
}

/**
 * Kept between one Outlet giving the node up and the next taking it, in the
 * same commit. Dropped after it: a node away longer (under Home, say) comes
 * back to whatever its content did meanwhile, never to an old offset. A swap
 * split over two commits (the new place behind a transition) gets nothing
 * back either
 */
const kept = new WeakMap<HTMLDivElement, Kept>();

const keep = (node: HTMLDivElement): Kept => {
  const scrolled: Kept["scrolled"] = [];
  for (const el of [node, ...node.querySelectorAll("*")]) {
    // Real scrollers only: Monaco's own wrappers scroll by hand under
    // `overflow: hidden`, and an offset the browser left on one is not its
    if (!(el.scrollTop || el.scrollLeft)) continue;
    const { overflowX, overflowY } = getComputedStyle(el);
    if (/auto|scroll/.test(overflowX + overflowY)) {
      scrolled.push({ el, top: el.scrollTop, left: el.scrollLeft });
    }
  }
  const active = document.activeElement;
  const focused =
    active instanceof HTMLElement && node.contains(active) ? active : undefined;
  return { scrolled, focused };
};

const giveBack = ({ scrolled, focused }: Kept) => {
  for (const { el, top, left } of scrolled) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
  // Only into a vacuum: focus something else took while the node was away
  // stays there
  const active = document.activeElement;
  if (!active || active === document.body) {
    focused?.focus({ preventScroll: true });
  }
};

/**
 * Where `node` shows now. One live `Outlet` per node is the contract: a place
 * is swapped for another in one commit, never shown twice. A second `Outlet`
 * mounting while the node is still in another host takes it, and the first
 * would not get it back if the second unmounted first, so that case is
 * logged (reported) when it happens.
 */
export const Outlet = ({
  node,
  className,
  style,
}: {
  node: HTMLDivElement;
  className?: string;
  style?: CSSProperties;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current!;
    if (node.parentNode) {
      log.warn("An Outlet mounted for a node another Outlet still holds", {
        report: true,
      });
    }
    host.appendChild(node);
    // A move keeps the content mounted, but the browser resets its scroll
    // offsets and moves focus to the body: a feed read halfway down would
    // show its top, and a composer typed in would lose the caret
    const moved = kept.get(node);
    if (moved) {
      kept.delete(node);
      giveBack(moved);
    }
    return () => {
      // Another Outlet may already have taken it in the same commit
      if (node.parentNode !== host) return;
      const entry = keep(node);
      kept.set(node, entry);
      host.removeChild(node);
      // React runs the next Outlet's layout effect in this same commit
      queueMicrotask(() => {
        if (kept.get(node) === entry) kept.delete(node);
      });
    };
  }, [node]);
  return <div ref={ref} className={className} style={style} />;
};
