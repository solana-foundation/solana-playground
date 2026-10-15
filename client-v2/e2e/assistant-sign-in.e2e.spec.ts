import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { json } from "./fixtures";
import { SIGNED_OUT_REASON } from "../src/features/auth/config.mjs";
import { REMEMBERED_BACKEND_KEY } from "../src/views/sidebar/assistant/model/remembered-backend";

/**
 * The default backend is offered only to a signed-in user, because
 * `/api/agent` refuses anyone else.
 *
 * The probe is stubbed as configured, so this runs where no key exists, CI
 * included. The only turn sent is answered by the stub's signed-out refusal:
 * what is under test is whether the panel connects or offers sign-in, not
 * what the backend answers.
 */

const LONG = { timeout: 60_000 };

type AssistantWindow = Window & {
  __pgAssistant?: { isConnected: boolean };
};

const isConnected = (page: Page) =>
  page.evaluate(() => !!(window as AssistantWindow).__pgAssistant?.isConnected);

/** A deployment that serves a default backend, and a browser that picked it before */
const defaultBackendRemembered = async (page: Page) => {
  await page.route("**/api/agent", (r) =>
    r.request().method() === "GET"
      ? json(r, { configured: true, model: "test-model" })
      : r.abort()
  );
  // `addInitScript` runs in the page, so the key travels as its argument
  await page.addInitScript(
    (key) => localStorage.setItem(key, "default"),
    REMEMBERED_BACKEND_KEY
  );
};

const session = (page: Page, user: unknown) =>
  page.route("**/api/auth/get-session", (r) => json(r, { user }));

const openProject = async (page: Page, name: string) => {
  await page.goto("/");
  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill(name);
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);
};

test("assistant-own-key: Signed out, the default backend offers sign-in", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await defaultBackendRemembered(page);
  await session(page, null);

  await openProject(page, "signed-out");

  await expect(
    page.getByText(
      "Sign in with GitHub to use it, or bring your own key below."
    )
  ).toBeVisible(LONG);
  await expect(
    page.getByRole("button", { name: "Start", exact: true })
  ).toBeHidden();
  // The tag would otherwise call the backend ready to use
  await expect(page.getByText("sign-in needed", { exact: true })).toBeVisible();
  await expect(page.getByText("no key needed", { exact: true })).toBeHidden();
  expect(await isConnected(page)).toBe(false);
});

test("assistant-own-key: Signed in, the remembered default backend reconnects", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await defaultBackendRemembered(page);
  await session(page, { id: "u1", name: "Tester", image: null, login: "t" });

  await openProject(page, "signed-in");

  await expect.poll(() => isConnected(page), LONG).toBe(true);
});

const USER = { id: "u1", name: "Tester", image: null, login: "t" };

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

/** Signed in, with the default backend picked by hand from the picker */
const connectDefault = async (page: Page, name: string) => {
  await defaultBackendRefusing(page);
  await session(page, USER);
  await openProject(page, name);
  await page.getByRole("button", { name: "Start", exact: true }).click(LONG);
  await expect(page.getByLabel("Message the assistant")).toBeVisible(LONG);
};

/** The picker, offering sign-in for the default backend, in place of the chat */
const expectSignInPicker = async (page: Page) => {
  await expect(
    page.getByText(
      "Sign in with GitHub to use it, or bring your own key below."
    )
  ).toBeVisible(LONG);
  await expect(page.getByText("sign-in needed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Message the assistant")).toBeHidden();
};

test("assistant-own-key: Signing out while connected to the default backend", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await connectDefault(page, "signs-out");
  await page.route("**/api/auth/sign-out", (r) => json(r, { success: true }));
  // Registered later, so it answers before the signed-in stub
  await session(page, null);

  await page.getByRole("button", { name: "GitHub profile: t" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in with GitHub" }).first()
  ).toBeVisible(LONG);

  await expectSignInPicker(page);
});

test("assistant-own-key: The session ends mid-chat on the default backend", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await connectDefault(page, "session-ends");
  // An expiry or another tab's sign-out: no sign-out runs in this tab
  await session(page, null);

  const composer = page.getByLabel("Message the assistant");
  await composer.fill("Why did my build fail?");
  await composer.press("Enter");
  await expect(
    page.getByText("Sign in with GitHub to use the default backend.")
  ).toBeVisible(LONG);

  await expectSignInPicker(page);
});
