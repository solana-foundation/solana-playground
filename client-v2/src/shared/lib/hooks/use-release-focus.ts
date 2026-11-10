import * as React from "react";

/**
 * For a modal overlay's content: a ref that takes focus off whatever holds it
 * outside the content as the content mounts, and an `onCloseAutoFocus`
 * handler that gives focus back to it. Returns `[releaseFocus, returnFocus]`.
 *
 * Radix hides the rest of the page with `aria-hidden` in its first effect and
 * moves focus into the overlay only a render later, once its focus scope has
 * its container. Focus left outside (the editor, or a menu trigger, which
 * Radix keeps from taking focus on press) then sits in the hidden part, and
 * Chrome refuses the attribute: "Blocked aria-hidden on an element because
 * its descendant retained focus". A ref attaches before any effect runs, so
 * the page is hidden with nothing focused in it. The blur runs once per
 * mounted node: a re-attach of the same node (StrictMode, a new caller ref)
 * finds focus already inside or on the body and must not take that for the
 * element to return to.
 *
 * The focus scope records what was focused only after that blur, so an
 * overlay that relies on it to return focus on close (ContextMenu) would
 * return it to the body. Such an overlay calls `returnFocus` from its
 * `onCloseAutoFocus`, after the caller's own handler, and focus goes back to
 * the released element unless the caller placed it elsewhere or the element
 * is gone (then the body, as before). Overlays that focus their trigger on
 * close (Dialog, Sheet, DropdownMenu, Select) never read the recorded element:
 * with no trigger mounted, focus stays on the body with or without this hook.
 * `returnFocus` mirrors a modal ContextMenu; a non-modal one would skip the
 * return after a press outside, and this hook would not.
 *
 * `ref` is the caller's own ref to the content, passed on.
 */
function useReleaseFocus<T extends HTMLElement>(ref: React.Ref<T> | undefined) {
  const mounted = React.useRef<T | undefined>(undefined);
  const released = React.useRef<HTMLElement | SVGElement | undefined>(
    undefined
  );

  const releaseFocus = React.useCallback(
    (node: T | null) => {
      if (node && node !== mounted.current) {
        mounted.current = node;
        released.current = undefined;
        const page = node.ownerDocument;
        const active = page.activeElement;
        if (
          (active instanceof HTMLElement || active instanceof SVGElement) &&
          active !== page.body &&
          !node.contains(active)
        ) {
          released.current = active;
          active.blur();
        }
      }
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
    },
    [ref]
  );

  const returnFocus = React.useCallback((event: Event) => {
    const element = released.current;
    released.current = undefined;
    if (event.defaultPrevented || !element?.isConnected) return;
    event.preventDefault();
    element.focus();
  }, []);

  return [releaseFocus, returnFocus] as const;
}

export { useReleaseFocus };
