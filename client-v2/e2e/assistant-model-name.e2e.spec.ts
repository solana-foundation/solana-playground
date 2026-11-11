import type { Locator, Page } from "@playwright/test";

import { expect, LONG, startProject, stubAiStatus, test } from "./fixtures";
import { PHONE, waitForPhonePage } from "./viewports";

/**
 * A long model name in the composer, laid out by a real browser: unit tests
 * only see the classes, not whether the name pushes Send out of the box.
 */

const LONG_ID = "deepseek/deepseek-chat-v3.1-terminus-instruct:free";

/** The deployment serves no default backend, so the composer names the connection */
const stubNoDefault = (page: Page) => stubAiStatus(page, "own");

/**
 * Connected to OpenRouter on a model with a long id. Through the store: the
 * key lives in memory only, so there is nothing to seed before the load
 */
const connectLong = (page: Page) =>
  page.evaluate((model) => {
    const assistant = (
      window as Window & { __pgAssistant?: { connect: (c: unknown) => void } }
    ).__pgAssistant;
    if (!assistant) throw new Error("the page exposes no __pgAssistant");
    assistant.connect({
      id: "openrouter",
      apiKey: "sk-or-fake-0123456789",
      endpoint: { baseUrl: "https://openrouter.ai/api/v1", model },
    });
  }, LONG_ID);

/** The element's box; a hidden element has none, which fails the test */
const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the element has no box: it is hidden");
  return box;
};

/**
 * The name is cut, not wrapped, in a button `height` tall at most: one line.
 * The composer's buttons are 32px on a desktop and 48px on a phone, as tall
 * as + and Send beside them
 */
const expectCutWithin = (height: number) => async (page: Page) => {
  const composer = page.locator("form").filter({
    has: page.getByRole("textbox", { name: "Message the assistant" }),
  });
  const model = composer.getByRole("button", { name: LONG_ID });
  await expect(model).toBeVisible(LONG);
  const box = await boxOf(model);
  // 12rem at the 16 px root
  expect(box.width).toBeLessThanOrEqual(192);
  const form = await boxOf(composer);
  const send = await boxOf(composer.getByRole("button", { name: "Send" }));
  expect(send.x + send.width).toBeLessThanOrEqual(form.x + form.width);
  expect(box.height).toBeLessThanOrEqual(height);

  await model.focus();
  await expect(page.getByRole("tooltip")).toHaveText(LONG_ID);
};

test("assistant-model-name: Long name in the composer, desktop and phone", async ({
  page,
}) => {
  await stubNoDefault(page);
  await page.goto("/");
  await startProject(page, "long-model-name", LONG);
  await connectLong(page);
  await expectCutWithin(32)(page);

  await page.setViewportSize(PHONE);
  await waitForPhonePage(page, "Work");
  await page.getByRole("radio", { name: "Chat" }).click();
  await expect(page.getByRole("region", { name: "Work" })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expectCutWithin(48)(page);
});
