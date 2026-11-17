import { isFaucetClosed } from "./faucet";

/** The faucet's 429, or its own words for the limit */
const FAUCET_LIMIT = /\b429\b|too many requests|rate limit|airdrop limit/i;

/**
 * Whether a refused airdrop's message is the devnet faucet's limit: an
 * expected answer, unlike any other failure of the request
 */
export const isFaucetLimit = (message: string) => FAUCET_LIMIT.test(message);

/**
 * What an airdrop says when the network could not be reached: no faucet
 * answered, so no faucet steps would help. One string for the terminal, the
 * wallet chip and the cards.
 */
export const NETWORK_UNREACHABLE =
  "The network is unreachable. Check your connection and try again.";

/** What a refused airdrop names as its cause: the faucet's limit, or anything else */
export type AirdropRefusal = "limit" | "other";

/**
 * The cause as the wallet chip and the wallet menu head it, without a full
 * stop; the tutorial cards add one. One string, so no two surfaces disagree
 * about the same refusal
 */
export const refusalHeadline = (refusal: AirdropRefusal) =>
  refusal === "limit"
    ? "The faucet is at its limit"
    : "The faucet did not send SOL";

/**
 * Why a tutorial's airdrop brought no SOL, in the words the Deploy stage's
 * card and the wallet chip use for the same refusal, so no two surfaces
 * disagree about one. No "try again in a minute": the faucet's limit rarely
 * lifts that soon, so the steps under it send the learner to the web faucet
 */
export const airdropCause = (message: string) => {
  if (message === NETWORK_UNREACHABLE) return NETWORK_UNREACHABLE;
  // Asking the RPC again will not help until it reopens; the web faucet will
  if (isFaucetClosed(message)) return "The devnet RPC faucet is closed.";
  return isFaucetLimit(message)
    ? "The devnet faucet is at its limit."
    : `${refusalHeadline("other")}.`;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/faucet-limit", () => {
    it.each([
      "429 Too Many Requests",
      "Server responded with 429",
      "airdrop limit reached",
      "You've hit the rate limit",
    ])("reads %j as the faucet's limit", (message) => {
      expect(isFaucetLimit(message)).toBe(true);
    });

    it.each([
      ["429 Too Many Requests", "The devnet faucet is at its limit."],
      ["fetch failed", "The faucet did not send SOL."],
    ])("names the cause of %j", (message, cause) => {
      expect(airdropCause(message)).toBe(cause);
    });

    it("names a closed RPC faucet as such, not as a failure", () => {
      expect(airdropCause("410 Gone: faucet is closed")).toBe(
        "The devnet RPC faucet is closed."
      );
    });

    it("names an unreachable network as such, not as a faucet failure", () => {
      expect(airdropCause(NETWORK_UNREACHABLE)).toBe(NETWORK_UNREACHABLE);
    });

    it("reads any other failure as something else", () => {
      expect(isFaucetLimit("fetch failed")).toBe(false);
      expect(isFaucetLimit("slot 14290")).toBe(false);
    });
  });
}
