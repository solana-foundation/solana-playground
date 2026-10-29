import type { Page, Route } from "@playwright/test";
import {
  expect,
  json,
  LONG,
  startProject,
  stubSession,
  test,
} from "./fixtures";
import {
  DAILY_CAP_REASON,
  POOL_EXHAUSTED_REASON,
  REFUSAL_MESSAGES,
  REFUSAL_STATUS,
} from "../src/features/agent/config.mjs";

/**
 * What the panel says when the default backend refuses a turn by a limit,
 * and that the user can keep going on a key-based backend.
 *
 * `/api/agent` is stubbed: configured, signed in, answering the first turn
 * and refusing the second. The limits themselves are tested on the route
 * (`src/features/agent/agent.integration.spec.ts`); this is what the user sees.
 */

const FIRST_REPLY = "an answer from the default backend";
const OWN_REPLY = "an answer from your own key";
/** The OpenAI-compatible backend's default base URL, as `PROVIDERS` names it (`model/types.ts`) */
const OWN_COMPLETIONS = "https://api.openai.com/v1/chat/completions";

const streamed = (route: Route, text: string) =>
  route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body:
      [{ role: "assistant", content: text }, {}]
        .map(
          (delta, i) =>
            `data: ${JSON.stringify({
              choices: [
                { index: 0, delta, finish_reason: i === 0 ? null : "stop" },
              ],
            })}\n\n`
        )
        .join("") + "data: [DONE]\n\n",
  });

/** The default backend answers one turn, then refuses every turn by `reason` */
const answersOnceThenRefuses = async (
  page: Page,
  reason: typeof DAILY_CAP_REASON | typeof POOL_EXHAUSTED_REASON
) => {
  let turns = 0;
  await page.route("**/api/agent", (route) => {
    if (route.request().method() === "GET") {
      return json(route, { configured: true, model: "test-model" });
    }
    turns += 1;
    if (turns === 1) return streamed(route, FIRST_REPLY);
    return route.fulfill({
      status: REFUSAL_STATUS[reason],
      contentType: "application/json",
      headers: { "retry-after": "3600" },
      body: JSON.stringify({
        error: REFUSAL_MESSAGES[reason],
        reason,
        tier: "newcomer",
      }),
    });
  });
  await stubSession(page);
};

/** The Connect a model dialog, opened from the composer's menu */
const openConnect = async (page: Page) => {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Connect a model/ }).click();
  return page.getByRole("dialog", { name: "Connect a model" });
};

const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message the assistant" });

const say = async (page: Page, text: string) => {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
};

/** Connect the default backend, take one turn, and have the next refused */
const reachLimit = async (
  page: Page,
  reason: typeof DAILY_CAP_REASON | typeof POOL_EXHAUSTED_REASON
) => {
  await answersOnceThenRefuses(page, reason);
  await page.goto("/");
  await startProject(page, `limit-${reason}`, LONG);
  await expect(composer(page)).toBeVisible(LONG);
  const dialog = await openConnect(page);
  await dialog.getByRole("button", { name: "Start", exact: true }).click(LONG);
  await expect(dialog).toBeHidden(LONG);

  await say(page, "first question");
  await expect(page.getByText(FIRST_REPLY)).toBeVisible(LONG);
  await say(page, "second question");
  await expect(page.getByText(REFUSAL_MESSAGES[reason])).toBeVisible(LONG);
};

/** The conversation from before the refusal, still on screen */
const expectEarlierMessages = async (page: Page) => {
  const conversation = page.getByRole("log", { name: "Conversation" });
  await expect(conversation.getByText("first question")).toBeVisible();
  await expect(conversation.getByText(FIRST_REPLY)).toBeVisible();
  await expect(conversation.getByText("second question")).toBeVisible();
};

/** Switch to the OpenAI-compatible backend through the picker, and take a turn */
const keepGoingOnOwnKey = async (page: Page) => {
  await page.route(OWN_COMPLETIONS, (route) => streamed(route, OWN_REPLY));

  const dialog = await openConnect(page);
  await dialog.getByRole("button", { name: /^Bring your own key/ }).click();
  await dialog.getByRole("radio", { name: /^OpenAI-compatible/ }).click();
  await dialog.locator("#assistant-api-key").fill("sk-e2e-own-key");
  await dialog.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(dialog).toBeHidden(LONG);

  await say(page, "third question");
  await expect(page.getByText(OWN_REPLY)).toBeVisible(LONG);
};

test.describe("assistant-default-backend-spend", () => {
  test.setTimeout(240_000);

  test("assistant-default-backend-spend: The user reaches their daily cap", async ({
    page,
  }) => {
    await reachLimit(page, DAILY_CAP_REASON);

    await expectEarlierMessages(page);
    await keepGoingOnOwnKey(page);
  });

  test("assistant-default-backend-spend: The tier's pool is empty", async ({
    page,
  }) => {
    await reachLimit(page, POOL_EXHAUSTED_REASON);

    await expectEarlierMessages(page);
    await keepGoingOnOwnKey(page);
  });
});
