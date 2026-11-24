// Runs the real SDK over a recording transport, so the envelope is what Sentry would receive
import * as Sentry from "@sentry/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

import { requireFor } from "../../../test-utils/require-for";
import { scrubBreadcrumb, scrubEvent, scrubSpan } from "./scrub";
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

// Ahead of "reporter scrub": Sentry wraps the `fetch` it finds once per module, so the spy must be there first and stay
describe("fetch spans", () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeAll(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  beforeEach(async () => {
    await Sentry.close();
    envelopes.length = 0;
    fetchSpy.mockImplementation(async () => new Response("{}"));
    const options = sentryOptions({ dsn: DSN, tracesSampleRate: 1 });
    Sentry.init({
      dsn: options.dsn,
      tracesSampleRate: options.tracesSampleRate,
      tracePropagationTargets: options.tracePropagationTargets,
      traceLifecycle: options.traceLifecycle,
      integrations: options.integrations,
      beforeSendTransaction: options.beforeSendTransaction,
      beforeSendSpan: options.beforeSendSpan,
      transport: () => ({
        send: async (envelope) => {
          envelopes.push(envelope);
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    });
  });

  afterEach(() => {
    // The fetch and transaction breadcrumbs would reach the next describe's events
    Sentry.getIsolationScope().clearBreadcrumbs();
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });

  const httpSpansOf = () =>
    envelopes
      .map((envelope) => itemsOf(envelope)[0])
      .filter(([header]) => header.type === "transaction")
      .flatMap(
        ([, event]) =>
          (
            event as unknown as {
              spans?: {
                op?: string;
                description?: string;
                data?: Record<string, unknown>;
              }[];
            }
          ).spans ?? []
      )
      .filter((span) => span.op === "http.client");

  // `sig`, not `api-key`: Sentry's own query filter already hides `api-key`
  it("should redact a bare token query term, a key-named query value and a token fragment in a fetch span's attributes", async () => {
    const TOKEN = "abc123def456ghi789";

    await Sentry.startNewTrace(() =>
      Sentry.startSpan({ name: "/", op: "pageload" }, async () => {
        await fetch(`https://rpc.example.test/?${TOKEN}&sig=abc#${TOKEN}`);
      })
    );
    await Sentry.flush();

    const [span] = httpSpansOf();
    expect(span.data).toMatchObject({
      "url.query": "[redacted]&sig=[redacted]",
      "url.fragment": "[redacted]",
    });
    expect(JSON.stringify(envelopes)).not.toContain(TOKEN);
  });

  // The description and `url.full` are scrubbed twice, by `beforeSendSpan` and by `beforeSendTransaction`
  it("should redact a token-like host label in a fetch span's description, url.full, server.address and url.domain", async () => {
    const LABEL = "acme-mainnet-4f2a9c1b7d3e";

    await Sentry.startNewTrace(() =>
      Sentry.startSpan({ name: "/", op: "pageload" }, async () => {
        await fetch(`https://${LABEL}.rpc.example.test/`);
      })
    );
    await Sentry.flush();

    const [span] = httpSpansOf();
    expect(span.description).toBe("GET https://[redacted].rpc.example.test/");
    expect(span.data).toMatchObject({
      "url.full": "https://[redacted].rpc.example.test/",
      "server.address": "[redacted].rpc.example.test",
      "url.domain": "[redacted].rpc.example.test",
    });
    expect(JSON.stringify(envelopes)).not.toContain(LABEL);
  });

  it("should add neither sentry-trace nor baggage to a same-origin or a cross-origin fetch in a sampled span", async () => {
    await Sentry.startNewTrace(() =>
      Sentry.startSpan({ name: "/", op: "pageload" }, async () => {
        await fetch("/api/sync");
        await fetch("https://build.example.test/build");
      })
    );
    await Sentry.flush();

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "/api/sync",
      "https://build.example.test/build",
    ]);
    for (const [, init] of fetchSpy.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.has("sentry-trace")).toBe(false);
      expect(headers.has("baggage")).toBe(false);
    }
    // Both requests became spans, so Sentry's fetch wrapper ran over the spy
    expect(httpSpansOf()).toHaveLength(2);
  });
});

