/** The checklist's steps, in the order it shows them */
export const SETUP_STEPS = [
  "assistant",
  "network",
  "github",
  "wallet",
] as const;

export type SetupStep = typeof SETUP_STEPS[number];

/**
 * The steps that can be left to do; the network one is always chosen, so it
 * is never one to do, only one that can warn
 */
export type TodoStep = Exclude<SetupStep, "network">;

/**
 * One step as drawn: a done step may show a value (cluster, login, address);
 * a step to do is one with an action; the chosen network warns, with why,
 * while it does not answer (Spec 08 NET-02)
 */
export type StepView =
  | { step: SetupStep; done: true; value?: string }
  | { step: TodoStep; done: false }
  | { step: "network"; done: false; warn: string; value?: string }
  /** The wallet may be stored but could not be read: not a step to do over */
  | { step: "wallet"; done: false; problem: "unavailable" };

/**
 * Whether a step counts towards "n of total": a done one, and the network
 * while it warns, since a network that is not answering is still the one
 * chosen and an outage takes no step back. Counting is not completing: the
 * list completes only once every step is done
 */
export const counts = (view: StepView) => view.done || "warn" in view;
