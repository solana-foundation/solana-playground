/** The checklist's steps, in the order it shows them */
export const SETUP_STEPS = [
  "assistant",
  "network",
  "github",
  "wallet",
] as const;

export type SetupStep = typeof SETUP_STEPS[number];

/** One step as drawn: a done step may show a value (cluster, login, address) */
export interface StepView {
  step: SetupStep;
  done: boolean;
  value?: string;
}