describe("reporter scrub", () => {
  // A 64-byte secret key's length in base58, and a 44-character public key
  const KEY = "3Xz9".repeat(22);
  const PUBKEY = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const SECRET = Array.from({ length: 64 }, (_, i) => (i * 7) % 256);

  interface ScrubbedEvent {
    message?: string;
    release?: string;
    environment?: string;
    fingerprint?: string[];
    tags?: Record<string, unknown>;
    breadcrumbs?: { category?: string; message?: string }[];
    exception?: { values?: { value?: string }[] };
    extra?: Record<string, unknown>;
    contexts?: { feedback?: Record<string, unknown> };
  }
  interface ScrubbedTransaction {
    transaction?: string;
    spans?: { description?: string; data?: Record<string, unknown> }[];
  }
  // The session integration sends envelopes of its own; these are the events and feedback
  const eventsOf = () =>
    envelopes
      .map((envelope) => itemsOf(envelope)[0])
      .filter(
        ([header]) => header.type === "event" || header.type === "feedback"
      )
      .map(([, event]) => event as ScrubbedEvent);

  const recording: Transport = () => ({
    send: async (envelope) => {
      envelopes.push(envelope);
      return { statusCode: 200 };
    },
    flush: async () => true,
  });

  /** Starts Sentry with the production options, over the recording transport */
  const start = (integrations: Sentry.BrowserOptions["integrations"]) => {
    const options = sentryOptions({
      dsn: DSN,
      release: "abc123",
      environment: "production",
      tracesSampleRate: 0,
    });
    Sentry.init({
      dsn: options.dsn,
      release: options.release,
      environment: options.environment,
      integrations,
      beforeBreadcrumb: options.beforeBreadcrumb,
      beforeSend: options.beforeSend,
      transport: recording,
    });
  };

  // The default integrations, less the ones `LEFT_OUT` drops, `Console` among them
  beforeEach(async () => {
    await Sentry.close();
    envelopes.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    start(sentryOptions({ dsn: DSN, tracesSampleRate: 0 }).integrations);
  });

  afterEach(() => vi.restoreAllMocks());

  it("should install the scrub, tracing and no console breadcrumbs when the reporter initialises", async () => {
    await Sentry.close();
    reporter.init({ dsn: DSN, tracesSampleRate: 0 });

    const client = Sentry.getClient();
    expect(client?.getOptions().beforeSend).toBe(scrubEvent);
    expect(client?.getOptions().beforeBreadcrumb).toBe(scrubBreadcrumb);
    expect(client?.getOptions().beforeSendTransaction).toBe(
      sentryOptions({ dsn: DSN, tracesSampleRate: 0 }).beforeSendTransaction
    );
    expect(client?.getOptions().beforeSendSpan).toBe(scrubSpan);
    expect(client?.getOptions().traceLifecycle).toBe("static");
    expect(client?.getIntegrationByName("Console")).toBeUndefined();
    expect(client?.getIntegrationByName("BrowserTracing")).toBeDefined();
  });

  it("should send a transaction with a secret key redacted in its name and its spans", async () => {
    await Sentry.close();
    envelopes.length = 0;
    const options = sentryOptions({ dsn: DSN, tracesSampleRate: 1 });
    Sentry.init({
      dsn: options.dsn,
      tracesSampleRate: options.tracesSampleRate,
      traceLifecycle: options.traceLifecycle,
      beforeSendTransaction: options.beforeSendTransaction,
      defaultIntegrations: false,
      transport: recording,
    });

    // A new trace: an earlier test's unsampled page-load span stays active, and its children go unsampled
    Sentry.startNewTrace(() =>
      Sentry.startSpan({ name: `/share?k=${KEY}`, op: "pageload" }, () => {
        Sentry.startSpan(
          {
            name: `GET /api/x?k=${KEY}`,
            op: "http.client",
            attributes: { url: `/api/x?k=${KEY}` },
          },
          () => {}
        );
      })
    );
    await Sentry.flush();

    const transactions = envelopes
      .map((envelope) => itemsOf(envelope)[0])
      .filter(([header]) => header.type === "transaction")
      .map(([, event]) => event as unknown as ScrubbedTransaction);
    expect(transactions).toHaveLength(1);
    const [transaction] = transactions;
    expect(transaction.transaction).toBe("/share?k=[redacted]");
    expect(transaction.spans).toEqual([
      expect.objectContaining({
        description: "GET /api/x?k=[redacted]",
        data: expect.objectContaining({ url: "/api/x?k=[redacted]" }),
      }),
    ]);
    expect(JSON.stringify(envelopes)).not.toContain(KEY);
  });

  it("should send a standalone span, as INP is sent, with a secret key redacted in its attributes", async () => {
    await Sentry.close();
    envelopes.length = 0;
    const options = sentryOptions({ dsn: DSN, tracesSampleRate: 1 });
    Sentry.init({
      dsn: options.dsn,
      tracesSampleRate: options.tracesSampleRate,
      traceLifecycle: options.traceLifecycle,
      beforeSendSpan: options.beforeSendSpan,
      // The defaults filtered: `ScrubSamplingContext` among them scrubs the envelope header
      integrations: options.integrations,
      transport: recording,
    });

    // The options `_emitWebVitalSpan` in `@sentry/browser-utils` starts an INP span with in static mode
    Sentry.startNewTrace(() =>
      Sentry.startInactiveSpan({
        name: `button#k-${KEY}`,
        op: "ui.interaction.click",
        attributes: {
          "sentry.transaction": `/share?k=${KEY}`,
          "browser.web_vital.inp.target": `button#k-${KEY}`,
        },
        experimental: { standalone: true },
      }).end()
    );
    await Sentry.flush();

    const spans = envelopes
      .flatMap((envelope) => itemsOf(envelope))
      .filter(([header]) => header.type === "span");
    expect(spans).toHaveLength(1);
    const sent = JSON.stringify(spans);
    expect(sent).toContain("/share?k=[redacted]");
    expect(sent).toContain("button#k-[redacted]");
    expect(JSON.stringify(envelopes)).not.toContain(KEY);
  });

  describe("a span the scrub cannot walk", () => {
    const hostile = {
      get boom(): string {
        throw new TypeError(`getter ${KEY}`);
      },
    } as unknown as string;

    beforeEach(async () => {
      await Sentry.close();
      envelopes.length = 0;
      const options = sentryOptions({ dsn: DSN, tracesSampleRate: 1 });
      Sentry.init({
        dsn: options.dsn,
        tracesSampleRate: options.tracesSampleRate,
        traceLifecycle: options.traceLifecycle,
        beforeSendTransaction: options.beforeSendTransaction,
        beforeSendSpan: options.beforeSendSpan,
        // Sentry's normalising would turn the getter into text before the scrub sees it
        normalizeDepth: 0,
        defaultIntegrations: false,
        transport: recording,
      });
    });

    const transactionsOf = () =>
      envelopes
        .map((envelope) => itemsOf(envelope)[0])
        .filter(([header]) => header.type === "transaction")
        .map(([, event]) => event as unknown as ScrubbedTransaction);

    it("should send the transaction marked, with its measurements, when it is the root span", async () => {
      Sentry.startNewTrace(() =>
        Sentry.startSpan(
          {
            name: `/share?k=${KEY}`,
            op: "pageload",
            attributes: { hostile },
          },
          () => {
            Sentry.setMeasurement("lcp", 1200, "millisecond");
            Sentry.startSpan({ name: "child", op: "ui.render" }, () => {});
          }
        )
      );
      await Sentry.flush();

      const transactions = transactionsOf();
      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        contexts: { trace: { data: { "scrub.withheld": true } } },
        measurements: { lcp: { value: 1200, unit: "millisecond" } },
      });
      expect(JSON.stringify(envelopes)).not.toContain(KEY);
    });

    it("should send the transaction with that child span marked as withheld", async () => {
      Sentry.startNewTrace(() =>
        Sentry.startSpan({ name: "/", op: "pageload" }, () => {
          Sentry.startSpan(
            {
              name: `GET /x?k=${KEY}`,
              op: "http.client",
              attributes: { hostile },
            },
            () => {}
          );
        })
      );
      await Sentry.flush();

      const [transaction] = transactionsOf();
      expect(transaction.transaction).toBe("/");
      expect(transaction.spans).toEqual([
        expect.objectContaining({
          description: "Span withheld: scrubbing it failed",
          data: { "sentry.op": "http.client", "scrub.withheld": true },
        }),
      ]);
      expect(JSON.stringify(envelopes)).not.toContain(KEY);
    });

    // Sentry sends a standalone span's `data` as its attributes, and neither its `op` nor its measurements
    it("should send a standalone span, as INP is sent, marked, with its op and its Web Vital value", async () => {
      Sentry.startNewTrace(() =>
        Sentry.startInactiveSpan({
          name: "button#deploy",
          attributes: {
            "sentry.op": "ui.interaction.click",
            "browser.web_vital.inp.value": 120,
            hostile,
          },
          experimental: { standalone: true },
        }).end()
      );
      await Sentry.flush();

      const spans = envelopes
        .flatMap((envelope) => itemsOf(envelope))
        .filter(([header]) => header.type === "span")
        .map(([, container]) => container);
      expect(spans).toEqual([
        expect.objectContaining({
          items: [
            expect.objectContaining({
              name: "Span withheld: scrubbing it failed",
              attributes: {
                "sentry.op": { type: "string", value: "ui.interaction.click" },
                "browser.web_vital.inp.value": { type: "integer", value: 120 },
                "scrub.withheld": { type: "boolean", value: true },
              },
            }),
          ],
        }),
      ]);
      expect(JSON.stringify(envelopes)).not.toContain(KEY);
    });
  });

  it("should drop a transaction it cannot walk and send one withheld message per session", async () => {
    await Sentry.close();
    envelopes.length = 0;
    const options = sentryOptions({ dsn: DSN, tracesSampleRate: 1 });
    Sentry.init({
      dsn: options.dsn,
      tracesSampleRate: options.tracesSampleRate,
      traceLifecycle: options.traceLifecycle,
      beforeSend: options.beforeSend,
      beforeSendTransaction: options.beforeSendTransaction,
      // Sentry's normalising would turn the getter into text before the scrub sees it
      normalizeDepth: 0,
      defaultIntegrations: false,
      transport: recording,
    });
    const hostile = {
      get boom(): string {
        throw new TypeError(`getter ${KEY}`);
      },
    };
    const loadPage = () =>
      Sentry.withScope((scope) => {
        // Not a span attribute: `beforeSendSpan` would reduce it before the transaction's own walk
        scope.setExtra("hostile", hostile);
        Sentry.startNewTrace(() =>
          Sentry.startSpan({ name: "/", op: "pageload" }, () => {})
        );
      });

    loadPage();
    await Sentry.flush();
    loadPage();
    await Sentry.flush();

    const items = envelopes.map((envelope) => itemsOf(envelope)[0]);
    expect(items.filter(([header]) => header.type === "transaction")).toEqual(
      []
    );
    expect(eventsOf()).toEqual([
      expect.objectContaining({
        message: "Transaction withheld: scrubbing it failed",
        tags: { scrub_error: "TypeError" },
      }),
    ]);
    expect(JSON.stringify(envelopes)).not.toContain(KEY);
  });

  // After the withheld-message test: a drop here would spend its once-per-session message
  it("should send a transaction whose scope holds a value the scrub cannot walk, without that value", async () => {
    await Sentry.close();
    envelopes.length = 0;
    const options = sentryOptions({ dsn: DSN, tracesSampleRate: 1 });
    Sentry.init({
      dsn: options.dsn,
      tracesSampleRate: options.tracesSampleRate,
      traceLifecycle: options.traceLifecycle,
      beforeSendTransaction: options.beforeSendTransaction,
      beforeSendSpan: options.beforeSendSpan,
      defaultIntegrations: false,
      transport: recording,
    });
    const hostile = {
      get boom(): string {
        throw new TypeError(`getter ${KEY}`);
      },
    };

    Sentry.withScope((scope) => {
      // The event gets the context normalised; the transaction's captured scope keeps it as set
      scope.setContext("x", hostile);
      Sentry.startNewTrace(() =>
        Sentry.startSpan({ name: "/", op: "pageload" }, () => {})
      );
    });
    await Sentry.flush();

    const transactions = envelopes
      .map((envelope) => itemsOf(envelope)[0])
      .filter(([header]) => header.type === "transaction");
    expect(transactions).toHaveLength(1);
    expect(JSON.stringify(envelopes)).not.toContain(KEY);
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

  it("should redact a key quoted as a JSON byte array in an error's message", async () => {
    reporter.capture({
      ns: "wallet:import",
      level: "error",
      error: new Error(`Unexpected token in ${JSON.stringify(SECRET)}`),
      report: true,
      unhandled: false,
    });
    await Sentry.flush();

    const [event] = eventsOf();
    expect(event.exception?.values?.[0].value).toBe(
      "Unexpected token in [redacted]"
    );
  });

  it("should drop the console breadcrumbs even with the Console integration on", async () => {
    await Sentry.close();
    envelopes.length = 0;
    start((defaults) =>
      defaults.filter((integration) => integration.name !== "GlobalHandlers")
    );
    userPrints(`  ✔ prints ${KEY}`);
    reporter.capture({
      ns: "wallet:connect",
      level: "error",
      error: new Error("bad"),
      report: true,
      unhandled: false,
    });
    await Sentry.flush();

    expect(Sentry.getClient()?.getIntegrationByName("Console")).toBeDefined();
    const [event] = eventsOf();
    // Earlier tests' events stay on the scope as `sentry.event` crumbs; no console one may join them
    const categories = (event.breadcrumbs ?? []).map((crumb) => crumb.category);
    expect(categories).not.toContain("console");
    expect(JSON.stringify(envelopes)).not.toContain(KEY);
  });

  it("should send a withheld report, telling deploys apart, for a tag it cannot scrub", async () => {
    // Tags reach `beforeSend` as set: Sentry normalises extras and contexts, not tags
    const hostile = {
      get boom(): string {
        throw new TypeError(`getter ${KEY}`);
      },
    };
    Sentry.withScope((scope) => {
      scope.setTag("hostile", hostile as unknown as string);
      reporter.capture({
        ns: "wallet:connect",
        level: "error",
        error: new Error(`bad ${KEY}`),
        report: true,
        unhandled: false,
      });
    });
    await Sentry.flush();

    const [event] = eventsOf();
    expect(event).toMatchObject({
      message: "Report withheld: scrubbing it failed",
      release: "abc123",
      environment: "production",
      fingerprint: ["scrub-withheld", "wallet:connect"],
      tags: {
        ns: "wallet:connect",
        exception_type: "Error",
        scrub_error: "TypeError",
      },
    });
    expect(JSON.stringify(envelopes)).not.toContain(KEY);
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
