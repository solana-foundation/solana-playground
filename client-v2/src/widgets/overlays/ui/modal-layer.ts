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
 * The id of the dialog around a component, from `PgView`'s stack: what to
 * pass to `PgView.closeModal` to close this dialog rather than whichever is
 * on top. A dialog stays mounted under another, and its code (a submit that
 * settles, an effect that hears of a connection) can close it from there.
 */
export const ModalIdContext = createContext<string | null>(null);

export const useModalId = () => {
  const id = useContext(ModalIdContext);
  if (id === null) throw new Error("useModalId is used outside ModalHost");
  return id;
};

/**
 * The id of the dialog around a component that also renders outside one
 * (Start from scratch sits on Home as well as in the gallery), or `null`
 * there: outside a dialog there is nothing of its own to close.
 */
export const useModalIdIfAny = () => useContext(ModalIdContext);

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
