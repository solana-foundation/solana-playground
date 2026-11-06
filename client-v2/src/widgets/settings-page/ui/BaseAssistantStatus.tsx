import { cn } from "@/shared/lib/utils";
import { StatusDot } from "@/shared/ui/status-dot";

import BaseSettingRow from "./BaseSettingRow";

/** The hosted model, as `GET /api/ai/status` answered */
export type HostedModel = "checking" | "present" | "absent" | "unreachable";

const STATES: Record<
  HostedModel,
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
};

/** The Assistant section's first row: whether the hosted model is there, in words */
const BaseAssistantStatus = ({
  hosted,
  phone,
}: {
  hosted: HostedModel;
  phone: boolean;
}) => {
  const state = STATES[hosted];
  return (
    <BaseSettingRow
      name="Hosted model"
      description={state.help}
      phone={phone}
      small
      control={
        <span
          className={cn(
            "flex items-center gap-2 text-caption text-muted-foreground max-md:text-control",
            hosted === "present" && "text-foreground"
          )}
        >
          <StatusDot variant={state.dot} />
          {state.word}
        </span>
      }
    />
  );
};

export default BaseAssistantStatus;
