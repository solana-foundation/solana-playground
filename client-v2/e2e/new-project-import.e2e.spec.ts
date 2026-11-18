import type { Page } from "@playwright/test";

import {
  expect,
  json,
  LONG,
  newProjectPage,
  openFiles,
  openGallery,
  test,
} from "./fixtures";

const OWNER = "alice";
const REPO = "ts-client";

/**
 * Answers GitHub for a repository holding only TypeScript: the tree from the
 * API, each file's content from `raw.githubusercontent.com`
 */
const stubTypeScriptRepository = async (page: Page) => {
  const files: Record<string, string> = {
    "index.ts": "console.log('client');",
    "tests/rpc.test.ts": "describe('rpc', () => {});",
  };
  await page.route(
    `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/**`,
    (r) =>
      json(r, {
        truncated: false,
        tree: Object.keys(files).map((path) => ({
          path,
          type: "blob",
          sha: path,
        })),
      })
  );
  await page.route(
    `https://raw.githubusercontent.com/${OWNER}/${REPO}/**`,
    (r) => {
      const path = decodeURIComponent(
        new URL(r.request().url()).pathname.split("/").slice(4).join("/")
      );
      return path in files
        ? r.fulfill({ body: files[path] })
        : r.fulfill({ status: 404, body: "" });
    }
  );
};

/** Opens New project and imports the link from its Import from GitHub card */
const importFromNewProject = async (page: Page, link: string) => {
  await openGallery(page);
  const card = newProjectPage(page);
  await expect(card).toBeVisible();
  await card.getByLabel("Import from GitHub").fill(link);
  await card.getByRole("button", { name: "Import", exact: true }).click();
};

test("new-project-import: A TypeScript-only repository", async ({
  seededPage: page,
}) => {
  await stubTypeScriptRepository(page);
  await importFromNewProject(page, `https://github.com/${OWNER}/${REPO}`);

  // New project closes on the imported project, laid out with no program
  await expect(newProjectPage(page)).toHaveCount(0, LONG);
  const project = `/github-${OWNER}/${REPO}/`;
  // At the default window the tree sits in the dropdown "Files" opens
  await openFiles(page);
  await expect(
    page.locator(`[data-path="${project}client/index.ts"]`)
  ).toHaveCount(1, LONG);
  await expect(
    page.locator(`[data-path="${project}tests/rpc.test.ts"]`)
  ).toHaveCount(1);
});

test("new-project-import: Not a GitHub link", async ({ seededPage: page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://api.github.com/")) {
      asked.push(request.url());
    }
  });

  await importFromNewProject(page, "https://gitlab.com/acme/escrow");

  const card = newProjectPage(page);
  await expect(
    card.getByText("This isn't a GitHub repo or gist link.")
  ).toBeVisible();
  await expect(card.getByLabel("Import from GitHub")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  expect(asked).toEqual([]);
});

test("new-project-import: Private or missing repository", async ({
  seededPage: page,
}) => {
  await page.route(
    "https://api.github.com/repos/acme/escrow-private/git/trees/**",
    (r) => r.fulfill({ status: 404, json: { message: "Not Found" } })
  );

  await importFromNewProject(page, "https://github.com/acme/escrow-private");

  await expect(
    newProjectPage(page).getByText(
      "Playground can't find acme/escrow-private on GitHub. It may be private, renamed or deleted."
    )
  ).toBeVisible(LONG);
  await expect(newProjectPage(page)).toBeVisible();
});
