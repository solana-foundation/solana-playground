import { additionalProgramLen } from "./additional-len";
import { PgWeb3 } from "../../utils";

// The utils barrel needs webpack's globals; the class under test only needs
// the loader program's arithmetic
vi.mock("../../utils", async () => ({
  PgWeb3: {
    BpfLoaderUpgradeableProgram: (
      await vi.importActual<
        typeof import("../../utils/web3/bpf-loader-upgradeable")
      >("../../utils/web3/bpf-loader-upgradeable")
    ).BpfLoaderUpgradeableProgram,
  },
}));

const { MINIMUM_EXTEND_PROGRAM_BYTES } = PgWeb3.BpfLoaderUpgradeableProgram;

/** On-chain account length that fits exactly `programLen` bytes of program */
const exact = (programLen: number) =>
  PgWeb3.BpfLoaderUpgradeableProgram.getProgramDataAccountSize(programLen);

const upgrade = (programLen: number, onChainLen: number | undefined) =>
  additionalProgramLen({ programLen, deployed: true, onChainLen });

describe("additionalProgramLen", () => {
  it("is 0 for a program that is not deployed yet", () => {
    expect(
      additionalProgramLen({
        programLen: 5000,
        deployed: false,
        onChainLen: undefined,
      })
    ).toBe(0);
  });

  it("is 0 when the account fits the new program exactly", () => {
    expect(upgrade(5000, exact(5000))).toBe(0);
  });

  it("is the surplus, negative, when the account is already larger", () => {
    expect(upgrade(5000, exact(5000) + 300)).toBe(-300);
  });

  // SIMD-0431: `extendProgram` rejects a request smaller than the minimum
  it("rounds a small shortfall up to the minimum extend size", () => {
    expect(upgrade(5000, exact(5000) - 100)).toBe(MINIMUM_EXTEND_PROGRAM_BYTES);
  });

  it("keeps a shortfall that is already above the minimum", () => {
    const shortfall = MINIMUM_EXTEND_PROGRAM_BYTES + 1;
    expect(upgrade(5000, exact(5000) - shortfall)).toBe(shortfall);
  });

  it("throws when a deployed program's on-chain length is unknown", () => {
    expect(() => upgrade(5000, undefined)).toThrow(
      "Failed to get program data length"
    );
  });
});
