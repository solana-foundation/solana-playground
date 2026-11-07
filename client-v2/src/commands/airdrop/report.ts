import type { FaucetLinkFill } from "@/shared/lib/faucet";
import { faucetLink } from "@/shared/lib/faucet";

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * The line after an airdrop landed, with what the balance rose by. A public
 * RPC may credit less than was asked, so the requested amount alone would
 * overstate it. A balance that fell meanwhile (the wallet paid for something)
 * gives no amount to name.
 */
export const receivedLine = (
  requestedSol: number,
  receivedLamports: number
): string => {
  if (receivedLamports <= 0) return "Airdrop successful.";
  const received = receivedLamports / LAMPORTS_PER_SOL;
  return received >= requestedSol
    ? `Airdrop successful: received ${received} SOL.`
    : `Airdrop successful: received ${received} SOL of the ${requestedSol} SOL requested.`;
};

/**
 * Whether the RPC would not send the airdrop for a limit: an HTTP 429, which
 * web3.js reports as "429 Too Many Requests: …" once its retries run out (or
 * "429 : …" over HTTP/2, which has no status text), or the faucet's own words
 * for its daily limit or an empty faucet. The web faucet keeps a separate
 * quota, so it is worth pointing to for any of them.
 */
export const isRateLimited = (error: unknown): boolean =>
  error instanceof Error &&
  /^429\b|too many (airdrop )?requests|rate.?limit|airdrop limit|run dry/i.test(
    error.message
  );

/**
 * What the terminal says after a limit, with the web faucet filled in. Worded
 * like the tutorial's airdrop card (HOO-2677): the user meets both.
 */
export const rateLimitNote = (fill: FaucetLinkFill): string => {
  const faucet = fill.cluster ? `the ${fill.cluster} faucet` : "the faucet";
  return `Airdrop refused: ${faucet} is at its limit for now. Get SOL from the web faucet instead: ${faucetLink(
    fill
  )}`;
};
