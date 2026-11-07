/* eslint-disable layers/curry-order -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type { LucideIcon } from "lucide-react";
import {
  Axe,
  Check,
  Droplets,
  Expand,
  Hammer,
  Play,
  Rocket,
  Send,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { AccountView, Act, ActBeat } from "@/entities/tutorial";
import type {
  AccountOnCard,
  ActState,
  Press,
  Stage,
} from "@/features/tutorial-conversation";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Kbd } from "@/shared/ui/kbd";
import { Spinner } from "@/shared/ui/spinner";

import { summedRecord } from "../model/account-card";
import BaseAccountView from "./BaseAccountView";
import { ACTION, ACTION_FILL, ACTION_SOFT, PHONE_CTA } from "./card-action";
import { phoneCtaWidth, usePhone } from "./phone";
import { formatSeconds } from "./Prose";

/** A string argument stops at 32 characters */
export const ARG_MAX = 32;

/** The beat between presses, so each lands on the card before the next goes */
const UNTIL_GAP_MS = 250;

/** How many lines the live card shows: the latest, as the record shows them all */
const LIVE_PRESSES = 3;

/**
 * Outside the phone layout the card can still be narrow (the chat beside the
 * editor on a 1024 px tablet): under 32rem of card, where the title's line
 * and the button no longer fit side by side, a lone button takes a line of
 * its own, the card's width, so the title and its line keep theirs
 */
const NARROW_CTA = "@max-lg/act:w-full";

/** The key hint, where there is no room for it or no keyboard to press it */
const NARROW_HIDE = "@max-lg/act:hidden pointer-coarse:hidden";

const ICONS: Record<Act, LucideIcon> = {
  airdrop: Droplets,
  build: Hammer,
  deploy: Rocket,
  buildDeploy: Rocket,
  run: Play,
  call: Send,
};

/** A move on an account shows what it does to it: chop, grow */
const MOVE_ICONS: Record<AccountView["kind"], LucideIcon> = {
  player: Axe,
  memory: Expand,
};

