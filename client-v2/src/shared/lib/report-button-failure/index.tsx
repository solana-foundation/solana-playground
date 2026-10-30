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
 * printed to an open console, `toldByStage` for a Build or Deploy run whose
 * stage shows it failed, and the wallet's airdrop for a sign-in failure the
 * account row shows.
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
  // The terminal and a stage may both mark one thrown string; kept twice, the
  // spare copy would hide a later, unrelated failure with the same text
  if (shownStrings.includes(error)) return;
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

const unavailable = new WeakMap<object, string>();

/**
 * Mark a failure as an action that cannot run where it was clicked, such as a
 * command while no terminal is mounted. `reportButtonFailure` then says
 * "Can't <action> here: <wayOut>." instead of "Could not <action>.", since
 * nothing broke.
 *
 * @param error the failure, matched by identity
 * @param wayOut what gets the user somewhere it can run, completing the
 * sentence, such as "open a project to use the terminal"
 */
export const markUnavailableHere = (error: object, wayOut: string): void => {
  unavailable.set(error, wayOut);
};

/**
 * The way out `markUnavailableHere` recorded for this failure, or `null`
 * when it is not one.
 */
export const unavailableHere = (error: unknown): string | null =>
  (typeof error === "object" && error !== null && unavailable.get(error)) ||
  null;

/**
 * Where a failed click goes: the `onError` of `AsyncButton` and
 * `CopyButton`, and the catch of a click path that is not one of them (such
 * as `ImportButton` and `useTurn`'s send).
 *
 * The returned handler logs the failure under `ui:button`, not marked for
 * reporting (which failures reach error tracking is decided in HOO-1800),
 * and tells the user "Could not <action>." in a toast, or "Can't <action>
 * here: <way out>." for a failure `markUnavailableHere` marked. The raw
 * error never reaches the screen. A failure already shown (`markFailureShown`)
 * is only logged: the user hears of a failure once.
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
    const wayOut = unavailableHere(error);
    const text = wayOut
      ? `Can't ${action} here: ${wayOut}.`
      : `Could not ${action}.`;
    PgView.setToast(() => <span>{text}</span>, {
      options: { name: BUTTON_FAILED_TOAST, id: BUTTON_FAILED_TOAST },
    });
  };
