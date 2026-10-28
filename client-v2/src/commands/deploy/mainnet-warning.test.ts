import { describe, expect, it } from "vitest";

import { MAINNET_DEPLOY_WARNING, warnsOnDeploy } from "./mainnet-warning";

describe("warnsOnDeploy", () => {
  it("warns on mainnet-beta only", () => {
    expect(warnsOnDeploy("mainnet-beta")).toBe(true);
    expect(warnsOnDeploy("devnet")).toBe(false);
    expect(warnsOnDeploy("localnet")).toBe(false);
    expect(warnsOnDeploy(null)).toBe(false);
  });
});

describe("MAINNET_DEPLOY_WARNING", () => {
  // What the spec requires the warning to say, not its exact sentence
  it.each([
    "real SOL",
    "Playground wallet",
    "this browser",
    "your own machine",
    "Solana CLI or Anchor",
  ])("says %s", (phrase) => {
    expect(MAINNET_DEPLOY_WARNING).toContain(phrase);
  });
});
