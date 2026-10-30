import type { Page, Request } from "@playwright/test";
import {
  expect,
  json,
  LONG,
  projectMenu,
  seedWorkspace,
  test,
  TEST_USER,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/**
 * Share as gist, against stubs: `/api/gists` answers as GitHub would through
 * it, and sign-in's popup lands straight on the real `/api/auth-complete`,
 * which reports back the way it does after GitHub. No account, no GitHub.
 */

const PROJECT = "e2e-project";
const GIST_URL = "https://gist.github.com/t/abc123";

const dialog = (page: Page) =>
  page.getByRole("dialog", { name: `Share ${PROJECT} as a gist` });

/**
 * The session reads as `signedIn()` says, and a sign-in's popup completes at
 * once, signing in. Returns the bodies sign-in was asked with.
 */
const stubAuth = async (page: Page, { signedIn }: { signedIn: boolean }) => {
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
  await menu
    .getByRole("menuitem", { name: `Share ${PROJECT} as a gist` })
    .click();
  await expect(dialog(page)).toBeVisible();
};

test("gist-sharing: Opening the share dialog from the menu", async ({
  page,
}) => {
  await stubAuth(page, { signedIn: true });
  await seedWorkspace(page);

  await openShare(page);

  await expect(dialog(page).getByText(/The gist is public/)).toBeVisible();
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
    dialog(page).getByRole("button", { name: "Create public gist" })
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
    .getByRole("button", { name: "Create public gist" })
    .click();

  await expect(
    dialog(page).getByRole("textbox", { name: "Gist URL" })
  ).toHaveValue(GIST_URL, LONG);
  const open = dialog(page).getByRole("link", { name: /Open on GitHub/ });
  await expect(open).toHaveAttribute("href", GIST_URL);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");

  expect(requests).toHaveLength(1);
});

test("gist-sharing: Signed out, then signed in", async ({ page }) => {
  const signIns = await stubAuth(page, { signedIn: false });
  await stubGists(page, [201, { url: GIST_URL, id: "abc123" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page)
    .getByRole("button", { name: "Sign in with GitHub to share" })
    .click();

  await expect(
    dialog(page).getByRole("textbox", { name: "Gist URL" })
  ).toHaveValue(GIST_URL, LONG);
  expect(signIns).toHaveLength(1);
  expect(signIns[0].scopes).toBeUndefined();
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
    .getByRole("button", { name: "Create public gist" })
    .click();
  await dialog(page)
    .getByRole("button", { name: "Allow gists on GitHub" })
    .click(LONG);

  await expect(
    dialog(page).getByRole("textbox", { name: "Gist URL" })
  ).toHaveValue(GIST_URL, LONG);
  expect(signIns.map((body) => body.scopes)).toEqual([["gist"]]);
  expect(requests).toHaveLength(2);
});

test("gist-sharing: Rate limited", async ({ page }) => {
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [429, { reason: "rate-limited" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page)
    .getByRole("button", { name: "Create public gist" })
    .click();

  await expect(
    dialog(page).getByText(/GitHub is limiting requests/)
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
    .getByRole("button", { name: "Create public gist" })
    .click();
  await expect(
    dialog(page).getByRole("textbox", { name: "Gist URL" })
  ).toBeVisible(LONG);

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
    .getByRole("button", { name: "Create public gist" })
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
    .getByRole("button", { name: "Create public gist" })
    .click();

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

  await dialog(page)
    .getByRole("button", { name: "Create public gist" })
    .click();

  await expect.poll(() => lineOf(lines, "gist_export_succeeded")).toBeTruthy();
  const started = lineOf(lines, "gist_export_started");
  const succeeded = lineOf(lines, "gist_export_succeeded");
  const files = started?.match(/files: (\d+)/)?.[1];
  expect(Number(files)).toBeGreaterThan(0);
  expect(succeeded).toContain(`files: ${files}`);
});

test("gist-sharing: A failure is counted by reason", async ({ page }) => {
  const lines = linesOn(page);
  await stubAuth(page, { signedIn: true });
  await stubGists(page, [429, { reason: "rate-limited" }]);
  await seedWorkspace(page);
  await openShare(page);

  await dialog(page)
    .getByRole("button", { name: "Create public gist" })
    .click();

  await expect
    .poll(() => lineOf(lines, "gist_export_failed"))
    .toContain("reason: rate-limited");
});
