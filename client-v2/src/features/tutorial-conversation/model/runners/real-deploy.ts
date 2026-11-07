/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { DEVNET_FAUCET_SOL } from "@/shared/lib/faucet";
import { createLogger } from "@/shared/lib/logger";

import { additionalProgramLen } from "../../../../commands/deploy/additional-len";
import { BpfLoaderUpgradeable } from "../../../../commands/deploy/bpf-loader-upgradeable";
import { sendAndConfirmTxWithRetriesFor } from "../../../../commands/deploy/deploy";
import { unclosedBufferLineFor } from "../../../../commands/deploy/stopped";
import type { Wallet } from "../../../../utils";
import {
  PgCommand,
  PgConnection,
  PgExplorer,
  PgGlobal,
  PgProgramInfo,
  PgServer,
  PgTerminal,
  PgTx,
  PgWallet,
  PgWeb3,
} from "../../../../utils";
import type { Runner } from "../ports";
import type { RunResult } from "../progress";
import type { ActRun } from "./act-runner";
import { actRunner } from "./act-runner";
import { isFundedForDeploy, runAirdropWith } from "./airdrop";
import { runBuild } from "./build";
import type { BuildSource } from "./build-source";
import { trackBuildSource } from "./build-source";
import { builtInstructions } from "./built-instructions";
import type { DeployPort, OnChain } from "./deploy";
import { runDeploy } from "./deploy";
import type { DeployWatchPort } from "./deploy-watch";
import type { FundingChain } from "./fund";
import { currentTarget } from "./real-run";
import { runOnDevnet } from "./real-run";
import { deploySlotOf, landedDeploy, recogniseDeploy } from "./recognise";
import { targetGuardFor } from "./target";

/** What a deploy step cannot go on without; saying which beats a `TypeError` */
const needed = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) {
    throw new Error(`The deploy needs ${what}`);
  }
  return value;
};

const log = createLogger("tutorial-conversation:deploy");

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

type Connection = PgWeb3.Connection;

/** Buffers are read through the read-buffer RPC: the platform RPC does not return fresh buffers */
const readBufferOf = (conn: Connection) =>
  PgConnection.getReadBufferConnection(conn);

