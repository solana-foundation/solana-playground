import { describe, expect, it } from "vitest";

import {
  AirdropRefusedError,
  isAirdropRefused,
  isRateLimited,
  receivedLine,
  refusedNote,
} from "./report";

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

describe("isAirdropRefused", () => {
  it("reads a refusal the command threw", () => {
    expect(
      isAirdropRefused(new AirdropRefusedError(new Error("fetch failed")))
    ).toBe(true);
  });

  it("keeps the request's message and its cause", () => {
    const cause = new Error("429 Too Many Requests");
    const refusal = new AirdropRefusedError(cause);
    expect(refusal.message).toBe("429 Too Many Requests");
    expect(refusal.cause).toBe(cause);
    expect(isRateLimited(refusal)).toBe(true);
  });

  it.each([
    new Error("This network has no faucet."),
    new Error("Sign-in cancelled"),
    "a string",
    undefined,
  ])("does not read %s as one", (error) => {
    expect(isAirdropRefused(error)).toBe(false);
  });
});

describe("refusedNote", () => {
  const WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const LINK = `https://faucet.solana.com/?walletAddress=${WALLET}&amount=5&cluster=devnet`;
  const fill = { walletAddress: WALLET, amount: 5, cluster: "devnet" };

  it("says the faucet is at its limit, with the link and the steps", () => {
    const note = refusedNote(new Error("429 Too Many Requests"), fill);
    // The tutorial's airdrop card says it the same way (HOO-2677)
    expect(note).toMatch(
      /^Airdrop refused: the devnet faucet is at its limit for now\. Get SOL from the web faucet instead: /
    );
    expect(note).toContain(LINK);
    expect(note).toContain("1. Open the web faucet and sign in with GitHub");
    expect(note).toContain(
      "2. Confirm the airdrop. Your address and 5 SOL are filled in"
    );
    expect(note).toContain("3. ");
  });

  it("gives the same steps for any other refusal, worded for it", () => {
    const note = refusedNote(new Error("fetch failed"), fill);
    expect(note).toMatch(
      /^Airdrop refused: the devnet faucet did not send SOL\. Get SOL from the web faucet instead: /
    );
    expect(note).toContain(LINK);
    expect(note).toContain("1. Open the web faucet and sign in with GitHub");
  });

  it("asks the faucet for an amount its form offers, and says that one", () => {
    const note = refusedNote(new Error("fetch failed"), {
      walletAddress: WALLET,
      amount: 3,
      cluster: "devnet",
    });
    expect(note).toContain(LINK);
    expect(note).toContain("Your address and 5 SOL are filled in");
  });

  it("names no cluster it does not know", () => {
    expect(refusedNote(new Error("429"), {})).toMatch(
      /^Airdrop refused: the faucet is at its limit for now\./
    );
  });
});
