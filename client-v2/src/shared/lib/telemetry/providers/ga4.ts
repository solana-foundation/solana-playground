import { readConsent } from "../consent";
import type { TelemetryEvent, TelemetryProvider } from "../types";

// gtag.js is a browser script, and Google's snippet puts both on `window`
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const paramsOf = ({ params, scope }: TelemetryEvent) =>
  scope === undefined ? params : { ...params, scope };

/** The queue gtag.js drains once it loads; it reads `arguments` objects, not arrays */
const installGtagQueue = (measurementId: string) => {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId);
};

/**
 * Sends events to GA4 for `measurementId`; without one, or outside a browser, sends nothing.
 *
 * Asks the consent store at every send (`analytics-consent`). The gtag queue
 * does not exist until the first event tracked while the choice is `allowed`,
 * so nothing tracked before Allow is ever queued, and a later Allow does not
 * replay it. While the choice is not `allowed`, events are dropped.
 */
export const ga4Provider = ({
  measurementId,
}: {
  measurementId?: string;
}): TelemetryProvider => {
  if (!measurementId || typeof window === "undefined") {
    return { send: () => {} };
  }

  return {
    send: (event) => {
      if (readConsent() !== "allowed") return;
      if (!window.gtag) installGtagQueue(measurementId);
      window.gtag?.("event", event.name, paramsOf(event));
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll, afterEach, vi } = import.meta.vitest;

  /** The calls gtag.js will read, each as the array it was called with */
  const queued = () =>
    (window.dataLayer ?? []).map((call) =>
      Array.from(call as ArrayLike<unknown>)
    );

  describe("shared/lib/telemetry/providers/ga4", () => {
    let writeConsent: typeof import("../consent").writeConsent;
    beforeAll(async () => {
      ({ writeConsent } = await import("../consent"));
    });

    afterEach(() => {
      vi.restoreAllMocks();
      window.localStorage.clear();
      delete window.gtag;
      delete window.dataLayer;
    });

    it("should send nothing and set up nothing without a measurement id", () => {
      writeConsent("allowed");

      ga4Provider({}).send({ name: "auth_signed_out", params: {} });

      expect(window.gtag).toBeUndefined();
      expect(window.dataLayer).toBeUndefined();
    });

    it("should leave window.gtag and window.dataLayer undefined while unanswered", () => {
      const provider = ga4Provider({ measurementId: "G-TEST" });

      provider.send({ name: "dply_started", params: {} });

      expect(window.gtag).toBeUndefined();
      expect(window.dataLayer).toBeUndefined();
    });

    it("should leave window.gtag and window.dataLayer undefined once declined", () => {
      writeConsent("declined");

      ga4Provider({ measurementId: "G-TEST" }).send({
        name: "dply_started",
        params: {},
      });

      expect(window.gtag).toBeUndefined();
      expect(window.dataLayer).toBeUndefined();
    });

    it("should leave window.gtag undefined when storage throws", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });

      expect(() =>
        ga4Provider({ measurementId: "G-TEST" }).send({
          name: "dply_started",
          params: {},
        })
      ).not.toThrow();

      expect(window.gtag).toBeUndefined();
    });

    it("should queue an event for gtag.js once allowed, before gtag.js has loaded", () => {
      writeConsent("allowed");

      ga4Provider({ measurementId: "G-TEST" }).send({
        name: "auth_sign_in_failed",
        params: { reason: "cancelled" },
        scope: "header",
      });

      expect(queued().at(-1)).toEqual([
        "event",
        "auth_sign_in_failed",
        { reason: "cancelled", scope: "header" },
      ]);
    });

    it("should never send an event tracked before Allow, and send one tracked after", () => {
      const provider = ga4Provider({ measurementId: "G-TEST" });

      provider.send({ name: "dply_started", params: {} });
      writeConsent("allowed");
      provider.send({ name: "dply_succeeded", params: {} });

      const events = queued()
        .filter(([command]) => command === "event")
        .map(([, name]) => name);
      expect(events).toEqual(["dply_succeeded"]);
    });

    it("should stop sending at once when the choice turns to declined", () => {
      writeConsent("allowed");
      const provider = ga4Provider({ measurementId: "G-TEST" });
      provider.send({ name: "dply_started", params: {} });

      writeConsent("declined");
      provider.send({ name: "dply_succeeded", params: {} });

      const events = queued()
        .filter(([command]) => command === "event")
        .map(([, name]) => name);
      expect(events).toEqual(["dply_started"]);
    });
  });
}
