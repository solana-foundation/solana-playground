import { createLogger } from "./logger";

const log = createLogger("logger:global");

const RESIZE_OBSERVER_LOOP_NOTICE =
  "ResizeObserver loop completed with undelivered notifications.";

/**
 * The browser's report that a resize was delivered a frame late. The panel
 * layout raises it on load; it is harmless, and each one would otherwise reach
 * Sentry, once a DSN is set, as an unhandled panic. The match is exact, and a
 * thrown `Error` with the same text carries an `error` and is not matched.
 */
const isResizeObserverLoopNotice = (event: ErrorEvent) =>
  event.error == null && event.message === RESIZE_OBSERVER_LOOP_NOTICE;

/**
 * Sends uncaught errors and unhandled rejections to `panic`, except the
 * ResizeObserver loop notice; returns the uninstaller
 */
export const installGlobalHandlers = () => {
  const onError = (event: ErrorEvent) => {
    if (isResizeObserverLoopNotice(event)) return;
    // A cross-origin script error carries only a message, no `error`
    log.panic(event.error ?? event.message, { unhandled: true });
  };
  const onRejection = (event: PromiseRejectionEvent) =>
    log.panic(event.reason, { unhandled: true });

  globalThis.addEventListener("error", onError);
  globalThis.addEventListener("unhandledrejection", onRejection);
  return () => {
    globalThis.removeEventListener("error", onError);
    globalThis.removeEventListener("unhandledrejection", onRejection);
  };
};
