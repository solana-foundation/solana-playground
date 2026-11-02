import type { Page } from "@playwright/test";

import { expect, json, seedWorkspace, test } from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/** The stock Sidebar, which holds the navigation and its foot */
const nav = (page: Page) => page.locator('[data-slot="sidebar"]');
const row = (page: Page) => page.getByTestId("status-row");

const network = (page: Page) =>
  row(page).getByRole("button", { name: /^Change cluster, currently devnet/ });
const ai = (page: Page) => row(page).getByRole("button", { name: /^AI, / });
const rust = (page: Page) =>
  row(page).getByRole("button", { name: /^Rust analyzer/ });

test.describe("on a 1440 px window", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

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
      .toContain("{indicator: ai, state: not-ready, from: row}");
  });

  test("client-v2-status: A cluster that stops answering", async ({
    seededPage: page,
  }) => {
    // A cluster is down when its slot does not move between two reads a
    // second apart (`PgConnection.getIsClusterDown`)
    await page.route("https://api.devnet.solana.com/**", async (route) => {
      const body = route.request().postDataJSON() as {
        id?: unknown;
        method?: string;
      } | null;
      if (body?.method !== "getSlot") return route.continue();
      return json(route, { jsonrpc: "2.0", result: 123, id: body.id });
    });
    await page.reload();

    const down = row(page).getByRole("button", {
      name: "Change cluster, currently devnet, not answering",
    });
    await expect(down).toHaveText("Devnet · Not answering", {
      timeout: 15_000,
    });
    await expect(down.locator('[data-slot="status-dot"]')).toHaveAttribute(
      "data-variant",
      "error"
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
});

test("client-v2-status: The rail's dots", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedWorkspace(page);
  await page.setViewportSize({ width: 834, height: 1112 });
  const rail = nav(page).getByTestId("status-rail");
  await expect(
    rail.getByRole("button", { name: /^Cluster: devnet/ })
  ).toBeVisible();
  await expect(rail.getByRole("button", { name: /^AI, / })).toBeVisible();
  await expect(
    rail.getByRole("button", { name: /^Rust analyzer/ })
  ).toBeVisible();
  const lines = linesOn(page);
  await rail.getByRole("button", { name: /^Cluster: devnet/ }).click();
  await expect
    .poll(() => lineOf(lines, "settings_opened"))
    .toContain("{from: rail}");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("client-v2-status: The phone chip names what is down", async ({
    page,
  }) => {
    // The seed waits on the tree a phone keeps in a closed Sheet
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const chip = page.getByTestId("status-chip");
    await expect(chip).toHaveAccessibleName(/^Status, \d not ready$/);
    expect((await chip.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await chip.click();

    const sheet = page.getByRole("dialog", { name: "Status" });
    await expect(sheet.locator("[data-status]")).toHaveCount(3);
    for (const name of ["Network", "AI", "Rust analyzer"]) {
      await expect(sheet.getByText(name, { exact: true })).toBeVisible();
    }
    const aiRow = sheet.locator('[data-status="ai"]');
    await expect(aiRow).toContainText("AI · Off");
    await aiRow.getByRole("button", { name: "Connect a model" }).click();
    await expect(
      page.getByRole("dialog", { name: "Connect a model" })
    ).toBeVisible();
  });
});
