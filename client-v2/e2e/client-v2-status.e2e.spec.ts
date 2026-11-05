import type { Page } from "@playwright/test";

import { expect, json, seedWorkspace, test } from "./fixtures";
import { lineOf, linesOn } from "./telemetry";
import { DESK, PHONE, TABLET, WIDE_DESK } from "./viewports";

/** The stock Sidebar, which holds the navigation and its foot */
const nav = (page: Page) => page.locator('[data-slot="sidebar"]');
const row = (page: Page) => page.getByTestId("status-row");

const network = (page: Page) =>
  row(page).getByRole("button", { name: /^Change cluster, currently devnet/ });
const ai = (page: Page) => row(page).getByRole("button", { name: /^AI, / });
const rust = (page: Page) =>
  row(page).getByRole("button", { name: /^Rust analyzer/ });
const notice = (page: Page) => page.getByTestId("stage-notice");

const OFFLINE_LINE =
  "You're offline. Editing still works. Build, Deploy and the assistant need a connection.";

/**
 * Devnet answers `getSlot` with one slot that never moves: down by
 * `PgConnection.getIsClusterDown`, which reads the slot twice a second apart
 */
const stallDevnet = (page: Page) =>
  page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as {
      id?: unknown;
      method?: string;
    } | null;
    if (body?.method !== "getSlot") return route.continue();
    return json(route, { jsonrpc: "2.0", result: 123, id: body.id });
  });

test.describe("on a 1440 px window", () => {
  test.use({ viewport: WIDE_DESK });

  test("client-v2-status: Three indicators in one pattern", async ({
    seededPage: page,
  }) => {
    for (const indicator of [network(page), ai(page), rust(page)]) {
      await expect(indicator).toBeVisible();
      await expect(indicator.locator('[data-slot="status-dot"]')).toHaveCount(
        1
      );
    }
    await expect(network(page)).toContainText("Devnet");
    await expect(rust(page)).toContainText("Rust");
  });

  test("client-v2-status: No model connected", async ({ seededPage: page }) => {
    const lines = linesOn(page);
    await expect(ai(page)).toHaveText("AI · Off");
    await ai(page).click();
    await expect(
      page.getByRole("dialog", { name: "Connect a model" })
    ).toBeVisible();
    await expect
      .poll(() => lineOf(lines, "assistant_connect_opened"))
      .toContain("{via: status}");
  });

  test("client-v2-status: Picking an indicator is measured", async ({
    seededPage: page,
  }) => {
    const lines = linesOn(page);
    await ai(page).click();
    await expect
      .poll(() => lineOf(lines, "status_indicator_picked"))
      // No model is grey (`idle`), which is measured as ready
      .toContain("{indicator: ai, state: ready, from: row}");
  });

  test("client-v2-status: A cluster that stops answering", async ({
    seededPage: page,
  }) => {
    await stallDevnet(page);
    await page.reload();

    const down = row(page).getByRole("button", {
      name: "Change cluster, currently devnet, not responding",
    });
    await expect(down).toHaveText("Devnet · Not responding", {
      timeout: 15_000,
    });
    // Waiting, not broken: the offline notice's warning colour, not red
    await expect(down.locator('[data-slot="status-dot"]')).toHaveAttribute(
      "data-variant",
      "warning"
    );
    const lines = linesOn(page);
    await down.click();
    await expect
      .poll(() => lineOf(lines, "settings_opened"))
      .toContain("{from: cluster}");
    await expect(
      page
        .getByRole("region", { name: "Settings" })
        .getByRole("radiogroup", { name: "Network" })
    ).toBeVisible();
  });

  test("client-v2-status: Going offline and back", async ({
    seededPage: page,
  }) => {
    const before = await rust(page).textContent();
    await page.context().setOffline(true);
    await expect(network(page)).toHaveText("Devnet · Offline");
    await expect(ai(page)).toHaveText("AI · Offline");
    await expect(rust(page)).toHaveText("Rust · Offline");
    await page.context().setOffline(false);
    await expect(network(page)).not.toContainText("Offline");
    await expect(ai(page)).toHaveText("AI · Off");
    await expect(rust(page)).not.toContainText("Offline");
    expect(before).not.toContain("Offline");
  });

  test("client-v2-status: Offline shows one line over the stage", async ({
    seededPage: page,
  }) => {
    const lines = linesOn(page);
    await page.locator("#flow-stage-tab-build").click();
    const build = page.getByRole("button", { name: "Build", exact: true });
    await expect(build).toBeEnabled();
    await expect(notice(page)).toHaveCount(0);

    await page.context().setOffline(true);
    await expect(notice(page).getByRole("alert")).toHaveText(OFFLINE_LINE);
    await expect(build).toBeDisabled();
    await expect
      .poll(() => lineOf(lines, "status_notice_shown"))
      .toContain("{notice: offline}");

    await page.context().setOffline(false);
    await expect(notice(page)).toHaveCount(0);
    await expect(build).toBeEnabled();
  });

  test("client-v2-status: A notice is measured once per onset", async ({
    seededPage: page,
  }) => {
    const lines = linesOn(page);
    const shown = () =>
      lines.filter((line) =>
        line.startsWith("[telemetry:event] status_notice_shown ")
      );
    // Deploy's code is loaded while online: offline, a stage not yet opened
    // cannot load its chunk (sent to Lead as intake, 3 Nov)
    await page.locator("#flow-stage-tab-deploy").click();
    await expect(
      page.locator("#flow-stage-panel-deploy").getByRole("heading").first()
    ).toBeVisible();
    await page.locator("#flow-stage-tab-build").click();
    await page.context().setOffline(true);
    await expect(notice(page)).toBeVisible();
    await page.locator("#flow-stage-tab-deploy").click();
    await page.locator("#flow-stage-tab-build").click();
    await expect(notice(page)).toBeVisible();
    await expect.poll(() => shown().length).toBe(1);
    expect(shown()[0]).toContain("{notice: offline}");
    await page.context().setOffline(false);
  });

  test("client-v2-status: A cluster that does not answer on Deploy", async ({
    seededPage: page,
  }) => {
    await stallDevnet(page);
    await page.reload();
    await expect(
      row(page).getByRole("button", {
        name: "Change cluster, currently devnet, not responding",
      })
    ).toBeVisible({ timeout: 15_000 });
    // Build does not wait for the cluster: no line there
    await page.locator("#flow-stage-tab-build").click();
    await expect(notice(page)).toHaveCount(0);

    await page.locator("#flow-stage-tab-deploy").click();
    await expect(notice(page).getByRole("alert")).toContainText(
      "Devnet is not responding. Try again, or change the network."
    );
    // The cluster recovers; Try again asks it now, and the line clears
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await notice(page).getByRole("button", { name: "Try again" }).click();
    await expect(notice(page)).toHaveCount(0, { timeout: 15_000 });
  });

  test("client-v2-status: The setup row warns while the cluster does not answer", async ({
    seededPage: page,
  }) => {
    const setupRow = page
      .getByRole("listitem")
      .filter({ hasText: "Choose a network" });
    await expect(setupRow).toHaveAttribute("data-status", "done");
    await stallDevnet(page);
    await page.reload();
    await expect(setupRow).toHaveAttribute("data-status", "warn", {
      timeout: 15_000,
    });
    await expect(setupRow).toHaveAttribute("title", "devnet is not responding");
  });

  test("client-v2-status: Change network from the notice", async ({
    seededPage: page,
  }) => {
    await stallDevnet(page);
    await page.reload();
    await page.locator("#flow-stage-tab-deploy").click();
    const lines = linesOn(page);
    await notice(page)
      .getByRole("button", { name: "Change network" })
      .click({ timeout: 15_000 });
    await expect(
      page
        .getByRole("region", { name: "Settings" })
        .getByRole("radiogroup", { name: "Network" })
    ).toBeVisible();
    await expect
      .poll(() => lineOf(lines, "status_notice_action"))
      .toContain("{notice: cluster-down, action: change-network}");
  });
});

