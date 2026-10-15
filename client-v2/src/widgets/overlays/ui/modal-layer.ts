import { createContext, useContext } from "react";

/**
 * Whether the dialog around a `ModalFrame` is the top of `PgView`'s stack.
 * `ModalHost` keeps every stacked dialog mounted, and only the top one draws
 * its content. What a dialog's component holds in state survives while
 * another sits on it; the components below its `ModalFrame` remount when it
 * is on top again, so their own state does not.
 *
 * `null` outside `ModalHost`: a `ModalFrame` rendered anywhere else is a
 * mistake, and `useIsTopModal` says so rather than drawing a dialog.
 */
export const ModalLayerContext = createContext<boolean | null>(null);

export const useIsTopModal = () => {
  const isTop = useContext(ModalLayerContext);
  if (isTop === null) {
    throw new Error("ModalFrame is rendered outside ModalHost");
  }
  return isTop;
};

/**
 * Set by `ModalHost` for the top dialog: while its submit runs, the dialog
 * cannot be dismissed (Escape, a press outside, the header's Close), so the
 * submit's answer reaches the dialog that asked for it.
 */
export const ModalDismissContext = createContext<(blocked: boolean) => void>(
  () => {}
);

export const useBlockDismiss = () => useContext(ModalDismissContext);

/**
 * Set by `ModalPages`: reports the dialog as opened, once, under the name
 * `ModalPages` was given, so a dialog of several pages is counted once. A
 * `ModalFrame` outside `ModalPages` has none and reports itself.
 */
export const ModalOpenReportContext = createContext<(() => void) | null>(null);

export const useOpenReport = () => useContext(ModalOpenReportContext);
