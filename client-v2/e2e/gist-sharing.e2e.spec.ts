import type { Page, Request } from "@playwright/test";

import {
  expect,
  json,
  LONG,
  projectMenu,
  seedWorkspace,
  startProject,
  test,
  TEST_USER,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/**
 * Share to GitHub, against stubs: `/api/gists` answers as GitHub would through
 * it, and sign-in's popup lands straight on the real `/api/auth-complete`,
 * which reports back the way it does after GitHub. No account, no GitHub.
 */

const PROJECT = "e2e-project";
const GIST_URL = "https://gist.github.com/t/abc123";

const LINK_PATH = "/gist/abc123";

const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Share to GitHub" });

/** The Playground link the shared state hands out */
const playgroundLink = (page: Page) =>
  dialog(page).getByRole("textbox", { name: "Playground link" });

/**
 * The session reads as `signedIn()` says, and a sign-in's popup completes at
 * once, signing in. Returns the bodies sign-in was asked with.
 */
const stubAuth = async (page: Page, { signedIn }: { signedIn: boolean }) => {
  // eslint-disable-next-line unicorn/no-null -- the session answer carries `user: null` when signed out
  let user: typeof TEST_USER | null = signedIn ? TEST_USER : null;
  const signIns: Array<Record<string, unknown>> = [];
  await page.route("**/api/auth/get-session", (r) => json(r, { user }));
  await page.route("**/api/auth/sign-in/social", (r) => {
    const body = r.request().postDataJSON();
    signIns.push(body);
    user = TEST_USER;
    // GitHub would send the popup back here; skip GitHub
    return json(r, { url: body.callbackURL, redirect: false });
  });
  return signIns;
};

/** `/api/gists` answers these in order, one per request; records the requests */
const stubGists = async (page: Page, ...answers: Array<[number, unknown]>) => {
  const requests: Request[] = [];
  await page.route("**/api/gists", (r) => {
    requests.push(r.request());
    const [status, body] = answers[requests.length - 1] ?? [500, {}];
    return r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return requests;
};

const openShare = async (page: Page) => {
  const menu = await projectMenu(page, PROJECT);
  await menu.getByRole("menuitem", { name: `Share ${PROJECT}` }).click();
  await expect(dialog(page)).toBeVisible();
};

test("gist-sharing: Opening the share dialog from the menu", async ({
  page,
}) => {
  await stubAuth(page, { signedIn: true });
  await seedWorkspace(page);

  await openShare(page);

  await expect(
    dialog(page).getByRole("radio", { name: "Secret" })
  ).toBeChecked();
});

test("gist-sharing: Opening the share dialog by its key", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  await seedWorkspace(page);

  const menu = await projectMenu(page, PROJECT);
  await menu.press("g");

  await expect(dialog(page)).toBeVisible();
});

test("gist-sharing: Nothing is sent on open", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  const requests = await stubGists(page);
  await seedWorkspace(page);

  await openShare(page);

  await expect(
    dialog(page).getByRole("button", { name: "Share to GitHub" })
  ).toBeVisible();
  expect(requests).toHaveLength(0);
});

test("gist-sharing: Successful share", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  const requests = await stubGists(page, [
    201,
    { url: GIST_URL, id: "abc123" },
  ]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();

  await expect(playgroundLink(page)).toHaveValue(
    new URL(LINK_PATH, page.url()).href,
    LONG
  );
  await expect(dialog(page).getByText("Shared")).toBeVisible();
  const open = dialog(page).getByRole("link", { name: /Open on GitHub/ });
  await expect(open).toHaveAttribute("href", GIST_URL);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");

  expect(requests).toHaveLength(1);
});

const prompt = (page: Page) =>
  page.getByRole("dialog", { name: "Sign in to share" });

/** Picks Share on the project while signed out: the prompt opens */
const openSignedOut = async (page: Page) => {
  const menu = await projectMenu(page, PROJECT);
  await menu.getByRole("menuitem", { name: `Share ${PROJECT}` }).click();
  await expect(prompt(page)).toBeVisible();
};

test("gist-sharing: Signed out, the prompt comes first", async ({ page }) => {
  await stubAuth(page, { signedIn: false });
  const requests = await stubGists(page);
  await seedWorkspace(page);

  await openSignedOut(page);

  await expect(
    prompt(page).getByText(
      "Your project goes to a gist on your GitHub account."
    )
  ).toBeVisible();
  const signIn = prompt(page).getByRole("button", {
    name: "Sign in with GitHub",
  });
  await expect(signIn.locator("svg")).toBeVisible();
  await expect(
    prompt(page).getByRole("button", { name: "Cancel", exact: true })
  ).toBeVisible();
  expect(requests).toHaveLength(0);
});

test("gist-sharing: Signed out, then signed in", async ({ page }) => {
  const signIns = await stubAuth(page, { signedIn: false });
  const requests = await stubGists(page, [
    201,
    { url: GIST_URL, id: "abc123" },
  ]);
  await seedWorkspace(page);
  await openSignedOut(page);

  await prompt(page)
    .getByRole("button", { name: "Sign in with GitHub" })
    .click();

  await expect(
    dialog(page).getByRole("button", { name: "Share to GitHub" })
  ).toBeVisible(LONG);
  await expect(prompt(page)).toHaveCount(0);
  expect(requests).toHaveLength(0);
  expect(signIns).toHaveLength(1);
  expect(signIns[0].scopes).toBeUndefined();
});

test("gist-sharing: Signed in, no prompt", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  await seedWorkspace(page);

  await openShare(page);

  await expect(prompt(page)).toHaveCount(0);
});

