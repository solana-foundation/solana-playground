import { createLogger } from "./logger";

const log = createLogger("logger:global");

const shown = new WeakSet<object>();

/**
 * Marks a failure the user was already shown, such as the terminal's "Process
 * error" line for an unknown command or a declined wallet question: an
 * expected outcome, so if nothing catches it the global handler leaves a
 * breadcrumb instead of a report. A thrown primitive cannot be marked.
 */
export const markShown = (error: unknown) => {
  if (typeof error === "object" && error !== null) shown.add(error);
};

const summary = (reason: object) =>
  reason instanceof Error
    ? `${reason.name}: ${reason.message}`
    : String(reason);

const RESIZE_OBSERVER_LOOP_NOTICE =
  "ResizeObserver loop completed with undelivered notifications.";

/**
 * The browser's report that a resize was delivered a frame late. The panel
 * layout raises it on load; it is harmless, and each one would otherwise reach
 * Sentry, once a DSN is set, as an unhandled panic. The match is exact, and a
 * thrown `Error` with the same text carries an `error` and is not matched.
 */
const isResizeObserverLoopNotice = (event: ErrorEvent) =>
  (event.error === null || event.error === undefined) &&
  event.message === RESIZE_OBSERVER_LOOP_NOTICE;

/**
 * Sends uncaught errors and unhandled rejections to `panic`, except the
 * ResizeObserver loop notice, which is dropped, and a rejection marked with
 * `markShown`, which is logged at `warn`; returns the uninstaller
 */
export const installGlobalHandlers = () => {
  const onError = (event: ErrorEvent) => {
    if (isResizeObserverLoopNotice(event)) return;
    // A cross-origin script error carries only a message, no `error`
    log.panic(event.error ?? event.message, { unhandled: true });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const { reason } = event;
    if (typeof reason === "object" && reason !== null && shown.has(reason)) {
      log.warn(`Shown to the user: ${summary(reason)}`);
    } else {
      log.panic(reason, { unhandled: true });
    }
  };

  globalThis.addEventListener("error", onError);
  globalThis.addEventListener("unhandledrejection", onRejection);
  return () => {
    globalThis.removeEventListener("error", onError);
    globalThis.removeEventListener("unhandledrejection", onRejection);
  };
};
