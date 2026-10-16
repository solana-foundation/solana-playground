import { render } from "@testing-library/react";

import { GoogleAnalytics } from "./google-analytics";
import { ga4Provider } from "./providers/ga4";

const gtagScripts = () =>
  document.querySelectorAll<HTMLScriptElement>(
    'script[src*="googletagmanager"]'
  );

/** The last call gtag.js will read, as the array it was called with */
const lastQueued = () => {
  const queue = window.dataLayer ?? [];
  return Array.from(queue[queue.length - 1] as ArrayLike<unknown>);
};

afterEach(() => {
  gtagScripts().forEach((script) => script.remove());
  delete window.gtag;
  delete window.dataLayer;
});

describe("ga4Provider", () => {
  it("should send nothing and set up nothing without a measurement id", () => {
    ga4Provider({}).send({ name: "auth_signed_out", params: {} });

    expect(window.gtag).toBeUndefined();
    expect(window.dataLayer).toBeUndefined();
  });

  it("should queue an event before gtag.js has loaded", () => {
    ga4Provider({ measurementId: "G-TEST" }).send({
      name: "auth_sign_in_failed",
      params: { reason: "cancelled" },
      scope: "header",
    });

    expect(lastQueued()).toEqual([
      "event",
      "auth_sign_in_failed",
      { reason: "cancelled", scope: "header" },
    ]);
  });
});

describe("GoogleAnalytics", () => {
  it("should inject nothing without a measurement id", () => {
    render(<GoogleAnalytics />);

    expect(gtagScripts()).toHaveLength(0);
  });

  it("should inject gtag.js once for the measurement id", () => {
    render(<GoogleAnalytics measurementId="G-TEST" />);
    render(<GoogleAnalytics measurementId="G-TEST" />);

    expect(gtagScripts()).toHaveLength(1);
    expect(gtagScripts()[0].src).toContain("id=G-TEST");
  });
});
