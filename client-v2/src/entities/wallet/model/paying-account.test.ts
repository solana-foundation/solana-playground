import { describe, expect, it } from "vitest";

import { payingAccountName } from "./paying-account";

describe("entities/wallet/model/paying-account", () => {
  it("names a Playground account once there are two or more", () => {
    expect(payingAccountName({ isPg: true, name: "Wallet 2" }, 2)).toBe(
      "Wallet 2"
    );
  });

  it("names nothing with a single Playground account", () => {
    expect(payingAccountName({ isPg: true, name: "Wallet 1" }, 1)).toBe(
      undefined
    );
  });

  it("never names an extension's account", () => {
    expect(payingAccountName({ isPg: false, name: "Phantom" }, 3)).toBe(
      undefined
    );
  });
});
