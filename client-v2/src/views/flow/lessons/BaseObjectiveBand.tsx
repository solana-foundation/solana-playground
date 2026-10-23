import type { FC } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";

import { BrandButton } from "@/shared/ui/brand-button";
import { Button } from "@/shared/ui/button";
import { Callout } from "@/shared/ui/callout";
import {
  ObjectiveBand,
  ObjectiveMeter,
  ObjectiveNav,
  ObjectiveText,
} from "@/shared/ui/objective-band";

export type BandAction = { label: string; onClick: () => void };

type BandShared = {
  /** `label` is the wide eyebrow, `short` the phone's "1/4", `progress` 0..1 */
  position: { label: string; short: string; progress: number };
  objective: string;
  /** The verifiedBy line */
  criterion: string;
  back: { enabled: boolean; onClick: () => void };
  next: { enabled: boolean; onClick: () => void };
  /** The phone's one-row band, whose chevron opens the steps; absent = wide */
  compact?: { onOpenSteps: () => void };
};

/** A step under the cursor: its page, the assistant and the proving action */
export type StepBandProps = BandShared & {
  kind: "step";
  /** `null` when the step has no page */
  read: (BandAction & { unread: boolean }) | null;
  stuck: BandAction;
  /** `null` behind the frontier, where there is nothing left to prove */
  prove: BandAction | null;
  /** What blocks the proving action; `null` when nothing does */
  readiness: {
    lead: string;
    items: { key: string; text: string; onClick: (() => void) | null }[];
  } | null;
};

/** The path's end: "done", and where to go */
export type FinishedBandProps = BandShared & {
  kind: "finished";
  gallery: BandAction;
};

export type BaseObjectiveBandProps = StepBandProps | FinishedBandProps;

/**
 * One ask above the editor, drawn from props alone. The actions are a
 * sibling row of the design system's parts rather than `ObjectiveActions`,
 * which hides below `md`: a phone still needs to prove a step.
 */
export const BaseObjectiveBand: FC<BaseObjectiveBandProps> = (props) => {
  const { position, objective, criterion, back, next, compact } = props;
  const step = props.kind === "step" ? props : null;

  return (
    <div className="flex flex-col">
      <ObjectiveBand className="flex-wrap">
        {compact ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {position.short}
          </span>
        ) : (
          <span className="shrink-0 text-xs tracking-wider text-muted-foreground uppercase">
            {position.label}
          </span>
        )}
        <ObjectiveMeter value={position.progress} />
        <ObjectiveText>{objective}</ObjectiveText>
        {!compact && (
          <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
            {criterion}
          </span>
        )}
        {compact && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Show the steps"
            onClick={compact.onOpenSteps}
          >
            <ChevronDown />
          </Button>
        )}
        {/* Row two (design.md, "Lessons (5.19)"): back and on, then the
            actions. On a phone it stays one line and scrolls sideways, so
            the proving action is never pushed onto a third line. The padding
            (undone by the negative margin) keeps the scroller from clipping
            a focused button's ring, since overflow-x also clips y. */}
        <div
          data-slot="objective-actions-row"
          className={cn(
            "flex w-full items-center gap-2",
            compact
              ? "-m-1 w-[calc(100%+0.5rem)] flex-nowrap overflow-x-auto p-1 [scrollbar-width:none] *:shrink-0"
              : "flex-wrap"
          )}
        >
          <ObjectiveNav
            onBack={back.onClick}
            onNext={next.onClick}
            canBack={back.enabled}
            canNext={next.enabled}
          />
          {step?.read && (
            <Button
              variant="ghost"
              size="sm"
              data-unread={step.read.unread ? "" : undefined}
              onClick={step.read.onClick}
            >
              {step.read.unread && (
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-primary"
                />
              )}
              {step.read.label}
            </Button>
          )}
          {step && (
            <BrandButton size="sm" onClick={step.stuck.onClick}>
              {step.stuck.label}
            </BrandButton>
          )}
          {step?.prove && (
            <Button variant="outline" size="sm" onClick={step.prove.onClick}>
              {step.prove.label}
            </Button>
          )}
          {props.kind === "finished" && (
            <Button variant="ghost" size="sm" onClick={props.gallery.onClick}>
              {props.gallery.label}
            </Button>
          )}
        </div>
      </ObjectiveBand>
      {/* `aria-live` because the list shrinks as the learner fixes things,
          and a change nobody is looking at is a change nobody hears */}
      <div aria-live="polite">
        {step?.readiness && (
          <Callout className="rounded-none border-x-0 py-2">
            <span>{step.readiness.lead}</span>
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              {step.readiness.items.map((item) =>
                item.onClick ? (
                  <Button
                    key={item.key}
                    variant="link"
                    size="xs"
                    className="h-auto px-0"
                    onClick={item.onClick}
                  >
                    {item.text}
                  </Button>
                ) : (
                  // Nothing to click: a build already running is a thing to
                  // wait for, so it stays quiet text rather than a dead control
                  <span key={item.key} className="text-muted-foreground">
                    {item.text}
                  </span>
                )
              )}
            </div>
          </Callout>
        )}
      </div>
    </div>
  );
};
