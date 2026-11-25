import { PgWallet } from "../../utils";

/**
 * Where the floating wallet opens when the control that asked for it wants it
 * beside itself. Read once by the window as it opens and forgotten when it
 * closes, so an open from anywhere else keeps the usual top-right place.
 */
let anchor: DOMRect | undefined;

/** Opens the floating wallet right above `el` (the wallet chip's Accounts) */
export const showWalletAbove = (el: Element | null) => {
  anchor = el?.getBoundingClientRect();
  PgWallet.show = true;
};

export const walletAnchor = () => anchor;

export const forgetWalletAnchor = () => {
  anchor = undefined;
};
