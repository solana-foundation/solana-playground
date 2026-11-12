/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import {
  Check,
  ChevronDown,
  CircleX,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import type {
  AccountOnCard,
  RunResult,
} from "@/features/tutorial-conversation";
import { devnetExplorerUrl } from "@/shared/lib/devnet-explorer";
import { DEVNET_FAUCET_SOL, faucetUrlWith } from "@/shared/lib/faucet";
import { airdropCause } from "@/shared/lib/faucet-limit";
import { PROGRAM_LOG, programLogText } from "@/shared/lib/program-log";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { shortKey } from "@/shared/lib/short-key";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";

import BaseAccountView from "./BaseAccountView";
import FaucetSteps from "./FaucetSteps";
import { formatSeconds, Prose, READ } from "./Prose";
import WalletAddress from "./WalletAddress";

type TxResult = Extract<RunResult, { act: "run" | "call" }>;
type Landed = Extract<TxResult, { ok: true }>;
type Failed = Extract<TxResult, { ok: false }>;

/** The head's meta when no instruction was decoded */
const SENT_FROM: Record<TxResult["act"], string> = {
  run: "from client.ts",
  call: "from the chat",
};

/** lamports as test SOL, the way the details sentence says the fee */
const testSol = (lamports: number) => String(lamports / 1e9);

/** Where a run or call came from, for the sentence and a meta fallback */
const FROM: Record<TxResult["act"], string> = {
  run: "client.ts",
  call: "Your call",
};

/**
 * The card's frame, as the prototype's result shell draws it: a status head
 * that opens the details under it, what came back in view below the head,
 * and the details in the same box.
 */
const Shell = ({
  icon,
  title,
  meta,
  failed = false,
  body,
  details,
}: {
  icon: ReactNode;
  title: string;
  meta: ReactNode;
  failed?: boolean;
  body?: ReactNode;
  details?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const status = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 font-heading text-[1rem] leading-[1.5rem] font-medium text-foreground">
          {title}
        </span>
        {meta && (
          <span className="min-w-0 truncate text-[0.875rem] leading-[1.125rem] text-muted-foreground">
            {meta}
          </span>
        )}
      </span>
    </>
  );
  const row = "flex h-9 w-full items-center gap-2 px-3 text-left";
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "overflow-hidden rounded-control border bg-surface-panel",
        failed ? "border-error/40" : "border-border"
      )}
    >
      <div role="status">
        {details ? (
          <CollapsibleTrigger
            className={cn(
              row,
              failed && "bg-error/[0.08]",
              "group transition-colors duration-150 hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-ring"
            )}
          >
            {status}
            <span className="sr-only">Details</span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:text-foreground motion-reduce:transition-none",
                open && "rotate-180"
              )}
            />
          </CollapsibleTrigger>
        ) : (
          <div className={cn(row, failed && "bg-error/[0.08]")}>{status}</div>
        )}
        {body && (
          <div
            className={cn(
              "flex flex-col gap-3 px-3 pb-3",
              failed && "border-t border-error/20 pt-3"
            )}
          >
            {body}
          </div>
        )}
      </div>
      {details && (
        <CollapsibleContent>
          <div className="mx-3 flex flex-col gap-2 border-t border-border pt-3 pb-3">
            {details}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
};

/**
 * The quiet text controls under the details' sentence, as the prototype sets
 * them: the design system's ghost button with its box taken off
 */
const QUIET =
  "h-auto px-0 hover:bg-transparent inline-flex items-center gap-1.5 rounded-sm whitespace-nowrap text-[0.875rem] leading-[1.125rem] text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none";

/** Code in the details' sentence, on the prototype's ringed chip */
const CHIP = "bg-black/35 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)]";

/** lamports as SOL, to at most four places */
const solOf = (lamports: number) =>
  String(Math.round((lamports / 1e9) * 1e4) / 1e4);

/** Copy for a value, reading "Copied" for a moment after it worked */
const CopyText = ({
  value,
  label,
  what,
}: {
  value: string;
  label: string;
  /** What did not happen, for the failure's toast */
  what: string;
}) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  // Through a promise from the start, so a browser with no clipboard (an
  // insecure context) is reported too rather than throwing in the click
  const onCopy = () =>
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(value))
      .then(() => setCopied(true))
      .catch(reportButtonFailure(what));
  return (
    <Button variant="ghost" size="xs" onClick={onCopy} className={QUIET}>
      {copied ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : (
        <Copy aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      )}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
};

