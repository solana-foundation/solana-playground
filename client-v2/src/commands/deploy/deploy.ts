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
} from "../../utils";
import { PgSession } from "../../features/auth";
import { checkWallet } from "../checks";
import { StoppedError, throwIfStopped } from "../../utils/stopped";
import { createCmd } from "../create";
import { additionalProgramLen } from "./additional-len";
import { airdropTopUp } from "./airdrop-top-up";
import { BpfLoaderUpgradeable } from "./bpf-loader-upgradeable";
import { deployStoppedLine } from "./stopped";
import type { StoppedBuffer } from "./stopped";
import { MAINNET_DEPLOY_WARNING, warnsOnDeploy } from "./mainnet-warning";
import { DeployCancelledError, DeployFundingError, PgDeployRun } from "./run";
import type { DeployResult, FundingFailure } from "./run";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("commands:deploy");

export const deploy = createCmd({
  name: "deploy",
  description: "Deploy your program",
  preChecks: [checkWallet, checkProgram],
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
      const result = await processDeploy(signal, lockStop);
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

/** Check whether the state is valid for deployment. */
async function checkProgram() {
  if (!PgProgramInfo.uuid && !PgProgramInfo.importedProgram?.bytes.length) {
    PgTerminal.println("Warning: Program is not built.");
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
        "Warning: Your last build failed. Deploying now will upload the last successful build, not the current sources."
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
      `Could not fetch on-chain data. Try using a different RPC provider with '${PgTerminal.bold(
        "solana config set -u <RPC_URL>"
      )}' command.`
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

1. Remove the custom program ID from ${PgTerminal.bold("Program ID")}
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
 * @param signal a stop ends the deploy while it funds the wallet or writes
 * the buffer (Spec 03's Cancel): at the next transaction, or between chunks
 * @param lockStop called once the final deploy or upgrade begins, which
 * cannot stop
 */
const processDeploy = async (
  signal: AbortSignal,
  lockStop: () => void
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
  // how much SOL user needs before creating the buffer.
  const connection = PgConnection.current;
  const [userBalance, bufferBalance] = await Promise.all([
    connection.getBalance(wallet.publicKey),
    connection.getMinimumBalanceForRentExemption(
      PgWeb3.BpfLoaderUpgradeableProgram.getBufferAccountSize(programLen)
    ),
  ]);

  // Nothing is sent yet; a stop here leaves nothing behind
  throwIfStopped(signal, deployStoppedLine({ state: "none" }));

  // Get the balance required to deploy/upgrade (without fees)
  const programExists = PgProgramInfo.onChain!.deployed;
  PgDeployRun.update({ upgrade: programExists });
  const additionalLen = getAdditionalLen(programLen);
  const requiredBalanceWithoutFees =
    additionalLen > 0
      ? bufferBalance +
        (await connection.getMinimumBalanceForRentExemption(additionalLen))
      : bufferBalance;
  if (userBalance < requiredBalanceWithoutFees) {
    const formatBalance = (lamports: number) => {
      return PgTerminal.bold(PgWeb3.lamportsToSol(lamports).toFixed(2));
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
    const short = (reason: FundingFailure, cause: string | null = null) =>
      new DeployFundingError({
        reason,
        balance: userBalance,
        needed: requiredBalanceWithoutFees,
        address: wallet.publicKey.toBase58(),
        cause,
      });
    if (typeof airdropAmount !== "number") {
      if (answers) throw short("no_faucet");
      throw new Error(msg);
    }

    if (answers) {
      // The stage funds without a question; the airdrop's sign-in check
      // would throw too, but its reason is read here, not from its message
      if (!PgSession.get()) throw short("signed_out");
      PgTerminal.println(`Warning: ${msg}`);
      throwIfStopped(signal, deployStoppedLine({ state: "none" }));
    } else {
      const term = await PgTerminal.get();
      term.println(`Warning: ${msg}`);
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
    PgDeployRun.update({ funds: true, step: "funding" });
    try {
      await PgCommand.airdrop.execute(amount.toString());
    } catch (e) {
      if (!answers) throw e;
      // The stage shows the faucet's answer on its card; the error and its
      // stack go to the logs, where a faucet regression can be found
      log.error(e, { report: true, context: { what: "stage deploy airdrop" } });
      throw short("airdrop_failed", e instanceof Error ? e.message : String(e));
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
      () => PgTx.send(transferIx),
      () => {
        if (typeof PgWallet.balance !== "number") {
          throw new Error("Could not get wallet balance");
        }

        return (
          PgWeb3.solToLamports(PgWallet.balance) < userBalance - requiredBalance
        );
      }
    );
  }

  // Extend the program data account if needed.
  //
  // NOTE: This ideally would happen just before the upgrade, but doing so
  // results in `Program was deployed in this block already` error.
  if (additionalLen > 0) {
    throwIfStopped(signal, deployStoppedLine({ state: "none" }));
    await sendAndConfirmTxWithRetries(
      async () => {
        return await BpfLoaderUpgradeable.extendProgram(
          PgProgramInfo.pk!,
          additionalLen,
          { wallet: pgWallet }
        );
      },
      () => getAdditionalLen(programLen) <= 0
    );
  }

  // Funding is done; a stop here leaves no buffer
  throwIfStopped(signal, deployStoppedLine({ state: "none" }));

  // Create buffer
  const bufferKp = PgWeb3.Keypair.generate();
  await sendAndConfirmTxWithRetries(
    async () => {
      return await BpfLoaderUpgradeable.createBuffer(
        bufferKp,
        bufferBalance,
        programLen,
        { wallet: pgWallet }
      );
    },
    async () => {
      const bufferAcc = await connection.getAccountInfo(bufferKp.publicKey);
      return !!bufferAcc;
    }
  );

  // Load buffer
  PgDeployRun.update({ step: "write", percent: 0 });
  const loadBufferResult = await loadBufferWithControl(
    signal,
    bufferKp.publicKey,
    programBytes,
    {
      wallet: pgWallet,
      onWrite: (current, total) => {
        const percent = (current / total) * 100;
        PgView.setMainSecondaryProgress(percent);
        PgDeployRun.update({ percent: Math.floor(percent) });
      },
      onMissing: (missingCount) => {
        PgTerminal.println(
          `Warning: ${PgTerminal.bold(
            missingCount.toString()
          )} ${PgCommon.makePlural(
            "transaction",
            missingCount
          )} not confirmed, retrying...`
        );
      },
      onRateLimit: (retryAfter) => {
        PgTerminal.println(
          `Warning: Reached rate-limits, waiting (${PgCommon.formatSeconds(
            retryAfter
          )})...`
        );
      },
    }
  );
  /** End a stopped deploy, closing its buffer so its SOL comes back */
  const stopWithBuffer = async () => {
    let left: StoppedBuffer;
    try {
      await sendAndConfirmTxWithRetries(
        () =>
          BpfLoaderUpgradeable.closeBuffer(bufferKp.publicKey, {
            wallet: pgWallet,
          }),
        async () => !(await connection.getAccountInfo(bufferKp.publicKey))
      );
      left = { state: "closed" };
    } catch (e) {
      // The line names the buffer and how to reclaim it by hand
      log.error(e, {
        report: true,
        context: { action: "close the buffer on stop" },
      });
      left = { state: "kept", address: bufferKp.publicKey.toBase58() };
    }
    return new StoppedError(deployStoppedLine(left));
  };

  if (loadBufferResult.cancelled) {
    // Stopped: no questions, the buffer is closed
    if (signal.aborted) throw await stopWithBuffer();

    const term = await PgTerminal.get();
    const shouldCloseBufferAccount = await term.waitForInput(
      `${PgTerminal.warning(
        "Cancelled deployment."
      )} Would you like to close the buffer account and reclaim SOL?`,
      { confirm: true, default: "yes" }
    );
    let msg;
    if (shouldCloseBufferAccount) {
      await sendAndConfirmTxWithRetries(
        async () => {
          return await BpfLoaderUpgradeable.closeBuffer(bufferKp.publicKey, {
            wallet: pgWallet,
          });
        },
        async () => {
          const bufferAcc = await connection.getAccountInfo(bufferKp.publicKey);
          return !bufferAcc;
        }
      );
      msg = PgTerminal.success("Reclaim successful.");
    } else {
      msg = `${PgTerminal.error(
        "Reclaim rejected."
      )} Run \`solana program close --buffers\` to close unused buffer accounts and reclaim SOL.`;
    }

    term.println(msg);
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
          { wallet: pgWallet }
        );
      },
      async () => {
        const bufferAcc = await connection.getAccountInfo(bufferKp.publicKey);
        const isBufferAuthority = bufferAcc?.data
          .slice(5, 37)
          .equals(standardWallet.publicKey.toBuffer());
        return !!isBufferAuthority;
      }
    );
  }

  // Deploy
  PgDeployRun.update({ step: "deploy" });
  const signature = await (programExists ? upgrade() : deployNew());
  // The program is on chain by now: a failed balance read costs the run its
  // cost figure, never its success, or a retry would pay for an upgrade
  let cost: number | null = null;
  try {
    cost = Math.max(0, balanceBefore - (await spendable()));
  } catch (e) {
    log.warn("could not read the balance after the deploy", {
      context: { error: String(e) },
    });
  }
  return { signature: signature ?? null, cost, upgraded: programExists };

  function deployNew() {
    return sendAndConfirmTxWithRetries(
      async () => {
        return await BpfLoaderUpgradeable.deployProgram(
          PgProgramInfo.kp!,
          bufferKp.publicKey,
          programLen
        );
      },
      async () => {
        const bufferAcc = await connection.getAccountInfo(bufferKp.publicKey);
        return !bufferAcc;
      }
    );
  }

  function upgrade() {
    return sendAndConfirmTxWithRetries(
      async () => {
        return await BpfLoaderUpgradeable.upgradeProgram(
          PgProgramInfo.pk!,
          bufferKp.publicKey
        );
      },
      async () => {
        const bufferAcc = await connection.getAccountInfo(bufferKp.publicKey);
        return !bufferAcc;
      }
    );
  }
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
 * TODO(HOO-2394 follow-up): the stop at the pause question and a failed
 * buffer close have no unit test yet (`deploy.test.ts` covers a load that
 * fails after a stop); the manual deploy scenarios cover them until then.
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
        term.println("Stopping after this step…");
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

/**
 * Send and confirm transaction with retries based on `checkConfirmation`
 * condition.
 *
 * `checkConfirmation` is necessary because `PgTx.confirm` can be unreliable.
 *
 * @param sendTx send transaction callback
 * @param checkConfirmation only confirm the transaction if this callback returns truthy
 * @returns the transaction signature
 */
const sendAndConfirmTxWithRetries = async (
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
      const result = await PgTx.confirm(txHash);
      if (!result?.err) return txHash;
      if (await checkConfirmation()) return txHash;
    } catch (e: any) {
      console.log(e);
      err = e;
      if (i === MAX_RETRIES - 1) break;
      await PgCommon.sleep(sleepAmount);
      sleepAmount *= SLEEP_MULTIPLIER;
    }
  }

  throw new Error(
    `Exceeded maximum amount of retries (${PgTerminal.bold(
      MAX_RETRIES.toString()
    )}).
This might be an RPC related issue. Consider changing the endpoint from the settings.
${err?.message ? `Reason: ${err.message}` : ""}`
  );
};
