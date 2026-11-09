import type { Page } from "@playwright/test";

import { expect, json, LONG, seedWorkspace, test } from "./fixtures";

const SKILL = {
  id: "e2e-skill",
  name: "E2E skill",
  description: "A skill to switch off from Settings.",
  enabled: true,
  source: {
    type: "remote",
    baseUrl: "https://skills.test/",
    entry: "SKILL.md",
  },
};

const openSources = async (page: Page) => {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Sources and tools/ }).click();
};

/** Settings, scrolled to its Assistant section */
const openAssistantSettings = async (page: Page) => {
  await page.keyboard.press("ControlOrMeta+,");
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings).toBeVisible();
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Assistant", exact: true })
    .click();
  return settings.getByRole("region", { name: "Assistant" });
};

test("settings-assistant-sources: A skill unticked in Settings", async ({
  page,
}) => {
  await page.route("**/api/mcp", (r) => json(r, { servers: [] }));
  await page.route("**/api/skills", (r) => json(r, { skills: [SKILL] }));
  await seedWorkspace(page);

  const section = await openAssistantSettings(page);
  const box = section.getByRole("checkbox", { name: "E2E skill" });
  await expect(box).toBeChecked(LONG);
  await box.click();
  await expect(box).not.toBeChecked();

  await page.getByRole("button", { name: "Back to app" }).click();
  await openSources(page);
  await expect(
    page.getByRole("checkbox", { name: "E2E skill" })
  ).not.toBeChecked();
});

test("settings-assistant-sources: Nothing listed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/mcp", (r) => json(r, { servers: [] }));
  await page.route("**/api/skills", (r) => json(r, { skills: [] }));
  await seedWorkspace(page);

  const section = await openAssistantSettings(page);
  await expect(
    section.getByText("The server reported no skills", { exact: false })
  ).toBeVisible(LONG);
  await expect(section.getByText(/^No servers\./)).toBeVisible();
  expect(errors).toEqual([]);
});

test("settings-assistant-sources: Both views on screen", async ({ page }) => {
  await page.route("**/api/mcp", (r) => json(r, { servers: [] }));
  await page.route("**/api/skills", (r) => json(r, { skills: [SKILL] }));
  await seedWorkspace(page);
  await openSources(page);
  await expect(page.getByRole("checkbox", { name: "E2E skill" })).toBeChecked(
    LONG
  );

  const section = await openAssistantSettings(page);
  // The name, not the box: a label pointing at the panel's copy would leave this one checked
  await section.getByText("E2E skill", { exact: true }).click();
  await expect(
    section.getByRole("checkbox", { name: "E2E skill" })
  ).not.toBeChecked();

  await page.getByRole("button", { name: "Back to app" }).click();
  await expect(
    page.getByRole("checkbox", { name: "E2E skill" })
  ).not.toBeChecked();
});
