import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";

import {
  createServerLogger,
  initServerLogger,
  resetServerLogger,
  sentryServerProvider,
  serverConsoleProvider,
} from "./server.mjs";

// Created at import, before any `initServerLogger` in this file runs
const early = createServerLogger("api:projects");

const memory = () => {
  const entries = [];
  return { entries, log: (entry) => entries.push(entry) };
};

afterEach(() => {
  mock.restoreAll();
  resetServerLogger();
});

describe("serverConsoleProvider", () => {
  test("prints an error field by field, its cause included, then the context", () => {
    const print = mock.method(console, "error", () => {});
    const cause = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET",
    });
    const error = Object.assign(new Error("insert failed", { cause }), {
      code: "23505",
      constraint: "projects_pkey",
    });

    serverConsoleProvider().log({
      ns: "api:projects",
      level: "error",
      error,
      context: { op: "save" },
      report: false,
    });

    const [ns, fields, context] = print.mock.calls[0].arguments;
    assert.equal(ns, "[api:projects]");
    assert.equal(fields.message, "insert failed");
    assert.equal(fields.code, "23505");
    assert.equal(fields.constraint, "projects_pkey");
    assert.equal(fields.stack, error.stack);
    assert.equal(fields.cause.code, "ECONNRESET");
    assert.deepEqual(context, { op: "save" });
  });
});

describe("createServerLogger", () => {
  test("sends to the providers configured after it was created", () => {
    const logged = memory();
    initServerLogger({ providers: [logged] });

    early.warn("SENTRY_TRACES_SAMPLE_RATE=2 is not a rate from 0 to 1");

    assert.equal(logged.entries.length, 1);
  });

  // Runs after an `initServerLogger`, so it also proves `resetServerLogger` restores the default
  test("prints to the console by default", () => {
    const print = mock.method(console, "info", () => {});

    early.info("pool ready");

    assert.deepEqual(
      print.mock.calls.map((call) => call.arguments),
      [["[api:projects]", "pool ready"]]
    );
  });

  test("turns a value that is not an Error into one, keeping the value as its cause", () => {
    const logged = memory();
    initServerLogger({ providers: [logged] });

    early.error(42);

    const { error } = logged.entries[0];
    assert.ok(error instanceof Error);
    assert.equal(error.message, "42");
    assert.equal(error.cause, 42);
  });

  test("prints an error whose cause is itself once", () => {
    const print = mock.method(console, "error", () => {});
    const error = new Error("loop");
    error.cause = error;

    early.error(error);

    assert.equal(print.mock.callCount(), 1);
    assert.equal(print.mock.calls[0].arguments[0], "[api:projects]");
  });

  test("delivers to the other providers when one throws, and prints the failed entry", () => {
    const print = mock.method(console, "error", () => {});
    const failure = new Error("provider down");
    const logged = memory();
    initServerLogger({
      providers: [
        {
          log: () => {
            throw failure;
          },
        },
        logged,
      ],
    });

    early.warn("still delivered");

    assert.equal(logged.entries.length, 1);
    assert.deepEqual(print.mock.calls[0].arguments, [
      "[logger:provider] a log provider threw",
      { ns: "api:projects", level: "warn", message: "still delivered" },
      failure,
    ]);
  });

  const error = new Error("insert failed");
  for (const [label, log, expected] of [
    [
      "sends an error logged with report: true to Sentry, its context as extra",
      () => early.error(error, { report: true, context: { code: "23505" } }),
      {
        captureException: [
          [
            error,
            {
              level: "error",
              tags: { ns: "api:projects" },
              extra: { code: "23505" },
            },
          ],
        ],
        captureMessage: [],
      },
    ],
    [
      "sends a warning logged with report: true to Sentry as a message",
      () => early.warn("rate refused", { report: true }),
      {
        captureException: [],
        captureMessage: [
          [
            "[api:projects] rate refused",
            {
              level: "warning",
              tags: { ns: "api:projects" },
              extra: undefined,
            },
          ],
        ],
      },
    ],
    [
      "keeps a plain error out of Sentry",
      () => early.error(error),
      { captureException: [], captureMessage: [] },
    ],
  ]) {
    test(label, () => {
      const Sentry = { captureException: mock.fn(), captureMessage: mock.fn() };
      initServerLogger({ providers: [sentryServerProvider(Sentry)] });

      log();

      assert.deepEqual(
        {
          captureException: Sentry.captureException.mock.calls.map(
            (call) => call.arguments
          ),
          captureMessage: Sentry.captureMessage.mock.calls.map(
            (call) => call.arguments
          ),
        },
        expected
      );
    });
  }
});