test("client-v2-status: The rail's dots", async ({ page }) => {
  await page.setViewportSize(DESK);
  await seedWorkspace(page);
  await page.setViewportSize(TABLET);
  const rail = nav(page).getByTestId("status-rail");
  await expect(
    rail.getByRole("button", { name: /^Cluster: devnet/ })
  ).toBeVisible();
  await expect(rail.getByRole("button", { name: /^AI, / })).toBeVisible();
  await expect(
    rail.getByRole("button", { name: /^Rust analyzer/ })
  ).toBeVisible();
  // The rail has no words, so each dot's tooltip says its state
  await rail.getByRole("button", { name: /^Cluster: devnet/ }).hover();
  await expect(page.getByRole("tooltip")).toHaveText(/^Devnet · /);
  const lines = linesOn(page);
  await rail.getByRole("button", { name: /^Cluster: devnet/ }).click();
  await expect
    .poll(() => lineOf(lines, "settings_opened"))
    .toContain("{from: rail}");
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE });

  test("client-v2-status: The phone chip names what is down", async ({
    page,
  }) => {
    // No model alone is not a failure and is not counted: something has to
    // be down for the chip to name it
    await stallDevnet(page);
    // The seed waits on the tree a phone keeps in a closed Sheet
    await page.setViewportSize(DESK);
    await seedWorkspace(page);
    await page.setViewportSize(PHONE);

    const chip = page.getByTestId("status-chip");
    await expect(chip).toHaveAccessibleName("Status, 1 not ready", {
      timeout: 15_000,
    });
    expect((await chip.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await chip.click();

    const sheet = page.getByRole("dialog", { name: "Status" });
    await expect(sheet.locator("[data-status]")).toHaveCount(3);
    for (const name of ["Network", "AI", "Rust analyzer"]) {
      await expect(sheet.getByText(name, { exact: true })).toBeVisible();
    }
    const aiRow = sheet.locator('[data-status="ai"]');
    await expect(aiRow.getByText("Off", { exact: true })).toBeVisible();
    await aiRow.getByRole("button", { name: "Connect a model" }).click();
    await expect(
      page.getByRole("dialog", { name: "Connect a model" })
    ).toBeVisible();
  });

  test("client-v2-status: The phone chip reads Offline", async ({ page }) => {
    await page.setViewportSize(DESK);
    await seedWorkspace(page);
    await page.setViewportSize(PHONE);

    await page.context().setOffline(true);
    const chip = page.getByTestId("status-chip");
    await expect(chip).toHaveAccessibleName("Status, offline");
    await expect(chip).toContainText("Offline");
  });
});
