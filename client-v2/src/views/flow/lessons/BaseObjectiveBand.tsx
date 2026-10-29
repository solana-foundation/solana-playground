import type { FC } from "react";
import { useState } from "react";

import {
  ObjectiveActions,
  ObjectiveBand,
  ObjectiveCheck,
  ObjectiveCondition,
  ObjectiveCount,
  ObjectiveFold,
  ObjectiveMain,
  ObjectiveMeter,
  ObjectiveNav,
  ObjectivePrimary,
  ObjectiveQuiet,
  ObjectiveRow,
  ObjectiveText,
} from "@/shared/ui/objective-band";

export type BandAction = { label: string; onClick: () => void };

type BandShared = {
  /** `label` is the wide "Step 1 of 4", `short` the phone's "1/4", `progress` 0..1 */
  position: { label: string; short: string; progress: number };
  objective: string;
  /** The verifiedBy line */
  criterion: string;
  back: { enabled: boolean; onClick: () => void };
  next: { enabled: boolean; onClick: () => void };
  /** Below the phone width: the band folds, and its actions are the foot
   * bar's (`BaseLessonBar`) */
  phone?: boolean;
};

/** A step under the cursor: its page and its one action */
export type StepBandProps = BandShared & {
  kind: "step";
  /** `null` when the step has no page */
  read: BandAction | null;
  /** "Continue" on a step proved by reading, else the assistant's rung */
  primary: BandAction & { kind: "continue" | "stuck" };
};

/** The path's end: "done", and where to go */
export type FinishedBandProps = BandShared & {
  kind: "finished";
  gallery: BandAction;
};

export type BaseObjectiveBandProps = StepBandProps | FinishedBandProps;

/**
 * What the band offers to press, at the band's size or the phone bar's:
 * back and on, then the page and the step's action. Shared with
 * `BaseLessonBar`, so the two can never offer different things.
 */
export const BandControls: FC<{
  band: BaseObjectiveBandProps;
  /** Wraps the page and the action, so the bar can push them to its end */
  End: FC<{ children: React.ReactNode }>;
}> = ({ band, End }) => {
  const size = band.phone ? "phone" : "default";
  return (
    <>
      <ObjectiveNav
        size={size}
        onBack={band.back.onClick}
        onNext={band.next.onClick}
        canBack={band.back.enabled}
        canNext={band.next.enabled}
      />
      <End>
        {band.kind === "step" && band.read && (
          <ObjectiveQuiet size={size} onClick={band.read.onClick}>
            {band.read.label}
          </ObjectiveQuiet>
        )}
        {band.kind === "step" && (
          <ObjectivePrimary size={size} onClick={band.primary.onClick}>
            {band.primary.label}
          </ObjectivePrimary>
        )}
        {band.kind === "finished" && (
          <ObjectiveQuiet size={size} onClick={band.gallery.onClick}>
            {band.gallery.label}
          </ObjectiveQuiet>
        )}
      </End>
    </>
  );
};

const Inline: FC<{ children: React.ReactNode }> = ({ children }) => (
  <>{children}</>
);

/**
 * One ask above the editor, drawn from props alone: where you are, the ask,
 * and the one thing to press, in one row that wraps its actions as a group
 * only when it must. How the step is checked is one press away under the
 * check, and stays open or shut from step to step as the learner left it.
 * On a phone the row folds and opens in place instead.
 */
export const BaseObjectiveBand: FC<BaseObjectiveBandProps> = (props) => {
  const { position, objective, criterion, phone } = props;
  const [open, setOpen] = useState(false);

  if (phone) {
    return (
      <ObjectiveFold
        open={open}
        position={position.short}
        value={position.progress}
        objective={objective}
        onClick={() => setOpen((o) => !o)}
      >
        {criterion}
      </ObjectiveFold>
    );
  }

  return (
    <ObjectiveBand>
      <ObjectiveRow>
        <ObjectiveMain>
          <ObjectiveCount>{position.label}</ObjectiveCount>
          <ObjectiveMeter value={position.progress} />
          <ObjectiveText title={objective}>{objective}</ObjectiveText>
          {props.kind === "step" && (
            <ObjectiveCheck open={open} onClick={() => setOpen((o) => !o)} />
          )}
        </ObjectiveMain>
        <ObjectiveActions>
          <BandControls band={props} End={Inline} />
        </ObjectiveActions>
      </ObjectiveRow>
      {/* At the path's end the line is the summary, so it always shows */}
      {(open || props.kind === "finished") && (
        <ObjectiveCondition>{criterion}</ObjectiveCondition>
      )}
    </ObjectiveBand>
  );
};
