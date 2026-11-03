import { Button } from "@/shared/ui/button";
import { StatusDot } from "@/shared/ui/status-dot";

import type { StatusIndicator, StatusState } from "../model/indicators";

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

/** What an indicator says when pressed: its words, why, and its one action */
export const StatusDetail = ({
  indicator,
  onAction,
}: {
  indicator: StatusIndicator;
  onAction: (indicator: StatusIndicator) => void;
}) => (
  <>
    {indicator.detail && (
      <p className="text-sm text-muted-foreground">{indicator.detail}</p>
    )}
    {indicator.action && (
      <Button
        variant="outline"
        size="sm"
        // A fingertip tall on a phone (Spec 06, "Accessibility")
        className="self-start max-md:min-h-11"
        onClick={() => onAction(indicator)}
      >
        {indicator.action.text}
      </Button>
    )}
  </>
);

/** A dot sized for the 16 px glyph box every navigation row's icon has */
export const IndicatorDot = ({ state }: { state: StatusState }) => (
  <span className="grid size-4 shrink-0 place-items-center">
    <StatusDot variant={DOT[state]} size="lg" />
  </span>
);
