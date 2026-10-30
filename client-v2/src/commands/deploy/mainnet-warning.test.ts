import { describe, expect, it } from "vitest";

import {
  MAINNET_DEPLOY_WARNING,
  MAINNET_DEPLOY_WARNING_BODY,
  MAINNET_DEPLOY_WARNING_GUIDE,
  warnsOnDeploy,
} from "./mainnet-warning";

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

describe("MAINNET_DEPLOY_WARNING_GUIDE", () => {
  // The Deploy stage links these words in place; a body edit that drops or
  // repeats them would leave the link dangling or doubled
  it("is in the body exactly once", () => {
    expect(
      MAINNET_DEPLOY_WARNING_BODY.split(MAINNET_DEPLOY_WARNING_GUIDE)
    ).toHaveLength(2);
  });
});
