import { describe, expect, it } from "vitest";

import { isAirdropSignInGated } from "./sign-in-gate";

describe("isAirdropSignInGated", () => {
  it.each(["localnet", "playnet"])("opens the gate on %s", (cluster) => {
    expect(isAirdropSignInGated(cluster)).toBe(false);
  });

  it.each(["devnet", "testnet", "mainnet"])(
    "keeps the gate on %s",
    (cluster) => {
      expect(isAirdropSignInGated(cluster)).toBe(true);
    }
  );

  it("keeps the gate while the cluster is unread", () => {
    // eslint-disable-next-line unicorn/no-null -- `PgConnection.cluster` is `null` before the cluster is read
    expect(isAirdropSignInGated(null)).toBe(true);
    expect(isAirdropSignInGated(undefined)).toBe(true);
  });
});
