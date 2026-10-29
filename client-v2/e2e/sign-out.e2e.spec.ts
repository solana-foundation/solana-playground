import { expect, json, LONG, seedWorkspace, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Signing out from the account menu.
 *
 * The session cookie is HttpOnly, so it survives a refused sign-out, and a
 * footer that showed signed out anyway was undone by the next reload. Sync is
 * stubbed off, so the sign-out uploads nothing first: what is under test is
 * the account control and its dialog, not the hand-over.
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

  const dialog = page.getByRole("dialog", { name: "Sign out of Playground?" });
  const confirm = dialog.getByRole("button", { name: "Sign out" });

  /** Opens the dialog from the account menu and confirms */
  const signOut = async () => {
    await account(page).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await confirm.click();
  };

  return { dialog, confirm, signOut };
};

test("client-v2-auth: A sign-out", async ({ page }) => {
  test.setTimeout(120_000);
  // Held until the in-progress state is checked: the upload and the request
  // can take seconds, and the dialog's button says so meanwhile
  let accept: () => void = () => {};
  const accepted = new Promise<void>((resolve) => {
    accept = resolve;
  });
  const { dialog, confirm, signOut } = await signedInWith(page, async () => {
    await accepted;
    return "accepted";
  });

  await signOut();

  // Busy, and the dialog open, until the server answers
  await expect(confirm).toHaveAttribute("aria-busy", "true", LONG);

  accept();

  await expect(account(page)).toHaveAccessibleName("Account, signed out", LONG);
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Could not sign out.")).toBeHidden();
});

test("client-v2-auth: A sign-out that fails", async ({ page }) => {
  test.setTimeout(120_000);
  let refuse = true;
  const { dialog, signOut } = await signedInWith(page, async () =>
    refuse ? "refused" : "accepted"
  );

  await signOut();

  await expect(page.getByText("Could not sign out.")).toBeVisible(LONG);
  // The dialog stays, and behind it the user is still signed in. The page
  // under a modal dialog is hidden from the accessibility tree, so the
  // account is read once the dialog is dismissed.
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(account(page)).toHaveAccessibleName("Account: t");

  // A retry the server accepts signs out
  refuse = false;
  await signOut();

  await expect(account(page)).toHaveAccessibleName("Account, signed out", LONG);
  await expect(dialog).toBeHidden();
});
