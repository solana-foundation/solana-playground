import { CircleCheck, CircleX } from "lucide-react";

import type { Text } from "@/entities/tutorial";
import type { RunResult } from "@/features/tutorial-conversation";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Kbd } from "@/shared/ui/kbd";
import { Prose, READ, formatSeconds } from "./Prose";

export interface BaseResultCardProps {
  result: RunResult;
  /** The definition's line for the failure it plans, when this is it */
  planned: Text | null;
  /** A failure still waiting for Explain or "I'll fix it myself" */
  open: boolean;
  onExplain: () => void;
  onFixMyself: () => void;
  /** Open a file at a line: the compiler's location */
  onShowLine: (file: string, line: number) => void;
}

/** lamports to devnet SOL, as the card prints it */
const sol = (lamports: number) =>
  `${Math.round((lamports / 1e9) * 10000) / 10000} devnet SOL from your wallet`;

/** The head's title and meta for a result */
const headOf = (r: RunResult): { title: string; meta: string } => {
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
    const where = [
      r.error?.code,
      r.error?.line !== null && r.error?.line !== undefined
        ? `line ${r.error.line}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return { title: "Build failed", meta: where };
  }
  if (r.act === "deploy" || r.act === "buildDeploy") {
    if (r.ok) {
      return {
        title: r.upgraded ? `Upgraded ${r.programId}` : "Deployed",
        meta: sol(r.lamports),
      };
    }
    const titles = {
      no_funds: "Not enough devnet SOL",
      no_wallet: "No wallet",
      failed: "Deploy failed",
    } as const;
    return { title: titles[r.reason], meta: r.message };
  }
  if (r.ok) {
    return {
      title: "Confirmed",
      meta: r.act === "run" ? "from client.ts" : "from the chat",
    };
  }
  if ((r.act === "run" || r.act === "call") && r.refused) {
    const { instruction, error } = r.refused;
    return {
      title: `${instruction} refused`,
      meta: error
        ? [error.name, String(error.code)].filter(Boolean).join(" · ")
        : r.message,
    };
  }
  return {
    title: r.act === "run" ? "Run failed" : "Call failed",
    meta: r.message,
  };
};

/**
 * What a run came back with, one shape for build, deploy, run and call. This
 * is the shell: the head, and for a failed build the compiler's line, its
 * location as a link, the definition's line when it plans the failure, and
 * Explain and "I'll fix it myself" while it is open. The run tickets (4.1 to
 * 4.3) fill the bodies each result carries.
 *
 * TODO(tutorial-flow-v2 4.2): an open failed deploy, run or call draws no
 * button yet. Its card is the run tickets' (4.2: Try again and Open faucet;
 * 4.3: a failed transaction). In Hello Anchor, the one definition so far, no
 * deploy, run or call act is reachable before step 1's build passes, which
 * needs a wired runner.
 */
const BaseResultCard = ({
  result,
  planned,
  open,
  onExplain,
  onFixMyself,
  onShowLine,
}: BaseResultCardProps) => {
  const { title, meta } = headOf(result);
  const Icon = result.ok ? CircleCheck : CircleX;
  const failedBuild = result.act === "build" && !result.ok ? result : null;
  const error = failedBuild?.error ?? null;

  return (
    <div
      role="status"
      className={cn(
        "overflow-hidden rounded-control border bg-surface-panel",
        result.ok ? "border-border" : "border-error/40"
      )}
    >
      <div className="flex h-9 items-center gap-2 px-3">
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
      </div>
      {result.ok &&
        (result.act === "run" || result.act === "call") &&
        result.line && (
          <p className="mx-3 mb-3 border-l-2 border-success pl-3 font-mono text-[0.75rem] text-foreground">
            {result.line}
          </p>
        )}
      {open && failedBuild && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          {error && (
            <p className="font-mono text-[0.75rem] text-foreground">
              {error.message}
            </p>
          )}
          {error?.file && error.line !== null && (
            <Button
              variant="link"
              size="xs"
              onClick={() => onShowLine(error.file!, error.line!)}
              className="h-auto w-fit px-0 font-mono text-[0.75rem] text-muted-foreground"
            >
              {`--> ${error.file}:${error.line}${
                error.column !== null ? `:${error.column}` : ""
              }`}
            </Button>
          )}
          {planned && (
            <p className={READ}>
              <Prose text={planned} />
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onExplain}>
              Explain the error
              <Kbd
                aria-hidden="true"
                className="bg-white/15 text-primary-foreground/80"
              >
                ⌘↵
              </Kbd>
            </Button>
            <Button variant="ghost" onClick={onFixMyself}>
              I&apos;ll fix it myself
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BaseResultCard;