test("gist-sharing: Sign-in cancelled", async ({ page }) => {
  await stubAuth(page, { signedIn: false });
  // A popup GitHub never sends back: the sign-in waits until it is cancelled
  await page.route("**/api/auth/sign-in/social", (r) =>
    json(r, { url: "about:blank", redirect: false })
  );
  const requests = await stubGists(page);
  await seedWorkspace(page);
  await openSignedOut(page);

  await prompt(page)
    .getByRole("button", { name: "Sign in with GitHub" })
    .click();
  await prompt(page).getByRole("button", { name: "Cancel sign-in" }).click();

  await expect(prompt(page).getByText("Sign-in cancelled.")).toBeVisible();
  await expect(
    prompt(page).getByRole("button", { name: "Sign in with GitHub" })
  ).toBeEnabled();
  expect(requests).toHaveLength(0);
});

test("gist-sharing: Closing the dialog while sign-in waits", async ({
  page,
}) => {
  await stubAuth(page, { signedIn: false });
  await page.route("**/api/auth/sign-in/social", (r) =>
    json(r, { url: "about:blank", redirect: false })
  );
  const requests = await stubGists(page);
  await seedWorkspace(page);
  await openSignedOut(page);

  await prompt(page)
    .getByRole("button", { name: "Sign in with GitHub" })
    .click();
  await expect(
    prompt(page).getByRole("button", { name: "Cancel sign-in" })
  ).toBeVisible();
  await prompt(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  await expect(prompt(page)).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test("gist-sharing: A sign-in that cannot start", async ({ page }) => {
  await stubAuth(page, { signedIn: false });
  await page.route("**/api/auth/sign-in/social", (r) =>
    r.fulfill({ status: 500, contentType: "application/json", body: "{}" })
  );
  const requests = await stubGists(page);
  await seedWorkspace(page);
  await openSignedOut(page);

  await prompt(page)
    .getByRole("button", { name: "Sign in with GitHub" })
    .click();

  await expect(prompt(page).getByText("Could not start sign-in")).toBeVisible();
  expect(requests).toHaveLength(0);
});

test("gist-sharing: Cancel leaves without signing in", async ({ page }) => {
  const signIns = await stubAuth(page, { signedIn: false });
  const requests = await stubGists(page);
  await seedWorkspace(page);
  await openSignedOut(page);

  await prompt(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  await expect(prompt(page)).toHaveCount(0);
  expect(signIns).toHaveLength(0);
  expect(requests).toHaveLength(0);
});

test("gist-sharing: A session without gist access", async ({ page }) => {
  const signIns = await stubAuth(page, { signedIn: true });
  const requests = await stubGists(
    page,
    [403, { reason: "needs-gist-scope" }],
    [201, { url: GIST_URL, id: "abc123" }]
  );
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();
  await dialog(page)
    .getByRole("button", { name: "Allow gists on GitHub" })
    .click(LONG);

  await expect(playgroundLink(page)).toHaveValue(
    new URL(LINK_PATH, page.url()).href,
    LONG
  );
  expect(signIns.map((body) => body.scopes)).toEqual([["gist"]]);
  expect(requests).toHaveLength(2);
});

test("gist-sharing: Rate limited", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [429, { reason: "rate-limited" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();

  await expect(
    dialog(page).getByText(
      "GitHub is limiting requests from this browser. Try again in a few minutes."
    )
  ).toBeVisible(LONG);
  await expect(
    dialog(page).getByRole("button", { name: "Try again" })
  ).toBeVisible();
});

test("gist-sharing: GitHub refused the gist", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [422, { reason: "rejected" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();

  await expect(
    dialog(page).getByText("GitHub refused the gist. Nothing was published.")
  ).toBeVisible(LONG);
  await expect(
    dialog(page).getByRole("button", { name: "Try again" })
  ).toHaveCount(0);
});

test("gist-sharing: Request failed", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [502, { reason: "request-failed" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();

  await expect(
    dialog(page).getByText(
      "Could not export to GitHub. Check your gists on GitHub before you try again."
    )
  ).toBeVisible(LONG);
  await expect(
    dialog(page).getByRole("button", { name: "Try again" })
  ).toBeVisible();
});

test("gist-sharing: The keypair stays home", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  const requests = await stubGists(page, [201, { url: GIST_URL, id: "abc" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();
  await expect(playgroundLink(page)).toBeVisible(LONG);

  const body = requests[0].postDataJSON();
  const manifest = JSON.parse(body.files[".playground.json"].content);
  expect(manifest.name).toBe(PROJECT);
  const paths = Object.values(manifest.files) as string[];
  expect(paths).toContain("src/lib.rs");
  expect(paths.filter((p) => p.startsWith(".workspace/"))).toEqual([]);
  expect(JSON.stringify(body)).not.toContain("program-info");
});

test("gist-sharing: Access still missing after the popup", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  const requests = await stubGists(
    page,
    [403, { reason: "needs-gist-scope" }],
    [403, { reason: "needs-gist-scope" }]
  );
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();
  await dialog(page)
    .getByRole("button", { name: "Allow gists on GitHub" })
    .click(LONG);

  await expect(
    dialog(page).getByText(/GitHub did not grant gist access/)
  ).toBeVisible(LONG);
  expect(requests).toHaveLength(2);
});

test("gist-sharing: Authorization revoked", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [401, { reason: "github-unauthorized" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();

  await expect(
    dialog(page).getByRole("button", { name: "Sign in with GitHub again" })
  ).toBeVisible(LONG);
});

test("gist-sharing: A successful share is counted", async ({ page }) => {
  const lines = linesOn(page);
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [201, { url: GIST_URL, id: "abc" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();

  await expect.poll(() => lineOf(lines, "gist_export_succeeded")).toBeTruthy();
  const started = lineOf(lines, "gist_export_started");
  const succeeded = lineOf(lines, "gist_export_succeeded");
  const files = started?.match(/files: (\d+)/)?.[1];
  expect(Number(files)).toBeGreaterThan(0);
  expect(succeeded).toContain(`files: ${files}`);
  expect(started).toContain("visibility: secret");
  expect(started).toContain("source: project_menu");
});

test("gist-sharing: A failure is counted by reason", async ({ page }) => {
  const lines = linesOn(page);
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [429, { reason: "rate-limited" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();

  await expect
    .poll(() => lineOf(lines, "gist_export_failed"))
    .toContain("reason: rate-limited");
  expect(lineOf(lines, "gist_export_failed")).toContain("visibility: secret");
});

test("gist-sharing: Too large is caught before sending", async ({ page }) => {
  test.setTimeout(120_000);
  await stubAuth(page, { signedIn: true });
  const requests = await stubGists(page);
  // A repository whose one source file is over 4 MB, imported as the project
  await page.route("https://api.github.com/repos/alice/big/git/trees/**", (r) =>
    json(r, {
      truncated: false,
      tree: [{ path: "index.ts", type: "blob", sha: "index.ts" }],
    })
  );
  await page.route("https://raw.githubusercontent.com/alice/big/**", (r) =>
    r.fulfill({ body: "//" + "x".repeat(4 * 1024 * 1024 + 1024) })
  );
  await seedWorkspace(page);
  await page.locator("[data-settings-trigger]").first().click();
  await page
    .getByRole("region", { name: "Settings" })
    .getByRole("button", { name: "From GitHub" })
    .click();
  const importer = page.getByRole("dialog");
  await importer
    .getByPlaceholder("https://github.com/... or https://gist.github.com/...")
    .fill("https://github.com/alice/big");
  await importer.locator('button[type="submit"]').click();
  await expect(page.getByRole("dialog")).toHaveCount(0, LONG);
  // An import closes Settings once the project is open
  await expect(page.getByRole("region", { name: "Settings" })).toHaveCount(0);

  const big = "github-alice/big/";
  const menu = await projectMenu(page, big);
  await menu.getByRole("menuitem", { name: `Share ${big}` }).click();
  await page
    .getByRole("dialog", { name: "Share to GitHub" })
    .getByRole("button", { name: "Share to GitHub" })
    .click();

  await expect(
    page.getByText(`${big} is too large to share as a gist`)
  ).toBeVisible(LONG);
  expect(requests).toHaveLength(0);
});

test("gist-sharing: Sharing with the default", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  const requests = await stubGists(page, [
    201,
    { url: GIST_URL, id: "abc123" },
  ]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();

  await expect(playgroundLink(page)).toBeVisible(LONG);
  expect(requests[0].postDataJSON().public).toBe(false);
});

test("gist-sharing: Sharing a public gist", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  const requests = await stubGists(page, [
    201,
    { url: GIST_URL, id: "abc123" },
  ]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page).getByRole("radio", { name: "Public" }).click();
  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();

  await expect(playgroundLink(page)).toBeVisible(LONG);
  expect(requests[0].postDataJSON().public).toBe(true);
});

test("gist-sharing: Copying the Playground link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [201, { url: GIST_URL, id: "abc123" }]);
  await seedWorkspace(page);
  await openShare(page);
  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();
  await expect(playgroundLink(page)).toBeVisible(LONG);

  await dialog(page)
    .getByRole("button", { name: "Copy Playground link" })
    .click();

  await expect(page.getByText("Link copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    new URL(LINK_PATH, page.url()).href
  );
});

test("gist-sharing: Copying the GitHub link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [201, { url: GIST_URL, id: "abc123" }]);
  await seedWorkspace(page);
  await openShare(page);
  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();
  await expect(playgroundLink(page)).toBeVisible(LONG);

  await dialog(page).getByRole("button", { name: "Copy GitHub link" }).click();

  await expect(page.getByText("Link copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    GIST_URL
  );
});

test("gist-sharing: Sharing from the header", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  const requests = await stubGists(page);
  await seedWorkspace(page);

  await page.locator("#flow-share").click();

  await expect(dialog(page)).toBeVisible();
  expect(requests).toHaveLength(0);
});

test("gist-sharing: No header Share on a phone", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  await seedWorkspace(page);
  await expect(page.locator("#flow-share")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.locator("#flow-share")).toHaveCount(0);
});

test("gist-sharing: Another project's row", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  await seedWorkspace(page, "other-project");
  // A second project from Home, which then is the open one
  await page
    .locator('[data-slot="sidebar"]')
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await startProject(page, PROJECT);

  const menu = await projectMenu(page, "other-project");
  await expect(menu.getByRole("menuitem", { name: /^Share/ })).toHaveCount(0);
  await menu.press("g");

  await expect(dialog(page)).toHaveCount(0);
});

test("gist-sharing: A copy is counted", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const lines = linesOn(page);
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [201, { url: GIST_URL, id: "abc123" }]);
  await seedWorkspace(page);
  await openShare(page);
  await dialog(page).getByRole("button", { name: "Share to GitHub" }).click();
  await expect(playgroundLink(page)).toBeVisible(LONG);

  await dialog(page)
    .getByRole("button", { name: "Copy Playground link" })
    .click();

  await expect
    .poll(() => lineOf(lines, "gist_link_copied"))
    .toContain("copied: playground");
});
