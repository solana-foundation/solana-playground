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
 * A new project as a short form: a title, then two labelled rows, the
 * framework and the name with Start at its end, and what is wrong with the
 * name under the field. The rows' labels share a column from `md`, so the
 * controls start on one line; below it each label sits over its control and
 * every control is a fingertip tall in the phone's type. The card has no icon
 * or eyebrow of its own: the New project tile above it already says what it
 * is (DES-194).
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
  const nameId = useId();

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-panel p-4 md:p-5">
      <div className="min-w-0">
        <div className="text-control font-act text-foreground max-md:text-body">
          Start from scratch
        </div>
        <div className="text-caption font-read text-muted-foreground max-md:text-control">
          A working starter you shape with the assistant.
        </div>
      </div>

      {/* Two rows, a label and its control each. The labels are what the
          eye reads down; the controls carry the same names for a screen
          reader, so the visible label of the group is not read twice. Each
          label is one control tall and the row aligns to its top, so a
          message under the field leaves "Name" on the field's line */}
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-[5.5rem_minmax(0,1fr)] md:items-start">
        <span
          aria-hidden="true"
          className="text-caption font-label text-muted-foreground max-md:text-control max-md:-mb-1.5 md:leading-8"
        >
          Framework
        </span>
        <Segmented
          variant="gradient"
          aria-label="Framework"
          className="max-md:w-full max-md:gap-1 md:justify-self-start"
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

        <label
          htmlFor={nameId}
          className="text-caption font-label text-muted-foreground max-md:text-control max-md:-mb-1.5 md:leading-8"
        >
          Name
        </label>
        {/* The message goes under the field: the form grows at its foot and
            nothing above or beside it moves (DES-194) */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex gap-2">
            <Input
              id={nameId}
              aria-label="Project name"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className="min-w-0 flex-1 md:max-w-80 max-md:h-12 max-md:px-3.5 max-md:text-body"
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
    </div>
  );
};

export default BaseStartFromScratch;
