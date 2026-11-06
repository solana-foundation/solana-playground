/** Moves the feed to a step's divider, by the step's index */
type StepJumpListener = (index: number) => void;

const listeners = new Set<StepJumpListener>();

/**
 * Asks the feed to bring step `index`'s heading into view, as a pick in the
 * step bar's menu does (reported as `menu`). The phone's steps sheet asks: it sits in the header,
 * outside the feed, and the feed draws no step bar there. The lesson's
 * progress is untouched.
 */
export const requestStepJump = (index: number) => {
  listeners.forEach((listen) => listen(index));
};

/** Listens for `requestStepJump`; returns what stops listening */
export const onStepJumpRequest = (listen: StepJumpListener) => {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
};
