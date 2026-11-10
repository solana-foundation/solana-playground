import { createLogger, toError } from "@/shared/lib/logger";
import { networkHold } from "@/widgets/status";

import { PgSession } from "../../features/auth";
import {
  PgCommand,
  PgCommon,
  PgConnection,
  PgGlobal,
  PgProgramInfo,
  PgServer,
  PgTerminal,
  PgTx,
  PgView,
  PgWallet,
  PgWeb3,
  SyncOrAsync,
  Wallet,
} from "../../utils";
import { StoppedError, throwIfStopped } from "../../utils/stopped";
import { isAirdropSignInGated } from "../airdrop/sign-in-gate";
import { withAirdropVia } from "../airdrop/via";
import { checkWallet } from "../checks";
import { createCmd } from "../create";
import { additionalProgramLen } from "./additional-len";
import { airdropTopUp } from "./airdrop-top-up";
import { BpfLoaderUpgradeable } from "./bpf-loader-upgradeable";
import { MAINNET_DEPLOY_WARNING, warnsOnDeploy } from "./mainnet-warning";
import { NetworkRefusedError } from "./network-refused";
import { forgetOpenBuffer, recordOpenBuffer } from "./open-buffers";
import type { DeployResult, FundingFailure } from "./run";
import { DeployCancelledError, DeployFundingError, PgDeployRun } from "./run";
import type { StoppedBuffer } from "./stopped";
import {
  bufferLeftLine,
  closeBuffersCommandFor,
  deployStoppedLine,
} from "./stopped";

const log = createLogger("commands:deploy");

const reclaimRejectedLineFor = (readBufferUrl: string | undefined) =>
  `${PgTerminal.error("Reclaim rejected.")} Run \`${closeBuffersCommandFor(
    readBufferUrl
  )}\` to close unused buffer accounts and reclaim SOL.`;

export const deploy = createCmd({
  name: "deploy",
  description: "Deploy your program",
  needsConnection: true,
  preChecks: [checkNetwork, checkWallet, checkProgram],
  stoppable: true,
  handle: async ({ signal, lockStop }): Promise<DeployResult | undefined> => {
    switch (PgGlobal.deployState) {
      case "ready":
        PgGlobal.update({ deployState: "loading" });
        break;
      case "loading":
        PgGlobal.update({ deployState: "paused" });
        return;
      case "paused":
        PgGlobal.update({ deployState: "loading" });
        return;
      case "cancelled":
        throw new Error("Deployment has been cancelled.");
    }

    PgView.setMainSecondaryProgress(0.1);
    if (warnsOnDeploy(PgConnection.cluster)) {
      PgTerminal.println(PgTerminal.warning(MAINNET_DEPLOY_WARNING));
    }
    PgTerminal.println(
      `${PgTerminal.info(
        "Deploying..."
      )} This could take a while depending on the program size and network conditions.`
    );

    try {
      const startTime = performance.now();
      const result = await processDeploy(lockStop, signal);
      const timePassed = (performance.now() - startTime) / 1000;
      PgTerminal.println(
        `${PgTerminal.success(
          "Deployment successful."
        )} Completed in ${PgCommon.formatSeconds(timePassed)}.`
      );
      return result;
    } finally {
      PgView.setMainSecondaryProgress(0);
      PgDeployRun.reset();
      PgGlobal.update({ deployState: "ready" });
    }
  },
});

/**
 * End a deploy before it asks the faucet, when the network changed since it
 * started: the airdrop funds the network selected now, while the run sends
 * on its own
 */
function throwIfNetworkChanged(connection: typeof PgConnection.current) {
  // A commitment change makes a new connection to the same endpoint
  if (PgConnection.current.rpcEndpoint !== connection.rpcEndpoint) {
    throw new Error(
      "The network changed during the deploy, so an airdrop would fund another network. Deploy again."
    );
  }
}

/**
 * The network `connection` points at. Read from its own endpoint:
 * `PgConnection.cluster` is derived asynchronously and can still name the
 * previous network right after a switch.
 */
async function clusterOf(
  connection: typeof PgConnection.current
): Promise<DeployResult["cluster"]> {
  try {
    return await PgConnection.getCluster(connection.rpcEndpoint);
  } catch (error) {
    // A custom endpoint whose genesis hash cannot be read: the deploy itself
    // goes on, its network unknown. The network selected now may be another
    // one, so a record under it would be the wrong-network record this
    // function exists to prevent.
    log.warn("could not read the deploy's cluster; it is not recorded", {
      context: { error: String(error) },
    });
    // eslint-disable-next-line unicorn/no-null -- `DeployResult.cluster` is `null` for an unknown network
    return null;
  }
}

