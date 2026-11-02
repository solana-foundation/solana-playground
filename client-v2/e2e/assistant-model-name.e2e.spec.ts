import type { Page } from "@playwright/test";
import { expect, json, LONG, startProject, test } from "./fixtures";

/**
 * A long model name in the composer, laid out by a real browser: unit tests
 * only see the classes, not whether the name pushes Send out of the box.
 */

const LONG_ID = "deepseek/deepseek-chat-v3.1-terminus-instruct:free";
const PHONE = { width: 390, height: 844 };

/** Connected to OpenRouter on a model with a long id, as a kept connection the panel reconnects to */
const connectLong = async (page: Page) => {
  await page.route("**/api/agent", (route) =>
    json(route, { configured: false, model: null })
  );
  await page.addInitScript((model) => {
    sessionStorage.setItem(
      "assistant.connection",
      JSON.stringify({
        id: "openrouter",
        apiKey: "sk-or-fake-0123456789",
        endpoint: { baseUrl: "https://openrouter.ai/api/v1", model },
      })
    );
  }, LONG_ID);
};

const expectCut = async (page: Page) => {
  const composer = page.locator("form").filter({
    has: page.getByRole("textbox", { name: "Message the assistant" }),
  });
  const model = composer.getByRole("button", { name: LONG_ID });
  await expect(model).toBeVisible(LONG);
  const box = (await model.boundingBox())!;
  // 12rem at the 16 px root
  expect(box.width).toBeLessThanOrEqual(192);
  const form = (await composer.boundingBox())!;
  const send = (await composer
    .getByRole("button", { name: "Send" })
    .boundingBox())!;
  expect(send.x + send.width).toBeLessThanOrEqual(form.x + form.width);
  // One line: the name is cut, not wrapped
  expect(box.height).toBeLessThanOrEqual(32);

  await model.focus();
  await expect(page.getByRole("tooltip")).toHaveText(LONG_ID);
};

test("assistant-model-name: Long name in the composer, desktop and phone", async ({
  page,
}) => {
  await connectLong(page);
  await page.goto("/");
  await startProject(page, "long-model-name", LONG);
  await expectCut(page);

  await page.setViewportSize(PHONE);
  await page.getByRole("radio", { name: "Chat" }).click();
  await expect(page.getByRole("region", { name: "Work" })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expectCut(page);
});
