import { expect, json, LONG, seedWorkspace, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Signing out from the account menu.
 *
 * The session cookie is HttpOnly, so it survives a refused sign-out, and a
 * footer that showed signed out anyway was undone by the next reload. Sync is
 * stubbed off, so the sign-out uploads nothing first: what is under test is
 * the account control and its question, not the hand-over.
 */

const USER = { id: "u1", name: "Tester", image: null, login: "t" };

/** The footer's account row, or the rail's "Account", whatever the session */
const account = (page: Page) =>
  page
    .locator('[data-slot="sidebar"] [data-slot="sidebar-footer"]')
    .getByRole("button", { name: /^Account/ });

/**
 * A signed-in browser whose sign-out request is answered by `answer`. Once a
 * sign-out is accepted, the session reads as signed out.
 */
const signedInWith = async (
  page: Page,
  answer: () => Promise<"accepted" | "refused">
) => {
  let signedIn = true;
  await page.route("**/api/auth/get-session", (r) =>
    json(r, { user: signedIn ? USER : null })
  );
  await page.route("**/api/sync", (r) => json(r, { enabled: false }));
  await page.route("**/api/auth/sign-out", async (r) => {
    if ((await answer()) === "refused") {
      return r.fulfill({ status: 500, body: "" });
    }
    signedIn = false;
    return json(r, { success: true });
  });

  await seedWorkspace(page);
  await expect(account(page)).toHaveAccessibleName("Account: t", LONG);

  const menu = page.getByRole("menu", { name: "Account" });
  const question = menu.getByText("Sign out of Playground?");
  const confirm = menu.getByRole("menuitem", { name: /^Sign out/ });

  /** Asks from the account menu, in place, and confirms */
  const signOut = async () => {
    await account(page).click();
    await menu.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(question).toBeVisible();
    await confirm.click();
  };

  /** Closes the menu, which hides the rest of the page while it is open */
  const closeMenu = async () => {
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  };

  return { question, confirm, signOut, closeMenu };
};

test("client-v2-auth: A sign-out", async ({ page }) => {
  test.setTimeout(120_000);
  // Held until the in-progress state is checked: the upload and the request
  // can take seconds, and the menu's Sign out item says so meanwhile
  let accept: () => void = () => {};
  const accepted = new Promise<void>((resolve) => {
    accept = resolve;
  });
  const { question, confirm, signOut, closeMenu } = await signedInWith(
    page,
    async () => {
      await accepted;
      return "accepted";
    }
  );

  await signOut();

  // Busy, and the question open, until the server answers
  await expect(confirm).toHaveAttribute("aria-busy", "true", LONG);

  accept();

  // The menu stays open, signed out
  await expect(question).toBeHidden(LONG);
  await closeMenu();
  await expect(account(page)).toHaveAccessibleName("Account, signed out", LONG);
  await expect(page.getByText("Could not sign out.")).toBeHidden();
});

test("client-v2-auth: A sign-out that fails", async ({ page }) => {
  test.setTimeout(120_000);
  let refuse = true;
  const { question, signOut, closeMenu } = await signedInWith(page, async () =>
    refuse ? "refused" : "accepted"
  );

  await signOut();

  await expect(page.getByText("Could not sign out.")).toBeVisible(LONG);
  // The question stays, and the user is still signed in. The page under the
  // open menu is hidden from the accessibility tree, so the account is read
  // once the menu is closed.
  await expect(question).toBeVisible();
  await page.getByRole("menuitem", { name: "Cancel" }).click();
  await expect(question).toBeHidden();
  await closeMenu();
  await expect(account(page)).toHaveAccessibleName("Account: t");

  // A retry the server accepts signs out
  refuse = false;
  await signOut();

  await expect(question).toBeHidden(LONG);
  await closeMenu();
  await expect(account(page)).toHaveAccessibleName("Account, signed out", LONG);
});