/**
 * Refuses a deploy the status says cannot reach the network, wherever it was
 * asked for: the stage's pill is held, but the assistant's tool, the file menu
 * and the terminal all come through here. Only a fresh start is refused: the
 * same command pauses and resumes a run under way.
 */
function checkNetwork() {
  if (PgGlobal.deployState !== "ready") return;
  const hold = networkHold(
    {
      name: PgConnection.cluster ?? "unknown",
      isConnected: PgConnection.isConnected,
      slotStalled: PgConnection.isClusterDown,
    },
    navigator.onLine
  );
  if (hold)
    throw new NetworkRefusedError(`${hold}. Deploy waits for the network.`);
}

/** Check whether the state is valid for deployment. */
async function checkProgram() {
  if (!PgProgramInfo.uuid && !PgProgramInfo.importedProgram?.bytes.length) {
    PgTerminal.println(PgTerminal.warning("Warning: Program is not built."), {
      noColor: true,
    });
    await PgCommand.build.execute();
  }

  // The server keeps the previous program binary after a failed compilation, so
  // /deploy would silently return the stale binary. Ask the user about whether
  // to proceed with the deployment using the server-cached binary.
  if (
    PgProgramInfo.lastBuildFailed &&
    !PgProgramInfo.importedProgram?.bytes.length
  ) {
    // A caller with its own answers (the Deploy stage) asks in its own UI
    const answers = PgDeployRun.answers;
    if (answers) {
      if (!(await answers.confirmStaleBuild())) {
        throw new DeployCancelledError();
      }
    } else {
      PgTerminal.println(
        PgTerminal.warning(
          "Warning: Your last build failed. Deploying now will upload the last successful build, not the current sources."
        ),
        { noColor: true }
      );
      const term = await PgTerminal.get();
      const proceed = await term.waitForInput(
        "Deploy the previously built binary anyway?",
        { confirm: true, default: "no" }
      );
      if (!proceed) throw new DeployCancelledError();
    }
  }

  if (!PgProgramInfo.pk) {
    throw new Error(
      "Program ID not found. Build the program first: the build creates its keypair."
    );
  }

  if (!PgProgramInfo.onChain) {
    throw new Error(
      "Could not fetch on-chain data. Try using a different RPC provider with 'solana config set -u <RPC_URL>' command."
    );
  }

  if (!PgProgramInfo.onChain.deployed) {
    if (!PgProgramInfo.kp) {
      throw new Error(
        "Initial deployment needs a keypair but you've only provided a public key."
      );
    }

    if (!PgProgramInfo.kp.publicKey.equals(PgProgramInfo.pk)) {
      throw new Error(
        `Entered program ID doesn't match the program ID derived from program's keypair.
You can fix this in 3 different ways:

1. Remove the custom program ID from Program ID
2. Import the program keypair for the current program ID
3. Create a new program keypair`
      );
    }
  }

  if (!PgProgramInfo.onChain.upgradable) {
    throw new Error("The program is not upgradable.");
  }

  const authority = PgProgramInfo.onChain.authority;
  if (authority && !authority.equals(PgWallet.current!.publicKey)) {
    throw new Error(`You don't have the authority to upgrade this program.
Program ID: ${PgProgramInfo.pk}
Program authority: ${authority}
Your address: ${PgWallet.current!.publicKey}`);
  }
}

/**
 * Deploy the current program.
 *
 * @param lockStop called once the final deploy or upgrade begins, which
 * cannot stop
 * @param signal a stop ends the deploy while it funds the wallet or writes
 * the buffer (Spec 03's Cancel): at the next transaction, or between chunks
 */