/** Devnet through the connection the settings hold, which `PgTx` sends on */
export const devnetFunding: FundingChain = {
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
const closeBufferOn =
  (conn: Connection) => async (buffer: string, wallet: Wallet) => {
    await sendAndConfirmTxWithRetriesFor(conn)(
      () =>
        BpfLoaderUpgradeable.closeBuffer(pk(buffer), {
          wallet,
          connection: conn,
        }),
      async () => !(await readBufferOf(conn).getAccountInfo(pk(buffer)))
    );
  };

/** The slot of the program's last deploy or upgrade; null when not on chain */
const deploySlotOn = (conn: Connection) => async (programId: string) => {
  const program = await conn.getAccountInfo(pk(programId));
  if (!program) return null;
  // The program account names its ProgramData account after a u32 tag
  const data = await conn.getAccountInfo(
    new PgWeb3.PublicKey(program.data.subarray(4, 36))
  );
  return data ? deploySlotOf(data.data) : null;
};

const programSignaturesOn = (conn: Connection) => async (programId: string) =>
  (await conn.getSignaturesForAddress(pk(programId), { limit: 20 })).map(
    (s) => ({
      signature: s.signature,
      slot: s.slot,
      failed: s.err !== null,
    })
  );

/**
 * Sends a deploy or upgrade from `buffer`. When its retries give up, a
 * deploy that landed anyway (the confirm timed out, then the retry failed on
 * the consumed buffer) answers its signature instead of the failure.
 */
const sendFromBuffer = async (
  conn: Connection,
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
      !!(await readBufferOf(conn).getAccountInfo(pk(buffer))),
    deploySlot: deploySlotOn(conn),
    signatures: programSignaturesOn(conn),
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

/** The program's source as one value: every file under `src/`, by path */
const programSource = () => {
  const src = PgExplorer.getCurrentSrcPath();
  return JSON.stringify(
    Object.entries(PgExplorer.files)
      .filter(([path]) => path.startsWith(src))
      .map(([path, file]) => [path, file.content ?? ""])
      .sort(([a], [b]) => (a < b ? -1 : 1))
  );
};

/**
 * The source of the last passing build, across every build the page sees.
 * Started by `watchBuildSource` once the app's globals exist, never at import:
 * `PgCommand.build` throws before the commands are registered, and the panel
 * tree imports this module before they are. Kept for the page, as the build
 * command it listens to is, so a frame mounting twice keeps what it saw.
 */
let buildSource: BuildSource | undefined;

/** Start listening to builds, once per page; safe to call on every mount */
export const watchBuildSource = () => {
  buildSource ??= trackBuildSource({
    onDidStart: (cb) => PgCommand.build.onDidStart(() => cb()),
    onDidFinish: (cb) => PgCommand.build.onDidFinish(cb),
    source: programSource,
    failed: () => !!PgProgramInfo.lastBuildFailed,
  });
};

/**
 * The deploy port over the editor's loader calls. A tutorial runs on devnet
 * only: on any other cluster the deploy refuses with what to do, rather than
 * spend a local validator's SOL or change the learner's settings.
 *
 * Every send goes through the connection the run started on and the program
 * `program()` last read, which runs after the build and before the first
 * send: a project or network switched mid-run cannot redirect a retry or a
 * later buffer write, and the guard stops the run at its next send.
 */
export const realDeployPort = (): DeployPort => {
  let wallet: Wallet | null = null;
  let runConnection: Connection | null = null;
  let programPk: PgWeb3.PublicKey | null = null;
  let programKp: PgWeb3.Keypair | null = null;
  const target = targetGuardFor("the deploy")(currentTarget);
  const sending = () => {
    target.ensure();
    return needed(runConnection, "the devnet connection");
  };
  return {
    refusal: () => {
      // The name can still be the previous endpoint's right after a switch:
      // a custom RPC on mainnet would read as devnet (HOO-2728)
      // A failed read keeps the name stale for good: that wait never ends
      if (PgConnection.clusterIsStale && !PgConnection.hasClusterReadFailed) {
        return "The network is still loading. Try again in a moment.";
      }
      if (PgConnection.cluster !== "devnet") {
        return "Tutorials deploy to devnet. Switch the network to devnet in Settings and try again.";
      }
      target.capture();
      runConnection = PgConnection.current;
      return null;
    },
    wallet: () => {
      wallet = playgroundWallet();
      return wallet ? wallet.publicKey.toBase58() : null;
    },
    // As the no-wallet card's Create wallet makes it (`PgWallet.add` makes it
    // the current wallet too)
    createWallet: () => {
      PgWallet.add();
      wallet = playgroundWallet();
      if (!wallet) throw new Error("The Playground wallet was not made");
      return wallet.publicKey.toBase58();
    },
    program: () => {
      programPk = PgProgramInfo.pk ?? null;
      programKp = PgProgramInfo.kp ?? null;
      return {
        id: programPk?.toBase58() ?? null,
        keypair: !!programKp,
        stale:
          !PgProgramInfo.uuid ||
          !!PgProgramInfo.lastBuildFailed ||
          // Not watching yet: no build was seen, so build
          !buildSource?.isCurrent(),
        length: null,
      };
    },
    // The build act's own run, so a build-and-deploy names the same error
    build: async () => {
      const built = await runBuild("build", { beatId: "deploy" }, () => {});
      if (built.ok || built.act !== "build") return { ok: true };
      return { ok: false, message: buildFailureOf(built) };
    },
    bytes: async () =>
      PgServer.deploy(needed(PgProgramInfo.uuid, "the build's uuid")),
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
    writeBuffer: async (bytes, onChain, onWrite) => {
      const conn = sending();
      const send = sendAndConfirmTxWithRetriesFor(conn);
      const payer = needed(wallet, "a wallet");
      const program = needed(programPk, "the program id");
      const extra = additionalProgramLen({
        programLen: bytes.length,
        deployed: onChain.deployed,
        onChainLen: onChain.deployed ? onChain.dataLen : undefined,
      });
      // Before the buffer, not beside the upgrade: an extend in the upgrade's
      // block fails with "Program was deployed in this block already"
      if (extra > 0) {
        await send(
          () =>
            BpfLoaderUpgradeable.extendProgram(program, extra, {
              wallet: payer,
              connection: conn,
            }),
          async () => {
            const now = await onChainOf(program.toBase58());
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
      await send(
        () =>
          BpfLoaderUpgradeable.createBuffer(buffer, bufferRent, bytes.length, {
            wallet: payer,
            connection: conn,
          }),
        async () =>
          !!(await readBufferOf(conn).getAccountInfo(buffer.publicKey))
      );
      try {
        target.ensure();
        await BpfLoaderUpgradeable.loadBuffer(buffer.publicKey, bytes, {
          wallet: payer,
          connection: conn,
          onWrite,
          onRateLimit: (retryAfter, reason) =>
            PgTerminal.println(
              `Warning: Reached rate-limits (${reason}), waiting ${retryAfter}s...`
            ),
        });
      } catch (e) {
        // The buffer already holds its rent: give it back before the write's
        // failure stands, as `runDeploy` does for a failed deploy
        const address = buffer.publicKey.toBase58();
        await closeBufferOn(conn)(address, payer).catch((closing) => {
          log.error(closing, {
            report: true,
            context: { stage: "Closing the buffer", buffer: address },
          });
          const readBuffer = readBufferOf(conn);
          PgTerminal.println(
            unclosedBufferLineFor(
              readBuffer === conn ? undefined : readBuffer.rpcEndpoint
            )(address)
          );
        });
        throw e;
      }
      return buffer.publicKey.toBase58();
    },
    deploy: async (buffer, length) => {
      const conn = sending();
      const kp = needed(programKp, "the program keypair");
      const payer = needed(wallet, "a wallet");
      return sendFromBuffer(
        conn,
        () =>
          sendAndConfirmTxWithRetriesFor(conn)(
            () =>
              BpfLoaderUpgradeable.deployProgram(kp, pk(buffer), length, {
                wallet: payer,
                connection: conn,
              }),
            async () => !(await readBufferOf(conn).getAccountInfo(pk(buffer)))
          ),
        buffer,
        kp.publicKey.toBase58(),
        "deploy"
      );
    },
    upgrade: async (buffer) => {
      const conn = sending();
      const program = needed(programPk, "the program id");
      const payer = needed(wallet, "a wallet");
      return sendFromBuffer(
        conn,
        () =>
          sendAndConfirmTxWithRetriesFor(conn)(
            () =>
              BpfLoaderUpgradeable.upgradeProgram(program, pk(buffer), {
                wallet: payer,
                connection: conn,
              }),
            async () => !(await readBufferOf(conn).getAccountInfo(pk(buffer)))
          ),
        buffer,
        program.toBase58(),
        "upgrade"
      );
    },
    // The buffer was written on the run's connection, so it is closed there
    closeBuffer: (buffer) =>
      closeBufferOn(needed(runConnection, "the devnet connection"))(
        buffer,
        needed(wallet, "a wallet")
      ),
    instructions: builtInstructions,
    print: (line) => PgTerminal.println(line),
    report: (error, stage) =>
      log.error(error, { report: true, context: { stage } }),
    now: () => Date.now(),
  };
};

/** A failed build's line on the deploy's failed card */
const buildFailureOf = (r: Extract<RunResult, { act: "build"; ok: false }>) => {
  if (r.reason === "unreachable") return "The build server didn't answer.";
  // TODO(HOO-2661): untested; this module needs the app's globals to load,
  // so an in-source block cannot reach it. The line is the one the
  // tutorial-runs spec names for a build-and-deploy refused for sign-in
  if (r.reason === "signed_out") return "Sign in with GitHub to build.";
  const e = r.error;
  if (!e) return "The build failed. See the terminal.";
  const where = e.line !== null ? ` (line ${e.line})` : "";
  return `The build failed: ${e.code ? `${e.code} ` : ""}${e.message}${where}`;
};

/**
 * A landed deploy with the IDL it put on chain, which the engine keeps. Only
 * an IDL a call can be sent through (`callableIdl`); one that cannot is
 * left out
 */
const withIdl = (result: RunResult): RunResult => {
  const idl = PgProgramInfo.callableIdl();
  return result.ok &&
    (result.act === "deploy" || result.act === "buildDeploy") &&
    idl
    ? { ...result, idl }
    : result;
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
  if (!result.ok && result.act !== "build" && "reason" in result) {
    log.warn(`A tutorial ${act} stopped: ${result.reason}`, {
      context: { message: result.message },
    });
  }
  return withIdl(result);
};

/**
 * The runner the tutorial frame passes to `PgConversation.init`. The build
 * act, whose ticket has not landed, answers "not wired yet".
 */
export const tutorialRunner: Runner = {
  ...actRunner(
    {
      airdrop: (_act, _input, onStage) =>
        runAirdropWith(onStage)(realDeployPort()),
      build: runBuild,
      deploy: runDeployOnDevnet,
      buildDeploy: runDeployOnDevnet,
      run: runOnDevnet(devnetFunding, DEVNET_FAUCET_SOL),
      call: runOnDevnet(devnetFunding, DEVNET_FAUCET_SOL),
    },
    async (act, startedAtMs) => {
      if (act !== "deploy" && act !== "buildDeploy") return null;
      if (PgConnection.cluster !== "devnet") return null;
      const recognised = await recogniseDeploy({
        act,
        programId: PgProgramInfo.pk?.toBase58() ?? null,
        startedAtMs,
        deploySlot: deploySlotOn(PgConnection.current),
        blockTime: (slot) => PgConnection.current.getBlockTime(slot),
        signatures: programSignaturesOn(PgConnection.current),
        instructions: builtInstructions(),
      });
      return recognised && withIdl(recognised);
    }
  ),
  // A funded wallet passes the airdrop card on any known cluster; the deploy after it still refuses off devnet
  isFunded: () =>
    PgConnection.cluster === undefined
      ? Promise.resolve(false)
      : isFundedForDeploy(realDeployPort()),
};

/** The deploy command and the open program, for `watchDeploys` */
export const realDeployWatch = (): DeployWatchPort => ({
  onDidStart: (cb) => PgCommand.deploy.onDidStart(() => cb()),
  onDidFinish: (cb) => PgCommand.deploy.onDidFinish(cb),
  // The command sets "ready" in its own `finally`, before `onDidFinish`
  // fires; `PgDeployHistory.init` relies on the same order
  isIdle: () => PgGlobal.deployState === "ready",
  workspace: () => PgExplorer.currentWorkspaceName ?? undefined,
  cluster: () => PgConnection.cluster ?? undefined,
  idl: () => PgProgramInfo.callableIdl() ?? undefined,
});
