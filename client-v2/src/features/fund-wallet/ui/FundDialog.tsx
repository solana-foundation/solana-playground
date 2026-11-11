import { useEffect, useRef, useState } from "react";

import { useRenderOnChange } from "@/hooks";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { createLogger } from "@/shared/lib/logger";
import {
  PgBlockExplorer,
  PgConnection,
  PgView,
  PgWallet,
  PgWeb3,
} from "@/utils";
import type { StandardWallet } from "@/utils/wallet/types";

import type { FailureReason } from "../model/fund";
import {
  classify,
  DEFAULT_AMOUNT,
  formatSol,
  parseAmount,
} from "../model/fund";
import { currentReceiver } from "../model/receiver";
import type { FundCluster, FundFrom } from "../model/telemetry";
import { fundTelemetry } from "../model/telemetry";
import { sendFunds, TransferNotConfirmedError } from "../model/transfer";
import type { FundFailure, FundPayer } from "./BaseFundDialog";
import BaseFundDialog from "./BaseFundDialog";

const log = createLogger("fund-wallet:dialog");

export interface FundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opened it, for `fund_dialog_opened` */
  from?: FundFrom;
}

/**
 * The wallet the user picked in this dialog, once connected. Never one picked
 * for them: an extension that is the current wallet is offered like the rest,
 * so the user can pay from another one beside it
 */
const pickedWallet = (wallets: StandardWallet[], name: string | undefined) =>
  wallets.find((w) => w.connected && w.name === name);

const describe = (error: unknown) => {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
};

const failureOf =
  (stage: "connect" | "send", reason: FailureReason) =>
  (wallet: string, error: unknown): FundFailure => {
    if (error instanceof TransferNotConfirmedError) {
      return { kind: "send-unconfirmed", signature: error.signature };
    }
    if (stage === "connect") {
      return reason === "rejected"
        ? { kind: "connect-declined", wallet }
        : { kind: "connect-failed", detail: describe(error) };
    }
    return reason === "rejected"
      ? { kind: "send-declined", wallet }
      : { kind: "send-failed", detail: describe(error) };
  };

/** A user's "no" is their choice, not a fault: logged, never reported */
const logFailure =
  (stage: "connect" | "send", reason: FailureReason) => (error: unknown) => {
    if (reason === "rejected") log.info(`${stage} declined`);
    else log.error(error, { report: true, context: { stage, reason } });
  };

/**
 * The Fund dialog, connected: wallets from `PgWallet.standardWallets` (found
 * through ConnectorKit by `entities/external-wallet`), the payer connected
 * through its own `connect()` so `PgWallet.state` never changes, and the
 * transfer through `PgTx` on the Playground's cluster.
 */
