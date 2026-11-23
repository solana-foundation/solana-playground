import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  initTelemetry,
  memoryProvider,
  readConsent,
  resetTelemetry,
  writeConsent,
} from "@/shared/lib/telemetry";

import { AnalyticsSwitch } from "./AnalyticsSwitch";
import { ConsentBanner } from "./ConsentBanner";

let events: ReturnType<typeof memoryProvider>;

beforeEach(() => {
  events = memoryProvider();
  initTelemetry({ providers: [events] });
  window.localStorage.clear();
});

afterEach(() => {
  resetTelemetry();
  window.localStorage.clear();
});

const banner = () =>
  screen.queryByRole("region", { name: "Analytics consent" });

describe("ConsentBanner", () => {
  it("should show the question, the Privacy policy link and both buttons on a fresh browser", () => {
    render(<ConsentBanner />);

    expect(banner()?.textContent).toContain(
      "Playground uses Google Analytics to see which features people use. Allow it?"
    );
    const link = screen.getByRole("link", { name: "Privacy policy" });
    expect(link.getAttribute("href")).toBe("https://solana.com/privacy-policy");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
  });

  it("should store the choice, close and track declined via banner on Decline", async () => {
    render(<ConsentBanner />);

    await userEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(readConsent()).toBe("declined");
    expect(banner()).toBeNull();
    expect(events.events).toEqual([
      {
        name: "obs_analytics_consent_set",
        params: { choice: "declined", via: "banner" },
        scope: undefined,
      },
    ]);
  });

  it("should store the choice, close and track allowed via banner on Allow", async () => {
    render(<ConsentBanner />);

    await userEvent.click(screen.getByRole("button", { name: "Allow" }));

    expect(readConsent()).toBe("allowed");
    expect(banner()).toBeNull();
    expect(events.events.map(({ params }) => params)).toEqual([
      { choice: "allowed", via: "banner" },
    ]);
  });

  it("should not show once a choice is stored", () => {
    writeConsent("declined");

    render(<ConsentBanner />);

    expect(banner()).toBeNull();
  });

  it("should close when another part of the page answers", () => {
    render(<ConsentBanner />);

    act(() => writeConsent("allowed"));

    expect(banner()).toBeNull();
  });
});

describe("AnalyticsSwitch", () => {
  const analytics = () => screen.getByRole("switch", { name: "Analytics" });

  it("should read off for unanswered and declined, on for allowed", () => {
    render(<AnalyticsSwitch />);
    expect(analytics().getAttribute("aria-checked")).toBe("false");

    act(() => writeConsent("allowed"));
    expect(analytics().getAttribute("aria-checked")).toBe("true");

    act(() => writeConsent("declined"));
    expect(analytics().getAttribute("aria-checked")).toBe("false");
  });

  it("should store allowed and track via settings when turned on", async () => {
    writeConsent("declined");
    render(<AnalyticsSwitch />);

    await userEvent.click(analytics());

    expect(readConsent()).toBe("allowed");
    expect(events.events.map(({ params }) => params)).toEqual([
      { choice: "allowed", via: "settings" },
    ]);
  });

  it("should store declined and track via settings when turned off", async () => {
    writeConsent("allowed");
    render(<AnalyticsSwitch />);

    await userEvent.click(analytics());

    expect(readConsent()).toBe("declined");
    expect(events.events.map(({ params }) => params)).toEqual([
      { choice: "declined", via: "settings" },
    ]);
  });
});