const processDeploy = async (
  lockStop: () => void,
  signal: AbortSignal
): Promise<DeployResult> => {
  const programBytes =
    PgProgramInfo.importedProgram?.bytes ??
    (await PgServer.deploy(PgProgramInfo.uuid!));
  const programLen = programBytes.length;

  const wallet = PgWallet.current!;
  const [pgWallet, standardWallet] = wallet.isPg
    ? [wallet, null]
    : [PgWallet.create(PgWallet.accounts[0]), wallet];

  // Decide whether it's an initial deployment or an upgrade and calculate
  // how much SOL user needs before creating the buffer. The run keeps this
  // connection and what the program info says about its network: a network
  // change from here on must not split it across two networks.
  const connection = PgConnection.current;
  // The platform RPC does not return fresh buffers
  const bufferConnection = PgConnection.getReadBufferConnection(connection);
  const readBufferUrl =
    bufferConnection === connection ? undefined : bufferConnection.rpcEndpoint;
  const onChain = PgProgramInfo.onChain;
  if (!onChain) throw new Error("Failed to get on-chain program info");
  const programExists = onChain.deployed;
  const additionalLen = getAdditionalLen(programLen);
  const sendAndConfirmTxWithRetries =
    sendAndConfirmTxWithRetriesFor(connection);
  const [userBalance, bufferBalance, cluster] = await Promise.all([
    connection.getBalance(wallet.publicKey),
    connection.getMinimumBalanceForRentExemption(
      PgWeb3.BpfLoaderUpgradeableProgram.getBufferAccountSize(programLen)
    ),
    clusterOf(connection),
  ]);

  // Nothing is sent yet; a stop here leaves nothing behind
  throwIfStopped(signal, deployStoppedLine({ state: "none" }));

  // Get the balance required to deploy/upgrade (without fees)
  PgDeployRun.update({ upgrade: programExists });
  const requiredBalanceWithoutFees =
    additionalLen > 0
      ? bufferBalance +
        (await connection.getMinimumBalanceForRentExemption(additionalLen))
      : bufferBalance;
  if (userBalance < requiredBalanceWithoutFees) {
    throwIfNetworkChanged(connection);
    const formatBalance = (lamports: number) => {
      return PgWeb3.lamportsToSol(lamports).toFixed(2);
    };

    const msg = `${
      programExists ? "Upgrading" : "Initial deployment"
    } requires ${formatBalance(
      requiredBalanceWithoutFees
    )} SOL but you have ${formatBalance(userBalance)} SOL.\n${
      programExists
        ? "This is only a temporary cost; most of the funds will be returned when the upgrade completes."
        : "This is the cost to store the program on-chain. You can reclaim the funds by closing the program later."
    }`;
    const airdropAmount = PgConnection.getAirdropAmount();
    const answers = PgDeployRun.answers;
    const shortWith = (cause: string | null) => (reason: FundingFailure) =>
      new DeployFundingError({
        reason,
        balance: userBalance,
        needed: requiredBalanceWithoutFees,
        address: wallet.publicKey.toBase58(),
        cause,
      });
    // eslint-disable-next-line unicorn/no-null -- `detail.cause` is `null` when the faucet said nothing, as the funding card reads it
    const short = shortWith(null);
    if (typeof airdropAmount !== "number") {
      if (answers) throw short("no_faucet");
      throw new Error(msg);
    }

    if (answers) {
      // The stage asks nothing. Only a public faucet needs a session
      // (`isAirdropSignInGated`, as the airdrop's own pre-check); the reason
      // is read here, not from that check's message. Signing in from the
      // card is the user's request for SOL, so it comes first.
      if (isAirdropSignInGated(PgConnection.cluster) && !PgSession.get()) {
        throw short("signed_out");
      }
      // Without automatic airdrop the stage stops at its funding card, and
      // only the card's "Request airdrop" press spends faucet quota
      if (!answers.airdrop) throw short("airdrop_off");
      PgTerminal.println(PgTerminal.warning(`Warning: ${msg}`), {
        noColor: true,
      });
      throwIfStopped(signal, deployStoppedLine({ state: "none" }));
    } else {
      const term = await PgTerminal.get();
      term.println(PgTerminal.warning(`Warning: ${msg}`), { noColor: true });
      throwIfStopped(signal, deployStoppedLine({ state: "none" }));
      // A stop while the question is open answers it, as "no" would; the
      // check below then ends the deploy as stopped, before any SOL moves
      const answerNo = () => {
        term.executeFromStr("no").catch((e: unknown) => {
          log.error(e, { context: { action: "answer the airdrop on stop" } });
        });
      };
      signal.addEventListener("abort", answerNo, { once: true });
      let confirmed;
      try {
        confirmed = await term.waitForInput(
          "You don't have enough SOL to complete the deployment. Would you like to request an airdrop?",
          { confirm: true, default: "yes" }
        );
      } finally {
        signal.removeEventListener("abort", answerNo);
      }
      throwIfStopped(signal, deployStoppedLine({ state: "none" }));
      if (!confirmed) throw new Error("Insufficient balance");
    }

    // Request only what the deployment is missing, not the cluster's
    // full faucet default (100 SOL on localnet)
    const amount = airdropTopUp(
      PgWeb3.lamportsToSol(requiredBalanceWithoutFees - userBalance),
      airdropAmount
    );
    // The questions above may have waited for an answer
    throwIfNetworkChanged(connection);
    PgDeployRun.update({ funds: true, step: "funding" });
    try {
      await withAirdropVia(
        () => PgCommand.airdrop.execute(amount.toString()),
        "deploy"
      );
    } catch (e) {
      if (!answers) throw e;
      // The stage shows the faucet's answer on its card; the error and its
      // stack go to the logs, where a faucet regression can be found
      log.error(e, { report: true, context: { what: "stage deploy airdrop" } });
      throw shortWith(e instanceof Error ? e.message : String(e))(
        "airdrop_failed"
      );
    }
  }

  // What the run costs is measured from here on, so an airdrop above is not
  // counted as spent. A standard wallet hands SOL to the Playground wallet,
  // which then pays: the cost is what both spent together.
  const payers = standardWallet
    ? [standardWallet.publicKey, pgWallet.publicKey]
    : [wallet.publicKey];
  const spendable = async () => {
    const balances = await Promise.all(
      payers.map((pk) => connection.getBalance(pk))
    );
    return balances.reduce((sum, b) => sum + b, 0);
  };
  const balanceBefore = await spendable();
  PgDeployRun.update({ step: "buffer" });

  // If deploying from a standard wallet, transfer the required lamports for
  // deployment to the first playground wallet, which allows to deploy without
  // asking for approval.
  if (standardWallet) {
    throwIfStopped(signal, deployStoppedLine({ state: "none" }));
    // Transfer extra 0.1 SOL for fees (doesn't have to get used)
    const requiredBalance =
      requiredBalanceWithoutFees + PgWeb3.solToLamports(0.1);
    const transferIx = PgWeb3.SystemProgram.transfer({
      fromPubkey: standardWallet.publicKey,
      toPubkey: pgWallet.publicKey,
      lamports: requiredBalance,
    });
    await sendAndConfirmTxWithRetries(
      () => PgTx.send(transferIx, { connection }),
      async () =>
        (await connection.getBalance(standardWallet.publicKey)) <
        userBalance - requiredBalance
    );
  }

  // Extend the program data account if needed.
  //
  // NOTE: This ideally would happen just before the upgrade, but doing so
  // results in `Program was deployed in this block already` error.
  if (additionalLen > 0) {
    throwIfStopped(signal, deployStoppedLine({ state: "none" }));
    const programPk = PgProgramInfo.pk;
    if (!programPk) throw new Error("The program ID was not found");
    await sendAndConfirmTxWithRetries(
      async () => {
        return await BpfLoaderUpgradeable.extendProgram(
          programPk,
          additionalLen,
          { wallet: pgWallet, connection }
        );
      },
      // Read on the run's network: the program info follows the one picked
      async () =>
        additionalProgramLen({
          programLen,
          deployed: true,
          onChainLen: await fetchProgramDataLenOn(connection)(programPk),
        }) <= 0
    );
  }

  // Funding is done; a stop here leaves no buffer
  throwIfStopped(signal, deployStoppedLine({ state: "none" }));

  const bufferKp = PgWeb3.Keypair.generate();
  const bufferAddress = bufferKp.publicKey.toBase58();
  // The loader takes a buffer's close from its authority: the Playground
  // wallet, until `setBufferAuthority` below hands it to the standard wallet
  let bufferAuthority: Wallet = pgWallet;
  const recordBuffer = () =>
    recordOpenBuffer({
      address: bufferAddress,
      authority: bufferAuthority.publicKey.toBase58(),
      endpoint: connection.rpcEndpoint,
      cluster,
      at: new Date().toISOString(),
    });
  // Recorded before it exists, so the rent a closed tab or a failed close
  // leaves behind stays on record for a reclaim (none reads it yet)
  await recordBuffer();
  // Whether the buffer surely exists, and whether a stop or a cancel already
  // dealt with it
  let isBufferCreated = false;
  let isBufferSettled = false;

  /**
   * Who may close the buffer now, read from the buffer itself: a
   * `setBufferAuthority` can land while its confirmation fails, and then the
   * standard wallet holds the close although the deploy never learned it. A
   * change is recorded, so a later reclaim signs with the right wallet.
   */
  const closeSigner = async (): Promise<Wallet> => {
    if (!standardWallet) return pgWallet;
    try {
      const account = await bufferConnection.getAccountInfo(bufferKp.publicKey);
      const named = account?.data.slice(5, 37);
      const holder = [standardWallet, pgWallet].find((w) =>
        named?.equals(w.publicKey.toBuffer())
      );
      if (holder && holder !== bufferAuthority) {
        bufferAuthority = holder;
        await recordBuffer();
      }
    } catch (e) {
      log.warn("could not read the buffer's authority", {
        context: { error: String(e) },
      });
    }
    return bufferAuthority;
  };

  /**
   * Close the buffer, or name what it still holds when the close fails. A
   * buffer closed, or found gone, is forgotten; a kept one stays on record
   * for a later reclaim.
   */
  const closeOrKeep = async (action: string): Promise<StoppedBuffer> => {
    let left: StoppedBuffer;
    try {
      const signer = await closeSigner();
      await sendAndConfirmTxWithRetries(
        () =>
          BpfLoaderUpgradeable.closeBuffer(bufferKp.publicKey, {
            wallet: signer,
            connection,
          }),
        async () => !(await bufferConnection.getAccountInfo(bufferKp.publicKey))
      );
      left = { state: "closed" };
    } catch (e) {
      // The line names the buffer, the SOL it holds and how to reclaim it
      // by hand
      log.error(e, {
        report: true,
        context: { action, buffer: bufferAddress },
      });
      const lamports = await keptLamportsOn(bufferConnection)(
        bufferKp.publicKey
      );
      // A live buffer is rent-exempt, so an empty one is gone: the close
      // landed and only its confirmation failed, or, after a failure, the
      // deploy itself consumed it
      if (lamports === 0) {
        left = { state: "gone" };
      } else {
        const sol =
          lamports === undefined ? undefined : PgWeb3.lamportsToSol(lamports);
        left = {
          state: "kept",
          address: bufferAddress,
          sol,
          readBufferUrl,
        };
      }
    }
    if (left.state !== "kept") await forgetOpenBuffer(bufferAddress);
    return left;
  };

  /** End a stopped deploy, closing its buffer so its SOL comes back */
  const stopWithBuffer = async () => {
    isBufferSettled = true;
    const left = await closeOrKeep("close the buffer on stop");
    return new StoppedError(deployStoppedLine(left));
  };

  /**
   * Ask whether to close the buffer and reclaim its SOL, after `heading`. The
   * answer settles the buffer: a rejected reclaim keeps it on record, and a
   * question that never got its answer falls to the failure close.
   */
  const offerReclaim = async (heading: string, action: string) => {
    const term = await PgTerminal.get();
    // A stop while the question is open answers it, as "no" would
    const answerNo = () => {
      term.executeFromStr("no").catch((e: unknown) => {
        log.error(e, { context: { action: "answer the reclaim on stop" } });
      });
    };
    signal.addEventListener("abort", answerNo, { once: true });
    let shouldCloseBufferAccount;
    try {
      shouldCloseBufferAccount = await term.waitForInput(
        `${heading} Would you like to close the buffer account and reclaim SOL?`,
        { confirm: true, default: "yes" }
      );
    } finally {
      signal.removeEventListener("abort", answerNo);
    }
    isBufferSettled = true;
    let msg;
    if (shouldCloseBufferAccount) {
      const left = await closeOrKeep(action);
      // No deploy is in flight before the last write, so a buffer gone is closed
      msg =
        left.state === "kept"
          ? bufferLeftLine(left)
          : PgTerminal.success("Reclaim successful.");
    } else {
      msg = reclaimRejectedLineFor(readBufferUrl);
    }

    term.println(msg);
  };

  /**
   * After a failed load: a caller with its own answers (the Deploy stage)
   * shows no terminal question, so its buffer is closed unasked, and a buffer
   * it could not close is named in the error the stage shows
   * @returns the error the load fails with
   */
  const reclaimAfterFailedLoad = async (loadError: unknown) => {
    const heading = PgTerminal.error("Writing the program failed.");
    if (!PgDeployRun.answers) {
      await offerReclaim(heading, "close the buffer after a failed load");
      return loadError;
    }
    isBufferSettled = true;
    const left = await closeOrKeep("close the buffer after a failed load");
    if (left.state !== "kept") {
      PgTerminal.println(
        `${heading} ${PgTerminal.success("Reclaim successful.")}`
      );
      return loadError;
    }
    return new Error(`${toError(loadError).message} ${bufferLeftLine(left)}`, {
      cause: loadError,
    });
  };

  /**
   * After a failure the buffer is closed as on a stop: left open, it held the
   * whole program's rent at an address shown nowhere. A close racing a deploy
   * still in flight is safe, as both consume the buffer.
   */
  const closeAfterFailure = async () => {
    if (isBufferSettled) return;
    // Read first: with preflight off, a close of an account already gone
    // lands as a failed transaction, and the buffer would read as closed
    let account;
    try {
      account = await bufferConnection.getAccountInfo(bufferKp.publicKey);
    } catch (e) {
      log.error(e, {
        context: { action: "read the buffer after a failed deploy" },
      });
      // An account that cannot be read is named, never closed blind, unless
      // it surely exists
      if (!isBufferCreated) {
        PgTerminal.println(
          bufferLeftLine({
            state: "unknown",
            address: bufferAddress,
            readBufferUrl,
          })
        );
        return;
      }
      account = true;
    }
    if (!account) {
      // A create that failed every retry most likely made no account. One
      // that lands later still holds rent, so the record stays and nothing
      // is said
      if (!isBufferCreated) return;
      // The deploy may have consumed it while its confirmation failed
      await forgetOpenBuffer(bufferAddress);
      PgTerminal.println(bufferLeftLine({ state: "gone" }));
      return;
    }
    const left = await closeOrKeep("close the buffer after a failed deploy");
    PgTerminal.println(bufferLeftLine(left));
  };

  let signature: string | undefined;
  try {
    // Create buffer
    await sendAndConfirmTxWithRetries(
      async () => {
        return await BpfLoaderUpgradeable.createBuffer(
          bufferKp,
          bufferBalance,
          programLen,
          { wallet: pgWallet, connection }
        );
      },
      async () => {
        const bufferAcc = await bufferConnection.getAccountInfo(
          bufferKp.publicKey
        );
        return !!bufferAcc;
      }
    );
    isBufferCreated = true;

    // Load buffer
    PgDeployRun.update({ step: "write", percent: 0 });
    const loadBufferResult = await loadBufferWithControl(
      signal,
      bufferKp.publicKey,
      programBytes,
      {
        wallet: pgWallet,
        connection,
        onWrite: (current, total) => {
          const percent = (current / total) * 100;
          PgView.setMainSecondaryProgress(percent);
          PgDeployRun.update({ percent: Math.floor(percent) });
        },
        onMissing: (missingCount) => {
          PgTerminal.println(
            PgTerminal.warning(
              `Warning: ${missingCount} ${PgCommon.makePlural(
                "transaction",
                missingCount
              )} not confirmed, retrying...`
            ),
            { noColor: true }
          );
        },
        onRateLimit: (retryAfter, reason) => {
          PgTerminal.println(
            PgTerminal.warning(
              `Warning: Reached rate-limits (${reason}), waiting (${PgCommon.formatSeconds(
                retryAfter
              )})...`
            ),
            { noColor: true }
          );
        },
      }
    ).catch(async (e: unknown) => {
      if (signal.aborted) throw await stopWithBuffer();
      // The buffer already holds the program's rent: give it back before the
      // load's failure stands
      let failure = e;
      try {
        failure = await reclaimAfterFailedLoad(e);
      } catch (closing) {
        // An unsettled buffer is still closed by the failure close
        log.error(closing, {
          report: true,
          context: {
            action: "close the buffer after a failed load",
            buffer: bufferAddress,
          },
        });
      }
      throw failure;
    });
    if (loadBufferResult.cancelled) {
      // Stopped: no questions, the buffer is closed
      if (signal.aborted) throw await stopWithBuffer();
      await offerReclaim(
        PgTerminal.warning("Cancelled deployment."),
        "close the buffer on cancel"
      );
      throw new Error("Deployment cancelled");
    }

    // A stop that came as the last chunk landed still ends here; from here the
    // deploy finishes, since its last transactions cannot stop
    if (signal.aborted) throw await stopWithBuffer();
    lockStop();

    // If deploying from a standard wallet, transfer the buffer authority
    // to the standard wallet before deployment, otherwise it doesn't
    // pass on-chain checks.
    if (standardWallet) {
      await sendAndConfirmTxWithRetries(
        async () => {
          return await BpfLoaderUpgradeable.setBufferAuthority(
            bufferKp.publicKey,
            standardWallet.publicKey,
            { wallet: pgWallet, connection }
          );
        },
        async () => {
          const bufferAcc = await bufferConnection.getAccountInfo(
            bufferKp.publicKey
          );
          const isBufferAuthority = bufferAcc?.data
            .slice(5, 37)
            .equals(standardWallet.publicKey.toBuffer());
          return !!isBufferAuthority;
        }
      );
      bufferAuthority = standardWallet;
      await recordBuffer();
    }

    // Deploy
    PgDeployRun.update({ step: "deploy" });
    signature = await (programExists ? upgrade() : deployNew());
  } catch (e) {
    try {
      await closeAfterFailure();
    } catch (closeError) {
      // The deploy's own error is what the person needs to see
      log.error(closeError, {
        report: true,
        context: { action: "settle the buffer after a failed deploy" },
      });
    }
    throw e;
  }
  // The deploy consumed the buffer
  await forgetOpenBuffer(bufferAddress);
  // The program is on chain by now: a failed balance read costs the run its
  // cost figure, never its success, or a retry would pay for an upgrade
  let cost: number | undefined;
  try {
    cost = Math.max(0, balanceBefore - (await spendable()));
  } catch (e) {
    log.warn("could not read the balance after the deploy", {
      context: { error: String(e) },
    });
  }
  return {
    signature: signature ?? undefined,
    cost,
    upgraded: programExists,
    cluster,
  };

  function deployNew() {
    return sendAndConfirmTxWithRetries(
      async () => {
        return await BpfLoaderUpgradeable.deployProgram(
          PgProgramInfo.kp!,
          bufferKp.publicKey,
          programLen,
          { connection }
        );
      },
      async () => {
        const bufferAcc = await bufferConnection.getAccountInfo(
          bufferKp.publicKey
        );
        return !bufferAcc;
      }
    );
  }

  function upgrade() {
    return sendAndConfirmTxWithRetries(
      async () => {
        const programPk = PgProgramInfo.pk;
        if (!programPk) throw new Error("The program ID was not found");
        return await BpfLoaderUpgradeable.upgradeProgram(
          programPk,
          bufferKp.publicKey,
          { connection }
        );
      },
      async () => {
        const bufferAcc = await bufferConnection.getAccountInfo(
          bufferKp.publicKey
        );
        return !bufferAcc;
      }
    );
  }
};