/** What the record says the act did */
const DONE: Record<Act, string> = {
  airdrop: "Funded your wallet",
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

/**
 * How each ended run reads as its record. A refused or failed run keeps the
 * act's own icon, in grey, as the prototype's record does: a green check
 * would say it went through.
 */
const RECORDS: Record<
  "done" | "refused" | "failed",
  { line: (act: ActBeat, seconds: string) => string }
> = {
  done: { line: doneLine },
  refused: { line: (act, s) => `${act.title} refused${s ? ` in ${s}` : ""}` },
  failed: { line: (act, s) => `${act.title} failed${s ? ` in ${s}` : ""}` },
};

/** One line per press, newest last */
const PressLines = ({
  label,
  presses,
}: {
  label: string;
  presses: Press[];
}) => (
  <ol aria-label={label} className="flex flex-col gap-1.5">
    {presses.map((press) => (
      <li
        key={press.at}
        className="flex min-w-0 items-center gap-2 text-caption"
      >
        {press.ok ? (
          <Check
            aria-hidden="true"
            className="size-3.5 shrink-0 text-success"
          />
        ) : (
          <X aria-hidden="true" className="size-3.5 shrink-0 text-error" />
        )}
        <span
          title={press.line}
          className={cn(
            "min-w-0 truncate",
            press.ok ? "text-foreground" : "text-error"
          )}
        >
          {press.line}
        </span>
        {press.signature && (
          <span
            title={press.signature}
            className="ml-auto shrink-0 font-mono text-[0.75rem] text-subtle"
          >
            {press.signature.slice(0, 4)}…{press.signature.slice(-4)}
          </span>
        )}
      </li>
    ))}
  </ol>
);

export interface BaseActCardProps {
  act: ActBeat;
  state: ActState;
  /** A repeating card's lines, oldest first */
  presses: Press[];
  /** The account this card acts on, once it was read */
  account?: AccountOnCard;
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
 * value is the definition's, sent as given, with no field. Once the run ended
 * the view drops the card if its result stands right under it (`view`,
 * `isReplacedByResult`). Only when another turn stands between them is the card
 * drawn as its record, one line with no button, ever: the act's own `record`
 * when it landed and names one, and a refusal that passed the step reads as
 * refused, not failed.
 *
 * A card with `repeat` is the exception to the one line: it stays one card across its presses, a line for each.
 * After a press by hand that landed, its second button runs the presses one
 * after another until Stop, a press that did not land, or the card's end. That
 * lives here and not in the save: a reload never resumes it. A card with an
 * account draws it under its head, and once finished sums to one line.
 */
const BaseActCard = ({
  act,
  state,
  presses,
  account,
  note,
  stage,
  took,
  disabled,
  onRun,
}: BaseActCardProps) => {
  const layout = usePhone();
  const { phone } = layout;
  const names =
    act.act === "call"
      ? (act.call.args ?? []).filter((a): a is string => typeof a === "string")
      : [];
  const [values, setValues] = useState<Record<string, string>>({});
  const Icon =
    (act.repeat && act.account && MOVE_ICONS[act.account.kind]) ||
    ICONS[act.act];

  const [until, setUntil] = useState(false);
  const allLanded = presses.length > 0 && presses.every((p) => p.ok);
  const missing = names.some((n) => !values[n]?.trim());
  const press = useRef(onRun);
  press.current = () => onRun(names.length ? values : undefined);
  useEffect(() => {
    if (!until) return undefined;
    // `disabled` while nothing runs: a failed press's card took over
    const cannotPress = disabled || state !== "live" || missing;
    if (!allLanded || (state !== "running" && cannotPress)) {
      setUntil(false);
      return undefined;
    }
    if (state === "running") return undefined;
    const timer = window.setTimeout(() => press.current(), UNTIL_GAP_MS);
    return () => window.clearTimeout(timer);
  }, [until, allLanded, state, disabled, missing, presses.length]);

  if (
    act.repeat &&
    presses.length > 0 &&
    (state === "done" || state === "refused") &&
    account
  ) {
    const mark =
      state === "done" && presses.every((p) => p.ok) ? (
        <Check aria-hidden="true" className="size-3.5 text-success" />
      ) : (
        <Icon aria-hidden="true" className="size-3.5 text-subtle" />
      );
    const line = (
      <p className="flex items-center gap-2 text-caption text-muted-foreground">
        {mark}
        {summedRecord({
          view: account.view,
          reading: account.reading,
          presses,
        })}
      </p>
    );
    // A grow keeps the map as its last press left it: that moment is the step's
    return account.view.kind === "memory" ? (
      <div className="flex flex-col gap-3 rounded-panel border border-border bg-surface-panel p-3">
        {line}
        <BaseAccountView
          account={account}
          presses={presses}
          heap
          className="border-t border-border pt-3"
        />
      </div>
    ) : (
      <div className="py-2">{line}</div>
    );
  }

  // With no press, the step passed elsewhere: the card reads its plain record
  if (
    act.repeat &&
    presses.length > 0 &&
    (state === "done" || state === "refused")
  ) {
    const times = presses.length === 1 ? "1 time" : `${presses.length} times`;
    return (
      <div className="flex flex-col gap-1.5 py-2 text-caption text-muted-foreground">
        <p className="flex items-center gap-2">
          {state === "done" ? (
            <Check aria-hidden="true" className="size-3.5 text-success" />
          ) : (
            <Icon aria-hidden="true" className="size-3.5 text-subtle" />
          )}
          {act.record ?? DONE[act.act]} {times}
        </p>
        <PressLines label={`${act.title}: every press`} presses={presses} />
      </div>
    );
  }

  if (state === "done" || state === "refused" || state === "failed") {
    const record = RECORDS[state];
    const seconds = took === null ? "" : formatSeconds(took / 1000);
    return (
      <p className="flex h-9 items-center gap-2 text-caption text-muted-foreground">
        {state === "done" ? (
          <Check aria-hidden="true" className="size-3.5 text-success" />
        ) : (
          <Icon aria-hidden="true" className="size-3.5 text-subtle" />
        )}
        {record.line(act, seconds)}
      </p>
    );
  }

  const running = state === "running";
  /** One action, no fields and no repeat: the button beside or under the text */
  const single = !names.length && !act.repeat;
  const run = (e?: FormEvent) => {
    e?.preventDefault();
    if (disabled || running || missing) return;
    onRun(names.length ? values : undefined);
  };

  const button = running ? (
    // Wraps onto a second line where the card is narrow, "n of m" with it
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <Spinner className="size-4 text-brand-purple" />
      <span className="text-[0.8125rem] font-act text-foreground">
        {stage?.label ?? "Starting"}
      </span>
      {stage && (
        <span className="text-[0.75rem] text-subtle tabular-nums">
          {stage.index} of {stage.count}
        </span>
      )}
      {stage?.detail && (
        <span className="text-[0.75rem] text-subtle tabular-nums">
          · {stage.detail}
        </span>
      )}
    </span>
  ) : (
    <Button
      type="submit"
      className={cn(
        ACTION,
        ACTION_FILL,
        PHONE_CTA,
        // Off the phone, only a lone button (no field, no repeat) takes a
        // narrow card's width: beside a name field it would squeeze the field
        // to nothing, since that row never wraps, and a repeat's button keeps
        // its own width beside the repeat toggle
        phoneCtaWidth(layout) ?? (single ? NARROW_CTA : undefined)
      )}
      disabled={disabled || missing}
    >
      {act.button}
      {!phone && (
        <Kbd
          aria-hidden="true"
          className={cn("bg-white/15 text-primary-foreground/80", NARROW_HIDE)}
        >
          ⌘↵
        </Kbd>
      )}
    </Button>
  );

  return (
    <form
      aria-label={act.title}
      onSubmit={run}
      className={cn(
        "@container/act relative flex gap-3 overflow-hidden rounded-panel border border-border bg-surface-panel p-3",
        names.length || act.repeat || phone || running
          ? "flex-col items-stretch"
          : "items-center"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
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
        <div className="min-w-0 flex-1">
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
        {single && !phone && !running && (
          <div className="ml-auto shrink-0 @max-lg/act:basis-full">
            {button}
          </div>
        )}
      </div>
      {/* On the phone the button sits under its text, under the thumb; a
          run's progress sits there at every width, so its long line never
          squeezes the title */}
      {single && (phone || running) && <div className="flex">{button}</div>}
      {account && (
        <BaseAccountView
          account={account}
          presses={presses}
          heap
          className="border-t border-border pt-3"
        />
      )}
      {presses.length > 0 && (
        <PressLines
          label={`${act.title}: so far`}
          presses={presses.slice(-LIVE_PRESSES)}
        />
      )}
      {act.repeat && (
        <div className="flex flex-wrap items-center gap-2">
          {!names.length && button}
          {(until || allLanded) && (
            <Button
              type="button"
              size="lg"
              variant="ghost"
              disabled={disabled}
              onClick={() => setUntil(!until)}
              className={cn("shrink-0 px-3", ACTION_SOFT, PHONE_CTA)}
            >
              {until ? "Stop" : act.repeat.label}
            </Button>
          )}
        </div>
      )}
      {names.length > 0 && (
        <div
          className={cn(
            "flex gap-2",
            phone && !layout.tablet ? "flex-col items-stretch" : "items-center"
          )}
        >
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
