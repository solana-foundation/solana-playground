import type { Locator, Page } from "@playwright/test";
import {
  expect,
  json,
  LONG,
  startProject,
  stubSession,
  test,
} from "./fixtures";

/**
 * The `pause_turn` scenarios of the `client-v2-ai` spec, run through the
 * default backend: the session and `/api/agent` are answered by `page.route`,
 * so no key and no server are needed, CI included.
 *
 * The resume limit is read off the error text rather than imported:
 * `run-turn.ts` loads the logger, which holds an in-source block, and
 * `scripts/in-source-e2e-imports.test.mjs` refuses that chain.
 */

/** One chat-completions chunk, the shape `/api/agent` streams */
const chunk = (delta: Record<string, string>, finishReason: string | null) =>
  `data: ${JSON.stringify({
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;

/** A response that streams `text` and ends with `finishReason` */
const stream = (text: string, finishReason: "pause_turn" | "stop") =>
  chunk({ role: "assistant", content: text }, null) +
  chunk({}, finishReason) +
  "data: [DONE]\n\n";

type Sent = { messages: { role: string; content: unknown }[] };

/**
 * A default backend whose probe reports a model and whose n-th POST is
 * answered with `body(n)`.
 *
 * @returns every POST body, in the order the browser sent them
 */
const serveAgent = async (page: Page, body: (n: number) => string) => {
  const sent: Sent[] = [];
  await page.route("**/api/agent", (r) => {
    if (r.request().method() === "GET") {
      return json(r, { configured: true, model: "test-model" });
    }
    sent.push(r.request().postDataJSON());
    return r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: body(sent.length),
    });
  });
  return sent;
};

/** Signed in, with the default backend picked in Connect a model; resolves to the composer */
const connectDefault = async (page: Page, name: string) => {
  await stubSession(page);
  await page.goto("/");
  await startProject(page, name, LONG);
  const composer = page.getByRole("textbox", {
    name: "Message the assistant",
  });
  await expect(composer).toBeVisible(LONG);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Connect a model/ }).click();
  const dialog = page.getByRole("dialog", { name: "Connect a model" });
  await dialog.getByRole("button", { name: "Start", exact: true }).click(LONG);
  await expect(dialog).toBeHidden(LONG);
  return composer;
};

const send = async (page: Page, composer: Locator, text: string) => {
  await composer.fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
};

const PAUSED = /The turn paused (\d+) times without finishing\./;

test("client-v2-ai: A paused turn is resumed", async ({ page }) => {
  test.setTimeout(240_000);
  const sent = await serveAgent(page, (n) =>
    n === 1
      ? stream("first half ", "pause_turn")
      : stream("second half", "stop")
  );
  const composer = await connectDefault(page, "pause-resumed");

  await send(page, composer, "hello");

  // Asserted one by one: the panel may show the two halves as two items
  await expect(page.getByText("first half")).toBeVisible(LONG);
  await expect(page.getByText("second half")).toBeVisible(LONG);
  expect(sent).toHaveLength(2);

  const last = sent[1].messages[sent[1].messages.length - 1];
  expect(last.role).toBe("assistant");
  expect(JSON.stringify(last.content)).toContain("first half");
});

test("client-v2-ai: A turn that keeps pausing", async ({ page }) => {
  test.setTimeout(240_000);
  const sent = await serveAgent(page, (n) =>
    stream(`part ${n} `, "pause_turn")
  );
  const composer = await connectDefault(page, "pause-forever");

  await send(page, composer, "hello");

  const error = page.getByRole("alert").filter({ hasText: PAUSED });
  await expect(error).toBeVisible(LONG);

  const pauses = Number(PAUSED.exec(await error.innerText())![1]);
  expect(pauses).toBeGreaterThan(1);
  // A request per pause: one more than the resume limit
  expect(sent).toHaveLength(pauses);
});
