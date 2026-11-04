// Runs the real SDK over a recording transport, so the envelope is what Sentry would receive
import * as Sentry from "@sentry/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireFor } from "../../../test-utils/require-for";
import { scrubBreadcrumb, scrubEvent } from "./scrub";
import { reporter, sentryOptions } from "./sentry";

type Transport = NonNullable<
  NonNullable<Parameters<typeof Sentry.init>[0]>["transport"]
>;
type Envelope = Parameters<ReturnType<Transport>["send"]>[0];
type EventItem = [
  { type: string },
  {
    type?: string;
    tags?: Record<string, unknown>;
    contexts?: { feedback?: Record<string, unknown> };
  }
];

const DSN = "https://key@o0.ingest.sentry.io/0";

const envelopes: Envelope[] = [];
let statusCode = 200;
// Set, a feedback's delivery waits until the test calls it
let release: (() => void) | undefined;

const itemsOf = (envelope: Envelope) => envelope[1] as unknown as EventItem[];
const isFeedback = (envelope: Envelope) =>
  itemsOf(envelope)[0][0].type === "feedback";

beforeEach(() => {
  envelopes.length = 0;
  statusCode = 200;
  release = undefined;
  Sentry.init({
    dsn: DSN,
    defaultIntegrations: false,
    transport: () => ({
      send: async (envelope) => {
        envelopes.push(envelope);
        if (release && isFeedback(envelope)) {
          await new Promise<void>((resolve) => (release = resolve));
        }
        return { statusCode };
      },
      flush: async () => true,
    }),
  });
});

afterEach(async () => {
  await Sentry.close();
});

const feedback = {
  message: "Deploy is slow",
  name: "@fren",
  source: "widget",
  tags: { type: "feedback", source: "widget", rating: 4, cluster: "devnet" },
};

const LATER = {
  ns: "feedback:form",
  level: "error",
  message: "later",
  report: true,
  unhandled: false,
} as const;

describe("reporter.sendFeedback", () => {
  it("should deliver the message, name, source, URL and tags as one feedback", async () => {
    await reporter.sendFeedback(feedback);

    expect(envelopes).toHaveLength(1);
    const [[header, event]] = itemsOf(envelopes[0]);
    expect(header.type).toBe("feedback");
    expect(event.contexts?.feedback).toMatchObject({
      message: "Deploy is slow",
      name: "@fren",
      source: "widget",
      url: window.location.href,
    });
    expect(event.tags).toMatchObject(feedback.tags);
  });

  it("should leave none of its tags on an event captured after it", async () => {
    await reporter.sendFeedback(feedback);
    reporter.capture(LATER);
    await Sentry.flush();

    const [[, later]] = itemsOf(envelopes[1]);
    expect(later.tags).toEqual({ ns: "feedback:form" });
  });

  it("should leave none of its tags on an event captured while it is in flight", async () => {
    release = () => {};
    const pending = reporter.sendFeedback(feedback);
    reporter.capture(LATER);
    await vi.waitFor(() => expect(envelopes).toHaveLength(2));
    release();
    await pending;

    const [[, during]] = itemsOf(
      requireFor("a non-feedback envelope")(
        envelopes.find((e) => !isFeedback(e))
      )
    );
    expect(during.tags).toEqual({ ns: "feedback:form" });
  });

  it("should reject when Sentry does not accept the feedback", async () => {
    statusCode = 500;

    await expect(reporter.sendFeedback(feedback)).rejects.toThrow();
  });
});

describe("reporter scrub", () => {
  // A 64-byte secret key's length in base58, and a 44-character public key
  const KEY = "3Xz9".repeat(22);
  const PUBKEY = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const SECRET = Array.from({ length: 64 }, (_, i) => (i * 7) % 256);

  interface ScrubbedEvent {
    breadcrumbs?: { category?: string; message?: string }[];
    exception?: { values?: { value?: string }[] };
    extra?: Record<string, unknown>;
    contexts?: { feedback?: Record<string, unknown> };
  }
  // The session integration sends envelopes of its own; these are the events and feedback
  const eventsOf = () =>
    envelopes
      .map((envelope) => itemsOf(envelope)[0])
      .filter(
        ([header]) => header.type === "event" || header.type === "feedback"
      )
      .map(([, event]) => event as ScrubbedEvent);

  // The production options over the recording transport, default integrations on
  beforeEach(async () => {
    await Sentry.close();
    envelopes.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const options = sentryOptions({
      dsn: DSN,
      release: "abc123",
      environment: "production",
    });
    Sentry.init({
      dsn: options.dsn,
      release: options.release,
      environment: options.environment,
      integrations: options.integrations,
      beforeBreadcrumb: options.beforeBreadcrumb,
      beforeSend: options.beforeSend,
      transport: () => ({
        send: async (envelope) => {
          envelopes.push(envelope);
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("should install the scrub and leave out console breadcrumbs when the reporter initialises", async () => {
    await Sentry.close();
    reporter.init({ dsn: DSN });

    const client = Sentry.getClient();
    expect(client?.getOptions().beforeSend).toBe(scrubEvent);
    expect(client?.getOptions().beforeBreadcrumb).toBe(scrubBreadcrumb);
    expect(client?.getIntegrationByName("Console")).toBeUndefined();
  });

  /** Stands in for the user's test printing through mocha to this window's console */
  const userPrints = (...args: unknown[]) => {
    // eslint-disable-next-line no-console -- the user's own output is what this test keeps out of Sentry
    console.log(...args);
  };

  it("should send neither the user's test output nor a secret key", async () => {
    userPrints(`  ✔ prints ${KEY}`);
    userPrints("[test:run]", "balance 5 SOL");
    reporter.trail({
      ns: "persistence:sync",
      level: "warn",
      message: "push rejected",
      report: false,
      unhandled: false,
    });
    reporter.capture({
      ns: "wallet:connect",
      level: "error",
      error: new Error(`bad key ${KEY}`),
      context: { owner: PUBKEY, sk: new Uint8Array(SECRET), list: SECRET },
      report: true,
      unhandled: false,
    });
    await Sentry.flush();

    const [event] = eventsOf();
    const crumbs = (event.breadcrumbs ?? []).map((crumb) => crumb.message);
    expect(crumbs).toEqual(["push rejected"]);
    expect(event.exception?.values?.[0].value).toBe("bad key [redacted]");
    expect(event.extra).toEqual({
      owner: PUBKEY,
      sk: "[redacted]",
      list: "[redacted]",
    });
    const sent = JSON.stringify(envelopes);
    expect(sent).not.toContain(KEY);
    expect(sent).not.toContain("balance 5 SOL");
  });

  it("should send a feedback's text as the user wrote it, without the console", async () => {
    userPrints("  ✔ the user's test");
    await reporter.sendFeedback({
      message: `my key is ${KEY}`,
      source: "widget",
      tags: { type: "feedback" },
    });

    const [event] = eventsOf();
    expect(event.contexts?.feedback?.message).toBe(`my key is ${KEY}`);
    expect(JSON.stringify(envelopes)).not.toContain("the user's test");
  });
});
