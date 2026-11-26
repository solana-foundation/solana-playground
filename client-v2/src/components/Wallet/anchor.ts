import { PgWallet } from "../../utils";

/**
 * Where the floating wallet opens when the control that asked for it wants it
 * beside itself. Read by the window as it opens, and again whenever the chip
 * asks while it is already open; forgotten when it closes, so an open from
 * anywhere else keeps the usual top-right place.
 */
let anchor: DOMRect | undefined;

/** The open window, told about a new anchor */
const listeners = new Set<(anchor: DOMRect | undefined) => void>();

/** Opens the floating wallet right above `el` (the wallet chip's Accounts) */
export const showWalletAbove = (el: Element | null) => {
  anchor = el?.getBoundingClientRect();
  listeners.forEach((cb) => cb(anchor));
  PgWallet.show = true;
};

export const walletAnchor = () => anchor;

/** Calls `cb` whenever the chip asks again while the window is open */
export const onWalletAnchor = (cb: (anchor: DOMRect | undefined) => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export const forgetWalletAnchor = () => {
  anchor = undefined;
};
