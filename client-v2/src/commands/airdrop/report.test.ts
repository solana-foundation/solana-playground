import { describe, expect, it } from "vitest";

import { isRateLimited, rateLimitNote, receivedLine } from "./report";

const LAMPORTS_PER_SOL = 1_000_000_000;

describe("receivedLine", () => {
  it("says the requested amount arrived when all of it did", () => {
    expect(receivedLine(5, 5 * LAMPORTS_PER_SOL)).toBe(
      "Airdrop successful: received 5 SOL."
    );
  });

  it("says how much of the request arrived when the faucet sent less", () => {
    expect(receivedLine(5, 1 * LAMPORTS_PER_SOL)).toBe(
      "Airdrop successful: received 1 SOL of the 5 SOL requested."
    );
  });

  it("reads fractions of a SOL", () => {
    expect(receivedLine(1, 0.5 * LAMPORTS_PER_SOL)).toBe(
      "Airdrop successful: received 0.5 SOL of the 1 SOL requested."
    );
  });

  it("names no amount when the balance fell meanwhile", () => {
    expect(receivedLine(5, -1000)).toBe("Airdrop successful.");
  });
});

describe("isRateLimited", () => {
  it.each([
    '429 Too Many Requests: {"jsonrpc":"2.0","error":{"code":429}}',
    // Over HTTP/2 the response carries no status text
    '429 : {"jsonrpc":"2.0","error":{"code":429}}',
    "failed to get airdrop: Too many airdrop requests. Wait 24 hours for a refill.",
    "You've either reached your airdrop limit today or the airdrop faucet has run dry.",
    "Rate limit exceeded",
  ])("reads %s as a rate limit", (message) => {
    expect(isRateLimited(new Error(message))).toBe(true);
  });

  it.each([
    new Error("Airdrop transaction failed: InstructionError"),
    new Error("Balance did not change"),
    new Error("Transaction simulation failed at slot 429"),
    new Error("4290 lamports short"),
    "a string",
    undefined,
  ])("does not read %s as one", (error) => {
    expect(isRateLimited(error)).toBe(false);
  });
});

describe("rateLimitNote", () => {
  it("links the web faucet with the wallet, amount and cluster", () => {
    const note = rateLimitNote({
      walletAddress: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
      amount: 5,
      cluster: "devnet",
    });
    expect(note).toContain(
      "https://faucet.solana.com/?walletAddress=9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin&amount=5&cluster=devnet"
    );
    // The tutorial's airdrop card says it the same way (HOO-2677)
    expect(note).toMatch(
      /^Airdrop refused: the devnet faucet is at its limit for now\. Get SOL from the web faucet instead: /
    );
  });

  it("names no cluster it does not know", () => {
    expect(rateLimitNote({})).toMatch(
      /^Airdrop refused: the faucet is at its limit for now\./
    );
  });
});
