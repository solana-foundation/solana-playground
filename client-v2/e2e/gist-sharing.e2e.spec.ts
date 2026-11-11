import type { Page, Request } from "@playwright/test";

import {
  currentProject,
  expect,
  grantClipboard,
  json,
  LONG,
  projectMenu,
  seedWorkspace,
  startProject,
  test,
  TEST_USER,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";
import { PHONE } from "./viewports";

/**
 * Sharing a project as a gist, against stubs: `/api/gists` answers as
 * GitHub would through it, and sign-in's popup lands straight on the real
 * `/api/auth-complete`, which reports back the way it does after GitHub. No
 * account, no GitHub.
 */

const PROJECT = "e2e-project";
const GIST_URL = "https://gist.github.com/t/abc123";

const LINK_PATH = "/gist/abc123";

/** The share dialog, titled by the project before the gist and by the gist after */
const dialog = (page: Page) =>
  page.getByRole("dialog", {
    name: /^Share .+ as a gist$|^Shared as a (secret|public) gist$/,
  });

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
    dialog(page).getByRole("button", { name: "Create secret gist" })
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

  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();

  await expect(playgroundLink(page)).toHaveValue(
    new URL(LINK_PATH, page.url()).href,
    LONG
  );
  await expect(
    dialog(page).getByRole("heading", { name: "Shared as a secret gist" })
  ).toBeVisible();
  const open = dialog(page).getByRole("link", {
    name: /Open the gist on GitHub/,
  });
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
    dialog(page).getByRole("button", { name: "Create secret gist" })
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
  // One cancel while the popup waits: the head's Close is the way out
  await expect(
    prompt(page).getByRole("button", { name: "Cancel", exact: true })
  ).toHaveCount(0);
  await prompt(page).getByRole("button", { name: "Close" }).click();

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

  await expect(
    prompt(page).getByText(
      "Sign-in isn't available. Your work is saved in this browser."
    )
  ).toBeVisible();
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

  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();
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

  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();

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

  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();

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

  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();

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

  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();
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

  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();
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

  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();

  await expect(
    dialog(page).getByRole("button", { name: "Sign in with GitHub" })
  ).toBeVisible(LONG);
});

test("gist-sharing: A successful share is counted", async ({ page }) => {
  const lines = linesOn(page);
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [201, { url: GIST_URL, id: "abc" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();

  await expect.poll(() => lineOf(lines, "gist_export_succeeded")).toBeTruthy();
  const started = lineOf(lines, "gist_export_started");
  const succeeded = lineOf(lines, "gist_export_succeeded");
  const files = started?.match(/files: (\d+)/)?.[1];
  expect(Number(files)).toBeGreaterThan(0);
  expect(succeeded).toContain(`files: ${files}`);
  expect(started).toContain("visibility: secret");
  expect(started).toContain("via: project_menu");
});

test("gist-sharing: A failure is counted by reason", async ({ page }) => {
  const lines = linesOn(page);
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [429, { reason: "rate-limited" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();

  await expect
    .poll(() => lineOf(lines, "gist_export_failed"))
    .toContain("reason: rate-limited");
  expect(lineOf(lines, "gist_export_failed")).toContain("visibility: secret");
});

test("gist-sharing: Too large is caught before sending", async ({ page }) => {
  test.setTimeout(120_000);
  await stubAuth(page, { signedIn: true });
  const requests = await stubGists(page);
  // The explorer refuses to import or create a project past the sync limits
  // (512 KB), far under a gist's 4 MB, so the project comes the one way a
  // project over them reaches the browser: restored from the account. 33
  // files of 128 KB, in lines of 64 bytes the editor tokenizes quickly
  const big = "big";
  const files: Record<string, string> = { "src/lib.rs": "// lib\n" };
  for (let i = 1; i <= 33; i++) {
    files[`src/f${i}.rs`] = `${"a".repeat(63)}\n`.repeat(2048);
  }
  const row = {
    id: "7c1d0e5c-4444-4444-8444-444444444444",
    name: big,
    kind: "project",
    updatedAt: new Date(Date.UTC(2026, 9, 1)).toISOString(),
  };
  await page.route("**/api/sync", (r) => json(r, { enabled: true, db: "ok" }));
  await page.route("**/api/conversations*", (r) => json(r, { items: [] }));
  await page.route("**/api/projects*", (r) => {
    if (r.request().method() !== "GET") return json(r, {});
    return new URL(r.request().url()).searchParams.get("id")
      ? json(r, {
          project: {
            id: row.id,
            name: row.name,
            kind: row.kind,
            updatedAt: row.updatedAt,
            snapshot: { files },
          },
        })
      : json(r, { projects: [row] });
  });
  await page.goto("/");
  await expect(currentProject(page)).toContainText(big, LONG);

  const menu = await projectMenu(page, big);
  await menu.getByRole("menuitem", { name: `Share ${big}` }).click();
  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();

  await expect(
    page.getByText(`${big} is too large to share as a gist`)
  ).toBeVisible(LONG);
  // Sending again would fail the same way, so the footer offers Close only
  await expect(
    dialog(page).getByRole("button", { name: "Try again" })
  ).toHaveCount(0);
  await expect(
    dialog(page).getByRole("button", { name: /^Create .* gist$/ })
  ).toHaveCount(0);
  await expect(
    dialog(page).getByRole("button", { name: "Close", exact: true })
  ).not.toHaveCount(0);
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

  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();

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
  await dialog(page)
    .getByRole("button", { name: "Create public gist" })
    .click();

  await expect(playgroundLink(page)).toBeVisible(LONG);
  expect(requests[0].postDataJSON().public).toBe(true);
});

test("gist-sharing: Copying the Playground link", async ({ page, context }) => {
  await grantClipboard(context);
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [201, { url: GIST_URL, id: "abc123" }]);
  await seedWorkspace(page);
  await openShare(page);
  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();
  await expect(playgroundLink(page)).toBeVisible(LONG);

  await dialog(page).getByRole("button", { name: "Copy link" }).click();

  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    new URL(LINK_PATH, page.url()).href
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

  await page.setViewportSize(PHONE);

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
  await grantClipboard(context);
  const lines = linesOn(page);
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [201, { url: GIST_URL, id: "abc123" }]);
  await seedWorkspace(page);
  await openShare(page);
  await dialog(page)
    .getByRole("button", { name: "Create secret gist" })
    .click();
  await expect(playgroundLink(page)).toBeVisible(LONG);

  await dialog(page).getByRole("button", { name: "Copy link" }).click();

  await expect
    .poll(() => lineOf(lines, "gist_link_copied"))
    .toContain("copied: playground");
});
