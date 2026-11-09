import type { Page } from "@playwright/test";

import { expect, json, LONG, test } from "./fixtures";

const settings = (page: Page) => page.getByRole("region", { name: "Settings" });

/** Opens Settings, unless a dialog closed over it left it open */
const openSettings = async (page: Page) => {
  if (!(await settings(page).isVisible())) {
    await page.locator("[data-settings-trigger]").first().click();
  }
  await expect(settings(page)).toBeVisible();
};

/** Opens Settings, then its "From GitHub" import dialog */
const openGithubImport = async (page: Page) => {
  await openSettings(page);
  await settings(page).getByRole("button", { name: "From GitHub" }).click();
  return page.getByRole("dialog");
};

/**
 * Every link the GitHub import dialog offers, as GitHub URLs: an example's
 * "Open in GitHub", and the explainer's repository and its playground URL,
 * which is the app's origin with the GitHub URL after it.
 */
const importDialogLinks = async (page: Page) => {
  const dialog = await openGithubImport(page);
  const hrefs = await dialog
    .getByRole("link")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  await page.keyboard.press("Escape");
  const origin = new URL(page.url()).origin;
  return hrefs.map((href) =>
    href.startsWith(origin) ? href.slice(origin.length + 1) : href
  );
};

/** The link in the custom build server's tip */
const buildServerLink = async (page: Page) => {
  await openSettings(page);
  await settings(page).getByRole("combobox", { name: "Build server" }).click();
  await page.getByRole("option", { name: "Custom" }).click();
  const link = page
    .getByRole("dialog")
    .getByRole("link", { name: "the playground server" });
  const href = (await link.getAttribute("href")) ?? "";
  await page.keyboard.press("Escape");
  return href;
};

/**
 * Every GitHub link the two dialogs offer, recorded: the three examples, the
 * explainer's repository (also inside its playground URL) and the build
 * server's tip. A change to any of them is a change to this list.
 */
const LINKS = [
  "https://github.com/solana-foundation/program-examples/tree/main/basics/create-account/anchor",
  "https://github.com/solana-foundation/program-examples/tree/main/basics/hello-solana/native/program",
  "https://github.com/solana-foundation/program-examples/tree/main/basics/transfer-sol/anchor",
  "https://github.com/solana-foundation/solana-playground/tree/master/server",
];

/** The dialogs' links, deduplicated and sorted */
const dialogLinks = async (page: Page) => {
  const links = await importDialogLinks(page);
  const server = await buildServerLink(page);
  return Array.from(new Set(links.concat(server))).sort();
};

test("github-import: The import and build server dialogs offer the recorded links", async ({
  page,
}) => {
  await page.goto("/");
  expect(await dialogLinks(page)).toEqual(LINKS);
});

// Reaches github.com itself, so the PR suite leaves it out (`--grep-invert
// @live-links`) and `client-v2-live-links.yml` runs it weekly: a path the
// examples repository drops fails there rather than in front of a user
test("github-import: Every recorded link resolves on GitHub @live-links", async ({
  page,
}) => {
  for (const url of LINKS) {
    // Its own timeout: GitHub's tree pages answer slower than the config's
    // `actionTimeout`, and a thrown timeout would end the loop before the
    // links after it were checked. Soft, so one run names every dead link.
    const status = await page.request
      .get(url, { maxRedirects: 5, timeout: LONG.timeout })
      .then(
        (response) => response.status(),
        (error: Error) => error.message
      );
    expect.soft(status, url).toBe(200);
  }
});

const PROGRAM_PATH = "basics/hello-solana/native/program";
const LIB_RS = `use solana_program::entrypoint;

entrypoint!(process_instruction);
`;

/** Serves the examples repository with one native program */
const stubExamples = async (page: Page) => {
  await page.route(
    "https://api.github.com/repos/solana-foundation/program-examples/**",
    (r) =>
      json(r, {
        truncated: false,
        tree: [
          {
            path: `${PROGRAM_PATH}/src/lib.rs`,
            type: "blob",
            sha: "1",
            url: "",
          },
        ],
      })
  );
  await page.route(
    "https://raw.githubusercontent.com/solana-foundation/program-examples/**",
    (r) => r.fulfill({ status: 200, contentType: "text/plain", body: LIB_RS })
  );
};

// The router folds `/https://github.com/…` to `/https:/github.com/…` on an
// in-app navigation, which the route used to refuse as "URL path not found"
test("github-import: An example's Open shows its program", async ({ page }) => {
  await stubExamples(page);
  await page.goto("/");

  const dialog = await openGithubImport(page);
  await dialog
    .getByTestId("github-example")
    .filter({ hasText: "Hello Solana" })
    .getByRole("button", { name: "Open", exact: true })
    .click();

  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "entrypoint!(process_instruction)",
    LONG
  );
});

// A failed route's error stayed in the main view over the next route's
test("github-import: A failed open leaves no error for the next one", async ({
  page,
}) => {
  await stubExamples(page);
  await page.goto(
    "/https://github.com/solana-foundation/program-examples/tree/main/basics/gone"
  );
  await expect(page.getByText(/No program code found/)).toBeVisible(LONG);

  const dialog = await openGithubImport(page);
  await dialog
    .getByTestId("github-example")
    .filter({ hasText: "Hello Solana" })
    .getByRole("button", { name: "Open", exact: true })
    .click();

  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "entrypoint!(process_instruction)",
    LONG
  );
  await expect(page.getByText(/No program code found/)).toHaveCount(0);
});
