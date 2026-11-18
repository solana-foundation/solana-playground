import * as B from "./generated";

/**
 * The designed order of the settings list: the default first, then Solscan,
 * then Orb (HOO-2759). An explorer not named here goes last.
 */
const ORDER = ["Solana Explorer", "Solscan", "Orb"];

const rank = (name: string) => {
  const i = ORDER.indexOf(name);
  return i === -1 ? ORDER.length : i;
};

export const BLOCK_EXPLORERS = Object.values(B).sort(
  (a, b) => rank(a.name) - rank(b.name)
);
