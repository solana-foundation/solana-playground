import { ExternalLink, Minus, Plus } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useState } from "react";

import { networkInSentence } from "@/constants";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { Badge } from "@/shared/ui/badge";
import { BrandButton } from "@/shared/ui/brand-button";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/shared/ui/input-group";
import { Spinner } from "@/shared/ui/spinner";

import type { Receiver, SendCheck } from "../model/fund";
import {
  canSend,
  formatSol,
  maxAmount,
  parseAmount,
  stepAmountWith,
} from "../model/fund";
import { NO_EXTENSION } from "../model/no-extension";

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
  /** Data URI */
  icon: string;
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
  | { kind: "send-unconfirmed"; signature: string }
  /** A send from an earlier opening has not settled: Send stays off */
  | { kind: "send-pending" };

export interface BaseFundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receiver: Receiver;
  /** Every detected wallet; empty when none is installed */
  wallets: FundWalletOption[];
  /**
   * `undefined` until the user connects a wallet in this dialog; a wallet connected
   * earlier is listed again and must be picked
   */
  payer: FundPayer | undefined;
  /** The Playground's cluster, named beside the amount; `undefined` while unknown */
  cluster: string | undefined;
  amount: string;
  onAmountChange: (amount: string) => void;
  /** Connects the named wallet; the dialog's button waits on it */
  onConnect: (name: string) => Promise<void>;
  /** Sends the amount; the dialog's button waits on it */
  onSend: () => Promise<void>;
  failure: FundFailure | undefined;
  /**
   * The explorer page of an address on the Playground's cluster; `undefined`
   * where the explorer cannot open that cluster, and the address stays text
   */
  addressUrl?: (address: string) => string | undefined;
  /** A phone draws the modal frame's foot: no Cancel, Send across it */
  isPhone?: boolean;
}

const shortAddress = (address: string) =>
  `${address.slice(0, 4)}…${address.slice(-4)}`;

/** A short address, linked to the explorer in a new tab where it can open it */
const AddressLink = ({ address, url }: { address: string; url?: string }) =>
  url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 font-mono text-primary-ink underline-offset-4 hover:underline"
    >
      {shortAddress(address)}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  ) : (
    <span className="font-mono">{shortAddress(address)}</span>
  );

/**
 * Cancel and Send as `BaseModalFrame` draws a brand submit: a ghost Cancel at
 * the brand button's 40 px on a desk; on a phone no Cancel (the dialog's close
 * button is enough) and Send across the foot in the flat accent. Copied rather than
 * built on that frame, which is a widget this feature cannot import.
 */
const DESK_CANCEL =
  "h-10 rounded-full px-4 font-heading text-[0.9375rem] font-act";
const DESK_SEND = "px-5";
const PHONE_SEND = "h-12 w-full rounded-xl text-control";

