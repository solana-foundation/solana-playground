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

/** Where the app opens a GitHub repository, as the dialog's explainer shows */
const GITHUB_ROUTE = "/github/";

/**
 * Every link the GitHub import dialog offers, as GitHub URLs: an example's
 * "Open in GitHub", and the explainer's repository and its playground URL,
 * which is the app's origin, `/github/`, and GitHub's own path after it.
 */
const importDialogLinks = async (page: Page) => {
  const dialog = await openGithubImport(page);
  const hrefs = await dialog
    .getByRole("link")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  await page.keyboard.press("Escape");
  const origin = new URL(page.url()).origin;
  const route = origin + GITHUB_ROUTE;
  return hrefs.map((href) =>
    href.startsWith(route)
      ? `https://github.com/${href.slice(route.length)}`
      : href
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
 * Every GitHub link the two dialogs offer, recorded: the two examples, the
 * explainer's repository (also inside its playground URL) and the build
 * server's tip. A change to any of them is a change to this list.
 */
const LINKS = [
  "https://github.com/solana-foundation/program-examples/tree/main/basics/create-account/anchor",
  "https://github.com/solana-foundation/program-examples/tree/main/basics/hello-solana/native/program",
  "https://github.com/solana-foundation/solana-playground/tree/master/server",
];

/** The dialogs' links, deduplicated and sorted */
const dialogLinks = async (page: Page) => {
  const links = await importDialogLinks(page);
  const server = await buildServerLink(page);
  return Array.from(new Set(links.concat(server))).sort();
};

test("client-v2-routes: The import and build server dialogs offer the recorded links", async ({
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
    const response = await page.request.get(url, { maxRedirects: 5 });
    // Soft, so one run names every dead link
    expect.soft(response.status(), url).toBe(200);
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

/** The examples program's own `/github/` address */
const PROGRAM_ROUTE = `/github/solana-foundation/program-examples/tree/main/${PROGRAM_PATH}`;

test("client-v2-routes: A folder of the examples repository opens", async ({
  page,
}) => {
  await stubExamples(page);
  await page.goto(PROGRAM_ROUTE);

  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "entrypoint!(process_instruction)",
    LONG
  );
  await expect(page).toHaveURL(PROGRAM_ROUTE);
});

test("client-v2-routes: An example's Open shows its program", async ({
  page,
}) => {
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
  await expect(page).toHaveURL(PROGRAM_ROUTE);
});

// The Flow view's left panel hid the warning with the project picker, so a
// project opened from a link could not be kept (HOO-2793)
test("github-import: A temporary project's Import keeps it", async ({
  page,
}) => {
  await stubExamples(page);
  await page.goto(PROGRAM_ROUTE);
  await expect(page.locator(".monaco-editor")).toContainText(
    "entrypoint!(process_instruction)",
    LONG
  );
  // At the default window the code area is too narrow to dock the tree, so
  // the warning is in the dropdown "Files" opens
  const files = page.locator("#editor-head-files");
  const tree = page.getByRole("dialog", { name: "Files" });
  await files.click();
  const warning = tree.getByText(/This is a temporary project/);
  await expect(warning).toBeVisible(LONG);

  await tree.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByPlaceholder("project name...") });
  await dialog.getByPlaceholder("project name...").fill("hello-kept");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  // The kept project opens with its file, which closes the dropdown; the
  // tree is read in it once more
  await expect(
    page
      .getByRole("group", { name: "Projects" })
      .getByRole("button", { name: "hello-kept", exact: true })
  ).toBeVisible(LONG);
  await expect(page.locator(".monaco-editor")).toContainText(
    "entrypoint!(process_instruction)",
    LONG
  );
  await expect(async () => {
    if (!(await tree.isVisible())) await files.click();
    await expect(tree.locator("#root-dir")).toBeVisible({ timeout: 2_000 });
  }).toPass(LONG);
  await expect(warning).toHaveCount(0);
  // Kept: the picker, now in the warning's place, names the project, and
  // the tree still hides it
  const picker = page.locator('[aria-label="Project"]');
  await expect(picker).toHaveCount(1);
  await expect(picker).toHaveText("hello-kept");
  await expect(picker).toBeHidden();
});

// A failed route's error stayed in the main view over the next route's
test("client-v2-routes: A folder with no program says so, then gets out of the way", async ({
  page,
}) => {
  await stubExamples(page);
  await page.goto(
    "/github/solana-foundation/program-examples/tree/main/basics/gone"
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
