import { expect, test } from "@playwright/test";

/**
 * "Fix with assistant" pressed before any backend is connected.
 *
 * The prompt waits in the composer and the panel says so -- but only until a
 * backend is connected. The hint lives beside the picker, not in the
 * conversation: a conversation notice outlives the connect and is stored with
 * the thread, asking for a backend that is already there.
 */

const LONG = { timeout: 60_000 };
const PROMPT = "Explain this build error and propose a fix: E0308";
const HINT = /Connect a backend to send this to the assistant/;

type AssistantWindow = Window & {
  __pgAssistant?: {
    requestPrompt: (text: string) => void;
    disconnect: () => void;
    items: { kind: string }[];
  };
};

test("a prompt asked for before connecting leaves no notice behind", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await page.goto("/");
  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill("fix-prompt");
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);

  await page.evaluate(
    (text) => (window as AssistantWindow).__pgAssistant!.requestPrompt(text),
    PROMPT
  );
  await expect(page.getByText(HINT)).toBeVisible(LONG);

  await page.getByRole("button", { name: "OpenAI-compatible" }).click();
  await page.locator("#assistant-base-url").fill("http://mock-llm.test/v1");
  await page.locator("#assistant-model").fill("mock-model");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.getByPlaceholder(/Ask about this project/)).toHaveValue(
    PROMPT,
    LONG
  );
  await expect(page.getByText(HINT)).toBeHidden();
  const kinds = await page.evaluate(() =>
    (window as AssistantWindow).__pgAssistant!.items.map((i) => i.kind)
  );
  expect(kinds).not.toContain("notice");

  // Back on the picker, the hint answered by that connect stays gone
  await page.evaluate(() =>
    (window as AssistantWindow).__pgAssistant!.disconnect()
  );
  await expect(
    page.getByRole("button", { name: "OpenAI-compatible" })
  ).toBeVisible(LONG);
  await expect(page.getByText(HINT)).toBeHidden();
});
