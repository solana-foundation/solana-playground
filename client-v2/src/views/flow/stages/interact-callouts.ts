/** One transaction's base fee, 5000 lamports, in SOL */
export const FEE_SOL = 0.000005;

/**
 * Whether the code was built after the program was last deployed: a green
 * build newer than the newest deploy on this network. Either side unknown
 * says nothing.
 */
export const builtAfterDeploy = (
  buildAt: number | undefined,
  deployAt: number | undefined
) => buildAt !== undefined && deployAt !== undefined && buildAt > deployAt;

/** Whether the fee payer cannot pay one fee; an unread balance says nothing */
export const solNeeded = (balance: number | undefined) =>
  balance !== undefined && balance < FEE_SOL;

/** A program id shortened in the middle: "Prog…nter" */
export const shortenId = (id: string) =>
  id.length <= 10 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;

if (import.meta.vitest) {
  const { beforeAll, describe, it, expect } = import.meta.vitest;

  describe("views/flow/stages/interact-callouts", () => {
    let PROGRAM_ID: typeof import("./addresses.fixture").PROGRAM_ID;
    let SHORT_PROGRAM_ID: typeof import("./addresses.fixture").SHORT_PROGRAM_ID;

    beforeAll(async () => {
      ({ PROGRAM_ID, SHORT_PROGRAM_ID } = await import("./addresses.fixture"));
    });

    it("builtAfterDeploy compares a known build with a known deploy", () => {
      expect(builtAfterDeploy(2, 1)).toBe(true);
      expect(builtAfterDeploy(1, 2)).toBe(false);
      expect(builtAfterDeploy(undefined, 1)).toBe(false);
      expect(builtAfterDeploy(2, undefined)).toBe(false);
    });

    it("solNeeded asks for SOL below one fee only", () => {
      expect(solNeeded(0)).toBe(true);
      expect(solNeeded(0.000004)).toBe(true);
      expect(solNeeded(FEE_SOL)).toBe(false);
      expect(solNeeded(undefined)).toBe(false);
    });

    it("shortenId keeps four characters each side", () => {
      expect(shortenId(PROGRAM_ID)).toBe(SHORT_PROGRAM_ID);
      expect(shortenId("short")).toBe("short");
    });
  });
}
