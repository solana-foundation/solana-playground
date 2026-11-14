import * as Sentry from "@sentry/react";
import { expect, it, vi } from "vitest";

import type { LogEntry } from "../types";
import { sentryProvider } from "./sentry";

vi.mock("@sentry/react", () => {
  const scope = { setLevel: vi.fn(), setTag: vi.fn(), setExtras: vi.fn() };
  return {
    init: vi.fn(),
    browserTracingIntegration: vi.fn(() => ({ name: "BrowserTracing" })),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    addBreadcrumb: vi.fn(),
    withScope: vi.fn((callback: (s: typeof scope) => void) => callback(scope)),
    scope,
  };
});

const scope = (Sentry as unknown as { scope: Record<string, unknown> }).scope;

const entry = (
  fields: Pick<LogEntry, "level" | "report"> & Partial<LogEntry>
): LogEntry => ({
  ns: "persistence:sync",
  level: fields.level,
  message: fields.message,
  error: fields.error,
  context: fields.context,
  report: fields.report,
  unhandled: fields.unhandled ?? false,
});

const DSN = "https://key@o0.ingest.sentry.io/0";

it("should initialise nothing and send nothing without a DSN", () => {
  const provider = sentryProvider({ tracesSampleRate: 0 });

  provider.log(entry({ level: "panic", report: true, error: new Error("x") }));

  expect(Sentry.init).not.toHaveBeenCalled();
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

it("should leave out Sentry's global handlers and console breadcrumbs", () => {
  sentryProvider({ dsn: DSN, tracesSampleRate: 0 });

  const { integrations } = vi.mocked(Sentry.init).mock.calls[0][0] as {
    integrations: (defaults: { name: string }[]) => { name: string }[];
  };
  const names = integrations([
    { name: "GlobalHandlers" },
    { name: "Console" },
    { name: "Dedupe" },
  ]).map((i) => i.name);
  expect(names).toContain("Dedupe");
  expect(names).not.toContain("GlobalHandlers");
  expect(names).not.toContain("Console");
});

// Which levels are reported is `isReported`'s rule; the provider follows `entry.report`
it.each([
  [true, true],
  [false, false],
])("should send an entry with report=%s: %s", (report, sent) => {
  sentryProvider({ dsn: DSN, tracesSampleRate: 0 }).log(
    entry({ level: "panic", report, error: new Error("e") })
  );

  expect(vi.mocked(Sentry.withScope).mock.calls.length > 0).toBe(sent);
});

it("should tag a reported exception with its namespace and severity", () => {
  const error = new Error("push rejected");
  sentryProvider({ dsn: DSN, tracesSampleRate: 0 }).log(
    entry({ level: "error", report: true, error, context: { projectId: "p1" } })
  );

  expect(scope.setTag).toHaveBeenCalledWith("ns", "persistence:sync");
  expect(scope.setLevel).toHaveBeenCalledWith("error");
  expect(scope.setExtras).toHaveBeenCalledWith({ projectId: "p1" });
  expect(Sentry.captureException).toHaveBeenCalledWith(error, undefined);
});

it("should mark an error from a global handler as unhandled", () => {
  const error = new Error("boom");
  sentryProvider({ dsn: DSN, tracesSampleRate: 0 }).log(
    entry({ level: "panic", report: true, error, unhandled: true })
  );

  expect(Sentry.captureException).toHaveBeenCalledWith(error, {
    mechanism: { handled: false, type: "auto.logger.global" },
  });
});

it("should prefix a reported warning with its namespace", () => {
  sentryProvider({ dsn: DSN, tracesSampleRate: 0 }).log(
    entry({ level: "warn", report: true, message: "slow push" })
  );

  expect(scope.setLevel).toHaveBeenCalledWith("warning");
  expect(Sentry.captureMessage).toHaveBeenCalledWith(
    "[persistence:sync] slow push"
  );
});

it.each([
  {
    name: "a warning",
    level: "warn",
    message: "slow push",
    error: undefined,
    severity: "warning",
    text: "slow push",
  },
  {
    name: "an error",
    level: "error",
    message: undefined,
    error: new TypeError("push rejected"),
    severity: "error",
    text: "TypeError: push rejected",
  },
] as const)(
  "should leave $name that is not reported as a breadcrumb in its namespace",
  ({ level, message, error, severity, text }) => {
    vi.mocked(Sentry.addBreadcrumb).mockClear();

    sentryProvider({ dsn: DSN, tracesSampleRate: 0 }).log(
      entry({
        level,
        report: false,
        message,
        error,
        context: { projectId: "p1" },
      })
    );

    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: "persistence:sync",
      level: severity,
      message: text,
      data: { projectId: "p1" },
    });
  }
);

it("should leave a reported entry as a breadcrumb only after its report", () => {
  vi.mocked(Sentry.addBreadcrumb).mockClear();
  vi.mocked(Sentry.captureException).mockClear();
  const error = new Error("push rejected");

  sentryProvider({ dsn: DSN, tracesSampleRate: 0 }).log(
    entry({ level: "error", report: true, error })
  );

  expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Error: push rejected" })
  );
  // Before it, each report would carry itself as its own last breadcrumb
  expect(
    vi.mocked(Sentry.captureException).mock.invocationCallOrder[0]
  ).toBeLessThan(vi.mocked(Sentry.addBreadcrumb).mock.invocationCallOrder[0]);
});

it("should leave no breadcrumb for an entry below warn", () => {
  vi.mocked(Sentry.addBreadcrumb).mockClear();

  sentryProvider({ dsn: DSN, tracesSampleRate: 0 }).log(
    entry({ level: "info", report: false, message: "pushed" })
  );

  expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
});
