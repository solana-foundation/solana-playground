// Runs the real SDK over a recording transport, so the envelope is what Sentry would receive
import * as Sentry from "@sentry/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reporter } from "./sentry";

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

    const [[, during]] = itemsOf(envelopes.find((e) => !isFeedback(e))!);
    expect(during.tags).toEqual({ ns: "feedback:form" });
  });

  it("should reject when Sentry does not accept the feedback", async () => {
    statusCode = 500;

    await expect(reporter.sendFeedback(feedback)).rejects.toThrow();
  });
});
