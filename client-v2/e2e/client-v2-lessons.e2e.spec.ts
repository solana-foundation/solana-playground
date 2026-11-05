/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import { expect, LONG, test } from "./fixtures";

/**
 * What is left of `client-v2-lessons` once the band, rail, reader and phone
 * bar are gone (HOO-2365): the assistant's questions are the project's, and
 * a conversation tutorial has no lesson questions of its own.
 */

const PROJECT_QUESTIONS = [
  "What does this program do?",
  "Why did my build fail?",
  "How do I deploy this?",
];
const LESSON_QUESTIONS = ["Explain this step", "Give me a hint"];

test.beforeEach(async ({ page }) => {
  // No default backend, whatever the dev server is configured with
  await page.route("**/api/agent", (route) =>
    route.fulfill({ json: { configured: false, model: null } })
  );
});

test("client-v2-lessons: Suggestions outside a tutorial", async ({
  seededPage: page,
}) => {
  for (const name of PROJECT_QUESTIONS) {
    await expect(page.getByRole("button", { name })).toBeVisible(LONG);
  }
  await expect(page.getByText("lib.rs", { exact: true }).first()).toBeVisible();
});

test("client-v2-lessons: Suggestions in a lesson", async ({ page }) => {
  await page.goto("/tutorials/hello-anchor");
  const chat = page.getByRole("complementary", { name: "Tutorial chat" });
  await expect(chat).toBeVisible(LONG);

  // The intro is drawn, so the column has rendered what it holds
  await expect(chat.getByRole("button", { name: /Start step 1/ })).toBeVisible(
    LONG
  );
  // Neither the lesson's questions nor the assistant's: the column is the
  // conversation's
  for (const name of LESSON_QUESTIONS) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  for (const name of PROJECT_QUESTIONS) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  // The scenario's "free questions go through the conversation's composer"
  // waits for that composer (`tutorial-flow-v2` task 3.6)
});
