import { useState } from "react";
import type { FormEvent } from "react";
import {
  Ban,
  CircleCheck,
  CircleX,
  Hammer,
  Play,
  Rocket,
  Send,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Act, ActBeat } from "@/entities/tutorial";
import type { ActState, Stage } from "@/features/tutorial-conversation";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Kbd } from "@/shared/ui/kbd";
import { Spinner } from "@/shared/ui/spinner";
import { formatSeconds } from "./Prose";

/** A string argument stops at 32 characters */
export const ARG_MAX = 32;

const ICONS: Record<Act, LucideIcon> = {
  build: Hammer,
  deploy: Rocket,
  buildDeploy: Rocket,
  run: Play,
  call: Send,
};

/** What the record says the act did */
const DONE: Record<Act, string> = {
  build: "Built",
  deploy: "Deployed",
  buildDeploy: "Built and deployed",
  run: "Ran it",
  call: "Called",
};

/** "Built in 1.6 s", or the act's own record line before its time */
const doneLine = (act: ActBeat, seconds: string) => {
  const line = act.record ?? DONE[act.act];
  if (!seconds) return line;
  return act.record ? `${line} · ${seconds}` : `${line} in ${seconds}`;
};

/** How each ended run reads as its record */
const RECORDS: Record<
  "done" | "refused" | "failed",
  {
    Icon: LucideIcon;
    tone: string;
    line: (act: ActBeat, seconds: string) => string;
  }
> = {
  done: { Icon: CircleCheck, tone: "text-success", line: doneLine },
  refused: {
    Icon: Ban,
    tone: "text-muted-foreground",
    line: (act, s) => `${act.title} refused${s ? ` in ${s}` : ""}`,
  },
  failed: {
    Icon: CircleX,
    tone: "text-error",
    line: (act, s) => `${act.title} failed${s ? ` in ${s}` : ""}`,
  },
};

export interface BaseActCardProps {
  act: ActBeat;
  state: ActState;
  /** The line after a reload interrupted the run, else null */
  note: string | null;
  stage: Stage | null;
  /** ms, once the run ended */
  took: number | null;
  /** Another act runs: this one waits */
  disabled: boolean;
  /** Press the button, or Enter in a call act's field, which passes the arguments by name */
  onRun: (args?: Record<string, string>) => void;
}

/**
 * One thing to run: an icon tile, the title, the context line and the button
 * with ⌘↵. While the act runs, the button gives way to the stage, "n of m"
 * and a bar on the card's bottom edge. A call act has one field for each
 * argument given by name alone, and waits for every one; an argument with a
 * value is the definition's, sent as given, with no field. Once the run
 * ended the card is its record, one line with no button, ever: the act's own
 * `record` when it landed and names one, and a refusal that passed the step
 * reads as refused, not failed.
 */
const BaseActCard = ({
  act,
  state,
  note,
  stage,
  took,
  disabled,
  onRun,
}: BaseActCardProps) => {
  const names =
    act.act === "call"
      ? (act.call.args ?? []).filter((a): a is string => typeof a === "string")
      : [];
  const [values, setValues] = useState<Record<string, string>>({});
  const Icon = ICONS[act.act];

  if (state === "done" || state === "refused" || state === "failed") {
    const record = RECORDS[state];
    const seconds = took === null ? "" : formatSeconds(took / 1000);
    return (
      <p className="flex h-9 items-center gap-2 text-caption text-muted-foreground">
        <record.Icon aria-hidden="true" className={cn("size-4", record.tone)} />
        {record.line(act, seconds)}
      </p>
    );
  }

  const running = state === "running";
  const missing = names.some((n) => !values[n]?.trim());
  const run = (e?: FormEvent) => {
    e?.preventDefault();
    if (disabled || running || missing) return;
    onRun(names.length ? values : undefined);
  };

  const button = running ? (
    <span className="flex items-center gap-2">
      <Spinner className="size-4 text-brand-purple" />
      <span className="text-[0.8125rem] font-act text-foreground">
        {stage?.label ?? "Starting"}
      </span>
      {stage && (
        <span className="text-[0.75rem] text-subtle tabular-nums">
          {stage.index} of {stage.count}
        </span>
      )}
    </span>
  ) : (
    <Button type="submit" size="lg" disabled={disabled || missing}>
      {act.button}
      <Kbd
        aria-hidden="true"
        className="bg-white/15 text-primary-foreground/80"
      >
        ⌘↵
      </Kbd>
    </Button>
  );

  return (
    <form
      aria-label={act.title}
      onSubmit={run}
      className={cn(
        "relative flex gap-3 overflow-hidden rounded-panel border border-border bg-surface-panel p-3",
        names.length ? "flex-col items-stretch" : "items-center"
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg",
            running
              ? "bg-brand-purple/14 text-brand-purple"
              : "bg-surface-raised text-muted-foreground"
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[0.875rem] font-label text-foreground">
            {act.title}
          </p>
          <p
            className={cn(
              "text-caption",
              note ? "text-warning-ink" : "text-muted-foreground"
            )}
          >
            {note ?? (names.length && missing ? "Type any name" : act.context)}
          </p>
        </div>
        {!names.length && <div className="ml-auto shrink-0">{button}</div>}
      </div>
      {names.length > 0 && (
        <div className="flex items-center gap-2">
          {names.map((name) => (
            <Input
              key={name}
              aria-label={name}
              placeholder={name === "name" ? "Your name" : name}
              maxLength={ARG_MAX}
              value={values[name] ?? ""}
              disabled={running}
              onChange={(e) =>
                setValues((v) => ({ ...v, [name]: e.target.value }))
              }
              className="h-9 flex-1"
            />
          ))}
          {button}
        </div>
      )}
      {running && stage && (
        <span
          aria-hidden="true"
          data-testid="act-stage-bar"
          style={{ transform: `scaleX(${stage.index / stage.count})` }}
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand-purple/60 transition-transform duration-300 motion-reduce:transition-none"
        />
      )}
    </form>
  );
};

export default BaseActCard;
