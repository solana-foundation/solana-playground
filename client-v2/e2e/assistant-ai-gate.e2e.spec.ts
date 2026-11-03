import type { Page } from "@playwright/test";
import {
  expect,
  LONG,
  startProject,
  stubAiStatus,
  stubSession,
  test,
} from "./fixtures";

/**
 * The assistant either works or says why not, before anything is typed
 * (`assistant-ai-gate`). Each test says what `GET /api/ai/status` answers and
 * who is signed in; no turn is ever sent, so `/api/agent` needs no stub.
 */

type AssistantWindow = Window & {
  __pgAssistant?: { requestPrompt: (text: string) => void };
};

const row = (page: Page) => page.locator("#assistant-ai-off");
const input = (page: Page) =>
  page.getByRole("textbox", { name: "Message the assistant" });
const send = (page: Page) => page.getByRole("button", { name: "Send" });

/** Types a question and presses Enter; the composer must keep it */
const typeAndEnter = async (page: Page) => {
  await input(page).fill("What does this program do?");
  await input(page).press("Enter");
  await expect(input(page)).toHaveValue("What does this program do?");
  await expect(send(page)).toHaveAttribute("aria-disabled", "true");
};

test("assistant-ai-gate: No hosted key, nothing connected", async ({
  page,
}) => {
  await stubAiStatus(page, "own");
  await page.goto("/");
  await startProject(page, "ai-off-no-key", LONG);

  await expect(row(page)).toContainText(
    "The assistant needs a key of your own on this deployment.",
    LONG
  );
  await typeAndEnter(page);
  await expect(page.getByText("Connect a model to send")).toBeAttached();

  await row(page).getByRole("button", { name: "Add a key" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("assistant-ai-gate: Signed out with a hosted model", async ({ page }) => {
  await stubAiStatus(page, "glm-5.3-flash");
  // eslint-disable-next-line unicorn/no-null -- the get-session body: no user is `user: null` on the wire
  await stubSession(page, null);
  await page.goto("/");
  await startProject(page, "ai-off-signed-out", LONG);

  await expect(row(page)).toContainText(
    "Sign in with GitHub to use the hosted model, or add a key of your own.",
    LONG
  );
  await expect(
    row(page).getByRole("button", { name: "Sign in with GitHub" })
  ).toBeVisible();
  await expect(
    row(page).getByRole("button", { name: "Add a key" })
  ).toBeVisible();
  await typeAndEnter(page);
  await expect(page.getByText("Sign in to send")).toBeAttached();
});

test("assistant-ai-gate: Hosted model unreachable", async ({ page }) => {
  let asked = 0;
  await page.route("**/api/ai/status", (route) => {
    asked += 1;
    return route.abort("failed");
  });
  await page.goto("/");
  await startProject(page, "ai-off-unreachable", LONG);

  await expect(row(page)).toContainText(
    "The assistant can't reach its model. Try again in a minute.",
    LONG
  );
  const before = asked;
  await row(page).getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => asked).toBeGreaterThan(before);
});

test("assistant-ai-gate: A prompt sent from outside the panel while the assistant is off", async ({
  page,
}) => {
  await stubAiStatus(page, "own");
  await page.goto("/");
  await startProject(page, "ai-off-prompt", LONG);
  await expect(row(page)).toBeVisible(LONG);

  // The entry every outside surface uses: Build's Ask, the server console,
  // a lesson's objective
  await page.evaluate(() => {
    const assistant = (window as AssistantWindow).__pgAssistant;
    if (!assistant) throw new Error("the assistant's window hook is missing");
    assistant.requestPrompt("Explain this build error");
  });
  await page.keyboard.press("Escape");

  await expect(input(page)).toHaveValue("Explain this build error", LONG);
  await expect(row(page)).toContainText(
    "Your prompt is waiting in the composer."
  );
});
