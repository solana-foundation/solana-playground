import { createLogger } from "./logger";

const log = createLogger("logger:global");

/** Sends uncaught errors and unhandled rejections to `panic`; returns the uninstaller */
export const installGlobalHandlers = () => {
  // A cross-origin script error carries only a message, no `error`
  const onError = (event: ErrorEvent) =>
    log.panic(event.error ?? event.message, { unhandled: true });
  const onRejection = (event: PromiseRejectionEvent) =>
    log.panic(event.reason, { unhandled: true });

  globalThis.addEventListener("error", onError);
  globalThis.addEventListener("unhandledrejection", onRejection);
  return () => {
    globalThis.removeEventListener("error", onError);
    globalThis.removeEventListener("unhandledrejection", onRejection);
  };
};
