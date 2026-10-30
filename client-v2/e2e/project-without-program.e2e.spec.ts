import type { Page } from "@playwright/test";

import { LONG, expect, json, test } from "./fixtures";

const OWNER = "alice";
const REPO = "ts-client";

/**
 * Answers GitHub for a repository holding the given files: the tree from the
 * API, each file's content from `raw.githubusercontent.com`.
 */
const stubRepository = async (page: Page, files: Record<string, string>) => {
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

/** Opens Settings, then its "From GitHub" import, and imports the repository */
const importRepository = async (page: Page, folder = "") => {
  await page.locator("[data-settings-trigger]").first().click();
  await page
    .getByRole("region", { name: "Settings" })
    .getByRole("button", { name: "From GitHub" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByPlaceholder("https://github.com/... or https://gist.github.com/...")
    .fill(
      `https://github.com/${OWNER}/${REPO}` +
        (folder ? `/tree/main/${folder}` : "")
    );
  await dialog.locator('button[type="submit"]').click();
};

const stageTabIds = (page: Page) =>
  page
    .locator('[id^="flow-stage-tab-"]')
    .evaluateAll((tabs) => tabs.map((tab) => tab.id));

const PROJECT = `/github-${OWNER}/${REPO}/`;

/** The explorer row of a path in the imported project */
const item = (page: Page, path: string) =>
  page.locator(`[data-path="${PROJECT}${path}"]`);

/** Imports the repository from Settings, then goes back to the app */
const importAndReturn = async (page: Page) => {
  await importRepository(page);
  // The dialog closes once the project is open; leaving Settings earlier
  // races the import, which can bring Settings back
  await expect(page.getByRole("dialog")).toHaveCount(0, LONG);
  await page.getByRole("button", { name: "Back to app" }).click();
  await expect(page.getByRole("region", { name: "Settings" })).toHaveCount(0);
};

const CLIENT_AND_TESTS = {
  "index.ts": "console.log('client');",
  "lib/rpc.ts": "export const rpc = 1;",
  "tests/rpc.test.ts": "describe('rpc', () => {});",
};

test("project-without-program: A client and its tests", async ({
  seededPage: page,
}) => {
  await stubRepository(page, CLIENT_AND_TESTS);
  await importRepository(page);

  await expect(item(page, "client/index.ts")).toHaveCount(1, LONG);
  await expect(item(page, "client/lib/rpc.ts")).toHaveCount(1);
  await expect(item(page, "tests/rpc.test.ts")).toHaveCount(1);
});

test("project-without-program: Folders are kept", async ({
  seededPage: page,
}) => {
  await stubRepository(page, {
    "src/app/main.ts": "export {};",
    "test/unit/math.ts": "export {};",
    "client/run.ts": "export {};",
    "README.md": "# readme",
    "package.json": "{}",
  });
  await importRepository(page);

  await expect(item(page, "client/run.ts")).toHaveCount(1, LONG);
  await expect(item(page, "client/src/app/main.ts")).toHaveCount(1);
  await expect(item(page, "tests/unit/math.ts")).toHaveCount(1);
  await expect(item(page, "README.md")).toHaveCount(0);
  await expect(item(page, "package.json")).toHaveCount(0);
});

test("project-without-program: A test file outside a tests folder", async ({
  seededPage: page,
}) => {
  await stubRepository(page, { "lib/math.spec.ts": "export {};" });
  await importRepository(page);

  await expect(item(page, "tests/lib/math.spec.ts")).toHaveCount(1, LONG);
  await expect(item(page, "client/")).toHaveCount(0);
});

test("project-without-program: A program no framework recognises", async ({
  seededPage: page,
}) => {
  await stubRepository(page, {
    "onchain/src/lib.rs": "fn main() {}",
    "client.ts": "export {};",
  });
  await importRepository(page);

  await expect(
    page
      .getByRole("dialog")
      .getByText(
        "This doesn't look like a Solana program. Playground opens Anchor, native Rust and Seahorse programs."
      )
  ).toBeVisible(LONG);
});

test("project-without-program: A folder of a repository", async ({
  seededPage: page,
}) => {
  await stubRepository(page, {
    "token/client/index.ts": "export {};",
    "token/client/tests/a.ts": "export {};",
  });
  await importRepository(page, "token/client");

  const project = `/github-${OWNER}/${REPO}/token/client/`;
  await expect(
    page.locator(`[data-path="${project}client/index.ts"]`)
  ).toHaveCount(1, LONG);
  await expect(page.locator(`[data-path="${project}tests/a.ts"]`)).toHaveCount(
    1
  );
});

test("project-without-program: A repository with neither", async ({
  seededPage: page,
}) => {
  // The message repository import gave before this change: a Markdown file
  // is not a source file, so nothing reaches the layout
  await stubRepository(page, { "notes.md": "# notes" });
  await importRepository(page);

  await expect(
    page
      .getByRole("dialog")
      .getByText(`No program code found in ${OWNER}/${REPO}.`)
  ).toBeVisible(LONG);
});

test("project-without-program: An imported TypeScript project", async ({
  seededPage: page,
}) => {
  await stubRepository(page, CLIENT_AND_TESTS);
  await importAndReturn(page);
  await expect(item(page, "tests/rpc.test.ts")).toHaveCount(1, LONG);

  await expect.poll(() => stageTabIds(page)).toEqual(["flow-stage-tab-write"]);
  await expect(page.locator("#flow-client-project")).toHaveText(
    "Client project"
  );
  await page.keyboard.press("Control+2");
  await expect(page.locator("#flow-stage-panel-write")).toBeVisible();
  await expect(page.locator("#flow-stage-panel-build")).toHaveCount(0);
});

test("project-without-program: A program is added", async ({
  seededPage: page,
}) => {
  await stubRepository(page, CLIENT_AND_TESTS);
  await importAndReturn(page);
  await expect(item(page, "tests/rpc.test.ts")).toHaveCount(1, LONG);
  await expect.poll(() => stageTabIds(page)).toEqual(["flow-stage-tab-write"]);

  // The tree's add-program button, which scaffolds `src/lib.rs`
  await page
    .locator("#root-dir")
    .getByRole("button", { name: "Add" })
    .first()
    .click();
  await expect(item(page, "src/lib.rs")).toHaveCount(1, LONG);

  await expect
    .poll(() => stageTabIds(page), LONG)
    .toEqual([
      "flow-stage-tab-write",
      "flow-stage-tab-build",
      "flow-stage-tab-deploy",
      "flow-stage-tab-interact",
    ]);
  await expect(page.locator("#flow-client-project")).toHaveCount(0);
});

test("project-without-program: A project with a program", async ({
  seededPage: page,
}) => {
  // The seeded project is the default native program
  await expect
    .poll(() => stageTabIds(page), LONG)
    .toEqual([
      "flow-stage-tab-write",
      "flow-stage-tab-build",
      "flow-stage-tab-deploy",
      "flow-stage-tab-interact",
    ]);
});
