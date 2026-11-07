import { describe, expect, it } from "vitest";

import { blocksDeploy, MAINNET_DEPLOY_BLOCKED } from "./mainnet-block";

describe("blocksDeploy", () => {
  it("blocks mainnet-beta only", () => {
    expect(blocksDeploy("mainnet-beta")).toBe(true);
    expect(blocksDeploy("devnet")).toBe(false);
    expect(blocksDeploy("localnet")).toBe(false);
    // eslint-disable-next-line unicorn/no-null -- `PgConnection.cluster` is `null` until the first endpoint is read
    expect(blocksDeploy(null)).toBe(false);
  });
});

describe("MAINNET_DEPLOY_BLOCKED", () => {
  it.each([
    "not available in the beta",
    "your own machine",
    "Solana CLI or Anchor",
  ])("says %s", (phrase) => {
    expect(MAINNET_DEPLOY_BLOCKED).toContain(phrase);
  });
});
