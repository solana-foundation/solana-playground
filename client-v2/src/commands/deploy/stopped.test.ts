// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, so its tests stay out of the modules (AGENTS.md)
import { describe, expect, it } from "vitest";

import { deployStoppedLine } from "./stopped";

describe("commands/deploy/stopped", () => {
  it("says nothing is left before the buffer exists", () => {
    expect(deployStoppedLine({ state: "none" })).toBe(
      "Stopped. The program was not deployed."
    );
  });

  it("says the buffer was closed and its SOL returned", () => {
    expect(deployStoppedLine({ state: "closed" })).toBe(
      "Stopped. The program was not deployed. Its buffer account was closed " +
        "and the SOL returned."
    );
  });

  it("names a buffer it could not close, the SOL it holds and how to reclaim it", () => {
    expect(
      deployStoppedLine({
        state: "kept",
        address: "Buf1111",
        sol: 1.42167696,
      })
    ).toBe(
      "Stopped. The program was not deployed. Its buffer Buf1111 " +
        "still holds 1.42 SOL. Run `solana program close --buffers` to get it back."
    );
  });

  it("says less than 0.01 SOL when the amount rounds to nothing", () => {
    expect(
      deployStoppedLine({
        state: "kept",
        address: "Buf1111",
        sol: 0.00089088,
      })
    ).toContain("still holds less than 0.01 SOL.");
  });

  it('keeps "its SOL" when the buffer\'s balance could not be read', () => {
    expect(
      deployStoppedLine({
        state: "kept",
        address: "Buf1111",
        sol: undefined,
      })
    ).toBe(
      "Stopped. The program was not deployed. Its buffer Buf1111 " +
        "still holds its SOL. Run `solana program close --buffers` to get it back."
    );
  });

  it("rounds a half cent up to 0.01 SOL", () => {
    expect(
      deployStoppedLine({
        state: "kept",
        address: "Buf1111",
        sol: 0.005,
      })
    ).toContain("still holds 0.01 SOL.");
  });
});
