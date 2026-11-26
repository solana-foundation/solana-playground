/**
 * The Playground account that pays, named only once there are two or more:
 * with one account the name says nothing. An extension's accounts live in the
 * extension, so it is never named here. The wallet chip and the Deploy stage's
 * payer line both read it, so they cannot disagree.
 */
export const payingAccountName = (
  wallet: { isPg?: boolean; name: string },
  accountCount: number
) => (wallet.isPg && accountCount > 1 ? wallet.name : undefined);

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

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
}
