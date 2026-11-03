/** The checklist's steps, in the order it shows them */
export const SETUP_STEPS = [
  "assistant",
  "network",
  "github",
  "wallet",
] as const;

export type SetupStep = typeof SETUP_STEPS[number];

/** The steps that can be left to do; the network one is always done */
export type TodoStep = Exclude<SetupStep, "network">;

/**
 * One step as drawn: a done step may show a value (cluster, login, address);
 * a step to do is one with an action
 */
export type StepView =
  | { step: SetupStep; done: true; value?: string }
  | { step: TodoStep; done: false };
