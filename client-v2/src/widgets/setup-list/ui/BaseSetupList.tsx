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
import type { SetupStep, StepView, TodoStep } from "../model/steps";

const STEP_LABELS: Record<SetupStep, string> = {
  assistant: "Connect the assistant",
  network: "Choose a network",
  github: "Sign in with GitHub",
  wallet: "Connect a wallet",
};

export interface BaseSetupListProps {
  steps: readonly StepView[];
  /** A step to do was clicked; its action runs */
  onPick: (step: TodoStep) => void;
  onDismiss: () => void;
  /** Folded to its title, "Get set up · n of 4 ›" */
  folded: boolean;
  /** The title was clicked to fold or unfold the list */
  onFold: (folded: boolean) => void;
}

/** "Get set up · n of total": a done step shows its value, a step to do runs its action */
const BaseSetupList = ({
  steps,
  onPick,
  onDismiss,
  folded,
  onFold,
}: BaseSetupListProps) => (
  <SetupList
    open={!folded}
    onOpenChange={(open) => onFold(!open)}
    className="px-2 pb-2"
  >
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
      {steps.map((view) =>
        view.done ? (
          <SetupListItem key={view.step} status="done">
            <SetupListIndicator />
            <SetupListLabel>
              {STEP_LABELS[view.step]}
              {/* The tick is drawn, and hidden from screen readers */}
              <span className="sr-only">, done</span>
            </SetupListLabel>
            {view.value && <SetupListValue>{view.value}</SetupListValue>}
          </SetupListItem>
        ) : (
          <SetupListItem key={view.step} className="p-0">
            <button
              type="button"
              onClick={() => onPick(view.step)}
              className="flex size-full items-center gap-2.5 rounded-md px-2 text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SetupListIndicator />
              <SetupListLabel>{STEP_LABELS[view.step]}</SetupListLabel>
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
