/**
 * A SOL balance as the wallet chip, the account menu and the Deploy payer line
 * show it: up to four decimals, trailing zeros dropped, "0 SOL" when empty.
 * One copy, so the three cannot disagree about the same wallet.
 */
export const solAmount = (sol: number) => `${Number(sol.toFixed(4))} SOL`;
