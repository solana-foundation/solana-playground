import { additionalProgramLen } from "../../../../commands/deploy/additional-len";
import { BpfLoaderUpgradeable } from "../../../../commands/deploy/bpf-loader-upgradeable";
import { sendAndConfirmTxWithRetries } from "../../../../commands/deploy/deploy";
import {
  PgCommand,
  PgConnection,
  PgProgramInfo,
  PgServer,
  PgTerminal,
  PgTx,
  PgWallet,
  PgWeb3,
} from "../../../../utils";
import type { Wallet } from "../../../../utils";
import { createLogger } from "@/shared/lib/logger";
import { actRunner } from "./act-runner";
import type { ActRun } from "./act-runner";
import { runDeploy } from "./deploy";
import { deploySlotOf, landedDeploy, recogniseDeploy } from "./recognise";
import type { DeployPort, OnChain } from "./deploy";
import type { FundingChain } from "./fund";

const log = createLogger("tutorial-conversation:deploy");

/** The faucet amount on devnet, in whole SOL (`PgConnection.getAirdropAmount`) */
const DEVNET_FAUCET_SOL = 5;

/**
 * The Playground wallet that pays: the current account, or the first. A
 * tutorial deploys from it even while a standard wallet is connected, so a
 * deploy never waits on an extension's approval; null when none exists yet.
 */
const playgroundWallet = (): Wallet | null => {
  const account =
    PgWallet.accounts[PgWallet.currentIndex] ?? PgWallet.accounts[0];
  return account ? PgWallet.create(account) : null;
};

const pk = (address: string) => new PgWeb3.PublicKey(address);

/** Devnet through the connection the settings hold, which `PgTx` sends on */
const devnetFunding: FundingChain = {
  balance: (address) => PgConnection.current.getBalance(pk(address)),
  airdrop: (address, lamports) =>
    PgConnection.current.requestAirdrop(pk(address), lamports),
  confirm: async (signature) => {
    const result = await PgTx.confirm(signature);
    return !!result && !result.err;
  },
};

const onChainOf = async (id: string): Promise<OnChain> => {
  const info = await PgProgramInfo.fetch(pk(id));
  if (!info.deployed) return { deployed: false };
  if (!info.upgradable) return { deployed: true, dataLen: 0, authority: null };
  if (!("programDataLen" in info) || info.programDataLen === undefined) {
    throw new Error("Could not read the program's data account");
  }
  return {
    deployed: true,
    dataLen: info.programDataLen,
    authority: info.authority?.toBase58() ?? null,
  };
};

/** Closes a buffer, returning its rent to the wallet that funded it */
const closeBuffer = async (buffer: string, wallet: Wallet) => {
  const conn = PgConnection.current;
  await sendAndConfirmTxWithRetries(
    () => BpfLoaderUpgradeable.closeBuffer(pk(buffer), { wallet }),
    async () => !(await conn.getAccountInfo(pk(buffer)))
  );
};

/** The slot of the program's last deploy or upgrade; null when not on chain */
const deploySlotOnChain = async (programId: string) => {
  const conn = PgConnection.current;
  const program = await conn.getAccountInfo(pk(programId));
  if (!program) return null;
  // The program account names its ProgramData account after a u32 tag
  const data = await conn.getAccountInfo(
    new PgWeb3.PublicKey(program.data.subarray(4, 36))
  );
  return data ? deploySlotOf(data.data) : null;
};

const programSignatures = async (programId: string) =>
  (
    await PgConnection.current.getSignaturesForAddress(pk(programId), {
      limit: 20,
    })
  ).map((s) => ({
    signature: s.signature,
    slot: s.slot,
    failed: s.err !== null,
  }));

/**
 * Sends a deploy or upgrade from `buffer`. When its retries give up, a
 * deploy that landed anyway (the confirm timed out, then the retry failed on
 * the consumed buffer) answers its signature instead of the failure.
 */
