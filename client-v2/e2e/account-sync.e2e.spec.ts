import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

/**
 * What a signed-in browser does with an account it has never seen.
 *
 * The session is an HttpOnly cookie from a live GitHub round trip, so signing
 * in for real is not something a test can do. The endpoints behind it are
 * stubbed instead: this is about what the *client* does with the answers --
 * whether the projects arrive, whether one is opened, whether the conversation
 * is on screen -- and every one of those was wrong at some point while the
 * modules underneath were individually passing their own tests.
 *
 * The server's side of the same contract is covered against a real database in
 * `src/features/persistence/server/projects.test.mjs`.
 */

const LONG = { timeout: 60_000 };

const TUTORIAL = {
  id: "tut:hello-anchor",
  name: "Hello Anchor",
  kind: "tutorial",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

/** Older, so it must not be the one opened */
const PROJECT = {
  id: "9f1d0e5c-1111-4111-8111-111111111111",
  name: "From The Laptop",
  kind: "project",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

const SNAPSHOTS: Record<string, unknown> = {
  [TUTORIAL.id]: { files: { "src/lib.rs": "// written on the other device" } },
  [PROJECT.id]: { files: { "src/lib.rs": "// written on the laptop" } },
};

const SAID = "a message from the other device";

/** An account whose work lives entirely on some other browser */
const stubAccount = async (page: Page) => {
  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

  await page.route("**/api/auth/get-session", (r) =>
    json(r, { user: { id: "u1", name: "Tester", image: null, login: "t" } })
  );
  await page.route("**/api/sync", (r) => json(r, { enabled: true, db: "ok" }));

  await page.route("**/api/conversations*", (r) =>
    json(r, {
      items: [
        {
          kind: "user",
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          createdAt: "2026-03-01T00:00:00.000Z",
          text: SAID,
        },
      ],
    })
  );

  await page.route("**/api/projects*", (r) => {
    if (r.request().method() === "PUT") {
      return json(r, { updatedAt: new Date().toISOString() });
    }
    const id = new URL(r.request().url()).searchParams.get("id");
    if (!id) return json(r, { projects: [TUTORIAL, PROJECT] });

    const found = [TUTORIAL, PROJECT].find((p) => p.id === id);
    return found
      ? json(r, { project: { ...found, snapshot: SNAPSHOTS[found.id] } })
      : r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
};

const threadId = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __pgAssistant?: { threadId?: string } })
        .__pgAssistant?.threadId ?? null
  );

test("a signed-in browser takes on the whole account", async ({ page }) => {
  test.setTimeout(240_000);
  await stubAccount(page);
  await page.goto("/");

  // The newest project is opened, so a device that has just pulled the whole
  // account down does not sit there saying "No project"
  await expect(page.locator('[aria-haspopup="true"]').first()).toContainText(
    "Hello Anchor",
    LONG
  );
  await expect.poll(() => threadId(page), LONG).toBe("tut:hello-anchor");

  // The gallery greets an empty browser, and this one only looked empty while
  // the account was still answering
  await expect(page.locator("[data-gallery-modal]")).toHaveCount(0, LONG);

  // Every project the account has, not just the one that happens to be open
  await page.locator('[aria-haspopup="true"]').first().click();
  const menu = page.getByLabel("Projects and lessons");
  await expect(menu).toBeVisible(LONG);
  await expect(menu.getByText("From The Laptop", { exact: true })).toBeVisible(
    LONG
  );
});

test("the conversation is on screen before a backend is picked", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await stubAccount(page);
  await page.goto("/");

  // Picking a backend is per-browser, so a second device always starts at the
  // picker. The thread is in memory well before that, and used to be invisible
  // until the user clicked through -- which reads as "it did not sync".
  await expect(page.getByText(SAID)).toBeVisible(LONG);
  await expect(
    page.getByRole("button", { name: "Start", exact: true })
  ).toBeVisible(LONG);
});

/**
 * A reload is not an edit.
 *
 * Every write bumps the row, and a bumped row is what the *other* browser sees
 * as "this project changed on another device". So a reload that quietly
 * re-uploaded anything -- the stale in-memory copy it was about to replace, or
 * the copy it had just pulled -- turned two idle browsers into a conflict
 * between them. The only honest number of writes here is none.
 */
