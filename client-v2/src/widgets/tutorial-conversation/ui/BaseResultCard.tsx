/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import { ChevronDown, CircleCheck, CircleX } from "lucide-react";
import { useState } from "react";

import type { Text } from "@/entities/tutorial";
import type {
  AccountOnCard,
  RunResult,
} from "@/features/tutorial-conversation";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Kbd } from "@/shared/ui/kbd";

import BaseTxResultCard from "./BaseTxResultCard";
import { ACTION, ACTION_FILL, ACTION_SOFT, PHONE_CTA } from "./card-action";
import { formatSeconds, Prose, READ } from "./Prose";

export interface BaseResultCardProps {
  result: RunResult;
  /** The account the run left, for a run or a call */
  account?: AccountOnCard;
  /** The definition's line for the failure it plans, when this is it */
  planned: Text | null;
  /** A failure still waiting for Explain or "I'll fix it myself" */
  open: boolean;
  onExplain: () => void;
  onFixMyself: () => void;
  /** Open a file at a line: the compiler's location */
  onShowLine: (file: string, line: number) => void;
  /** Run the act again: a build whose server never answered */
  onRetry: () => void;
}

/** The unreachable build server's line (HOO-2355, designers' BUILD-04) */
export const UNREACHABLE =
  "Build couldn't start. The Playground server didn't answer. Your code is unchanged.";

/** lamports to devnet SOL, as the card prints it */
const sol = (lamports: number) =>
  `${Math.round((lamports / 1e9) * 10000) / 10000} devnet SOL from your wallet`;

type TxResult = Extract<RunResult, { act: "run" | "call" }>;

const isTxResult = (r: RunResult): r is TxResult =>
  r.act === "run" || r.act === "call";

type BuildFailed = Extract<RunResult, { act: "build"; ok: false }>;

/**
 * The compiler's code and line: "E0412 · line 9" on a card that is live or
 * opened, "E0412 on line 9" on a folded record (the prototype's `errorMeta`,
 * f7d42bf2e)
 */
const errorMeta = (r: BuildFailed, expanded: boolean): string =>
  [r.error?.code, r.error?.line != null ? `line ${r.error.line}` : null]
    .filter(Boolean)
    .join(expanded ? " · " : " on ");

/** The head's title and meta for a build's or a deploy's result */
const headOf = (
  r: Exclude<RunResult, TxResult>,
  expanded: boolean
): { title: string; meta: string } => {
  if (r.act === "build") {
    if (r.ok) {
      const count = r.instructions.length;
      const names = r.instructions.join(", ");
      return {
        title: "Build successful",
        meta: `IDL: ${count} ${count === 1 ? "instruction" : "instructions"}${
          names ? ` · ${names}` : ""
        } · ${formatSeconds(r.seconds)}`,
      };
    }
    if (r.reason === "unreachable") {
      return { title: "Build server unreachable", meta: "" };
    }
    return { title: "Build failed", meta: errorMeta(r, expanded) };
  }
  // A deploy or a build-and-deploy
  if (r.ok) {
    return {
      title: r.upgraded ? `Upgraded ${r.programId}` : "Deployed",
      // A deploy recognised after a reload has no known cost
      meta: r.lamports === null ? "" : sol(r.lamports),
    };
  }
  const titles = {
    no_funds: "Not enough devnet SOL",
    no_wallet: "No wallet",
    failed: "Deploy failed",
  } as const;
  return { title: titles[r.reason], meta: r.message };
};

/**
 * What a run came back with, one shape for build, deploy, run and call. This
 * is the shell: the head, and for a failed build the compiler's line, its
 * location as a link, the definition's line when it plans the failure, and
 * Explain and "I'll fix it myself" while it is open. The run tickets (4.1 to
 * 4.3) fill the bodies each result carries.
 *
 * A run's or call's result is `BaseTxResultCard`'s; a deploy's is
 * `BaseDeployResultCard`'s, which `TurnView` picks for it.
 */