/** The transaction's log in a well of its own, for the details' Log */
const LogLines = ({ lines }: { lines: string[] }) => (
  <pre className="mt-3 max-h-48 overflow-auto rounded-[6px] bg-surface-well px-3 py-3 font-mono text-[0.75rem] leading-5 whitespace-pre text-muted-foreground">
    {lines.join("\n")}
  </pre>
);

/** A landed run or call: "Confirmed", the instruction, what the program said */
const LandedCard = ({
  result,
  account,
}: {
  result: Landed;
  account?: AccountOnCard;
}) => {
  const [showLog, setShowLog] = useState(false);
  const ix = result.called[result.called.length - 1]?.instruction ?? null;
  const signature = result.signatures[result.signatures.length - 1] ?? null;
  const receipt = result.receipt ?? {};
  const said = result.line === null ? null : programLogText(result.line);

  const usage: string[] = [];
  if (receipt.computeUnits !== undefined) {
    usage.push(
      `it used ${receipt.computeUnits.toLocaleString("en-US")} compute units`
    );
  }
  if (receipt.fee !== undefined) {
    usage.push(`the fee was ${testSol(receipt.fee)} test SOL from your wallet`);
  }
  const how = usage.join(", and ");
  const sentence = `${FROM[result.act]} ran in ${formatSeconds(
    result.seconds
  )}${ix ? ` and called \`${ix}\`` : ""}.${
    how ? ` ${how[0].toUpperCase()}${how.slice(1)}.` : ""
  }`;

  return (
    <Shell
      icon={
        <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
      }
      title="Confirmed"
      meta={
        ix ? (
          <code className="font-mono text-[0.8125rem]">{ix}</code>
        ) : (
          SENT_FROM[result.act]
        )
      }
      body={
        (said !== null || account) && (
          <>
            {said !== null && (
              <p className="border-l-2 border-success pl-3 font-mono text-[0.8125rem] leading-[1.6] break-words">
                <span className="text-muted-foreground">{PROGRAM_LOG}</span>
                <span className="text-foreground">{said}</span>
              </p>
            )}
            {account && <BaseAccountView account={account} still />}
          </>
        )
      }
      details={
        <Collapsible open={showLog} onOpenChange={setShowLog}>
          <p className={cn(READ, "text-pretty")}>
            <Prose text={sentence} codeClassName={CHIP} />
          </p>
          <div className="mt-2 flex items-center gap-4">
            {signature && (
              <>
                <CopyText
                  value={signature}
                  label="Copy signature"
                  what="copy the signature"
                />
                <Button variant="ghost" size="xs" asChild className={QUIET}>
                  <a
                    href={devnetExplorerUrl({ kind: "tx", value: signature })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="size-3.5"
                    />
                    Explorer
                  </a>
                </Button>
              </>
            )}
            {receipt.log && (
              <CollapsibleTrigger className={cn(QUIET, "group ml-auto")}>
                Log
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-4 transition-transform duration-150 motion-reduce:transition-none",
                    showLog && "rotate-180"
                  )}
                />
              </CollapsibleTrigger>
            )}
          </div>
          {receipt.log && (
            <CollapsibleContent>
              <LogLines lines={receipt.log} />
            </CollapsibleContent>
          )}
        </Collapsible>
      }
    />
  );
};

/** The log line that names the failure: Anchor's error, else the program's exit */
const errorLineOf = (log: string): string | null => {
  const lines = log.split("\n");
  return (
    lines.find((l) => l.includes("AnchorError")) ??
    lines.find((l) => / failed: /.test(l)) ??
    null
  );
};

/**
 * A run or call the faucet left short: what is short, the wallet to top up,
 * and the faucet, as the prototype's "Not enough devnet SOL" card draws it.
 * The act card under it runs again.
 */
const FundsCard = ({
  result,
  onFund,
}: {
  result: Extract<Failed, { reason: "no_funds" }>;
  /** Open the Fund dialog; no button without it */
  onFund?: () => void;
}) => {
  const { balance, cost, address } = result.funding;
  return (
    <Shell
      failed
      icon={
        <CircleX aria-hidden="true" className="size-4 shrink-0 text-error" />
      }
      title="Not enough devnet SOL"
      meta={null}
      body={
        <>
          <p className={READ}>
            {`Your wallet has ${solOf(balance)} SOL, and this ${
              result.act
            } needs about ${solOf(cost)} SOL. ${airdropCause(result.message)}`}
          </p>
          <FaucetSteps />
          {/* As the deploy's card: the whole address, Copy right after it */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
            <span className="shrink-0 text-muted-foreground">Your wallet</span>
            <WalletAddress address={address}>
              {/* 44 px tall under a finger, without growing the row */}
              <span className="ml-2 inline-block align-middle pointer-coarse:[&>button]:-my-3 pointer-coarse:[&>button]:min-h-11">
                <CopyText
                  value={address}
                  label="Copy"
                  what="copy the address"
                />
              </span>
            </WalletAddress>
          </div>
          <div className="flex flex-wrap gap-2 max-sm:flex-col max-sm:items-stretch">
            <Button variant="outline" asChild>
              <a
                href={faucetUrlWith(DEVNET_FAUCET_SOL)("devnet")(address)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open the web faucet
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            </Button>
            {onFund && (
              <Button variant="outline" onClick={onFund}>
                Send from your wallet
              </Button>
            )}
          </div>
        </>
      }
    />
  );
};

/**
 * A run or call devnet has not read back in the read window (HOO-2675): sent,
 * so muted like "No transaction" and not red. The meta's short signature is
 * the Explorer link (Almaz's 3.29 rule: no separate Explorer button), and
 * while it is the live result Check again reads the same transactions again
 * without sending
 */
const UnconfirmedCard = ({
  result,
  onRecheck,
}: {
  result: Extract<Failed, { reason: "unconfirmed" }>;
  onRecheck?: () => void;
}) => {
  const last = result.unconfirmed[result.unconfirmed.length - 1];
  return (
    <Shell
      icon={
        <Clock
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      }
      title="Not confirmed yet"
      meta={
        // The link alone: the body already says why, and on a ~400 px card
        // any words beside it truncated (design alignment, 7 Nov)
        last && (
          <span className="flex items-baseline gap-2">
            <span aria-hidden="true">·</span>
            <a
              href={devnetExplorerUrl({ kind: "tx", value: last.signature })}
              target="_blank"
              rel="noopener noreferrer"
              title={last.signature}
              className="shrink-0 font-mono underline-offset-2 hover:underline"
            >
              {`${shortKey(last.signature)} ↗`}
            </a>
          </span>
        )
      }
      body={
        <>
          <p className={READ}>{result.message}</p>
          {onRecheck && (
            <div className="flex">
              <Button onClick={onRecheck}>Check again</Button>
            </div>
          )}
        </>
      }
    />
  );
};

/** A run or call that failed, or that sent nothing */
const FailedCard = ({
  result,
  exists,
  onRecheck,
  onFund,
  onCreateWallet,
}: {
  result: Failed;
  exists?: string;
  onRecheck?: () => void;
  onFund?: () => void;
  onCreateWallet?: () => Promise<unknown> | void;
}) => {
  if (result.reason === "unconfirmed") {
    return <UnconfirmedCard result={result} onRecheck={onRecheck} />;
  }
  // The goal accepts it: the account it creates was already there
  if (exists !== undefined) {
    return (
      <Shell
        icon={
          <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
        }
        title="Already exists"
        meta={
          "exists" in result && result.exists ? (
            <code className="font-mono text-[0.8125rem]">
              {result.exists.account}
            </code>
          ) : null
        }
        body={
          <p className={READ}>
            <Prose text={exists} codeClassName={CHIP} />
          </p>
        }
      />
    );
  }
  if (result.reason === "no_transaction") {
    return (
      <Shell
        icon={
          <Eye
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        }
        title="No transaction"
        meta={`${
          result.act === "run" ? "client.ts" : "the call"
        } sent none · see the terminal`}
      />
    );
  }
  if (result.reason === "no_funds") {
    return <FundsCard result={result} onFund={onFund} />;
  }
  let title = result.act === "run" ? "Run failed" : "Call failed";
  if (result.reason === "no_wallet") title = "No wallet";
  const error = result.refused?.error;
  // A card titled by its reason says the rest in its body, once
  let meta: string | null = result.reason ? null : result.message;
  if (error?.name) meta = `${error.name} · error ${error.code}`;
  const errorLine = errorLineOf(result.log);
  const lines = result.log ? result.log.split("\n") : [];
  return (
    <Shell
      failed
      icon={
        <CircleX aria-hidden="true" className="size-4 shrink-0 text-error" />
      }
      title={title}
      meta={meta}
      body={
        <>
          {errorLine && (
            <p className="border-l-2 border-error/40 pl-3 font-mono text-[0.8125rem] leading-[1.6] break-words text-foreground/90">
              {errorLine}
            </p>
          )}
          {/* The head's meta truncates; the whole reason reads here */}
          <p className={READ}>{result.message}</p>
          {/* As the deploy's card: the wallet, then the act runs again */}
          {result.reason === "no_wallet" && onCreateWallet && (
            <div className="flex max-sm:flex-col max-sm:items-stretch">
              <AsyncButton
                onClick={async () => {
                  await onCreateWallet();
                }}
                onError={reportButtonFailure("create the wallet")}
              >
                <Wallet aria-hidden="true" className="size-4" />
                Create wallet
              </AsyncButton>
            </div>
          )}
        </>
      }
      details={
        lines.length ? (
          <>
            <p className={READ}>
              {`${FROM[result.act]} ran in ${formatSeconds(result.seconds)}.`}
            </p>
            <LogLines lines={lines} />
          </>
        ) : undefined
      }
    />
  );
};

/**
 * A run's or a call's result, as Almaz's tutorial-v2 prototype draws it
 * (`ResultCard`, "Tx ok" and the failure card): the head says what happened,
 * the program's line or the error stays in view, and how it went (the
 * sentence with compute units and fee, Copy signature, Explorer, the log)
 * waits behind the head's chevron.
 *
 * TODO(tutorial-flow-v2 3.6): the prototype's failure card carries "Explain
 * the error" and "I'll fix it myself" while it is live; they arrive with the
 * assistant. An older card does not fold to its head yet.
 */
const BaseTxResultCard = ({
  result,
  account,
  exists,
  onRecheck,
  onFund,
  onCreateWallet,
}: {
  result: TxResult;
  account?: AccountOnCard;
  /** The line for an account the goal creates that was already there */
  exists?: string;
  /** Check again on an unconfirmed result; absent when it is not live */
  onRecheck?: () => void;
  /** Open the Fund dialog from a short-wallet card */
  onFund?: () => void;
  /** Create wallet on a run or call that found none; absent when it is not live */
  onCreateWallet?: () => Promise<unknown> | void;
}) =>
  result.ok ? (
    <LandedCard result={result} account={account} />
  ) : (
    <FailedCard
      result={result}
      exists={exists}
      onRecheck={onRecheck}
      onFund={onFund}
      onCreateWallet={onCreateWallet}
    />
  );

export default BaseTxResultCard;