test("reloading a project the account already has writes nothing", async ({
  page,
}) => {
  test.setTimeout(240_000);

  // A project of this browser's own, so the reload has something to switch
  // into -- an empty profile never exercises the path at all
  await page.goto("/");
  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill("Shared");
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);

  const localId = await page.evaluate(
    () =>
      (window as unknown as { __pgAssistant?: { threadId?: string } })
        .__pgAssistant?.threadId as string
  );
  // The workspace dotfiles ride along too. If either failed to land on disk,
  // or came back differently, the snapshot would no longer match and the
  // assertion below would see a write -- so this is a round trip, not just a
  // no-op check.
  const files = {
    "src/lib.rs": "// the account's copy",
    ".workspace/program-info.json": '{"kp":[1,2,3]}',
    ".tutorial.json": '{"pageNumber":3,"completed":false}',
  };

  const writes: unknown[] = [];
  const shared = {
    id: localId,
    name: "Shared",
    kind: "project",
    updatedAt: "2026-02-01T00:00:00.000Z",
  };

  const json = (r: Route, body: unknown) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

  await page.route("**/api/auth/get-session", (r) =>
    json(r, { user: { id: "u1", name: "T", image: null, login: "t" } })
  );
  await page.route("**/api/sync", (r) => json(r, { enabled: true, db: "ok" }));
  await page.route("**/api/conversations*", (r) => json(r, { items: [] }));
  await page.route("**/api/projects*", (r) => {
    if (r.request().method() === "PUT") {
      writes.push(JSON.parse(r.request().postData() ?? "{}"));
      return json(r, { updatedAt: new Date().toISOString() });
    }
    const id = new URL(r.request().url()).searchParams.get("id");
    return id
      ? json(r, { project: { ...shared, snapshot: { files } } })
      : json(r, { projects: [shared] });
  });

  await page.reload();

  // The account's copy is what is open, so the reconcile has finished
  await expect.poll(() => threadId(page), LONG).toBe(localId);
  await page.waitForTimeout(8000);

  expect(writes).toEqual([]);
  await expect(page.getByText("changed on another device")).toHaveCount(0);
});

/**
 * The program keypair and a lesson's progress travel with the project.
 *
 * Both live in dotfiles, and the explorer's in-memory tree has never held any
 * dotfile (`isItemNameValid`), so a snapshot built from it silently left them
 * behind -- the same project deployed to a different address on every device,
 * and a lesson restarted from page one.
 */
test("a started tutorial hands over its keypair and progress", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await page.getByRole("tab", { name: /tutorials/i }).click();
  await page
    .getByText("Hello Anchor", { exact: true })
    .locator("xpath=../..")
    .getByRole("button", { name: "Open" })
    .click();
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect.poll(() => threadId(page), LONG).toBe("tut:hello-anchor");
  // The keypair is written after the workspace is up, not with it
  await page.waitForTimeout(5000);

  const writes: Array<{ snapshot?: { files: Record<string, string> } }> = [];
  const json = (r: Route, body: unknown) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

  await page.route("**/api/auth/get-session", (r) =>
    json(r, { user: { id: "u1", name: "T", image: null, login: "t" } })
  );
  await page.route("**/api/sync", (r) => json(r, { enabled: true, db: "ok" }));
  await page.route("**/api/conversations*", (r) => json(r, { items: [] }));
  await page.route("**/api/projects*", (r) => {
    if (r.request().method() === "PUT") {
      writes.push(JSON.parse(r.request().postData() ?? "{}"));
      return json(r, { updatedAt: new Date().toISOString() });
    }
    // An account with nothing on it, so this browser is the one handing over
    return json(r, { projects: [] });
  });

  await page.reload();

  await expect.poll(() => writes.length, LONG).toBeGreaterThan(0);
  const sent = Object.keys(writes[0].snapshot?.files ?? {});
  expect(sent).toContain(".workspace/program-info.json");
  expect(sent).toContain(".tutorial.json");
});
