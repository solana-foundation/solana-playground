import type { Page } from "@playwright/test";

import { ANALYTICS_CHOICE_KEY } from "./analytics-choice";
import { expect, LONG, seedWorkspace, test } from "./fixtures";
import { lineOf, linesOn, linesRead } from "./telemetry";
import { WIDE_DESK } from "./viewports";

const GOOGLE = /googletagmanager\.com|google-analytics\.com/;
const GTAG = /googletagmanager\.com\/gtag\/js/;

/**
 * Every spec of the suite starts with the choice stored (`playwright.config.mts`)
 * so the banner stays out of their way. These start as a first visit: the
 * choice is forgotten once per tab, so a reload keeps what the visitor stored.
 */
const asFirstVisit = (page: Page) =>
  page.addInitScript((key) => {
    if (sessionStorage.getItem("e2e-choice-forgotten")) return;
    sessionStorage.setItem("e2e-choice-forgotten", "1");
    localStorage.removeItem(key);
  }, ANALYTICS_CHOICE_KEY);

/** Starts with the choice stored, as a visitor who answered on an earlier visit */
const answered = (page: Page, choice: "allowed" | "declined") =>
  page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem("e2e-choice-forgotten")) return;
      sessionStorage.setItem("e2e-choice-forgotten", "1");
      localStorage.setItem(key, value);
    },
    [ANALYTICS_CHOICE_KEY, choice]
  );

/**
 * Stubs gtag.js, so nothing reaches Google, and records every request to
 * Google's hosts. `gtag.js` itself answers an empty script: the queue
 * `ga4Provider` fills on `window.dataLayer` is what the page sends, and
 * the specs read it.
 */
const watchGoogle = async (page: Page) => {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (GOOGLE.test(request.url())) urls.push(request.url());
  });
  await page.route(GOOGLE, (route) =>
    route.fulfill({ contentType: "text/javascript", body: "" })
  );
  return urls;
};

const banner = (page: Page) =>
  page.getByRole("region", { name: "Analytics consent" });

const settings = (page: Page) => page.getByRole("region", { name: "Settings" });

const storedChoice = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), ANALYTICS_CHOICE_KEY);

/** The names of the events `ga4Provider` queued for gtag.js, in order; `undefined` before it installed the queue */
const queuedEvents = (page: Page) =>
  page.evaluate(() => {
    const queue = (window as { dataLayer?: unknown[] }).dataLayer;
    return queue
      ?.map((call) => Array.from(call as ArrayLike<unknown>))
      .filter(([command]) => command === "event")
      .map(([, name]) => String(name));
  });

/** Settings opens and closes with a tracked event each (`settings_opened`, `settings_closed`) */
const openSettings = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+,");
  await expect(settings(page)).toBeVisible();
};
const closeSettings = async (page: Page) => {
  await page.getByRole("button", { name: "Back to app" }).click();
  await expect(settings(page)).toBeHidden();
};

const analyticsSwitch = (page: Page) =>
  settings(page).getByRole("switch", { name: "Analytics" });

test("analytics-consent: A fresh browser", async ({ page }) => {
  await asFirstVisit(page);
  const google = await watchGoogle(page);

  await page.goto("/");

  await expect(banner(page)).toBeVisible(LONG);
  expect(await storedChoice(page)).toBeNull();
  expect(google).toEqual([]);
});

test("analytics-consent: A visitor who declines", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(WIDE_DESK);
  await asFirstVisit(page);
  const google = await watchGoogle(page);
  const lines = linesOn(page);
  // A deploy needs a built program and a cluster; a build that the server
  // refuses stands in, tracking `build_started` and `build_failed` all the same
  await page.route("**/build", (route) =>
    route.fulfill({ status: 500, body: "boom" })
  );
  await page.goto("/");

  await banner(page).getByRole("button", { name: "Decline" }).click();
  await expect(banner(page)).toBeHidden();
  // Events that would reach GA4 had the visitor allowed it
  await openSettings(page);
  await closeSettings(page);
  await seedWorkspace(page);
  await page.locator("#flow-stage-tab-build").click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Could not build" })
  ).toBeVisible(LONG);
  await expect
    .poll(async () => {
      await linesRead(lines);
      return lineOf(lines, "build_failed") !== undefined;
    })
    .toBe(true);

  expect(lineOf(lines, "build_started")).toBeDefined();
  expect(google).toEqual([]);
  expect(await queuedEvents(page)).toBeUndefined();
});

test("analytics-consent: A visitor who allows", async ({ page }) => {
  await asFirstVisit(page);
  const google = await watchGoogle(page);
  await page.goto("/");

  await banner(page).getByRole("button", { name: "Allow" }).click();
  await expect
    .poll(() => google.filter((url) => GTAG.test(url)))
    .toHaveLength(1);
  await openSettings(page);

  expect(await queuedEvents(page)).toContain("settings_opened");
  expect(google.filter((url) => GTAG.test(url))).toHaveLength(1);
});

