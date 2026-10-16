import { PgWeb3 } from "../../utils";

/** What the length arithmetic needs to know about the program */
export interface ProgramLenInfo {
  /** Length of the program binary about to be deployed, in bytes */
  programLen: number;
  /** Whether the program already exists on-chain */
  deployed: boolean;
  /** Current program data account length on-chain, if known */
  onChainLen: number | undefined;
}

/**
 * Get the additional length necessary for upgrades.
 *
 * The return value (`r`) can be interpreted as:
 *
 * - If `r < 0` : The program has `-r` amount of extra space - no need to extend
 * - If `r == 0`: The program either has the exact space or hasn't been deployed
 * - If `r > 0` : The program needs `r` amount of space for upgrade
 *
 * This function takes [SIMD-0431] into account.
 *
 * [SIMD-0431]: https://github.com/solana-foundation/solana-improvement-documents/pull/431
 */
export const additionalProgramLen = (info: ProgramLenInfo) => {
  if (!info.deployed) return 0;

  const requiredLen =
    PgWeb3.BpfLoaderUpgradeableProgram.getProgramDataAccountSize(
      info.programLen
    );
  if (typeof info.onChainLen !== "number") {
    throw new Error("Failed to get program data length");
  }

  const additionalLen = requiredLen - info.onChainLen;
  if (additionalLen <= 0) return additionalLen;

  // SIMD-0431
  return Math.max(
    additionalLen,
    PgWeb3.BpfLoaderUpgradeableProgram.MINIMUM_EXTEND_PROGRAM_BYTES
  );
};
