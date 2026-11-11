import type { FaucetLinkFill } from "@/shared/lib/faucet";
import { faucetLink, offeredAmount, webFaucetSteps } from "@/shared/lib/faucet";
import type { AirdropRefusal } from "@/shared/lib/faucet-limit";

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
 * An airdrop that brought no SOL once it started: a balance read, the
 * request, its confirmation, or a balance that never moved failed. It keeps
 * the failure's message, so the terminal's error line reads as before, and is
 * told apart from a failure before the airdrop started (no wallet, a sign-in,
 * no faucet on the cluster), which no faucet steps would help. Thrown only
 * where the web faucet serves the cluster.
 */
export class AirdropRefusedError extends Error {
  override readonly name = "AirdropRefusedError";

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "The airdrop failed", {
      cause,
    });
  }
}

/** Whether the `airdrop` command threw for a refusal ({@link AirdropRefusedError}) */
export const isAirdropRefused = (
  error: unknown
): error is AirdropRefusedError => error instanceof AirdropRefusedError;

/** The cause of a refusal, as the wallet chip and the wallet menu name it */
export const refusalOf = (error: unknown): AirdropRefusal =>
  isRateLimited(error) ? "limit" : "other";

/**
 * What the terminal says after any refusal: the cause, the web faucet filled
 * in, and its steps (`webFaucetSteps`, worded for a newcomer). The first line is worded
 * like the tutorial's airdrop card (HOO-2677): the user meets both. The link
 * asks for an amount the faucet's form offers, so step 2 names that one.
 */
export const refusedNote = (error: unknown, fill: FaucetLinkFill): string => {
  const faucet = fill.cluster ? `the ${fill.cluster} faucet` : "the faucet";
  const cause = isRateLimited(error)
    ? `${faucet} is at its limit for now`
    : `${faucet} did not send SOL`;
  const amount = offeredAmount(fill.amount);
  const steps = webFaucetSteps(
    amount,
    "Come back here. The SOL is in your wallet once the faucet confirms"
  ).map((step, i) => `  ${i + 1}. ${step}`);
  return [
    `Airdrop refused: ${cause}. Get SOL from the web faucet instead: ${faucetLink(
      { ...fill, amount }
    )}`,
    ...steps,
  ].join("\n");
};