test("analytics-consent: Allowing after some use", async ({ page }) => {
  await asFirstVisit(page);
  await watchGoogle(page);
  await page.goto("/");

  // `settings_opened` is tracked while the choice is unanswered
  await openSettings(page);
  await closeSettings(page);
  await banner(page).getByRole("button", { name: "Allow" }).click();
  await openSettings(page);

  const events = await queuedEvents(page);
  expect(events?.filter((name) => name === "settings_opened")).toHaveLength(1);
  // The first event GA4 got is the choice itself; the earlier use is not replayed
  expect(events?.[0]).toBe("obs_analytics_consent_set");
});

test("analytics-consent: The banner on a fresh browser", async ({ page }) => {
  await asFirstVisit(page);
  await watchGoogle(page);

  await page.goto("/");

  await expect(banner(page)).toBeVisible(LONG);
  await expect(banner(page)).toContainText(
    "Playground uses Google Analytics to see which features people use. Allow it?"
  );
  const link = banner(page).getByRole("link", { name: "Privacy policy" });
  await expect(link).toHaveAttribute(
    "href",
    "https://solana.com/privacy-policy"
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(
    banner(page).getByRole("button", { name: "Decline" })
  ).toBeVisible();
  await expect(
    banner(page).getByRole("button", { name: "Allow" })
  ).toBeVisible();
});

test("analytics-consent: The banner after an answer", async ({ page }) => {
  await asFirstVisit(page);
  await watchGoogle(page);
  await page.goto("/");

  await banner(page).getByRole("button", { name: "Decline" }).click();
  await expect(banner(page)).toBeHidden();
  await page.reload();

  // Wait for the app, so a banner that is late would have shown by now
  await expect(
    page.getByRole("heading", { name: "Where should we begin?" })
  ).toBeVisible(LONG);
  await expect(banner(page)).toBeHidden();
});

test("analytics-consent: Turning analytics off", async ({ page }) => {
  await answered(page, "allowed");
  const google = await watchGoogle(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Where should we begin?" })
  ).toBeVisible(LONG);
  // What gtag.js would have left on the domain
  await page.evaluate(() => {
    document.cookie = "_ga=GA1.1.1.1; path=/";
    document.cookie = "_ga_TEST000000=GS1.1.1; path=/";
  });

  await openSettings(page);
  await expect(analyticsSwitch(page)).toBeChecked();
  await analyticsSwitch(page).click();

  await expect(analyticsSwitch(page)).not.toBeChecked();
  expect(await storedChoice(page)).toBe("declined");
  expect(await page.evaluate(() => document.cookie)).not.toContain("_ga");
  const gtagOnWindow = () =>
    page.evaluate(() => {
      const { gtag, dataLayer } = window as {
        gtag?: unknown;
        dataLayer?: unknown;
      };
      return { gtag: typeof gtag, dataLayer: typeof dataLayer };
    });
  expect(await gtagOnWindow()).toEqual({
    gtag: "undefined",
    dataLayer: "undefined",
  });
  const sent = google.length;
  // Tracked events, which would reach `gtag` were it still on `window`
  await closeSettings(page);
  await openSettings(page);
  expect(await gtagOnWindow()).toEqual({
    gtag: "undefined",
    dataLayer: "undefined",
  });
  expect(google).toHaveLength(sent);
});

test("analytics-consent: Turning analytics on from Settings", async ({
  page,
}) => {
  await answered(page, "declined");
  const google = await watchGoogle(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Where should we begin?" })
  ).toBeVisible(LONG);
  await openSettings(page);
  expect(google).toEqual([]);

  await analyticsSwitch(page).click();

  await expect(analyticsSwitch(page)).toBeChecked();
  expect(await storedChoice(page)).toBe("allowed");
  await expect
    .poll(() => google.filter((url) => GTAG.test(url)))
    .toHaveLength(1);
});

test("analytics-consent: Declining on the banner", async ({ page }) => {
  await asFirstVisit(page);
  await watchGoogle(page);
  const lines = linesOn(page);
  await page.goto("/");

  await banner(page).getByRole("button", { name: "Decline" }).click();

  await expect
    .poll(async () => {
      await linesRead(lines);
      return lines.some(
        (line) =>
          line.startsWith("[telemetry:event] obs_analytics_consent_set ") &&
          line.includes("choice: declined") &&
          line.includes("via: banner")
      );
    })
    .toBe(true);
  expect(await queuedEvents(page)).toBeUndefined();
});
