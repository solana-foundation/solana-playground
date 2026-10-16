// The only browser module that imports `@sentry/react`: everything else in the app reports through it
import * as Sentry from "@sentry/react";

import type { Level } from "../logger/severity";
import type { LogEntry } from "../logger/types";
import type { Feedback, Reporter, ReporterConfig } from "./types";

const SEVERITY: Record<Level, Sentry.SeverityLevel> = {
  panic: "fatal",
  error: "error",
  warn: "warning",
  info: "info",
  debug: "debug",
};

const init = ({ dsn, release, environment }: ReporterConfig) => {
  Sentry.init({
    dsn,
    release,
    environment,
    // The logger installs its own global handlers, so every error takes one path
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== "GlobalHandlers"),
  });
};

const capture = (entry: LogEntry) =>
  Sentry.withScope((scope) => {
    scope.setLevel(SEVERITY[entry.level]);
    // Sentry titles an exception by its own message, so the tag is what tells slices apart
    scope.setTag("ns", entry.ns);
    if (entry.context) scope.setExtras(entry.context);

    if (entry.error) {
      Sentry.captureException(
        entry.error,
        entry.unhandled
          ? { mechanism: { handled: false, type: "auto.logger.global" } }
          : undefined
      );
    } else {
      Sentry.captureMessage(`[${entry.ns}] ${entry.message ?? ""}`);
    }
  });

const sendFeedback = async ({ message, name, source, tags }: Feedback) => {
  // `sendFeedback` sets its tags on the current scope, so it runs in a forked one; the promise
  // is boxed because `withScope` keeps a returned promise's scope on the stack until it settles
  const { delivery } = Sentry.withScope(() => ({
    delivery: Sentry.sendFeedback({ message, name, source, tags }),
  }));
  await delivery;
};

export const reporter: Reporter = {
  carried: true,
  init,
  capture,
  sendFeedback,
};
