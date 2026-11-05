import type { Page } from "@playwright/test";

import { expect, json, LONG, test } from "./fixtures";

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
const importRepository = async (page: Page, folder: string) => {
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

/** Imports the repository from Settings, which closes once the project opens */
const importAndReturn = async (page: Page) => {
  await importRepository(page, "");
  await expect(page.getByRole("dialog")).toHaveCount(0, LONG);
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
  await importRepository(page, "");

  await expect(item(page, "client/index.ts")).toHaveCount(1, LONG);
  await expect(item(page, "client/lib/rpc.ts")).toHaveCount(1);
  await expect(item(page, "tests/rpc.test.ts")).toHaveCount(1);
});

test("project-without-program: A repository with an Anchor program", async ({
  seededPage: page,
}) => {
  await stubRepository(page, {
    "programs/counter/src/lib.rs":
      "use anchor_lang::prelude::*;\n#[program]\nmod counter {}",
    "client/index.ts": "export {};",
    "tests/counter.ts": "export {};",
  });
  await importRepository(page, "");

  // The Anchor layout: the program's `src/`, the client, and each test as
  // `<name>.test.ts`. None of it is read as a project with no program.
  await expect(item(page, "src/lib.rs")).toHaveCount(1, LONG);
  await expect(item(page, "client/index.ts")).toHaveCount(1);
  await expect(item(page, "tests/counter.test.ts")).toHaveCount(1);
  await expect(item(page, "client/programs/counter/src/lib.rs")).toHaveCount(0);
});

test("project-without-program: Two files for one place", async ({
  seededPage: page,
}) => {
  await stubRepository(page, {
    "a.ts": "export const top = 1;",
    "client/a.ts": "export const nested = 2;",
  });
  await importRepository(page, "");

  await expect(item(page, "client/a.ts")).toHaveCount(1, LONG);
  await expect(item(page, "client/client/a.ts")).toHaveCount(1);
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
  await importRepository(page, "");

  await expect(item(page, "client/run.ts")).toHaveCount(1, LONG);
  await expect(item(page, "client/src/app/main.ts")).toHaveCount(1);
  await expect(item(page, "tests/unit/math.ts")).toHaveCount(1);
  await expect(item(page, "README.md")).toHaveCount(0);
  await expect(item(page, "package.json")).toHaveCount(0);
});

test("project-without-program: An IDL and a fixture are kept", async ({
  seededPage: page,
}) => {
  await stubRepository(page, {
    "src/index.ts": 'import idl from "../idl/x.json";',
    "idl/x.json": "{}",
    "tests/a.test.ts": 'import a from "./fixtures/a.json";',
    "tests/fixtures/a.json": "{}",
    "tsconfig.json": "{}",
  });
  await importRepository(page);

  await expect(item(page, "client/idl/x.json")).toHaveCount(1, LONG);
  await expect(item(page, "client/src/index.ts")).toHaveCount(1);
  await expect(item(page, "tests/a.test.ts")).toHaveCount(1);
  await expect(item(page, "tests/fixtures/a.json")).toHaveCount(1);
  await expect(item(page, "client/tsconfig.json")).toHaveCount(0);
});

test("project-without-program: A test file outside a tests folder", async ({
  seededPage: page,
}) => {
  await stubRepository(page, { "lib/math.spec.ts": "export {};" });
  await importRepository(page, "");

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
  await importRepository(page, "");

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
  await importRepository(page, "");

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
  await expect(page.locator("#flow-run")).toHaveText("Run");
  await page.keyboard.press("Control+2");
  await expect(page.locator("#flow-stage-panel-write")).toBeVisible();
  await expect(page.locator("#flow-stage-panel-build")).toHaveCount(0);
});

test("project-without-program: A project with no program on a phone", async ({
  seededPage: page,
}) => {
  await stubRepository(page, CLIENT_AND_TESTS);
  await importAndReturn(page);
  await expect(item(page, "tests/rpc.test.ts")).toHaveCount(1, LONG);
  await expect.poll(() => stageTabIds(page)).toEqual(["flow-stage-tab-write"]);

  await page.setViewportSize({ width: 390, height: 844 });

  // The phone's stepper leaves Write out, so nothing is left to draw
  await expect(
    page.getByRole("tablist", { name: "Development loop" })
  ).toHaveCount(0);
  await expect(page.locator("#flow-client-project")).toHaveCount(1);
  await expect(page.locator("#flow-run")).toBeVisible();
});

test("project-without-program: The preview of a project with no program on a phone", async ({
  seededPage: page,
}) => {
  await stubRepository(page, CLIENT_AND_TESTS);
  await importAndReturn(page);
  await expect(item(page, "tests/rpc.test.ts")).toHaveCount(1, LONG);
  await expect.poll(() => stageTabIds(page)).toEqual(["flow-stage-tab-write"]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Preview the build" }).click();

  // In the viewport, not only present: the pager used to bounce back to Code
  // while both stayed in the DOM, visible to a count
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#flow-client-project")).toBeInViewport();
  await expect(
    preview.getByText("Run the client to see its output here.")
  ).toBeInViewport();
  await expect(page.getByRole("region", { name: "Work" })).not.toBeInViewport();
  // The welcome names no Build or Deploy for a project that has none
  await expect(preview.locator(".xterm-rows")).toContainText(
    "Output from your client and your commands shows here."
  );
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
  await expect(page.locator("#flow-run")).toHaveCount(0);
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

test("client-run: A project with a program", async ({ seededPage: page }) => {
  // The seeded project is the default native program
  await expect
    .poll(() => stageTabIds(page), LONG)
    .toContain("flow-stage-tab-build");
  await expect(page.locator("#flow-run")).toHaveCount(0);
});
