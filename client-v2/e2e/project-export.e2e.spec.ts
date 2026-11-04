import type { Page } from "@playwright/test";
import { readFile } from "fs/promises";
import JSZip from "jszip";

import { expect, json, LONG, projectMenu, test } from "./fixtures";

const OWNER = "alice";
const REPO = "ts-client";

/** A project with no program: a client that reads the cluster, and a test */
const CLIENT_AND_TEST = {
  "client.ts": "console.log(await pg.connection.getSlot());",
  "tests/basic.test.ts": "it('adds', () => assert.equal(1 + 1, 2));",
};

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

/** Imports the repository from Settings, which closes once the project opens */
const importRepository = async (page: Page) => {
  await page.locator("[data-settings-trigger]").first().click();
  await page
    .getByRole("region", { name: "Settings" })
    .getByRole("button", { name: "From GitHub" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByPlaceholder("https://github.com/... or https://gist.github.com/...")
    .fill(`https://github.com/${OWNER}/${REPO}`);
  await dialog.locator('button[type="submit"]').click();
  await expect(page.getByRole("dialog")).toHaveCount(0, LONG);
};

/** Opens the export dialog from the imported project's menu */
const openExport = async (page: Page) => {
  const menu = await projectMenu(page, `github-${OWNER}/${REPO}/`);
  await menu.getByRole("menuitem", { name: "Export as zip" }).click();
};

test("project-export: The dialog for a TypeScript project", async ({
  seededPage: page,
}) => {
  await stubRepository(page, CLIENT_AND_TEST);
  await importRepository(page);
  await openExport(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Make it a Node project?")).toBeVisible();
  await expect(dialog.getByText("Convert the project layout?")).toHaveCount(0);
  await expect(dialog.getByText("package.json")).toBeVisible();
  await expect(dialog.getByText("~/.config/solana/id.json")).toBeVisible();
});

test("project-export: A project with no program", async ({
  seededPage: page,
}) => {
  await stubRepository(page, CLIENT_AND_TEST);
  await importRepository(page);
  await openExport(page);

  const download = page.waitForEvent("download", LONG);
  await page.getByRole("button", { name: /convert and export/i }).click();
  const zip = await JSZip.loadAsync(
    await readFile(await (await download).path())
  );

  // Folders are entries of their own in a zip; the files are what matter
  const files = Object.keys(zip.files).filter((path) => !path.endsWith("/"));
  expect(files.sort()).toEqual([
    ".gitignore",
    "README.md",
    "client/client.ts",
    "package.json",
    "playground.ts",
    "tests/basic.test.ts",
    "tsconfig.json",
  ]);
  const client = await zip.file("client/client.ts")?.async("string");
  expect(client).toContain('import { pg } from "../playground";');
  // The README the export wrote, shown after it; by then a fallback toast
  // would have shown too
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Cluster and wallet" })
  ).toBeVisible();
  await expect(
    page.getByText("Could not convert the layout; exported it as is.")
  ).toHaveCount(0);
});
