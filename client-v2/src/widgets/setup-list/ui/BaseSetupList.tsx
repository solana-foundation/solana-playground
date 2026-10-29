import { ChevronRight } from "lucide-react";

import {
  SetupList,
  SetupListContent,
  SetupListDismiss,
  SetupListHeader,
  SetupListIndicator,
  SetupListItem,
  SetupListLabel,
  SetupListTrigger,
  SetupListValue,
} from "@/shared/ui/setup-list";
import type { SetupStep, StepView } from "../model/steps";

const STEP_LABELS: Record<SetupStep, string> = {
  assistant: "Connect the assistant",
  network: "Choose a network",
  github: "Sign in with GitHub",
  wallet: "Connect a wallet",
};

export interface BaseSetupListProps {
  steps: readonly StepView[];
  /** A step to do was clicked; its action runs */
  onPick: (step: SetupStep) => void;
  onDismiss: () => void;
  /** Extra attributes for a step's button, such as a settings trigger's */
  stepAttrs?: Partial<Record<SetupStep, Record<`data-${string}`, string>>>;
  /**
   * Starts folded to its title, "Get set up · n of 4 ›": the phone's menu is
   * the whole screen, so the prototype keeps the list to one line there
   */
  folded?: boolean;
}

/** "Get set up · n of total": a done step shows its value, a step to do runs its action */
const BaseSetupList = ({
  steps,
  onPick,
  onDismiss,
  stepAttrs,
  folded = false,
}: BaseSetupListProps) => (
  <SetupList defaultOpen={!folded} className="px-2 pb-2">
    <SetupListHeader>
      <SetupListTrigger
        done={steps.filter((s) => s.done).length}
        total={steps.length}
      >
        Get set up
      </SetupListTrigger>
      <SetupListDismiss onClick={onDismiss} />
    </SetupListHeader>
    <SetupListContent>
      {steps.map(({ step, done, value }) =>
        done ? (
          <SetupListItem key={step} status="done">
            <SetupListIndicator />
            <SetupListLabel>
              {STEP_LABELS[step]}
              {/* The tick is drawn, and hidden from screen readers */}
              <span className="sr-only">, done</span>
            </SetupListLabel>
            {value && <SetupListValue>{value}</SetupListValue>}
          </SetupListItem>
        ) : (
          <SetupListItem key={step} className="p-0">
            <button
              type="button"
              {...stepAttrs?.[step]}
              onClick={() => onPick(step)}
              className="flex size-full items-center gap-2.5 rounded-md px-2 text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SetupListIndicator />
              <SetupListLabel>{STEP_LABELS[step]}</SetupListLabel>
              <SetupListValue>
                <ChevronRight />
              </SetupListValue>
            </button>
          </SetupListItem>
        )
      )}
    </SetupListContent>
  </SetupList>
);

export default BaseSetupList;
