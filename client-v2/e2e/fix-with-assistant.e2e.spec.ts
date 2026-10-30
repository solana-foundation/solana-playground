import { expect, test } from "@playwright/test";
import { json, startProject } from "./fixtures";

/**
 * A build error's Explain pressed before any backend is connected.
 *
 * The prompt waits in the composer and the panel says so -- but only until a
 * backend is connected. The hint lives beside the picker, not in the
 * conversation: a conversation notice outlives the connect and is stored with
 * the thread, asking for a backend that is already there.
 */

const LONG = { timeout: 60_000 };
const PROMPT = "Explain this build error in plain words: E0308";
// The test serves no default backend, so the model is the one way in
const HINT = /Connect a model to send this to the assistant/;

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

  // No default backend, so the requested prompt has nothing to go to
  await page.route("**/api/agent", (route) =>
    json(route, { configured: false, model: null })
  );
  await page.goto("/");
  await startProject(page, "fix-prompt", LONG);

  await page.evaluate(
    (text) => (window as AssistantWindow).__pgAssistant!.requestPrompt(text),
    PROMPT
  );
  await expect(page.getByText(HINT)).toBeVisible(LONG);

  await page.getByRole("radio", { name: "OpenAI-compatible" }).click();
  await page.locator("#assistant-base-url").fill("http://mock-llm.test/v1");
  await page.locator("#assistant-model").fill("mock-model");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(
    page.getByRole("textbox", { name: "Message the assistant" })
  ).toHaveValue(PROMPT, LONG);
  await expect(page.getByText(HINT)).toBeHidden();
  const kinds = await page.evaluate(() =>
    (window as AssistantWindow).__pgAssistant!.items.map((i) => i.kind)
  );
  expect(kinds).not.toContain("notice");

  // Disconnected, the composer offers to connect again, and the hint answered
  // by that connect stays gone
  await page.evaluate(() =>
    (window as AssistantWindow).__pgAssistant!.disconnect()
  );
  await expect(
    page.getByRole("button", { name: "Connect a model" })
  ).toBeVisible(LONG);
  await expect(page.getByText(HINT)).toBeHidden();
});