/**
 * The length of a program's data account on `connection`, or `undefined` when
 * the program or its data account is not there
 */
const fetchProgramDataLenOn =
  (connection: PgWeb3.Connection) => async (programPk: PgWeb3.PublicKey) => {
    const program = await connection.getAccountInfo(programPk);
    if (!program) return undefined;
    // An upgradeable program's account holds its data account's address
    const programDataPk = new PgWeb3.PublicKey(program.data.slice(4));
    return (await connection.getAccountInfo(programDataPk))?.data.length;
  };

/** {@link additionalProgramLen} for the current program */
const getAdditionalLen = (programLen: number) => {
  const onChain = PgProgramInfo.onChain;
  if (!onChain) throw new Error("Failed to get on-chain program info");
  return additionalProgramLen({
    programLen,
    deployed: onChain.deployed,
    onChainLen: onChain.programDataLen,
  });
};

/**
 * Load buffer with the ability to pause, resume and cancel on demand, and to
 * stop: a stop ends the write after the chunks in flight, and answers an open
 * "Continue deployment?" with no.
 *
 * TODO(HOO-2394 follow-up): the stop at the pause question has no unit test
 * yet; the manual deploy scenarios cover it until then.
 */
const loadBufferWithControl = (
  signal: AbortSignal,
  ...args: Parameters<typeof BpfLoaderUpgradeable["loadBuffer"]>
) => {
  return new Promise<
    | {
        cancelled: true;
        success?: never;
      }
    | {
        cancelled?: never;
        success: true;
      }
  >(async (res, rej) => {
    try {
      if (signal.aborted) return res({ cancelled: true });

      const abortController = new AbortController();
      args[2] = { ...args[2], abortController };

      const term = await PgTerminal.get();
      // This load segment's stop; a pause ends the segment and removes it
      const stopLoad = () => {
        term.println(PgTerminal.info("Stopping after this step…"), {
          noColor: true,
        });
        abortController.abort();
      };
      signal.addEventListener("abort", stopLoad, { once: true });
      // An abort while the terminal was fetched fired no listener
      if (signal.aborted) stopLoad();

      const handle = async () => {
        if (abortController.signal.aborted) {
          await term.executeFromStr("yes");
          return;
        }

        abortController.abort();
        signal.removeEventListener("abort", stopLoad);
        if (signal.aborted) {
          dispose();
          PgGlobal.update({ deployState: "cancelled" });
          return res({ cancelled: true });
        }

        // A stop while the question is open answers it, as "no" would
        const answerNo = () => {
          term.executeFromStr("no").catch((e: unknown) => {
            log.error(e, { context: { action: "answer the pause on stop" } });
          });
        };
        signal.addEventListener("abort", answerNo, { once: true });
        const shouldContinue = await term.waitForInput("Continue deployment?", {
          confirm: true,
          default: "yes",
        });
        signal.removeEventListener("abort", answerNo);
        dispose();

        if (shouldContinue && !signal.aborted) {
          PgGlobal.update({ deployState: "loading" });
          loadBufferWithControl(signal, ...args).then(res, rej);
        } else {
          PgGlobal.update({ deployState: "cancelled" });
          res({ cancelled: true });
        }
      };

      let prevState = PgGlobal.deployState;
      const { dispose } = PgGlobal.onDidChangeDeployState((state) => {
        if (
          prevState !== state &&
          (prevState === "paused" || state === "paused")
        ) {
          handle().catch(rej);
        }
        prevState = state;
      });

      // A pause aborts the segment too; `handle` settles the promise then
      const paused = () => abortController.signal.aborted && !signal.aborted;
      try {
        await BpfLoaderUpgradeable.loadBuffer(...args);
        if (signal.aborted) res({ cancelled: true });
        else if (!paused()) res({ success: true });
      } catch (e) {
        if (signal.aborted) {
          // A segment can fail as the stop aborts it: still a stop, so the
          // buffer is closed and its SOL comes back
          log.error(e, {
            report: true,
            context: { action: "load the buffer after a stop" },
          });
          res({ cancelled: true });
        } else if (!paused()) {
          rej(e);
        }
      } finally {
        signal.removeEventListener("abort", stopLoad);
        if (!paused()) dispose();
      }
    } catch (e) {
      rej(e);
    }
  });
};

