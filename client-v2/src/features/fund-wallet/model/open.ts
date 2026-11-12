import type { FundFrom } from "./telemetry";

type Listener = (from: FundFrom) => void;

const listeners = new Set<Listener>();

/**
 * Ask the mounted `FundDialogHost` to open the Fund dialog. A card or a
 * toast asks rather than renders its own dialog: a toast unmounts after a
 * few seconds and would take the dialog along. With no host it does nothing.
 */
export const openFundDialog = (from: FundFrom): void => {
  listeners.forEach((listener) => listener(from));
};

/** Listen for {@link openFundDialog}; returns the unsubscribe */
export const onDidRequestFundDialog = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
