import { describe, expect, it } from "vitest";

import { isDeployBlocked, MAINNET_DEPLOY_BLOCKED } from "./mainnet-block";

describe("isDeployBlocked", () => {
  it("blocks mainnet only", () => {
    expect(isDeployBlocked("mainnet")).toBe(true);
    expect(isDeployBlocked("devnet")).toBe(false);
    expect(isDeployBlocked("localnet")).toBe(false);
    // eslint-disable-next-line unicorn/no-null -- `PgConnection.cluster` is `null` until the first endpoint is read
    expect(isDeployBlocked(null)).toBe(false);
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
