import type { Page } from "@playwright/test";
import {
  expect,
  json,
  LONG,
  startProject,
  stubSession,
  test,
  TEST_USER,
} from "./fixtures";
import { SIGNED_OUT_REASON } from "../src/features/auth/config.mjs";
import { REMEMBERED_BACKEND_KEY } from "../src/views/sidebar/assistant/model/remembered-backend-key";

/**
 * The default backend is offered only to a signed-in user, because
 * `/api/agent` refuses anyone else.
 *
 * The probe is stubbed as configured, so this runs where no key exists, CI
 * included. Signed out, nothing pops up: a send opens Connect a model, which
 * offers sign-in in place of Start, and the prompt stays in the composer.
 */

type AssistantWindow = Window & {
  __pgAssistant?: { isConnected: boolean };
};

const isConnected = (page: Page) =>
  page.evaluate(() => !!(window as AssistantWindow).__pgAssistant?.isConnected);

const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message the assistant" });

const connectDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Connect a model" });

/** A deployment that serves a default backend, which refuses every turn as signed out */
const defaultBackendRefusing = (page: Page) =>
  page.route("**/api/agent", (r) =>
    r.request().method() === "GET"
      ? json(r, { configured: true, model: "test-model" })
      : r.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Sign in with GitHub to use the default backend.",
            reason: SIGNED_OUT_REASON,
          }),
        })
  );

/** ...and a browser that picked the default before */
const defaultBackendRemembered = async (page: Page) => {
  await defaultBackendRefusing(page);
  // `addInitScript` runs in the page, so the key travels as its argument
  await page.addInitScript(
    (key) => localStorage.setItem(key, "default"),
    REMEMBERED_BACKEND_KEY
  );
};

const openProject = async (page: Page, name: string) => {
  await page.goto("/");
  await startProject(page, name, LONG);
  await expect(composer(page)).toBeVisible(LONG);
};

const send = async (page: Page, text: string) => {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
};

/** Connect a model, open on the default backend and offering sign-in for it */
const expectSignInOffered = async (page: Page) => {
  const dialog = connectDialog(page);
  await expect(dialog).toBeVisible(LONG);
  await expect(
    dialog.getByText(
      "Sign in with GitHub to use it, or bring your own key below."
    )
  ).toBeVisible();
  // The tag would otherwise call the backend ready to use
  await expect(
    dialog.getByText("sign-in needed", { exact: true })
  ).toBeVisible();
  await expect(dialog.getByText("no key needed", { exact: true })).toBeHidden();
  await expect(
    dialog.getByRole("button", { name: "Sign in with GitHub" })
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Start", exact: true })
  ).toBeHidden();
};

test("assistant-own-key: Signed out, the default backend offers sign-in", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await defaultBackendRemembered(page);
  await stubSession(page, null);
  await openProject(page, "signed-out");

  await send(page, "Why did my build fail?");

  await expectSignInOffered(page);
  expect(await isConnected(page)).toBe(false);
  // The prompt waits for a backend instead of being lost
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveValue("Why did my build fail?");
});

test("assistant-own-key: Signed in, the remembered default backend reconnects", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await defaultBackendRemembered(page);
  await stubSession(page);

  await openProject(page, "signed-in");

  await expect.poll(() => isConnected(page), LONG).toBe(true);
});

/** Signed in, with the default backend picked by hand in Connect a model */
const connectDefault = async (page: Page, name: string) => {
  await defaultBackendRefusing(page);
  await stubSession(page);
  await openProject(page, name);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Connect a model/ }).click();
  await connectDialog(page)
    .getByRole("button", { name: "Start", exact: true })
    .click(LONG);
  await expect(connectDialog(page)).toBeHidden(LONG);
  await expect.poll(() => isConnected(page), LONG).toBe(true);
};

test("assistant-own-key: Signing out while connected to the default backend", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await connectDefault(page, "signs-out");
  await page.route("**/api/auth/sign-out", (r) => json(r, { success: true }));
  // Registered later, so it answers before the signed-in stub
  await stubSession(page, null);

  const account = page.getByRole("button", {
    name: `Account: ${TEST_USER.login}`,
  });
  await account.click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  // Asked in the menu, in place of its items
  await expect(page.getByText("Sign out of Playground?")).toBeVisible();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  // The menu stays open, signed out; the page behind it is read once it closes
  await expect(page.getByText("Sign out of Playground?")).toBeHidden(LONG);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Account, signed out" })
  ).toBeVisible(LONG);

  // Nothing pops up on its own; the next send asks
  await expect(connectDialog(page)).toBeHidden();
  await send(page, "Still there?");
  await expectSignInOffered(page);
});

test("assistant-own-key: The session ends mid-chat on the default backend", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await connectDefault(page, "session-ends");
  // An expiry or another tab's sign-out: no sign-out runs in this tab
  await stubSession(page, null);

  await send(page, "Why did my build fail?");
  await expect(
    page.getByText("Sign in with GitHub to use the default backend.")
  ).toBeVisible(LONG);

  await send(page, "And now?");
  await expectSignInOffered(page);
});
