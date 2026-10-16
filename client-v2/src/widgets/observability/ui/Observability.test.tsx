import { StrictMode } from "react";
import type { ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { render, screen } from "@testing-library/react";

import { resetLogger } from "../../../shared/lib/logger";
import { resetTelemetry } from "../../../shared/lib/telemetry";
import { resetObservability } from "../model/init";
import { Observability } from "./Observability";

vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  withScope: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

afterEach(() => {
  resetObservability();
  resetLogger();
  resetTelemetry();
  document
    .querySelectorAll('script[src*="googletagmanager"]')
    .forEach((script) => script.remove());
  delete window.gtag;
  delete window.dataLayer;
});

const renderObservability = (
  children: ReactNode,
  googleAnalytics: { measurementId?: string } = {}
) =>
  render(
    <StrictMode>
      <Observability
        sentry={{ dsn: "https://key@o0.ingest.sentry.io/0" }}
        googleAnalytics={googleAnalytics}
        logLevel="error"
        fallback={<p role="alert">fallback</p>}
      >
        {children}
      </Observability>
    </StrictMode>
  );

/** Events queued for gtag.js, by name */
const queuedEvents = () =>
  (window.dataLayer ?? [])
    .map((call) => Array.from(call as ArrayLike<unknown>))
    .filter(([command]) => command === "event")
    .map(([, name]) => name);

it("should initialise Sentry and queue obs_initialised once under StrictMode's double render", () => {
  // No gtag.js and no stub beforehand, as on a real page load
  renderObservability(<p>app</p>, { measurementId: "G-TEST" });

  expect(screen.getByText("app")).toBeTruthy();
  expect(Sentry.init).toHaveBeenCalledTimes(1);
  expect(queuedEvents()).toEqual(["obs_initialised"]);
  expect(
    document.querySelectorAll('script[src*="googletagmanager"]')
  ).toHaveLength(1);
});

it("should have Sentry initialised before a child's first render", () => {
  const initialisedAtRender: boolean[] = [];
  const Child = () => {
    initialisedAtRender.push(vi.mocked(Sentry.init).mock.calls.length > 0);
    return null;
  };

  renderObservability(<Child />);

  expect(initialisedAtRender[0]).toBe(true);
});

it("should show the fallback and report when a child throws while rendering", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const Thrower = (): never => {
    throw new Error("render failed");
  };

  renderObservability(<Thrower />);

  expect(screen.getByRole("alert").textContent).toBe("fallback");
  expect(Sentry.withScope).toHaveBeenCalled();
});

it("should warn in the console about each missing id", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  render(
    <Observability
      sentry={{}}
      googleAnalytics={{}}
      logLevel="warn"
      fallback={null}
    >
      <p>app</p>
    </Observability>
  );

  expect(warn.mock.calls).toEqual([
    [
      "[observability:init]",
      "Sentry DSN is not set; errors are not reported to Sentry",
    ],
    [
      "[observability:init]",
      "GA4 measurement id is not set; events are not sent to Google Analytics",
    ],
  ]);
});

it("should send nothing to Google without a measurement id", () => {
  renderObservability(<p>app</p>);

  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
  expect(window.dataLayer).toBeUndefined();
});
