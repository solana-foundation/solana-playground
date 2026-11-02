import { useEffect, useRef, useState } from "react";

import { useRenderOnChange } from "@/hooks";
import { createLogger } from "@/shared/lib/logger";
import { PgConnection, PgView, PgWallet, PgWeb3 } from "@/utils";
import type { StandardWallet } from "@/utils/wallet/types";
import {
  classify,
  DEFAULT_AMOUNT,
  formatSol,
  parseAmount,
  receiverOf,
} from "../model/fund";
import type { FailureReason } from "../model/fund";
import { fundTelemetry } from "../model/telemetry";
import type { FundCluster } from "../model/telemetry";
import { sendFunds, TransferNotConfirmedError } from "../model/transfer";
import BaseFundDialog from "./BaseFundDialog";
import type { FundFailure, FundPayer } from "./BaseFundDialog";

const log = createLogger("fund-wallet:dialog");

export interface FundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The receiver `deploy` pays from, read from `PgWallet` */
const currentReceiver = () => {
  const current = PgWallet.current;
  const first = PgWallet.accounts[0];
  return receiverOf({
    // Only a Playground wallet can receive; an extension's key is null while
    // it disconnects, before `PgWallet` hands back to the Playground wallet
    current: current?.isPg
      ? {
          isPg: true,
          name: current.name,
          address: current.publicKey.toBase58(),
        }
      : null,
    firstAccount: first
      ? {
          name: first.name,
          address: PgWallet.create(first).publicKey.toBase58(),
        }
      : null,
  });
};

/**
 * The wallet the user picked in this dialog, once connected. Never one picked
 * for them: an extension that is the current wallet is offered like the rest,
 * so the user can pay from another one beside it
 */
const pickedWallet = (wallets: StandardWallet[], name: string | null) =>
  wallets.find((w) => w.connected && w.name === name) ?? null;

const describe = (error: unknown) => {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
};

const failureOf = (
  stage: "connect" | "send",
  reason: FailureReason,
  error: unknown,
  wallet: string
): FundFailure => {
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
const logFailure = (
  stage: "connect" | "send",
  reason: FailureReason,
  error: unknown
) => {
  if (reason === "rejected") log.info(`${stage} declined`);
  else log.error(error, { report: true, context: { stage, reason } });
};

/**
 * The Fund dialog, connected: wallets from `PgWallet.standardWallets` (found
 * through ConnectorKit by `entities/external-wallet`), the payer connected
 * through its own `connect()` so `PgWallet.state` never changes, and the
 * transfer through `PgTx` on the Playground's cluster.
 */
const FundDialog = ({ open, onOpenChange }: FundDialogProps) => {
  useRenderOnChange(PgWallet.onDidChangeStandardWallets);
  useRenderOnChange(PgWallet.onDidChangeCurrent);
  // The balance, the check and the note follow a cluster change
  useRenderOnChange(PgConnection.onDidChangeCluster);
  const [payerName, setPayerName] = useState<string | null>(null);
  const [balance, setBalance] = useState<FundPayer["balance"]>("loading");
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [failure, setFailure] = useState<FundFailure | null>(null);
  // Each opening is one attempt; a send that settles after the dialog closed
  // or reopened must not close or mark the dialog the user sees now
  const attempt = useRef(0);

  const wallets = PgWallet.standardWallets;
  const payer = pickedWallet(wallets, payerName);
  const receiver = currentReceiver();
  const cluster = PgConnection.cluster ?? null;

  useEffect(() => {
    attempt.current++;
    if (!open) return;
    fundTelemetry.track("fund_dialog_opened", { from: "account-menu" });
    setFailure(null);
    setAmount(DEFAULT_AMOUNT);
    setPayerName(null);
  }, [open]);

  // The payer's balance on the current cluster; reread when either changes
  const payerAddress = payer?.publicKey?.toBase58() ?? null;
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
    setFailure(null);
    try {
      await wallet.connect();
      if (!wallet.connected) throw new Error(`${name} did not connect.`);
    } catch (error: unknown) {
      const reason = classify(error);
      fundTelemetry.track("fund_failed", { stage: "connect", reason });
      logFailure("connect", reason, error);
      setFailure(failureOf("connect", reason, error, name));
      return;
    }
    fundTelemetry.track("fund_wallet_connected", { wallet: name });
    setPayerName(name);
  };

  const send = async () => {
    const parsed = parseAmount(amount);
    if (!parsed.ok) return;
    if (!payer?.connected) {
      setFailure({ kind: "send-failed", detail: "The wallet disconnected." });
      setPayerName(null);
      return;
    }
    const mine = attempt.current;
    // Read once, so the toast and the event name the cluster the send used
    const sentOn = PgConnection.cluster;
    setFailure(null);
    try {
      await sendFunds({
        payer: payer as StandardWallet<true>,
        to: receiver.address,
        lamports: parsed.lamports,
      });
    } catch (error: unknown) {
      const reason = classify(error);
      fundTelemetry.track("fund_failed", { stage: "send", reason });
      logFailure("send", reason, error);
      if (attempt.current === mine)
        setFailure(failureOf("send", reason, error, payer.name));
      return;
    }
    // `PgConnection.cluster` is null only before the first endpoint is read
    if (sentOn)
      fundTelemetry.track("fund_sent", { cluster: sentOn as FundCluster });
    PgView.setToast(
      () => <span>{`Sent ${formatSol(parsed.sol)} to ${receiver.name}.`}</span>,
      { options: { name: "fund-sent" } }
    );
    if (attempt.current === mine) onOpenChange(false);
  };

  const payerView: FundPayer | null = payer?.publicKey
    ? { name: payer.name, address: payer.publicKey.toBase58(), balance }
    : null;

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
    />
  );
};

export default FundDialog;