const sendFromBuffer = async (
  send: () => Promise<string | undefined>,
  buffer: string,
  programId: string,
  what: string
): Promise<string> => {
  let failure: unknown;
  try {
    const signature = await send();
    if (signature) return signature;
    failure = new Error(`The ${what} sent no transaction`);
  } catch (e) {
    failure = e;
  }
  const landed = await landedDeploy({
    programId,
    bufferExists: async () =>
      !!(await PgConnection.current.getAccountInfo(pk(buffer))),
    deploySlot: deploySlotOnChain,
    signatures: programSignatures,
  }).catch((e) => {
    log.error(e, {
      report: true,
      context: { stage: `Checking whether the ${what} landed` },
    });
    return null;
  });
  if (landed) return landed;
  throw failure;
};

/**
 * The deploy port over the editor's loader calls. A tutorial runs on devnet
 * only: on any other cluster the deploy refuses with what to do, rather than
 * spend a local validator's SOL or change the learner's settings.
 */
export const realDeployPort = (): DeployPort => {
  let wallet: Wallet | null = null;
  return {
    refusal: () =>
      PgConnection.cluster === "devnet"
        ? null
        : "Tutorials deploy to devnet. Switch the network to devnet in Settings and try again.",
    wallet: () => {
      wallet = playgroundWallet();
      return wallet ? wallet.publicKey.toBase58() : null;
    },
    program: () => ({
      id: PgProgramInfo.pk?.toBase58() ?? null,
      keypair: !!PgProgramInfo.kp,
      stale: !PgProgramInfo.uuid || !!PgProgramInfo.lastBuildFailed,
      length: null,
    }),
    build: async () => {
      // TODO(HOO-2355): the build act's runner, once it lands, so a
      // build-and-deploy reports the same compiler error card
      try {
        await PgCommand.build.execute();
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        };
      }
      return PgProgramInfo.lastBuildFailed
        ? { ok: false, message: "The build failed. See the terminal." }
        : { ok: true };
    },
    bytes: async () => PgServer.deploy(PgProgramInfo.uuid!),
    onChain: onChainOf,
    rent: async (length, onChain) => {
      const conn = PgConnection.current;
      const buffer = await conn.getMinimumBalanceForRentExemption(
        PgWeb3.BpfLoaderUpgradeableProgram.getBufferAccountSize(length)
      );
      if (!onChain.deployed) {
        return (
          buffer +
          (await conn.getMinimumBalanceForRentExemption(
            PgWeb3.BpfLoaderUpgradeableProgram.PROGRAM_ACCOUNT_SIZE
          ))
        );
      }
      const extra = additionalProgramLen({
        programLen: length,
        deployed: true,
        onChainLen: onChain.deployed ? onChain.dataLen : undefined,
      });
      return extra > 0
        ? buffer + (await conn.getMinimumBalanceForRentExemption(extra))
        : buffer;
    },
    funding: devnetFunding,
    capSol: DEVNET_FAUCET_SOL,
    writeBuffer: async (bytes, onChain) => {
      const payer = wallet!;
      const programPk = PgProgramInfo.pk!;
      const conn = PgConnection.current;
      const extra = additionalProgramLen({
        programLen: bytes.length,
        deployed: onChain.deployed,
        onChainLen: onChain.deployed ? onChain.dataLen : undefined,
      });
      // Before the buffer, not beside the upgrade: an extend in the upgrade's
      // block fails with "Program was deployed in this block already"
      if (extra > 0) {
        await sendAndConfirmTxWithRetries(
          () =>
            BpfLoaderUpgradeable.extendProgram(programPk, extra, {
              wallet: payer,
            }),
          async () => {
            const now = await onChainOf(programPk.toBase58());
            return (
              now.deployed &&
              additionalProgramLen({
                programLen: bytes.length,
                deployed: true,
                onChainLen: now.dataLen,
              }) <= 0
            );
          }
        );
      }
      const buffer = PgWeb3.Keypair.generate();
      const bufferRent = await conn.getMinimumBalanceForRentExemption(
        PgWeb3.BpfLoaderUpgradeableProgram.getBufferAccountSize(bytes.length)
      );
      await sendAndConfirmTxWithRetries(
        () =>
          BpfLoaderUpgradeable.createBuffer(buffer, bufferRent, bytes.length, {
            wallet: payer,
          }),
        async () => !!(await conn.getAccountInfo(buffer.publicKey))
      );
      try {
        await BpfLoaderUpgradeable.loadBuffer(buffer.publicKey, bytes, {
          wallet: payer,
          onRateLimit: (retryAfter) =>
            PgTerminal.println(
              `Warning: Reached rate-limits, waiting ${retryAfter}s...`
            ),
        });
      } catch (e) {
        // The buffer already holds its rent: give it back before the write's
        // failure stands, as `runDeploy` does for a failed deploy
        await closeBuffer(buffer.publicKey.toBase58(), payer).catch((closing) =>
          log.error(closing, {
            report: true,
            context: { stage: "Closing the buffer" },
          })
        );
        throw e;
      }
      return buffer.publicKey.toBase58();
    },
    deploy: async (buffer, length) => {
      const conn = PgConnection.current;
      return sendFromBuffer(
        () =>
          sendAndConfirmTxWithRetries(
            () =>
              BpfLoaderUpgradeable.deployProgram(
                PgProgramInfo.kp!,
                pk(buffer),
                length,
                { wallet: wallet! }
              ),
            async () => !(await conn.getAccountInfo(pk(buffer)))
          ),
        buffer,
        PgProgramInfo.pk!.toBase58(),
        "deploy"
      );
    },
    upgrade: async (buffer) => {
      const conn = PgConnection.current;
      return sendFromBuffer(
        () =>
          sendAndConfirmTxWithRetries(
            () =>
              BpfLoaderUpgradeable.upgradeProgram(
                PgProgramInfo.pk!,
                pk(buffer),
                { wallet: wallet! }
              ),
            async () => !(await conn.getAccountInfo(pk(buffer)))
          ),
        buffer,
        PgProgramInfo.pk!.toBase58(),
        "upgrade"
      );
    },
    closeBuffer: (buffer) => closeBuffer(buffer, wallet!),
    instructions: () =>
      (PgProgramInfo.idl?.instructions ?? []).map((ix) => ix.name),
    print: (line) => PgTerminal.println(line),
    report: (error, stage) =>
      log.error(error, { report: true, context: { stage } }),
    now: () => Date.now(),
  };
};

