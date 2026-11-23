import { act, render } from "@testing-library/react";

import { writeConsent } from "./consent";
import { GoogleAnalytics } from "./google-analytics";

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

  it("should clear the off switch on a later Allow", () => {
    writeConsent("allowed");
    render(<GoogleAnalytics measurementId="G-TEST" />);
    act(() => writeConsent("declined"));

    act(() => writeConsent("allowed"));

    expect(disableFlag("G-TEST")).toBe(false);
  });
});
