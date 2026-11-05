import { noStop, Prose, TITLE } from "./Prose";

export interface BaseStepDividerProps {
  /** The step's objective, which heads it */
  objective: string;
}

/**
 * The head of a step in the feed, and the step bar's target: the step's
 * objective as a 24/28 heading, Practicum's H2 at 400 px, as the prototype's
 * `StepDivider` at `f7d42bf2e` sets it. Nothing more, before or after the
 * step passes: the bar already names the step and says it is done, and its
 * time beside the heading only took the line's room. It never acts.
 */
const BaseStepDivider = ({ objective }: BaseStepDividerProps) => (
  <h2 className={TITLE}>
    <Prose text={noStop(objective)} />
  </h2>
);

export default BaseStepDivider;
