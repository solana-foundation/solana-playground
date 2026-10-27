import { RefObject, useEffect } from "react";

import { isInsideToast } from "@/shared/lib/toast-layer";

/**
 * Run the given callback when the user clicks outside of the given element.
 *
 * @param ref element reference
 * @param cb callback function to run on outside click
 * @param listenCondition only listen for click events if this condition is truthy
 * @param ignoreSelector elements matching this (or descendants of them) do not
 * count as outside. Needed for a control that toggles the element: this hook
 * fires on `mousedown`, so without it the toggle's own `click` would re-open
 * what the `mousedown` just closed.
 */
export const useOnClickOutside = (
  ref: RefObject<HTMLElement | null>,
  cb: () => void,
  listenCondition: boolean = true,
  ignoreSelector?: string
) => {
  useEffect(() => {
    if (!listenCondition) return;

    const handleOutsideClick = (ev: MouseEvent) => {
      const el = ref.current;
      const targetEl = ev.target;
      if (!el || !targetEl) return;
      if (!(targetEl instanceof HTMLElement)) return;
      if (el.contains(targetEl)) return;
      if (ignoreSelector && targetEl.closest(ignoreSelector)) return;

      // A toast portals to `body` and floats over everything, so a press on
      // it (its close button, a "change endpoint" action) is not the user
      // leaving the element; it must not close a panel or drop an input.
      if (isInsideToast(targetEl)) return;

      cb();
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [ref, cb, listenCondition, ignoreSelector]);
};
