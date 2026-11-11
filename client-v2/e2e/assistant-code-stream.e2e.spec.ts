import type { Page } from "@playwright/test";

import {
  expect,
  LONG,
  startProject,
  stubAiStatus,
  stubSession,
  test,
} from "./fixtures";
import { DESK } from "./viewports";

/**
 * HOO-2694: a reply jumped while it streamed. A line that outgrows its code
 * block brings in the block's horizontal scrollbar, and the reply below it
 * moved down by the scrollbar's height.
 *
 * Playwright launches Chromium with `--hide-scrollbars`, which hid this jump
 * from every other spec; this one draws them, as a desktop browser does.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

/** The store the development build puts on `window` */
type ThreadWindow = Window & {
  __pgAssistant?: {
    threadId?: string | null;
    addUserMessage: (text: string) => void;
    startAssistantMessage: () => string;
    appendToAssistantMessage: (id: string, delta: string) => void;
    setStatus: (status: string) => void;
  };
};

const thread = (page: Page) => page.getByRole("log", { name: "Conversation" });

/** Streams `delta` into the reply `message` */
const append = (page: Page, chunk: { message: string; delta: string }) =>
  page.evaluate(
    ({ message, delta }) =>
      (window as ThreadWindow).__pgAssistant?.appendToAssistantMessage(
        message,
        delta
      ),
    chunk
  );

test("assistant-code-stream: A code block keeps its height while a line streams past its width", async ({
  page,
  browserName,
}) => {
  test.fixme(
    browserName === "firefox",
    "Firefox draws overlay scrollbars that take no height, so the block's bar measures 0 and the jump never shows"
  );
  test.setTimeout(120_000);
  await stubSession(page);
  await stubAiStatus(page, "z-ai/glm-5.3-flash:US");
  await page.setViewportSize(DESK);
  await page.goto("/");
  await startProject(page, "thread-code-stream", LONG);

  await expect
    .poll(
      () =>
        page.evaluate(() => !!(window as ThreadWindow).__pgAssistant?.threadId),
      LONG
    )
    .toBe(true);
  const message = await page.evaluate(() => {
    const store = (window as ThreadWindow).__pgAssistant;
    if (!store) throw new Error("Expected the assistant store on window");
    store.addUserMessage("Show me");
    store.setStatus("running");
    const id = store.startAssistantMessage();
    store.appendToAssistantMessage(id, 'Here:\n\n```rust\nlet x = "');
    return id;
  });

  const block = thread(page).locator("pre").first();
  await expect(block).toContainText("let x", LONG);
  // The block's own box and whether its line overflows, read in one step:
  // each token redraws the highlighted `pre` inside it, so a `pre` found
  // first may be gone by the time it is measured
  const measure = async () => {
    const sample = await page.evaluate(() => {
      const pre = document.querySelector<HTMLElement>('[role="log"] pre');
      const box = pre?.closest(".group");
      return pre && box
        ? {
            height: box.getBoundingClientRect().height,
            overflows: pre.scrollWidth > pre.clientWidth,
            bar: pre.offsetHeight - pre.clientHeight,
          }
        : undefined;
    });
    if (!sample) throw new Error("Expected the reply's code block");
    return sample;
  };
  const samples: { height: number; overflows: boolean; bar: number }[] = [];
  // Short of the block's width, then well past it
  for (let chunk = 1; chunk <= 12; chunk++) {
    await append(page, { message, delta: "a".repeat(20) });
    await expect(block).toContainText("a".repeat(chunk * 20));
    samples.push(await measure());
  }
  const heights = samples.map((sample) => sample.height);

  // The line starts inside the block and ends past it, so the heights span
  // the moment the scrollbar comes in
  expect(samples[0].overflows).toBe(false);
  expect(samples.at(-1)?.overflows).toBe(true);
  // The scrollbar is drawn, so the heights collected above see the jump
  expect(samples.at(-1)?.bar).toBeGreaterThan(0);
  expect(heights).toEqual(heights.map(() => heights[0]));
});
