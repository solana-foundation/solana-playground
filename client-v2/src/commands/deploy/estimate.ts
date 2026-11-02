import { PgConnection, PgProgramInfo, PgServer, PgWeb3 } from "../../utils";
import { createLogger } from "@/shared/lib/logger";
import { additionalProgramLen } from "./additional-len";

const log = createLogger("deploy:estimate");

/** How long the deploy approval waits on its cost estimate */
const QUOTE_TIMEOUT_MS = 3000;

/** The fee of one signature, in lamports */
const LAMPORTS_PER_SIGNATURE = 5000;
/**
 * Program bytes one write transaction carries; kept at or below the chunk
 * `BpfLoaderUpgradeable.loadBuffer` writes (the packet size less the
 * transaction's own bytes), so the write count, and the fee, round up
 */
const WRITE_CHUNK_BYTES = 900;
/**
 * Creating the buffer, extending the program data and the deploy itself,
 * counted whether or not the extension is needed: the estimate rounds up
 */
const FIXED_TRANSACTIONS = 3;

/**
 * Lamports a deploy of the built program is about to cost the paying wallet,
 * or `null` when the program or the chain cannot be read. A first deploy
 * keeps the buffer's rent as the program's; an upgrade gets the buffer's
 * rent back and pays only for a larger program data account and the fees.
 * The program account's own rent, about 0.001 SOL, is left out.
 */
export const estimateDeployCost = async (): Promise<number | null> => {
  try {
    const onChain = PgProgramInfo.onChain;
    if (!onChain) return null;

    let programLen = PgProgramInfo.importedProgram?.bytes.length;
    if (!programLen && PgProgramInfo.uuid) {
      programLen = (await PgServer.deploy(PgProgramInfo.uuid)).length;
    }
    if (!programLen) return null;

    const connection = PgConnection.current;
    const additionalLen = additionalProgramLen({
      programLen,
      deployed: onChain.deployed,
      onChainLen: onChain.programDataLen,
    });
    const [bufferRent, extensionRent] = await Promise.all([
      connection.getMinimumBalanceForRentExemption(
        PgWeb3.BpfLoaderUpgradeableProgram.getBufferAccountSize(programLen)
      ),
      additionalLen > 0
        ? connection.getMinimumBalanceForRentExemption(additionalLen)
        : 0,
    ]);
    const writes = Math.ceil(programLen / WRITE_CHUNK_BYTES);
    const fees = (writes + FIXED_TRANSACTIONS) * LAMPORTS_PER_SIGNATURE;
    return (onChain.deployed ? 0 : bufferRent) + extensionRent + fees;
  } catch (e) {
    // The approval card leaves the cost out; the deploy itself is unaffected
    log.warn("could not estimate the deploy cost", {
      context: { error: String(e) },
    });
    return null;
  }
};

/**
 * {@link estimateDeployCost}, or `null` once `ms` pass without an answer:
 * the approval card waits on it, and a stalled build server or RPC must not
 * hold the card
 */
export const estimateDeployCostWithin = async (
  ms: number = QUOTE_TIMEOUT_MS
): Promise<number | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      log.warn("the deploy cost estimate timed out", { context: { ms } });
      resolve(null);
    }, ms);
  });
  try {
    return await Promise.race([estimateDeployCost(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
