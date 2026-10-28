import type { Page } from "@playwright/test";

import {
  LONG,
  currentProject,
  expect,
  json,
  projectRow,
  test,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

const ID = "0123abcd";

const PROGRAM = [
  "use solana_program::entrypoint;",
  "entrypoint!(process_instruction);",
].join("\n");

/**
 * Answers the gist API with a gist made by hand: one native program file.
 * Raw downloads are refused, so nothing reaches the network.
 */
const stubGist = async (page: Page) => {
  await page.route("https://gist.githubusercontent.com/**", (r) => r.abort());
  await page.route(`https://api.github.com/gists/${ID}`, (r) =>
    json(r, {
      truncated: false,
      owner: { login: "alice" },
      files: {
        "lib.rs": {
          content: PROGRAM,
          truncated: false,
          raw_url: `https://gist.githubusercontent.com/alice/${ID}/raw/lib.rs`,
        },
      },
    })
  );
};

const editorText = (page: Page) => page.locator(".monaco-editor .view-lines");

/** Opens Settings, then its "From GitHub" import, and imports the URL */
const importFromDialog = async (page: Page, url: string) => {
  await page.locator("[data-settings-trigger]").first().click();
  await page
    .getByRole("region", { name: "Settings" })
    .getByRole("button", { name: "From GitHub" })
    .click();

  const dialog = page.getByRole("dialog");
  await dialog
    .getByPlaceholder("https://github.com/... or https://gist.github.com/...")
    .fill(url);
  await dialog.locator('button[type="submit"]').click();
};

test("gist-sharing: Importing a gist from the dialog", async ({
  seededPage: page,
}) => {
  await stubGist(page);
  await importFromDialog(page, `https://gist.github.com/alice/${ID}`);

  await expect(currentProject(page)).toHaveText(`gist-alice/${ID}`, LONG);
  await expect(editorText(page)).toContainText(
    "entrypoint!(process_instruction)",
    LONG
  );
});

test("gist-sharing: Opening a gist link signed out", async ({ page }) => {
  await stubGist(page);

  await page.goto(`/gist/${ID}`);

  await expect(editorText(page)).toContainText(
    "entrypoint!(process_instruction)",
    LONG
  );
  await expect(page.locator("#tabs").getByText("lib.rs")).toBeVisible();
  // A view, not a project: the navigation lists none
  await expect(currentProject(page)).toHaveCount(0);
});

test("gist-sharing: Saving a gist opened from a link", async ({ page }) => {
  await stubGist(page);
  await page.goto(`/gist/${ID}`);
  await expect(editorText(page)).toContainText("entrypoint!", LONG);

  await importFromDialog(page, `https://gist.github.com/alice/${ID}`);

  await expect(currentProject(page)).toHaveText(`gist-alice/${ID}`, LONG);
});

test("gist-sharing: A missing gist", async ({ page }) => {
  await page.route(`https://api.github.com/gists/${ID}`, (r) =>
    r.fulfill({ status: 404, json: { message: "Not Found" } })
  );

  await page.goto(`/gist/${ID}`);

  await expect(
    page.getByText(`Gist "${ID}" was not found on GitHub`)
  ).toBeVisible(LONG);
});

/** A gist API answer holding one file */
const oneFile = (content: string, truncated = false) => ({
  truncated: false,
  owner: { login: "alice" },
  files: {
    "lib.rs": {
      content: truncated ? content.slice(0, 20) : content,
      truncated,
      raw_url: `https://gist.githubusercontent.com/alice/${ID}/raw/lib.rs`,
    },
  },
});

test("gist-sharing: Owner, id and revision are read from the URL", async ({
  page,
}) => {
  await page.route(`https://api.github.com/gists/${ID}/9f8e7d`, (r) =>
    json(r, oneFile(PROGRAM))
  );

  await page.goto(`/https://gist.github.com/alice/${ID}/9f8e7d`);

  await expect(editorText(page)).toContainText("entrypoint!", LONG);
});

test("gist-sharing: A repository URL is not a gist URL", async ({
  seededPage: page,
}) => {
  let gistRequests = 0;
  await page.route("https://api.github.com/gists/**", (r) => {
    gistRequests++;
    return r.abort();
  });
  await page.route("https://api.github.com/repos/alice/repo/**", (r) =>
    r.fulfill({ status: 404, json: { message: "Not Found" } })
  );

  await importFromDialog(page, "https://github.com/alice/repo");

  await expect(
    page.getByRole("dialog").getByText(/"alice\/repo" was not found/)
  ).toBeVisible(LONG);
  expect(gistRequests).toBe(0);
});

test("gist-sharing: Importing the same gist twice", async ({
  seededPage: page,
}) => {
  let requests = 0;
  await page.route(`https://api.github.com/gists/${ID}`, (r) => {
    requests++;
    return json(r, oneFile(PROGRAM));
  });
  const url = `https://gist.github.com/alice/${ID}`;
  await importFromDialog(page, url);
  await expect(currentProject(page)).toHaveText(`gist-alice/${ID}`, LONG);
  await page.getByText("Back to app").click();

  await importFromDialog(page, url);

  await expect(page.getByRole("dialog")).toBeHidden(LONG);
  await page.getByText("Back to app").click();
  await expect(projectRow(page, `gist-alice/${ID}`)).toHaveCount(1);
  expect(requests).toBe(1);
});

test("gist-sharing: GitHub's hourly limit is reached", async ({ page }) => {
  await page.route(`https://api.github.com/gists/${ID}`, (r) =>
    r.fulfill({
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
      json: { message: "API rate limit exceeded" },
    })
  );

  await page.goto(`/gist/${ID}`);

  await expect(page.getByText(/Please try again later/)).toBeVisible(LONG);
});

test("gist-sharing: A large file in a gist", async ({ page }) => {
  const tail = 'msg!("the end of a long file");';
  const whole = `${PROGRAM}\n${tail}`;
  await page.route(`https://api.github.com/gists/${ID}`, (r) =>
    json(r, oneFile(whole, true))
  );
  await page.route(
    `https://gist.githubusercontent.com/alice/${ID}/raw/lib.rs`,
    (r) => r.fulfill({ body: whole, contentType: "text/plain" })
  );

  await page.goto(`/gist/${ID}`);

  await expect(editorText(page)).toContainText(tail, LONG);
});

test("gist-sharing: A failed import is counted with its reason", async ({
  seededPage: page,
}) => {
  const lines = linesOn(page);
  await page.route(`https://api.github.com/gists/${ID}`, (r) =>
    r.fulfill({ status: 404, json: { message: "Not Found" } })
  );

  await importFromDialog(page, `https://gist.github.com/alice/${ID}`);

  await expect
    .poll(() => lineOf(lines, "gist_import_failed"), LONG)
    .toMatch(/dialog[\s\S]*not-found/);
});