const FundDialog = ({
  open,
  onOpenChange,
  from = "account-menu",
}: FundDialogProps) => {
  useRenderOnChange(PgWallet.onDidChangeStandardWallets);
  useRenderOnChange(PgWallet.onDidChangeCurrent);
  // The balance, the check and the note follow a cluster change
  useRenderOnChange(PgConnection.onDidChangeCluster);
  const [payerName, setPayerName] = useState<string | undefined>();
  const [balance, setBalance] = useState<FundPayer["balance"]>("loading");
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const phone = useViewport() === "phone";
  const [failure, setFailure] = useState<FundFailure | undefined>();
  // Each opening is one attempt; a send that settles after the dialog closed
  // or reopened must not close or mark the dialog the user sees now
  const attempt = useRef(0);
  // The last transfer sent but not confirmed. It may have landed, so it
  // outlives closing the dialog and holds Send off until a send confirms
  const unconfirmed = useRef<{ signature: string } | undefined>(undefined);
  const [, rerender] = useState(0);
  // A send still in flight, from this opening or an earlier one: a reopened
  // dialog must not offer a second payment before the first one settles
  const pending = useRef(false);
  const unconfirmedFailure = (): FundFailure | undefined => {
    if (pending.current) return { kind: "send-pending" };
    return unconfirmed.current
      ? { kind: "send-unconfirmed", signature: unconfirmed.current.signature }
      : undefined;
  };
  // A later opening showed the pending notice; once the send settles it
  // shows what is left of it (an unconfirmed signature, or nothing)
  const settledElsewhere = (shown: FundFailure | undefined) =>
    shown?.kind === "send-pending" ? unconfirmedFailure() : shown;

  const wallets = PgWallet.standardWallets;
  const payer = pickedWallet(wallets, payerName);
  const receiver = currentReceiver();
  const cluster = PgConnection.cluster ?? undefined;

  useEffect(() => {
    attempt.current++;
    if (!open) return;
    fundTelemetry.track("fund_dialog_opened", { from });
    setFailure(unconfirmedFailure());
    setAmount(DEFAULT_AMOUNT);
    setPayerName(undefined);
  }, [open, from]);

  // The wallet switching its account emits `connect` (and `disconnect` when it
  // drops); `publicKey` is live, so the address and balance follow a re-render
  useEffect(() => {
    if (!payer) return;
    const refresh = () => rerender((n) => n + 1);
    payer.on("connect", refresh);
    payer.on("disconnect", refresh);
    return () => {
      payer.off("connect", refresh);
      payer.off("disconnect", refresh);
    };
  }, [payer]);

  // The payer's balance on the current cluster; reread when either changes
  const payerAddress = payer?.publicKey?.toBase58();
  useEffect(() => {
    setBalance("loading");
    if (!open || !payerAddress) return;
    let current = true;
    PgConnection.current
      .getBalance(new PgWeb3.PublicKey(payerAddress))
      .then((lamports) => {
        if (current) setBalance(PgWeb3.lamportsToSol(lamports));
      })
      .catch((error: unknown) => {
        log.error(error, { report: true, context: { step: "payer balance" } });
        if (current) setBalance("unavailable");
      });
    return () => {
      current = false;
    };
  }, [open, payerAddress, cluster]);

  if (!receiver) {
    // The menu offers funding only once an account exists (`canFund`)
    if (open) log.warn("fund dialog opened with no Playground account");
    // eslint-disable-next-line unicorn/no-null -- a React component renders nothing with null
    return null;
  }

  const connect = async (name: string) => {
    const wallet = wallets.find((w) => w.name === name);
    if (!wallet) {
      log.warn("picked a wallet that is no longer listed", {
        context: { name },
      });
      setFailure({ kind: "connect-failed", detail: `${name} is gone.` });
      return;
    }
    setFailure(unconfirmedFailure());
    try {
      await wallet.connect();
      if (!wallet.connected) throw new Error(`${name} did not connect.`);
    } catch (error: unknown) {
      const reason = classify(error);
      fundTelemetry.track("fund_failed", { stage: "connect", reason });
      logFailure("connect", reason)(error);
      setFailure(failureOf("connect", reason)(name, error));
      return;
    }
    fundTelemetry.track("fund_wallet_connected", { wallet: name, as: "payer" });
    setPayerName(name);
  };

  const send = async () => {
    const parsed = parseAmount(amount);
    if (!parsed.ok) return;
    if (!payer?.connected) {
      setFailure({ kind: "send-failed", detail: "The wallet disconnected." });
      setPayerName(undefined);
      return;
    }
    const sendingFrom = payer.publicKey?.toBase58();
    if (sendingFrom === undefined || sendingFrom !== payerAddress) {
      // The wallet switched accounts since the dialog showed one; paying
      // from another account than the one the user saw is not a send
      setFailure({
        kind: "send-failed",
        detail: "The wallet account changed. Check the account and try again.",
      });
      return;
    }
    const mine = attempt.current;
    // Read once, so the toast and the event name the cluster the send used
    const sentOn = PgConnection.cluster;
    setFailure(undefined);
    pending.current = true;
    try {
      await sendFunds({
        payer: payer as StandardWallet<true>,
        to: receiver.address,
        lamports: parsed.lamports,
      });
    } catch (error: unknown) {
      pending.current = false;
      const reason = classify(error);
      fundTelemetry.track("fund_failed", { stage: "send", reason });
      logFailure("send", reason)(error);
      if (error instanceof TransferNotConfirmedError) {
        unconfirmed.current = { signature: error.signature };
      }
      if (attempt.current === mine)
        setFailure(failureOf("send", reason)(payer.name, error));
      else setFailure(settledElsewhere);
      return;
    }
    pending.current = false;
    unconfirmed.current = undefined;
    if (attempt.current !== mine) setFailure(settledElsewhere);
    // `PgConnection.cluster` is null only before the first endpoint is read
    if (sentOn)
      fundTelemetry.track("fund_sent", { cluster: sentOn as FundCluster });
    PgView.setToast(
      () => <span>{`Sent ${formatSol(parsed.sol)} to ${receiver.name}.`}</span>,
      { options: { name: "fund-sent" } }
    );
    if (attempt.current === mine) onOpenChange(false);
  };

  const payerView: FundPayer | undefined = payer?.publicKey
    ? {
        name: payer.name,
        icon: payer.icon,
        address: payer.publicKey.toBase58(),
        balance,
      }
    : undefined;

  // An explorer with no page for this cluster (Solscan on a local validator,
  // say) would open mainnet's, so the address then stays text
  const explorer = PgBlockExplorer.current;
  const linkCluster = PgConnection.cluster;
  const addressUrl = (address: string) =>
    explorer.opens(linkCluster)
      ? explorer.getAddressUrl(address, linkCluster)
      : undefined;

  return (
    <BaseFundDialog
      open={open}
      onOpenChange={onOpenChange}
      receiver={receiver}
      wallets={wallets.map((w) => ({ name: w.name, icon: w.icon }))}
      payer={payerView}
      cluster={cluster}
      amount={amount}
      onAmountChange={setAmount}
      onConnect={connect}
      onSend={send}
      failure={failure}
      addressUrl={addressUrl}
      phone={phone}
    />
  );
};

export default FundDialog;
