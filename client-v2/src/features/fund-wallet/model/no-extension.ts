/**
 * What the Fund dialog and the wallet chip's connect list say when no
 * Wallet Standard wallet is installed (designers' wallet spec, "No external
 * wallet found"): the Playground wallet is the way on
 */
export const NO_EXTENSION = {
  title: "No wallet extension found in this browser.",
  hint: "Install Phantom, Backpack or Solflare, then reload. Or keep using the Playground wallet.",
} as const;
