import { act, render } from "@testing-library/react";

import { initLogger, memoryProvider, resetLogger } from "../logger";
import { writeConsent } from "./consent";
import { GoogleAnalytics } from "./google-analytics";
import { ga4Provider } from "./providers/ga4";

const gtagScripts = () =>
  document.querySelectorAll<HTMLScriptElement>(
    'script[src*="googletagmanager"]'
  );

const disableFlag = (id: string) =>
  Reflect.get(window, `ga-disable-${id}`) as boolean | undefined;

afterEach(() => {
  gtagScripts().forEach((script) => script.remove());
  window.localStorage.clear();
  Reflect.deleteProperty(window, "ga-disable-G-TEST");
  delete window.gtag;
  delete window.dataLayer;
  document.cookie = "_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  document.cookie = "_ga_TEST=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

describe("GoogleAnalytics", () => {
  it("should inject nothing without a measurement id", () => {
    writeConsent("allowed");
    render(<GoogleAnalytics />);

    expect(gtagScripts()).toHaveLength(0);
  });

  it("should inject nothing while the choice is unanswered", () => {
    render(<GoogleAnalytics measurementId="G-TEST" />);

    expect(gtagScripts()).toHaveLength(0);
  });

  it("should inject nothing while the choice is declined", () => {
    writeConsent("declined");
    render(<GoogleAnalytics measurementId="G-TEST" />);

    expect(gtagScripts()).toHaveLength(0);
  });

  it("should inject gtag.js once for the measurement id when the choice is allowed", () => {
    writeConsent("allowed");
    render(<GoogleAnalytics measurementId="G-TEST" />);
    render(<GoogleAnalytics measurementId="G-TEST" />);

    expect(gtagScripts()).toHaveLength(1);
    expect(gtagScripts()[0].src).toContain("id=G-TEST");
  });

  it("should inject gtag.js when the choice turns to allowed, without a remount", () => {
    render(<GoogleAnalytics measurementId="G-TEST" />);
    expect(gtagScripts()).toHaveLength(0);

    act(() => writeConsent("allowed"));

    expect(gtagScripts()).toHaveLength(1);
  });

  it("should switch GA4 off and expire its cookies when the choice turns from allowed to declined", () => {
    writeConsent("allowed");
    document.cookie = "_ga=GA1.1.1; path=/";
    document.cookie = "_ga_TEST=GS1.1; path=/";
    render(<GoogleAnalytics measurementId="G-TEST" />);
    expect(disableFlag("G-TEST")).toBe(false);

    act(() => writeConsent("declined"));

    expect(disableFlag("G-TEST")).toBe(true);
    expect(document.cookie).not.toContain("_ga");
  });

  it("should expire the cookies an older build set while the choice is unanswered", () => {
    document.cookie = "_ga=GA1.1.1; path=/";
    document.cookie = "_ga_TEST=GS1.1; path=/";

    render(<GoogleAnalytics measurementId="G-TEST" />);

    expect(document.cookie).not.toContain("_ga");
    expect(gtagScripts()).toHaveLength(0);
  });

  it("should log at info when gtag.js fails to load", () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    writeConsent("allowed");
    render(<GoogleAnalytics measurementId="G-TEST" />);

    gtagScripts()[0].dispatchEvent(new Event("error"));

    expect(logged.entries).toEqual([
      expect.objectContaining({
        ns: "telemetry:google-analytics",
        level: "info",
        message: "gtag.js did not load",
      }),
    ]);
    resetLogger();
  });

  it("should clear the off switch on a later Allow", () => {
    writeConsent("allowed");
    render(<GoogleAnalytics measurementId="G-TEST" />);
    act(() => writeConsent("declined"));

    act(() => writeConsent("allowed"));

    expect(disableFlag("G-TEST")).toBe(false);
  });

  it("should take gtag and its queue off window when the choice turns to declined", () => {
    writeConsent("allowed");
    render(<GoogleAnalytics measurementId="G-TEST" />);
    const provider = ga4Provider({ measurementId: "G-TEST" });
    provider.send({ name: "dply_started", params: {} });
    expect(window.gtag).toBeDefined();

    act(() => writeConsent("declined"));
    provider.send({ name: "dply_succeeded", params: {} });

    expect(window.gtag).toBeUndefined();
    expect(window.dataLayer).toBeUndefined();
    // Takes the parked queue back, so no later test inherits it
    act(() => writeConsent("allowed"));
  });

  it("should give a later Allow the queue gtag.js already drains, and send to it again", () => {
    writeConsent("allowed");
    render(<GoogleAnalytics measurementId="G-TEST" />);
    const provider = ga4Provider({ measurementId: "G-TEST" });
    provider.send({ name: "dply_started", params: {} });
    const drained = window.dataLayer;
    act(() => writeConsent("declined"));
    provider.send({ name: "dply_failed", params: {} });

    act(() => writeConsent("allowed"));
    provider.send({ name: "dply_succeeded", params: {} });

    expect(window.dataLayer).toBe(drained);
    const events = (window.dataLayer ?? [])
      .map((call) => Array.from(call as ArrayLike<unknown>))
      .filter(([command]) => command === "event")
      .map(([, name]) => name);
    expect(events).toEqual(["dply_started", "dply_succeeded"]);
    expect(gtagScripts()).toHaveLength(1);
  });
});
