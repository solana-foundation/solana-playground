import {
  Check,
  ChevronDown,
  CircleX,
  Copy,
  ExternalLink,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import type { RunResult } from "@/features/tutorial-conversation";
import { devnetExplorerUrl } from "@/shared/lib/devnet-explorer";
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
import { CopyButton } from "@/shared/ui/copy-button";

import { formatSeconds, Prose, READ } from "./Prose";

/** A deploy's or a build-and-deploy's result, landed or not */
export type DeployResult = Extract<
  RunResult,
  { act: "deploy" | "buildDeploy" }
>;

/** Where the faucet's card sends the learner for devnet SOL */
export const FAUCET_URL = "https://faucet.solana.com";

export interface BaseDeployResultCardProps {
  result: DeployResult;
  /** A failure that is still the act's latest run, before the step moved on */
  open: boolean;
  /** Open the terminal, where the deploy printed its lines */
  onShowLog: () => void;
  /** Make the Playground wallet, then run the deploy again */
  onCreateWallet: () => Promise<unknown> | void;
}

/** Lamports as SOL, to four places at most */
const sol = (lamports: number) =>
  String(Math.round((lamports / 1e9) * 10000) / 10000);

/** The red head every failed deploy shares, 48 tall while it waits on the learner */
const FailedHead = ({ title, open }: { title: string; open: boolean }) => (
  <div
    className={cn(
      "flex items-center gap-2 bg-error/[0.08]",
      open ? "h-12 px-4" : "h-9 px-3"
    )}
  >
    <CircleX aria-hidden="true" className="size-4 shrink-0 text-error" />
    <span className="text-[0.8125rem] font-label text-foreground">{title}</span>
  </div>
);

const FailedCard = ({
  title,
  open,
  children,
}: {
  title: string;
  open: boolean;
  children: ReactNode;
}) => (
  <div
    role="status"
    className={cn(
      "overflow-hidden border border-error/40 bg-surface-panel",
      open ? "rounded-panel" : "rounded-control"
    )}
  >
    <FailedHead title={title} open={open} />
    {open && (
      <div className="flex flex-col gap-4 border-t border-error/20 px-4 py-4">
        {children}
      </div>
    )}
  </div>
);

/**
 * What a deploy came back with (`tutorial-runs`, "Deploy goes from the
 * learner's wallet on devnet"), drawn as Almaz's prototype has it
 * (`tutorial-v2`, `ResultCard.tsx`; where its SPEC table differs, the code
 * wins). Landed: one row, "Deployed to devnet" or "Upgraded <id>", whose
 * chevron opens what it did, the program's and the transaction's devnet
 * Explorer links, and Log, which opens the terminal. The faucet's red card
 * says how short the wallet is, gives its address to copy and the faucet;
 * the feed's Try again act card under it runs the deploy again. No wallet
 * offers to make one. Once the step moves on, a failure folds to its head.
 */
const BaseDeployResultCard = ({
  result,
  open,
  onShowLog,
  onCreateWallet,
}: BaseDeployResultCardProps) => {
  if (result.ok) return <LandedCard result={result} onShowLog={onShowLog} />;
  switch (result.reason) {
    case "no_funds":
      return (
        <FailedCard title="Not enough devnet SOL" open={open}>
          <p className={READ}>
            {`Your wallet has ${sol(
              result.balance
            )} SOL, and this deploy needs about ${sol(
              result.cost
            )} SOL. The devnet faucet is at its limit for now: try again in a minute, or top the wallet up yourself.`}
          </p>
          <div className="flex w-full items-center gap-3 text-caption">
            <span className="shrink-0 text-muted-foreground">Your wallet</span>
            <code
              title={result.address}
              className="min-w-0 flex-1 truncate font-mono text-[0.75rem] text-foreground"
            >
              {shortKey(result.address)}
            </code>
            <CopyButton
              value={result.address}
              label="Copy the wallet address"
              onError={reportButtonFailure("copy the wallet address")}
            />
          </div>
          <div className="flex max-sm:flex-col max-sm:items-stretch">
            <Button asChild variant="ghost">
              <a href={FAUCET_URL} target="_blank" rel="noreferrer">
                Open faucet
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            </Button>
          </div>
        </FailedCard>
      );
    case "no_wallet":
      return (
        <FailedCard title="No wallet" open={open}>
          <p className={READ}>
            A deploy pays from a Playground wallet. Create one in this browser
            and the deploy runs.
          </p>
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
        </FailedCard>
      );
    case "failed":
      return (
        <FailedCard title="Deploy failed" open={open}>
          <p className="break-words border-l-2 border-error/40 pl-3 font-mono text-[0.8125rem] text-foreground/90">
            {result.message}
          </p>
        </FailedCard>
      );
    default: {
      // A reason `RunResult` adds must get its own card here
      const unknown: never = result;
      return unknown;
    }
  }
};

/** The details' quiet controls: caption size, muted, brightening on hover */
const QUIET =
  "inline-flex items-center gap-1.5 rounded-sm whitespace-nowrap text-[0.875rem] leading-[1.125rem] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11";

/**
 * What a landed deploy did, in one sentence as the prototype's
 * `DeployDetails` says it: where the program lives, what the deploy took
 * and, when known, what it cost
 */
const sentenceOf = (r: Extract<DeployResult, { ok: true }>) => {
  const id = `\`${shortKey(r.programId)}\``;
  const where = r.upgraded
    ? `Your program at ${id} now runs the new code.`
    : `Your program now lives on devnet at ${id}.`;
  let what = "The deploy";
  if (r.upgraded) what = "The upgrade";
  else if (r.act === "buildDeploy") what = "The build and deploy";
  // A deploy recognised from the chain after a reload has no known cost
  const cost =
    r.lamports === null
      ? ""
      : ` and ${sol(r.lamports)} test SOL from your wallet`;
  return `${where} ${what} took ${formatSeconds(r.seconds)}${cost}.`;
};

/**
 * One row, as the prototype's other successful results: the status and the
 * chevron. Where the program lives, what it took, Copy id, the program's and
 * the transaction's Explorer links and Log wait in the details.
 */
const LandedCard = ({
  result,
  onShowLog,
}: {
  result: Extract<DeployResult, { ok: true }>;
  onShowLog: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // "Copied" stands long enough to be read, then Copy id is offered again
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  const title = result.upgraded
    ? `Upgraded ${shortKey(result.programId)}`
    : "Deployed to devnet";
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-control border border-border bg-surface-panel"
    >
      <div role="status">
        <CollapsibleTrigger className="group flex h-9 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-ring max-sm:h-11">
          <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-label text-foreground">
            {title}
          </span>
          <span className="sr-only">Details</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground motion-reduce:transition-none",
              open && "rotate-180"
            )}
          />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mx-3 flex flex-col gap-2 border-t border-border pt-3 pb-3">
          {/* The short id is one chip: broken across lines it reads as two keys */}
          <p className={cn(READ, "text-pretty [&_code]:whitespace-nowrap")}>
            <Prose text={sentenceOf(result)} />
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {/* Labelled, as the prototype's details row: an icon alone read
                as decoration beside Explorer and Log. `CopyButton` draws an
                icon only, and `shared/ui` changes in the design system, not
                here (TODO: a labelled CopyButton there) */}
            <button
              type="button"
              aria-label="Copy id"
              onClick={() => {
                Promise.resolve()
                  .then(() => navigator.clipboard.writeText(result.programId))
                  .then(() => setCopied(true))
                  .catch(reportButtonFailure("copy the program id"));
              }}
              className={QUIET}
            >
              {copied ? (
                <Check aria-hidden="true" className="size-3.5" />
              ) : (
                <Copy aria-hidden="true" className="size-3.5" />
              )}
              <span aria-live="polite">{copied ? "Copied" : "Copy id"}</span>
            </button>
            <a
              href={devnetExplorerUrl({
                kind: "address",
                value: result.programId,
              })}
              target="_blank"
              rel="noreferrer"
              className={QUIET}
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
              Explorer
            </a>
            <a
              href={devnetExplorerUrl({ kind: "tx", value: result.signature })}
              target="_blank"
              rel="noreferrer"
              title={result.signature}
              className={QUIET}
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
              Transaction
            </a>
            <button
              type="button"
              onClick={onShowLog}
              className={cn(QUIET, "ml-auto")}
            >
              Log
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default BaseDeployResultCard;