const BaseResultCard = ({
  result,
  account,
  planned,
  open,
  onExplain,
  onFixMyself,
  onShowLine,
  onRetry,
}: BaseResultCardProps) => {
  // A folded failed build opens again from its head, to read, never to act
  const [reopened, setReopened] = useState(false);
  if (isTxResult(result)) {
    return <BaseTxResultCard result={result} account={account} />;
  }
  const Icon = result.ok ? CircleCheck : CircleX;
  const failedBuild = result.act === "build" && !result.ok ? result : null;
  const error = failedBuild?.error ?? null;
  // A Base component takes types only from the feature: the slice's entry
  // would load its store
  const unreachable = failedBuild?.reason === "unreachable";
  // Folded, it opens again only when there is something to read
  const foldable =
    !!failedBuild &&
    !unreachable &&
    !open &&
    (failedBuild.error !== null || failedBuild.log !== "");
  const expanded = open || (foldable && reopened);
  const { title, meta } = headOf(result, expanded);
  const headParts = (
    <>
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          result.ok ? "text-success" : "text-error"
        )}
      />
      <span className="text-[0.8125rem] font-label text-foreground">
        {title}
      </span>
      {meta && (
        <span className="truncate text-caption text-muted-foreground">
          {meta}
        </span>
      )}
    </>
  );

  return (
    <div
      role="status"
      className={cn(
        "overflow-hidden rounded-control border bg-surface-panel",
        result.ok ? "border-border" : "border-error/40"
      )}
    >
      {foldable ? (
        <Button
          variant="ghost"
          aria-expanded={reopened}
          onClick={() => setReopened(!reopened)}
          className="h-9 w-full justify-start gap-2 rounded-none px-3 font-normal"
        >
          {headParts}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform",
              reopened && "rotate-180"
            )}
          />
        </Button>
      ) : (
        <div className="flex h-9 items-center gap-2 px-3">{headParts}</div>
      )}
      {open && unreachable && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <p className={READ}>{UNREACHABLE}</p>
          <Button
            className={cn(ACTION, ACTION_FILL, PHONE_CTA, "w-fit")}
            onClick={onRetry}
          >
            Try again
            <Kbd
              aria-hidden="true"
              className="bg-white/15 text-primary-foreground/80"
            >
              ⌘↵
            </Kbd>
          </Button>
        </div>
      )}
      {expanded && failedBuild && !unreachable && (
        <div className="flex flex-col gap-3 border-t border-error/20 px-3 py-3">
          {/* The compiler's words on a red rule, a quote of its output with
              no well (the prototype's ResultCard, f7d42bf2e) */}
          {error && (
            <div className="border-l-2 border-error/40 pl-3 font-mono text-[0.8125rem] leading-[1.6]">
              <p className="break-words text-foreground/90">{error.message}</p>
              {error.file && error.line !== null && (
                <Button
                  variant="link"
                  size="xs"
                  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the guard above narrows both; a closure loses it
                  onClick={() => onShowLine(error.file!, error.line!)}
                  className="h-auto w-fit px-0 font-mono text-[0.8125rem] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
                >
                  {`--> ${error.file}:${error.line}${
                    error.column !== null ? `:${error.column}` : ""
                  }`}
                </Button>
              )}
            </div>
          )}
          {/* No line to link: the log is all the learner has to go on */}
          {!(error?.file && error.line !== null) && failedBuild.log && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[0.75rem] text-muted-foreground">
              {failedBuild.log}
            </pre>
          )}
          {planned && (
            <p className={READ}>
              <Prose text={planned} />
            </p>
          )}
          {open && (
            // One width for both, in one row from `md` up: in a narrow column
            // they give up padding, not the row. Below `md`, Explain alone at
            // the full width and 48 px. No key hint
            // (Design alignment, 5 Nov), though ⌘↵ still presses Explain
            <div className="grid gap-2 md:w-fit md:auto-cols-fr md:grid-flow-col">
              <Button
                className={cn(ACTION, ACTION_FILL, PHONE_CTA)}
                onClick={onExplain}
              >
                Explain the error
              </Button>
              {/* A phone can't type the fix, so it isn't offered there:
                  Explain leads to the lines instead (the prototype's) */}
              <Button
                variant="ghost"
                className={cn(ACTION, ACTION_SOFT, "max-md:hidden")}
                onClick={onFixMyself}
              >
                I&apos;ll fix it myself
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BaseResultCard;
