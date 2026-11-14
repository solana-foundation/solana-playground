// The only browser module that imports `@sentry/react`: everything else in the app reports through it
import * as Sentry from "@sentry/react";

import type { Level } from "../logger/severity";
import type { LogEntry } from "../logger/types";
import { scrubBreadcrumb, scrubEvent, scrubTransaction } from "./scrub";
import type { Feedback, Reporter, ReporterConfig } from "./types";

const SEVERITY: Record<Level, Sentry.SeverityLevel> = {
  panic: "fatal",
  error: "error",
  warn: "warning",
  info: "info",
  debug: "debug",
};

/**
 * Sentry's integrations this app leaves out: the logger installs its own
 * global handlers, so every error takes one path; and the console carries the
 * user's own test output, so the logger's trail comes from `trail` instead
 */
const LEFT_OUT = new Set(["GlobalHandlers", "Console"]);

/** What `init` passes `Sentry.init`, and the integration test passes it too */
export const sentryOptions = ({
  dsn,
  release,
  environment,
  tracesSampleRate,
}: ReporterConfig): Sentry.BrowserOptions => ({
  dsn,
  release,
  environment,
  tracesSampleRate,
  // No `sentry-trace` or `baggage` on any request, so the API functions sample at their own rate
  tracePropagationTargets: [],
  // Only a static transaction runs `beforeSendTransaction`, the one hook that can drop it
  traceLifecycle: "static",
  integrations: (defaults) => [
    ...defaults.filter((integration) => !LEFT_OUT.has(integration.name)),
    Sentry.browserTracingIntegration(),
  ],
  // Neither the user's program output nor a secret key leaves the page
  beforeBreadcrumb: scrubBreadcrumb,
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubTransaction,
});

const init = (config: ReporterConfig) => {
  Sentry.init(sentryOptions(config));
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

const trail = ({ ns, level, message, error, context }: LogEntry) =>
  Sentry.addBreadcrumb({
    category: ns,
    level: SEVERITY[level],
    message: message ?? (error && `${error.name}: ${error.message}`),
    data: context,
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
  trail,
  sendFeedback,
};