/** The deploy act and the build-and-deploy act, on devnet */
export const runDeployOnDevnet: ActRun = async (act, _input, onStage) => {
  const result = await runDeploy(
    realDeployPort(),
    act === "buildDeploy" ? "buildDeploy" : "deploy",
    onStage
  );
  // The reason and the chain's message only: never a key or the wallet.
  // `runDeploy` answers only deploy results, so every failure has a reason
  if (!result.ok && "reason" in result) {
    log.warn(`A tutorial ${act} stopped: ${result.reason}`, {
      context: { message: result.message },
    });
  }
  return result;
};

/**
 * The runner the tutorial frame passes to `PgConversation.init`. The acts
 * whose tickets have not landed answer "not wired yet".
 */
export const tutorialRunner = actRunner(
  {
    deploy: runDeployOnDevnet,
    buildDeploy: runDeployOnDevnet,
  },
  async (act, startedAtMs) => {
    if (act !== "deploy" && act !== "buildDeploy") return null;
    if (PgConnection.cluster !== "devnet") return null;
    return recogniseDeploy({
      act,
      programId: PgProgramInfo.pk?.toBase58() ?? null,
      startedAtMs,
      deploySlot: deploySlotOnChain,
      blockTime: (slot) => PgConnection.current.getBlockTime(slot),
      signatures: programSignatures,
      instructions: (PgProgramInfo.idl?.instructions ?? []).map(
        (ix) => ix.name
      ),
    });
  }
);
