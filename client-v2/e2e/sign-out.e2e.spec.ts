import { expect, json, LONG, seedWorkspace, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Signing out from the header chip.
 *
 * The session cookie is HttpOnly, so it survives a refused sign-out, and a
 * header that showed signed out anyway was undone by the next reload. Sync is
 * stubbed off, so the sign-out uploads nothing first: what is under test is
 * the header chip, not the hand-over.
 */

const USER = { id: "u1", name: "Tester", image: null, login: "t" };

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
  const chip = page.getByRole("button", { name: "GitHub profile: t" });
  await expect(chip).toBeVisible(LONG);

  const signOut = async () => {
    await chip.click();
    // The row that opens the confirmation, then the confirmation itself
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
  };

  // Monaco keeps empty `alert` regions of its own, so the chip's is found by its text
  const failure = page
    .getByRole("alert")
    .filter({ hasText: "Could not sign out" });

  return { chip, signOut, failure };
};

test("client-v2-auth: A sign-out", async ({ page }) => {
  test.setTimeout(120_000);
  // Held until the in-progress state is checked: the upload and the request
  // can take seconds, and the chip says so meanwhile
  let accept: () => void = () => {};
  const accepted = new Promise<void>((resolve) => {
    accept = resolve;
  });
  const { signOut, failure } = await signedInWith(page, async () => {
    await accepted;
    return "accepted";
  });

  await signOut();

  const busy = page.getByRole("button", { name: "Signing out of GitHub" });
  await expect(busy).toBeVisible(LONG);
  await expect(busy).toHaveAttribute("aria-busy", "true");

  accept();

  await expect(
    page.getByRole("button", { name: "Sign in with GitHub" }).first()
  ).toBeVisible(LONG);
  await expect(
    page.getByRole("button", { name: /^GitHub profile/ })
  ).toBeHidden();
  await expect(failure).toBeHidden();
});

test("client-v2-auth: A sign-out that fails", async ({ page }) => {
  test.setTimeout(120_000);
  let refuse = true;
  const { chip, signOut, failure } = await signedInWith(page, async () =>
    refuse ? "refused" : "accepted"
  );

  await signOut();

  await expect(failure).toHaveText("Could not sign out. Try again.", LONG);
  await expect(chip).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with GitHub" })
  ).toBeHidden();

  // A retry the server accepts signs out, and the failure is no longer shown
  refuse = false;
  await signOut();

  await expect(
    page.getByRole("button", { name: "Sign in with GitHub" }).first()
  ).toBeVisible(LONG);
  await expect(failure).toBeHidden();
});
