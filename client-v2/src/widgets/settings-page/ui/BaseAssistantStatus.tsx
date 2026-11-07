import { useEffect, useRef, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { StatusDot } from "@/shared/ui/status-dot";

import BaseSettingRow from "./BaseSettingRow";

const log = createLogger("settings-page:assistant-status");

/** The hosted model, as `GET /api/ai/status` answered */
export type HostedModel = "checking" | "present" | "absent" | "unreachable";

/**
 * What the row says: the answer, or `offline` for a failure while the browser
 * has no network, which says nothing about the hosted model
 */
type Shown = HostedModel | "offline";

const STATES: Record<
  Shown,
  {
    dot: "success" | "running" | "warning" | "idle";
    word: string;
    help: string;
  }
> = {
  checking: {
    dot: "running",
    word: "Checking",
    help: "Asking whether the hosted model answers.",
  },
  present: {
    dot: "success",
    word: "Ready",
    help: "Hosted model. No key needed.",
  },
  absent: {
    dot: "idle",
    word: "Not offered",
    help: "This build has no hosted model. The assistant asks for a key.",
  },
  unreachable: {
    dot: "warning",
    word: "Not answering",
    help: "The hosted model is not answering. The assistant asks for a key.",
  },
  // Offline, the status bar's AI word while the browser is offline
  // (`widgets/status` `indicators`), so one state keeps one word
  offline: {
    dot: "idle",
    word: "Offline",
    help: "You are offline, so the hosted model cannot be asked.",
  },
};

/**
 * Present: Ready on the hosted model, named when the deployment names it, or
 * Not in use while chat runs on the user's own key (HOO-2695)
 */
const presentState = (
  hostedName: string | undefined,
  ownKey: string | undefined
) => {
  if (ownKey) {
    return {
      dot: "idle" as const,
      word: "Not in use",
      help: `Available, but chat uses ${ownKey} on your key.`,
    };
  }
  if (hostedName) {
    return { ...STATES.present, help: `${hostedName}. No key needed.` };
  }
  return STATES.present;
};

/**
 * The Assistant section's first row: whether the hosted model is there, in
 * words, with a Try again while it is not answering
 */
const BaseAssistantStatus = ({
  hosted,
  hostedName,
  ownKey,
  online,
  onRetry,
  phone,
}: {
  hosted: HostedModel;
  /** The hosted model's name, when the deployment says which model it is */
  hostedName?: string;
  /**
   * The model chat uses on the user's own key, when one is connected: the
   * hosted model is then there but not in use, and Ready would read as if it were
   */
  ownKey?: string;
  /** Whether the browser has a network */
  online: boolean;
  /** Ask the hosted model again; settles once it has answered */
  onRetry: () => Promise<unknown>;
  phone: boolean;
}) => {
  const shown: Shown = hosted === "unreachable" && !online ? "offline" : hosted;
  const state =
    shown === "present" ? presentState(hostedName, ownKey) : STATES[shown];
  // When a Try again last settled: a retry that is answered "unreachable"
  // again changes nothing else on the row, so the help line says it asked
  const [askedAt, setAskedAt] = useState<Date>();
  // A Try again that is answered takes its button away: focus moves to the
  // row's state, so a keyboard user's next Tab goes on from this row
  const isRetryPressed = useRef(false);
  const stateRef = useRef<HTMLSpanElement>(null);
  const retry = () => {
    isRetryPressed.current = true;
    return onRetry().then(() => setAskedAt(new Date()));
  };
  useEffect(() => {
    if (shown === "unreachable" || !isRetryPressed.current) return;
    isRetryPressed.current = false;
    if (document.activeElement === document.body) stateRef.current?.focus();
  }, [shown]);

  // The probe failed while offline is not a verdict on the model: back
  // online, the row asks once rather than stay on Not answering
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && hosted === "unreachable") {
      // Nobody pressed anything, so no toast; the caller reports a rejection
      onRetry().catch((error: unknown) => log.error(error));
    }
    wasOnline.current = online;
  }, [online, hosted, onRetry]);

  const help =
    shown === "unreachable" && askedAt
      ? `Still not answering, asked at ${askedAt.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}. The assistant asks for a key.`
      : state.help;
  return (
    <BaseSettingRow
      name="Hosted model"
      description={help}
      phone={phone}
      small
      control={
        <div className="flex items-center gap-3">
          {shown === "unreachable" && (
            <AsyncButton
              variant="outline"
              size={phone ? "default" : "sm"}
              onClick={retry}
              onError={reportButtonFailure("ask the hosted model again")}
            >
              Try again
            </AsyncButton>
          )}
          <span
            ref={stateRef}
            tabIndex={-1}
            className={cn(
              "flex items-center gap-2 outline-none text-caption text-muted-foreground max-md:text-control",
              shown === "present" && !ownKey && "text-foreground"
            )}
          >
            <StatusDot variant={state.dot} />
            {state.word}
          </span>
        </div>
      }
    />
  );
};

export default BaseAssistantStatus;
