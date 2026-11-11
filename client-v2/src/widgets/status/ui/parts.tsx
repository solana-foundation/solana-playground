import type { ComponentProps, ReactNode } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { StatusDot } from "@/shared/ui/status-dot";

import type {
  IndicatorId,
  StatusIndicator,
  StatusState,
} from "../model/indicators";

/** What did not happen when Try again still finds it down: "Could not …" */
const RETRY_FAILURE: Record<IndicatorId, string> = {
  network: "reach the network",
  ai: "reach the hosted model",
  rust: "start the Rust analyzer",
};

/**
 * The one mapping from a state to its dot, for every place status shows.
 * Waiting is the warning colour, as the offline notice over the stage is, so
 * one state never shows two severities; only a failure is red.
 */
export const DOT: Record<
  StatusState,
  "success" | "running" | "warning" | "error" | "idle"
> = {
  ready: "success",
  working: "running",
  "not-ready": "warning",
  failed: "error",
  idle: "idle",
};

/** Asks again; busy until it settles, and a rejection says "Could not reach …" */
export const RetryButton = ({
  indicator,
  onRetry,
  className,
}: {
  indicator: StatusIndicator;
  onRetry: (indicator: StatusIndicator) => Promise<unknown>;
  className?: string;
}) => (
  <AsyncButton
    variant="outline"
    size="sm"
    className={className}
    loadingText="Trying…"
    onClick={() => onRetry(indicator)}
    onError={reportButtonFailure(RETRY_FAILURE[indicator.id])}
  >
    Try again
  </AsyncButton>
);

/** What an indicator says when pressed: its words, why, and its actions */
export const StatusDetail = ({
  indicator,
  onAction,
  onRetry,
}: {
  indicator: StatusIndicator;
  onAction: (indicator: StatusIndicator) => void;
  /** Asks again; the button is busy until it settles, and a rejection says
   * "Could not reach …" */
  onRetry: (indicator: StatusIndicator) => Promise<unknown>;
}) => (
  <>
    {indicator.detail && (
      <p className="text-sm text-muted-foreground">{indicator.detail}</p>
    )}
    {(indicator.panel?.retry || indicator.action) && (
      <div className="flex flex-wrap gap-2">
        {indicator.panel?.retry && (
          <RetryButton
            indicator={indicator}
            onRetry={onRetry}
            // A fingertip tall on a phone (Spec 06, "Accessibility")
            className="max-md:min-h-11"
          />
        )}
        {indicator.action && (
          <Button
            variant="outline"
            size="sm"
            className="max-md:min-h-11"
            onClick={() => onAction(indicator)}
          >
            {indicator.action.text}
          </Button>
        )}
      </div>
    )}
  </>
);

const after = (words: string) => words.split(" · ").slice(1).join(" · ");

/**
 * The state under an indicator's name, where the name is already shown: the
 * AI's and the analyzer's words lose their short name ("AI · Off" reads
 * "Off"), the network keeps the cluster's
 */
export const stateWords = (indicator: StatusIndicator) => {
  if (indicator.id === "network") return indicator.words;
  const rest = after(indicator.words);
  if (rest) return rest;
  // "gpt-5-mini" is the state itself; "Rust" alone, not started, says it in its tip
  return indicator.state === "ready" ? indicator.words : after(indicator.tip);
};

/** A dot sized for the 16 px glyph box every navigation row's icon has */
export const IndicatorDot = ({
  state,
  className,
}: {
  state: StatusState;
  className?: string;
}) => (
  <span className={cn("grid size-4 shrink-0 place-items-center", className)}>
    <StatusDot variant={DOT[state]} size="lg" />
  </span>
);

/**
 * An indicator's panel in the status row or on the rail: its name, words,
 * line and buttons. It closes when an action is picked, since the action goes
 * elsewhere (the settings, Connect a model). Try again keeps it open while it
 * asks and when the answer is still down; once it is answered the indicator
 * has no panel any more, so the panel goes with it, and `onGone` hands focus
 * back to the indicator (see `useFocusAfterPanel`).
 */
export const StatusPanel = ({
  indicator,
  trigger,
  side,
  align,
  sideOffset,
  onPick,
  onAction,
  onRetry,
  onGone,
}: {
  indicator: StatusIndicator;
  /** The indicator's button, which the panel hangs from */
  trigger: ReactNode;
  side: ComponentProps<typeof PopoverContent>["side"];
  align: ComponentProps<typeof PopoverContent>["align"];
  sideOffset?: ComponentProps<typeof PopoverContent>["sideOffset"];
  /** The panel opened */
  onPick: (indicator: StatusIndicator) => void;
  onAction: (indicator: StatusIndicator) => void;
  onRetry: (indicator: StatusIndicator) => Promise<unknown>;
  /** The panel unmounted while open, usually because its indicator no
   * longer has one (Try again answered) */
  onGone: (indicator: StatusIndicator) => void;
}) => {
  const [open, setOpen] = useState(false);
  // Read when the panel goes, so the cleanup sees the last committed state,
  // not the first
  const last = useRef({ open, indicator, onGone });
  useLayoutEffect(() => {
    last.current = { open, indicator, onGone };
  });
  useEffect(
    () => () => {
      const panel = last.current;
      if (panel.open) panel.onGone(panel.indicator);
    },
    []
  );
  // The installed title is a plain element, so the panel names itself by it
  const titleId = useId();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) onPick(indicator);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="w-72"
        aria-labelledby={titleId}
      >
        <PopoverHeader className="gap-1">
          <PopoverTitle id={titleId} className="font-act">
            {indicator.name}
          </PopoverTitle>
          <PopoverDescription className="flex items-center gap-1.5 font-label text-foreground">
            <StatusDot variant={DOT[indicator.state]} />
            {stateWords(indicator)}
          </PopoverDescription>
        </PopoverHeader>
        <StatusDetail
          indicator={indicator}
          onAction={(picked) => {
            setOpen(false);
            onAction(picked);
          }}
          onRetry={onRetry}
        />
      </PopoverContent>
    </Popover>
  );
};

/** Marks an indicator's button in the row and on the rail, which
 * `useFocusAfterPanel` looks up by it */
const INDICATOR_ATTR = "data-status";
export const indicatorMark = (id: IndicatorId) => ({ [INDICATOR_ATTR]: id });

/**
 * When an open panel unmounts because Try again was answered, focus falls to
 * the body with the panel's buttons. This moves it to that indicator's button,
 * whose name now says the new state. The panel's cleanup runs before the
 * row's effects, so the row's effect finds the plain button already committed
 * in the trigger's place. Focus that is anywhere but the body stays put.
 */
export const useFocusAfterPanel = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const gone = useRef<IndicatorId>(undefined);
  useEffect(() => {
    const id = gone.current;
    if (!id) return;
    gone.current = undefined;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    ref.current
      ?.querySelector<HTMLElement>(`[${INDICATOR_ATTR}="${id}"]`)
      ?.focus();
  });
  const handleGone = (indicator: StatusIndicator) => {
    gone.current = indicator.id;
  };
  return { ref, handleGone };
};