/** How long a stop waits for the kept buffer's balance before it ends */
const KEPT_BALANCE_MS = 5000;

/**
 * What a buffer the stop could not close still holds, for the stopped line.
 * The RPC that failed the close may hang here too, so the read is bounded
 * and the stop never waits on it for long.
 *
 * @returns the lamports, or `undefined` when the cluster did not answer in time,
 * and the line says "its SOL"
 *
 * @param connection the deploy's own: the user may have changed network since,
 * and on another network the buffer reads 0, as if the close had landed
 */
const keptLamportsOn =
  (connection: PgWeb3.Connection) => async (buffer: PgWeb3.PublicKey) => {
    try {
      return await PgCommon.timeout(
        connection.getBalance(buffer),
        KEPT_BALANCE_MS
      );
    } catch (e) {
      // Not reported: the close failure just before it already is, and the
      // line still says what to do
      log.error(e, { context: { action: "read the kept buffer's balance" } });
      return undefined;
    }
  };

/**
 * Send and confirm transaction with retries based on `checkConfirmation`
 * condition.
 *
 * `checkConfirmation` is necessary because `PgTx.confirm` can be unreliable.
 *
 * @param connection the deploy's own: it confirms here, and `sendTx` sends
 * on it too
 * @param sendTx send transaction callback
 * @param checkConfirmation only confirm the transaction if this callback returns truthy
 * @returns the transaction signature
 */
export const sendAndConfirmTxWithRetriesFor =
  (connection: PgWeb3.Connection) =>
  async (
    sendTx: () => Promise<string>,
    checkConfirmation: () => SyncOrAsync<boolean>
  ) => {
    const MAX_RETRIES = 5;
    const SLEEP_MULTIPLIER = 1.8;

    let sleepAmount = 1000;
    let err;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const txHash = await sendTx();
        if (!txHash) return;
        const result = await PgTx.confirm(txHash, { connection });
        if (!result?.err) return txHash;
        if (await checkConfirmation()) return txHash;
      } catch (e: any) {
        log.warn("Deploy transaction attempt failed", {
          context: { error: e, attempt: i + 1, maxAttempts: MAX_RETRIES },
        });
        err = e;
        if (i === MAX_RETRIES - 1) break;
        await PgCommon.sleep(sleepAmount);
        sleepAmount *= SLEEP_MULTIPLIER;
      }
    }

    throw new Error(
      `Exceeded maximum amount of retries (${MAX_RETRIES}).
This might be an RPC related issue. Consider changing the endpoint from the settings.
${err?.message ? `Reason: ${err.message}` : ""}`
    );
  };
