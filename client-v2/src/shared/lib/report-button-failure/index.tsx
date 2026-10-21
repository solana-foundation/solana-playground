import { createLogger } from "@/shared/lib/logger";
import { PgView } from "@/utils/view";

const log = createLogger("ui:button");

/** The failed-click toast's telemetry name and id: one id, so a repeat replaces */
export const BUTTON_FAILED_TOAST = "button-failed";

/** How many shown strings are remembered; a thrown string is rare */
const SHOWN_STRINGS_CAP = 20;

const shownObjects = new WeakSet<object>();
const shownStrings: unknown[] = [];

/**
 * Mark a failure as already shown to the user, so `reportButtonFailure` logs
 * it without a toast. `PgTerminal.process` calls it for every failure it
 * printed to an open console.
 *
 * Objects are matched by identity. A thrown primitive (`Send` throws the
 * transaction's error string) can only be matched by value, so it answers one
 * check and is forgotten: a later failure with the same text, from a path
 * that printed nothing, is still toasted. The newest `SHOWN_STRINGS_CAP` are
 * kept. `null` and `undefined` say nothing about which failure they were and
 * are never marked.
 */
export const markFailureShown = (error: unknown): void => {
  if (error === null || error === undefined) return;
  if (typeof error === "object") {
    shownObjects.add(error);
    return;
  }
  shownStrings.push(error);
  if (shownStrings.length > SHOWN_STRINGS_CAP) shownStrings.shift();
};

/**
 * Whether `markFailureShown` was called with this failure. A matched
 * primitive is forgotten (see `markFailureShown`).
 */
export const wasFailureShown = (error: unknown): boolean => {
  if (typeof error === "object" && error !== null) {
    return shownObjects.has(error);
  }
  const at = shownStrings.indexOf(error);
  if (at === -1) return false;
  shownStrings.splice(at, 1);
  return true;
};

/**
 * Where a failed click goes: the `onError` of `AsyncButton` and
 * `CopyButton`, and the catch of a click path that is not one of them (such
 * as `ImportButton` and `useTurn`'s send).
 *
 * The returned handler logs the failure under `ui:button`, not marked for
 * reporting (which failures reach error tracking is decided in HOO-1800),
 * and tells the user "Could not <action>." in a toast. The raw error never
 * reaches the screen. A failure already shown, such as one the terminal
 * printed to an open console, is only logged: the user hears of a failure
 * once.
 *
 * @param action what did not happen, completing "Could not …", such as
 * "export the project"
 * @returns the handler for the failure
 */
export const reportButtonFailure =
  (action: string) =>
  (error: unknown): void => {
    log.error(error);
    if (wasFailureShown(error)) return;
    PgView.setToast(() => <span>Could not {action}.</span>, {
      options: { name: BUTTON_FAILED_TOAST, id: BUTTON_FAILED_TOAST },
    });
  };
