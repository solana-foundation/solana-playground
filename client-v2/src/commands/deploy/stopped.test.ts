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

  it("names a buffer it could not close and how to reclaim its SOL", () => {
    expect(deployStoppedLine({ state: "kept", address: "Buf1111" })).toBe(
      "Stopped. The program was not deployed. The buffer account Buf1111 " +
        "still holds its SOL; run `solana program close --buffers` to reclaim it."
    );
  });
});
