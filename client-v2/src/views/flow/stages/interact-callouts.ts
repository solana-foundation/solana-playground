/** One transaction's base fee, 5000 lamports, in SOL */
export const FEE_SOL = 0.000005;

/**
 * Whether the code was built after the program was last deployed: a green
 * build newer than the newest deploy on this network. Either side unknown
 * says nothing.
 */
export const builtAfterDeploy = (
  buildAt: number | null,
  deployAt: number | null
) => buildAt !== null && deployAt !== null && buildAt > deployAt;

/** Whether the fee payer cannot pay one fee; an unread balance says nothing */
export const solNeeded = (balance: number | null) =>
  balance !== null && balance < FEE_SOL;

/** A program id shortened in the middle: "6PNd…AVkj" */
export const shortenId = (id: string) =>
  id.length <= 10 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/stages/interact-callouts", () => {
    it("builtAfterDeploy compares a known build with a known deploy", () => {
      expect(builtAfterDeploy(2, 1)).toBe(true);
      expect(builtAfterDeploy(1, 2)).toBe(false);
      expect(builtAfterDeploy(null, 1)).toBe(false);
      expect(builtAfterDeploy(2, null)).toBe(false);
    });

    it("solNeeded asks for SOL below one fee only", () => {
      expect(solNeeded(0)).toBe(true);
      expect(solNeeded(0.000004)).toBe(true);
      expect(solNeeded(FEE_SOL)).toBe(false);
      expect(solNeeded(null)).toBe(false);
    });

    it("shortenId keeps four characters each side", () => {
      expect(shortenId("6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj")).toBe(
        "6PNd…AVkj"
      );
      expect(shortenId("short")).toBe("short");
    });
  });
}
