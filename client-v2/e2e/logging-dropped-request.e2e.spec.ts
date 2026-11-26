import type { Page } from "@playwright/test";

import { expect, LONG, seedWorkspace, stubSignedIn, test } from "./fixtures";
import { lineOf, linesOn, linesRead } from "./telemetry";

/**
 * What a signed-in browser logs when the thread pull (`GET
 * /api/conversations?threadId=`) fails. The page's own logger is the
 * observable: a dropped connection is a `warn` and a telemetry count, a
 * timeout is reported as an `error`.
 */

const DIAGNOSTICS = "[persistence:diagnostics]";

/** The diagnostics entries the page logs from now on, with their console level */
const diagnosticsOn = (page: Page) => {
  const entries: { type: string; text: string }[] = [];
  page.on("console", (message) => {
    if (!message.text().includes(DIAGNOSTICS)) return;
    entries.push({ type: message.type(), text: message.text() });
  });
  return entries;
};

const signedInWith = async (
  page: Page,
  answer: Parameters<Page["route"]>[1]
) => {
  await stubSignedIn(page.context());
  // Registered after the stub's own, so it answers first
  await page.route(/\/api\/conversations\?threadId=/, answer);
};

test("client-v2-logging: A sync pull loses its connection", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const entries = diagnosticsOn(page);
  const lines = linesOn(page);
  await signedInWith(page, (route) => route.abort("failed"));

  // Opening a project opens its thread, which pulls the account's copy
  await seedWorkspace(page);

  // A dropped connection is a warning, not an error: the next pull asks again
  await expect
    .poll(
      () =>
        entries.find(
          (entry) =>
            entry.type === "warning" &&
            entry.text.includes("pull ") &&
            entry.text.includes("failed: the connection dropped")
        ),
      LONG
    )
    .toBeDefined();
  // ...and it is counted instead of reported
  await expect
    .poll(async () => {
      await linesRead(lines);
      return lineOf(lines, "sync_request_dropped");
    })
    .toContain("op: pull");
  expect(entries.filter((entry) => entry.type === "error")).toEqual([]);
});

test("client-v2-logging: A sync request times out", async ({ page }) => {
  test.setTimeout(120_000);
  const entries = diagnosticsOn(page);
  const lines = linesOn(page);
  // Never answers: the pull's own 15 s timeout (`LOCKED_REQUEST_MS`) ends it
  await signedInWith(page, () => new Promise<void>(() => undefined));

  // Opening a project opens its thread, which pulls the account's copy
  await seedWorkspace(page);

  // Still reported, since a timeout is a fault on our side of the wire
  await expect
    .poll(() => entries.some((entry) => entry.type === "error"), {
      timeout: 45_000,
    })
    .toBe(true);
  await linesRead(lines);
  expect(lineOf(lines, "sync_request_dropped")).toBeUndefined();
});
