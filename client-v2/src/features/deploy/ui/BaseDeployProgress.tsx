import { StatusDot } from "@/shared/ui/status-dot";
import { cn } from "@/shared/lib/utils";
import type { DeployRunState, DeployStep } from "@/commands/deploy/run";

export interface BaseDeployProgressProps {
  state: DeployRunState;
}

type StepStatus = "done" | "running" | "waiting";

const ORDER: DeployStep[] = ["funding", "buffer", "write", "deploy"];

const STATUS_DOT: Record<StepStatus, "success" | "running" | "idle"> = {
  done: "success",
  running: "running",
  waiting: "idle",
};

const label = (step: DeployStep, state: DeployRunState) => {
  if (step === "funding") return "Funding wallet";
  if (step === "buffer") return "Preparing buffer";
  if (step === "write") return `Writing program, ${state.percent}%`;
  return state.upgrade ? "Upgrading" : "Deploying";
};

/** The running deploy's steps, each done, running or waiting */
const BaseDeployProgress = ({ state }: BaseDeployProgressProps) => {
  const steps = ORDER.filter((s) => s !== "funding" || state.funds);
  const at = state.step ? steps.indexOf(state.step) : -1;
  const statusOf = (i: number): StepStatus => {
    if (i < at) return "done";
    return i === at ? "running" : "waiting";
  };

  return (
    <ol
      role="status"
      aria-label="Deploy progress"
      className="flex w-full flex-col gap-1.5 text-control"
    >
      {steps.map((step, i) => {
        const status = statusOf(i);
        return (
          <li
            key={step}
            data-status={status}
            className={cn(
              "flex items-center gap-2",
              status === "waiting" ? "text-subtle" : "text-foreground"
            )}
          >
            <StatusDot variant={STATUS_DOT[status]} />
            {label(step, state)}
          </li>
        );
      })}
    </ol>
  );
};

export default BaseDeployProgress;
