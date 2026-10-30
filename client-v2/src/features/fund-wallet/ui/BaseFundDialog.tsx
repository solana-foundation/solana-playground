import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription, CalloutTitle } from "@/shared/ui/callout";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { canSend, formatSol, parseAmount } from "../model/fund";
import type { Receiver, SendCheck } from "../model/fund";

/** The amount field's id, which the spec and the tests find it by */
export const AMOUNT_ID = "fund-amount";

/** A wallet the dialog can connect to pay */
export interface FundWalletOption {
  name: string;
  /** Data URI */
  icon: string;
}

/** The connected wallet that pays */
export interface FundPayer {
  name: string;
  /** Base58 */
  address: string;
  /** In SOL, or where reading it stands */
  balance: number | "loading" | "unavailable";
}

/** What went wrong last, shown above the footer until the next attempt */
export type FundFailure =
  | { kind: "connect-declined"; wallet: string }
  | { kind: "connect-failed"; detail: string }
  | { kind: "send-declined"; wallet: string }
  | { kind: "send-failed"; detail: string }
  /** Sent, possibly landed: sending again could pay twice, so Send stays off */
  | { kind: "send-unconfirmed"; signature: string };

export interface BaseFundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receiver: Receiver;
  /** Every detected wallet; empty when none is installed */
  wallets: FundWalletOption[];
  /**
   * `null` until the user connects a wallet in this dialog; a wallet connected
   * earlier is listed again and must be picked
   */
  payer: FundPayer | null;
  /** The Playground's cluster, named beside the amount; `null` while unknown */
  cluster: string | null;
  amount: string;
  onAmountChange: (amount: string) => void;
  /** Connects the named wallet; the dialog's button waits on it */
  onConnect: (name: string) => Promise<void>;
  /** Sends the amount; the dialog's button waits on it */
  onSend: () => Promise<void>;
  failure: FundFailure | null;
}

const shortAddress = (address: string) =>
  `${address.slice(0, 4)}…${address.slice(-4)}`;

/** The line under the amount field: a problem, or where the SOL goes */
const amountNote = (
  amount: string,
  payer: FundPayer,
  cluster: string | null
): { ok: boolean; error: boolean; text: string } => {
  if (payer.balance === "unavailable") {
    return {
      ok: false,
      error: true,
      text: `Couldn't read ${payer.name}'s balance. Close and open this again to retry.`,
    };
  }
  const check = canSend(
    amount,
    payer.balance === "loading" ? null : payer.balance
  );
  if (check.ok) {
    return {
      ok: true,
      error: false,
      text: cluster
        ? `Sent on ${cluster}.`
        : "Sent on the Playground's cluster.",
    };
  }
  const notes: Record<Exclude<SendCheck, { ok: true }>["problem"], string> = {
    "not-a-number": "Enter an amount above 0.",
    "not-positive": "Enter an amount above 0.",
    "too-precise": "Use at most 9 decimals.",
    checking: "Checking the balance…",
    "above-balance": `${payer.name} holds ${formatSol(
      typeof payer.balance === "number" ? payer.balance : 0
    )}.`,
  };
  return {
    ok: false,
    error: check.problem !== "checking",
    text: notes[check.problem],
  };
};

/** The shared wallet copy (Spec 12, `wallet`) for a request the user refused */
const declinedIn = (wallet: string) =>
  `You declined in ${wallet}. Nothing was sent.`;

const failureText = (failure: FundFailure) => {
  switch (failure.kind) {
    case "connect-declined":
    case "send-declined":
      return { title: declinedIn(failure.wallet), detail: null };
    case "connect-failed":
      return { title: "Couldn't connect the wallet.", detail: failure.detail };
    case "send-failed":
      return { title: "Couldn't send the SOL.", detail: failure.detail };
    case "send-unconfirmed":
      return {
        title: "The SOL was sent, but not confirmed yet.",
        detail: `Look up ${failure.signature} in an explorer before sending again.`,
      };
  }
};

const sendLabel = (amount: string) => {
  const parsed = parseAmount(amount);
  return parsed.ok ? `Send ${formatSol(parsed.sol)}` : "Send SOL";
};

/**
 * Moves SOL from the user's own wallet into the Playground account that
 * deploys. Built from design-system parts: no funding design exists yet, so
 * the layout is provisional, and where it opens from is the widget's choice
 * and can move without touching this.
 */
const BaseFundDialog = ({
  open,
  onOpenChange,
  receiver,
  wallets,
  payer,
  cluster,
  amount,
  onAmountChange,
  onConnect,
  onSend,
  failure,
}: BaseFundDialogProps) => {
  const note = payer ? amountNote(amount, payer, cluster) : null;
  const unconfirmed = failure?.kind === "send-unconfirmed";
  const shown = failure ? failureText(failure) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fund your Playground wallet</DialogTitle>
          <DialogDescription>
            Sends SOL from your wallet to <strong>{receiver.name}</strong>{" "}
            <span className="font-mono">{shortAddress(receiver.address)}</span>,
            the account that deploys.
          </DialogDescription>
        </DialogHeader>

        {wallets.length === 0 && (
          <div>
            <p className="font-medium">
              No wallet extension found in this browser.
            </p>
            <p className="text-muted-foreground text-sm">
              Install Phantom, Backpack or Solflare, then reload.
            </p>
          </div>
        )}

        {wallets.length > 0 && !payer && (
          <div className="flex flex-col gap-2">
            {wallets.map((wallet) => (
              <AsyncButton
                key={wallet.name}
                variant="outline"
                className="justify-start"
                loadingText={`Waiting for ${wallet.name}…`}
                onClick={() => onConnect(wallet.name)}
                onError={reportButtonFailure(`connect ${wallet.name}`)}
              >
                <img src={wallet.icon} alt="" className="size-4" />
                Connect {wallet.name}
              </AsyncButton>
            ))}
          </div>
        )}

        {payer && note && (
          <>
            <p className="text-sm">
              From <strong>{payer.name}</strong>{" "}
              <span className="font-mono">{shortAddress(payer.address)}</span>
              {" · "}
              {typeof payer.balance === "number"
                ? formatSol(payer.balance)
                : "…"}
            </p>
            <Field data-invalid={note.error || undefined}>
              <FieldLabel htmlFor={AMOUNT_ID}>Amount (SOL)</FieldLabel>
              <Input
                id={AMOUNT_ID}
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                aria-invalid={note.error || undefined}
                onChange={(event) => onAmountChange(event.target.value)}
              />
              {note.error ? (
                <FieldError>{note.text}</FieldError>
              ) : (
                <FieldDescription>{note.text}</FieldDescription>
              )}
            </Field>
          </>
        )}

        {payer && cluster === "mainnet-beta" && (
          <Callout variant="warning">
            <CalloutTitle>Mainnet uses real SOL</CalloutTitle>
            <CalloutDescription>
              The Playground wallet's key is kept in this browser, where a
              malicious script could read it. Send only what a deploy needs.
            </CalloutDescription>
          </Callout>
        )}

        {shown && (
          <Callout variant="error">
            <CalloutTitle>{shown.title}</CalloutTitle>
            {shown.detail && (
              <CalloutDescription>{shown.detail}</CalloutDescription>
            )}
          </Callout>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          {payer && (
            <AsyncButton
              disabled={!note?.ok || unconfirmed}
              onClick={onSend}
              onError={reportButtonFailure("send the SOL")}
            >
              {sendLabel(amount)}
            </AsyncButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BaseFundDialog;
