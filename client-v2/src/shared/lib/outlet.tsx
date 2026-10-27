import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
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
    return () => {
      // Another Outlet may already have taken it in the same commit
      if (node.parentNode === host) host.removeChild(node);
    };
  }, [node]);
  return <div ref={ref} className={className} style={style} />;
};
