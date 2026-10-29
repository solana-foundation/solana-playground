import { Plus } from "lucide-react";
import { useId } from "react";

import { BrandButton } from "@/shared/ui/brand-button";
import { FieldError } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";

export interface ScratchFramework {
  name: FrameworkName;
  icon: string;
  /** The icon is drawn in a circle */
  circle?: boolean;
}

/**
 * Where Start stands. `creating` and `invalid` hold Start; `failed` keeps
 * it usable, so a press after a failure is a retry
 */
export type Start =
  | { state: "idle" }
  | { state: "creating" }
  | { state: "invalid"; error: string }
  | { state: "failed"; error: string };

/** A press makes a project: after a failure it is a retry */
export const canStart = (start: Start) =>
  start.state === "idle" || start.state === "failed";

export interface BaseStartFromScratchProps {
  frameworks: ScratchFramework[];
  framework?: FrameworkName;
  onFramework: (framework: FrameworkName) => void;
  name: string;
  onName: (name: string) => void;
  /** The name a project gets when none is typed */
  placeholder: string;
  start: Start;
  /** Something else runs: Start waits for it */
  held?: boolean;
  onStart: () => void;
}

/**
 * A new project in three choices, as the prototype draws it: a framework
 * (the choice that matters, so it gets the gradient ring), a name, then
 * Start. One row from `md`, stacked below it, where every choice is a
 * fingertip tall in the phone's type, as the prototype's phone draws it.
 */
const BaseStartFromScratch = ({
  frameworks,
  framework,
  onFramework,
  name,
  onName,
  placeholder,
  start,
  held = false,
  onStart,
}: BaseStartFromScratchProps) => {
  const creating = start.state === "creating";
  const usable = canStart(start) && !held;
  const error =
    start.state === "invalid" || start.state === "failed"
      ? start.error
      : undefined;
  const errorId = useId();

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-panel p-4 md:flex-row md:flex-wrap md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3 md:basis-56">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-surface-raised text-foreground max-md:bg-background"
        >
          <Plus className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="text-caption text-muted-foreground max-md:font-label max-md:text-subtle">
            Blank canvas
          </div>
          <div className="text-control font-act text-foreground max-md:text-body">
            Start from scratch
          </div>
          <div className="text-caption font-read text-muted-foreground max-md:text-control">
            A working starter you shape with the assistant.
          </div>
        </div>
      </div>

      <Segmented
        variant="gradient"
        aria-label="Framework"
        className="max-md:w-full max-md:gap-1"
        value={framework}
        onValueChange={(f) => {
          // A press on the chosen item clears the group; keep the choice
          if (f) onFramework(f as FrameworkName);
        }}
      >
        {frameworks.map((f) => (
          <SegmentedItem
            key={f.name}
            value={f.name}
            className="max-md:h-12 max-md:flex-1 max-md:px-2 max-md:text-control"
          >
            <img
              src={f.icon}
              alt=""
              className={
                f.circle ? "size-4 rounded-full" : "size-4 rounded-[4px]"
              }
            />
            {f.name}
          </SegmentedItem>
        ))}
      </Segmented>

      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Input
            aria-label="Project name"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="min-w-0 flex-1 md:w-48 md:flex-none max-md:h-12 max-md:px-3.5 max-md:text-body"
            value={name}
            placeholder={placeholder}
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && usable) onStart();
            }}
          />
          <BrandButton
            type="button"
            variant="accent"
            // One height with the framework chips and the name field
            className="h-8 max-md:h-12 max-md:px-4.5 max-md:text-control"
            disabled={!usable}
            aria-busy={creating || undefined}
            onClick={onStart}
          >
            Start &rarr;
          </BrandButton>
        </div>
        <FieldError id={errorId}>{error}</FieldError>
      </div>
    </div>
  );
};

export default BaseStartFromScratch;
