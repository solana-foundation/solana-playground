import type { Page } from "@playwright/test";

import { LONG, expect, test } from "./fixtures";

/** The About page's action; `exact` keeps it off other names holding "Start" */
const startButton = (page: Page) =>
  page.getByRole("button", { name: "Start", exact: true });

/**
 * The empty conversation's title names whose conversation it is; the head
 * names the model (assistant-model-name)
 */
const askAbout = (page: Page, name: string) =>
  page.getByRole("heading", { name: `Ask about ${name}`, exact: true });

test("client-v2-tutorials: The assistant beside Hello Anchor", async ({
  page,
}) => {
  await page.goto("/tutorials/hello-anchor");
  await expect(startButton(page)).toBeVisible(LONG);

  // Before Start there is no project: the conversation names the tutorial
  // and the files column offers nothing to create
  await expect(askAbout(page, "Hello Anchor")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create a new project" })
  ).toHaveCount(0);
});

test("client-v2-tutorials: Starting from the About page", async ({ page }) => {
  await page.goto("/tutorials/hello-seahorse");
  await startButton(page).click();

  await expect(page).toHaveURL(/\/tutorials\/hello-seahorse\/1$/, LONG);
  // The tutorial's project now exists, and the files column shows it
  await expect(page.locator("#root-dir")).toBeVisible(LONG);
  await expect(askAbout(page, "Hello Seahorse")).toBeVisible();
});

test("client-v2-tutorials: The details read as text", async ({ page }) => {
  await page.goto("/tutorials/hello-anchor");
  await expect(startButton(page)).toBeVisible(LONG);

  // Found by the data's text; `useInnerText` reads it as drawn, so a case
  // transform counts
  const drawn = (text: string, as: string) =>
    expect(page.getByText(text, { exact: true }).first()).toHaveText(as, {
      useInnerText: true,
    });
  await drawn("Beginner", "BEGINNER");
  for (const name of ["Anchor", "Rust", "TypeScript"]) await drawn(name, name);
});

test("client-v2-tutorials: Beside another project", async ({
  seededPage: page,
}) => {
  await page.goto("/tutorials/hello-anchor");
  await expect(startButton(page)).toBeVisible(LONG);

  // The open project keeps the conversation, whose thread and tools are its;
  // the files column stays empty until the tutorial has a project of its own
  await expect(askAbout(page, "e2e-project")).toBeVisible();
  await expect(page.locator("#root-dir")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create a new project" })
  ).toHaveCount(0);
});