/** The line under the amount field: a problem, or where the SOL goes */
const amountNoteFor =
  (receiverName: string) =>
  (payer: FundPayer, cluster: string | undefined) =>
  (amount: string): { ok: boolean; error: boolean; text: string } => {
    if (payer.balance === "unavailable") {
      return {
        ok: false,
        error: true,
        text: `Couldn't read ${payer.name}'s balance. Close and open this again to retry.`,
      };
    }
    const check = canSend(
      amount,
      payer.balance === "loading" ? undefined : payer.balance
    );
    if (check.ok) {
      return {
        ok: true,
        error: false,
        text: `Arrives in ${receiverName} on ${
          networkInSentence(cluster) ?? "the Playground's cluster"
        }.`,
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
      // Any zero is a hint, not a mistake: the field starts there, and
      // stepping down lands there
      error: check.problem !== "checking" && check.problem !== "not-positive",
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
      return { title: declinedIn(failure.wallet), detail: undefined };
    case "connect-failed":
      return { title: "Could not connect the wallet.", detail: failure.detail };
    case "send-failed":
      return { title: "Could not send.", detail: failure.detail };
    case "send-unconfirmed":
      return {
        title: "Sent, not confirmed yet.",
        detail: `${failure.signature}. Check it in Explorer before you send again.`,
      };
    case "send-pending":
      return {
        title: "An earlier transfer is still waiting.",
        detail: "Answer it in your wallet, or wait until it settles.",
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
  addressUrl,
  isPhone = false,
}: BaseFundDialogProps) => {
  const [isSending, setIsSending] = useState(false);
  const note = payer
    ? amountNoteFor(receiver.name)(payer, cluster)(amount)
    : undefined;
  const unconfirmed =
    failure?.kind === "send-unconfirmed" || failure?.kind === "send-pending";
  const shown = failure ? failureText(failure) : undefined;
  const max =
    typeof payer?.balance === "number" ? maxAmount(payer.balance) : undefined;
  const lower = stepAmountWith(-1)(amount);
  // Less changes nothing at 0
  const canLower = lower !== amount;

  const handleAmountKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const isModified =
      event.shiftKey || event.altKey || event.metaKey || event.ctrlKey;
    if (isModified) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onAmountChange(stepAmountWith(event.key === "ArrowUp" ? 1 : -1)(amount));
  };

  // BrandButton has no wait of its own, so Send keeps one: a second press
  // while the wallet asks would start a second transfer
  const handleSend = () => {
    setIsSending(true);
    Promise.resolve()
      .then(onSend)
      .catch(reportButtonFailure("send the SOL"))
      .finally(() => setIsSending(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fund your Playground wallet</DialogTitle>
          <DialogDescription>
            Sends SOL from your wallet to <strong>{receiver.name}</strong>{" "}
            <AddressLink
              address={receiver.address}
              url={addressUrl?.(receiver.address)}
            />
            , the account that deploys.
          </DialogDescription>
        </DialogHeader>

        {wallets.length === 0 && (
          <div>
            <p className="font-medium">{NO_EXTENSION.title}</p>
            <p className="text-muted-foreground text-sm">{NO_EXTENSION.hint}</p>
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
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
              From
              <Badge variant="secondary">
                <img src={payer.icon} alt="" className="size-3" />
                {payer.name}
              </Badge>
              <AddressLink
                address={payer.address}
                url={addressUrl?.(payer.address)}
              />
              {" · "}
              {typeof payer.balance === "number"
                ? formatSol(payer.balance)
                : "…"}
            </p>
            <Field data-invalid={note.error || undefined}>
              <FieldLabel htmlFor={AMOUNT_ID}>Amount (SOL)</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id={AMOUNT_ID}
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  aria-invalid={note.error || undefined}
                  onChange={(event) => onAmountChange(event.target.value)}
                  onKeyDown={handleAmountKey}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Less by 0.1 SOL"
                    disabled={!canLower}
                    onClick={() => onAmountChange(lower)}
                  >
                    <Minus />
                  </InputGroupButton>
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="More by 0.1 SOL"
                    onClick={() => onAmountChange(stepAmountWith(1)(amount))}
                  >
                    <Plus />
                  </InputGroupButton>
                  <InputGroupButton
                    disabled={max === undefined}
                    onClick={() => max && onAmountChange(max)}
                  >
                    Max
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
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

        {/* A phone with no payer yet has nothing for the foot to hold */}
        {(!isPhone || payer) && (
          <DialogFooter>
            {!isPhone && (
              <DialogClose asChild>
                <Button variant="ghost" className={DESK_CANCEL}>
                  Cancel
                </Button>
              </DialogClose>
            )}
            {payer && (
              <BrandButton
                variant={isPhone ? "accent" : "ring"}
                // Busy is not unavailable: it keeps its colour, as AsyncButton does
                className={cn(
                  isPhone ? PHONE_SEND : DESK_SEND,
                  isSending && "disabled:opacity-100"
                )}
                disabled={!note?.ok || unconfirmed || isSending}
                aria-busy={isSending || undefined}
                onClick={handleSend}
              >
                {isSending && <Spinner aria-hidden="true" />}
                {sendLabel(amount)}
              </BrandButton>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default BaseFundDialog;
