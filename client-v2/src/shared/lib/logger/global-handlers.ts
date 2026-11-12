import { createLogger } from "./logger";

const log = createLogger("logger:global");

const expected = new WeakSet<object>();

/**
 * The built-in errors a fault in the code throws, never an outcome a command
 * means: a failure of one of these is reported even when it is marked
 */
const FAULTS = [
  TypeError,
  ReferenceError,
  RangeError,
  SyntaxError,
  EvalError,
  URIError,
  WebAssembly.RuntimeError,
  WebAssembly.CompileError,
  WebAssembly.LinkError,
];

const isFault = (error: object) => FAULTS.some((type) => error instanceof type);

/**
 * Marks a failure as an expected outcome, not a bug: the terminal's "Process
 * error" line for an unknown command, a bad option or a declined wallet
 * question, or a stop. If nothing catches it, the global handler leaves a
 * breadcrumb instead of a report. A fault (`TypeError`, a wasm
 * `RuntimeError` and the like) is never marked, so a regression that throws
 * one in a command is still reported; nor is a thrown primitive.
 *
 * Not `markFailureShown` (`shared/lib/report-button-failure`): that one says
 * whether the user saw the failure, for the button toast, and depends on the
 * console being open; this one says whether the failure is a bug.
 */
export const markExpected = (error: unknown) => {
  if (typeof error === "object" && error !== null && !isFault(error)) {
    expected.add(error);
  }
};

/** Only the name: the message can quote the user's program output */
const nameOf = (reason: object) =>
  reason instanceof Error ? reason.name : "a non-Error object";

const RESIZE_OBSERVER_LOOP_NOTICE =
  "ResizeObserver loop completed with undelivered notifications.";

/**
 * The browser's report that a resize was delivered a frame late. Our own code
 * raises none on a load of Home or a project
 * (`e2e/resize-observer-loop.e2e.spec.ts`, which counts it apart from this
 * filter); this stays as a backstop for a dependency, an extension or a later
 * interaction that does. It is harmless, and each one would otherwise reach
 * Sentry, once a DSN is set, as an unhandled panic. The match is exact, and a
 * thrown `Error` with the same text carries an `error` and is not matched.
 */
const isResizeObserverLoopNotice = (event: ErrorEvent) =>
  (event.error === null || event.error === undefined) &&
  event.message === RESIZE_OBSERVER_LOOP_NOTICE;

/**
 * Sends uncaught errors and unhandled rejections to `panic`, except the
 * ResizeObserver loop notice, which is dropped, and a rejection marked with
 * `markExpected`, which is logged at `warn`; returns the uninstaller
 */
export const installGlobalHandlers = () => {
  const onError = (event: ErrorEvent) => {
    if (isResizeObserverLoopNotice(event)) return;
    // A cross-origin script error carries only a message, no `error`
    log.panic(event.error ?? event.message, { unhandled: true });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const { reason } = event;
    if (typeof reason === "object" && reason !== null && expected.has(reason)) {
      log.warn(`Expected failure: ${nameOf(reason)}`);
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
