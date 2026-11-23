/** Lamports in a SOL, as solana-sdk's `LAMPORTS_PER_SOL` */
const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Rust's `format!("{:.9}", lamports_to_sol(lamports))`: the SOL value with
 * nine decimals, computed on integers so no precision is lost.
 *
 * @param lamports the amount
 * @returns the amount in SOL with nine decimals
 */
export const formatSol = (lamports: bigint) => {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0");
  return `${whole}.${fraction}`;
};

/**
 * Rust's `format!("{}", lamports_to_sol(lamports))`: the shortest decimal
 * that reads back as the same `f64`, never with an exponent (JavaScript
 * switches to one below 1e-6). An amount of 9 decimals reads back as itself,
 * so the decimals the amount has, without trailing zeros, are that string.
 *
 * @param lamports the amount
 * @returns the amount in SOL
 */
export const displaySol = (lamports: bigint) =>
  formatSol(lamports).replace(/\.?0+$/, "");

/**
 * What the Solana CLI's `build_balance_message` prints for an amount in SOL:
 * nine decimals, trailing zeros and a dangling point trimmed, then " SOL".
 *
 * @param lamports the amount
 * @returns the balance as the buffers table shows it
 */
export const buildBalanceMessage = (lamports: bigint) =>
  `${displaySol(lamports)} SOL`;
