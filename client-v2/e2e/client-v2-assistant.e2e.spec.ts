import type { Page, Route } from "@playwright/test";
import {
  expect,
  home,
  homeRegion,
  json,
  LONG,
  startProject,
  stubSession,
  test,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/**
 * The assistant's composer: the model it names, sending without a key,
 * Send turning to Stop; and its thread at phone width, while reading back,
 * across a reload, and when an approval is answered. Every test stubs `/api/agent`, so none depends on the
 * dev server's own default backend.
 */

const DEFAULT_MODEL = "z-ai/glm-5.3-flash:US";
const PHONE = { width: 390, height: 844 };
const ANSWER =
  'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n';

const input = (page: Page) =>
  page.getByRole("textbox", { name: "Message the assistant" });
/**
 * The model button, by the name it shows. Found by role: the menu's trigger
 * replaces the button's `data-slot`.
 */
const modelButton = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name });
const effortControl = (page: Page) =>
  page.getByRole("button", { name: /: \d of \d$/ });

/** `GET` answers the probe; `POST` is handed to `onTurn` */
const stubAgent = async (
  page: Page,
  probe: { configured: boolean; model: string | null },
  onTurn: (route: Route) => Promise<void> | void
) => {
  await page.route("**/api/agent", (route) => {
    if (route.request().method() === "GET") return json(route, probe);
    return onTurn(route);
  });
};

const answer = (route: Route) =>
  route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: ANSWER,
  });

const openProject = async (page: Page, name: string) => {
  await page.goto("/");
  await startProject(page, name, LONG);
  await expect(input(page)).toBeVisible(LONG);
};

test("client-v2-assistant: The hosted default", async ({ page }) => {
  await stubSession(page);
  await stubAgent(page, { configured: true, model: DEFAULT_MODEL }, answer);
  await openProject(page, "hosted-default");

  await expect(modelButton(page, "GLM 5.3 Flash")).toBeVisible(LONG);
  await expect(effortControl(page)).toHaveCount(0);
});

test("client-v2-assistant: A backend with an effort ladder", async ({
  page,
}) => {
  await stubAgent(page, { configured: false, model: null }, answer);
  // Connecting must not send anything: a request here would be a turn
  let anthropicRequests = 0;
  await page.route("https://api.anthropic.com/**", (route) => {
    anthropicRequests += 1;
    return route.abort();
  });
  await openProject(page, "effort-ladder");

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Connect a model/ }).click();
  await page.getByRole("radio", { name: "Anthropic" }).click();
  await page.locator("#assistant-api-key").fill("sk-ant-fake-key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.getByRole("button", { name: "High: 3 of 5" })).toBeVisible(
    LONG
  );
  await expect(modelButton(page, "Opus 5.5")).toBeVisible();
  expect(anthropicRequests).toBe(0);
});

test("client-v2-assistant: The first message on the hosted default", async ({
  page,
}) => {
  let turns = 0;
  await stubSession(page);
  await stubAgent(page, { configured: true, model: DEFAULT_MODEL }, (route) => {
    turns += 1;
    return answer(route);
  });
  await openProject(page, "first-message");

  await input(page).fill("Say hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const thread = page.getByRole("log", { name: "Conversation" });
  await expect(thread.getByText("Say hello")).toBeVisible(LONG);
  await expect(thread.getByText("Hello", { exact: true })).toBeVisible(LONG);
  expect(turns).toBe(1);
});

// Home mounts no terminal; a command run from its assistant used to wait on
// the terminal forever, the approval card stuck on "running"
test("a command allowed on Home fails within seconds, with no terminal mounted", async ({
  page,
}) => {
  const calls: string[] = [];
  await stubSession(page);
  await stubAgent(page, { configured: true, model: DEFAULT_MODEL }, (route) => {
    calls.push(route.request().postData() ?? "");
    if (calls.length > 1) return answer(route);
    const callBuild = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_build",
                function: { name: "build", arguments: "{}" },
              },
            ],
          },
        },
      ],
    };
    const finish = { choices: [{ delta: {}, finish_reason: "tool_calls" }] };
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(callBuild)}\n\ndata: ${JSON.stringify(
        finish
      )}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.goto("/");
  await expect(home(page)).toBeVisible(LONG);
  await homeRegion(page)
    .getByRole("button", { name: "Ask the assistant" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Assistant" });
  await expect(sheet).toBeVisible();

  await input(page).fill("Build it");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await sheet.getByRole("button", { name: "Allow" }).click({ timeout: 30_000 });

  await expect(sheet.getByText("build errored")).toBeVisible({
    timeout: 5_000,
  });
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toContain("The build could not run");
  expect(calls[1]).toContain("The terminal is not open.");
});

test("client-v2-assistant: No default backend", async ({ page }) => {
  let turns = 0;
  await stubAgent(page, { configured: false, model: null }, (route) => {
    turns += 1;
    return answer(route);
  });
  await openProject(page, "no-default");
  await expect(modelButton(page, "Connect a model")).toBeVisible(LONG);

  // Nothing can take the message: Send stays disabled with text in, with the
  // arrow where the model button has the hand
  await input(page).fill("Say hello");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeDisabled();
  await expect(send).toHaveCSS("cursor", "default");
  await expect(modelButton(page, "Connect a model")).toHaveCSS(
    "cursor",
    "pointer"
  );

  // Enter sends nothing; by the time Send's tooltip has opened, a dialog or a
  // turn it had started would show
  await input(page).press("Enter");
  await send.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Connect a model to send");
  const dialog = page.getByRole("dialog", { name: "Connect a model" });
  await expect(dialog).toBeHidden();
  expect(turns).toBe(0);
  await expect(input(page)).toHaveValue("Say hello");

  // The model button is the way in: Connect a model, with its key field
  await modelButton(page, "Connect a model").click();
  await expect(dialog.locator("#assistant-api-key")).toBeVisible(LONG);
  // The composer sits under the dialog; closed, it still holds the prompt
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(input(page)).toHaveValue("Say hello");
});

test("client-v2-assistant: Stopping an answer", async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await stubSession(page);
  await stubAgent(
    page,
    { configured: true, model: DEFAULT_MODEL },
    async (route) => {
      await held;
      await route.abort().catch(() => {});
    }
  );
  await openProject(page, "stopping");

  await input(page).fill("Say hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible(LONG);
  await stop.click();

  await expect(
    page.getByRole("log", { name: "Conversation" }).getByText("Stopped.")
  ).toBeVisible(LONG);
  await expect(
    page.getByRole("button", { name: "Send", exact: true })
  ).toBeVisible(LONG);

  // Let the held request end so the page closes cleanly
  release();
});

test("client-v2-assistant: Stopping a turn is reported once", async ({
  page,
}) => {
  const lines = linesOn(page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await stubSession(page);
  await stubAgent(
    page,
    { configured: true, model: DEFAULT_MODEL },
    async (route) => {
      await held;
      await route.abort().catch(() => {});
    }
  );
  await openProject(page, "stopping-once");

  await input(page).fill("Say hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible(LONG);
  // Two presses before the button can turn back into Send
  await stop.evaluate((button: HTMLElement) => {
    button.click();
    button.click();
  });

  await expect(
    page.getByRole("log", { name: "Conversation" }).getByText("Stopped.")
  ).toBeVisible(LONG);
  await expect.poll(() => lineOf(lines, "assistant_turn_stopped")).toBeTruthy();
  // A moment more, so a second copy fails the test instead of passing unread
  await page.waitForTimeout(300);
  expect(
    lines.filter((l) =>
      l.startsWith("[telemetry:event] assistant_turn_stopped ")
    )
  ).toHaveLength(1);

  release();
});

/** Connect a model, opened from the head's More */
const openConnect = async (page: Page) => {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Connect a model/ }).click();
  const dialog = page.getByRole("dialog", { name: "Connect a model" });
  await expect(dialog).toBeVisible(LONG);
  return dialog;
};

test.describe("Connect a model", () => {
  test.setTimeout(120_000);

  test.describe("on a desktop", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("client-v2-assistant: Connecting on a desktop", async ({ page }) => {
      await stubAgent(page, { configured: false, model: null }, answer);
      await openProject(page, "connect-desktop");

      const dialog = await openConnect(page);
      // A card over the app, not a page of its own
      const box = (await dialog.boundingBox())!;
      expect(box.width).toBeLessThan(1280);
      expect(box.height).toBeLessThan(800);

      // With no default on the deployment, the form opens on Anthropic
      await dialog.locator("#assistant-api-key").fill("sk-ant-fake-key");
      // The dialog's submit, drawn as the view's ring brand button
      const connect = dialog.getByRole("button", {
        name: "Connect",
        exact: true,
      });
      await expect(connect).toHaveAttribute("data-slot", "brand-button");
      await expect(connect).toHaveAttribute("data-variant", "ring");
      await connect.click();

      await expect(dialog).toBeHidden(LONG);
      await expect(modelButton(page, "Opus 5.5")).toBeVisible();
    });
  });

  test.describe("on a phone", () => {
    test("client-v2-assistant: Connecting on a phone", async ({ page }) => {
      await stubAgent(page, { configured: false, model: null }, answer);
      // The project opens from Home on a desktop-sized page; a phone
      // shows the assistant on the pager's Work page, through Show: Chat
      await page.setViewportSize({ width: 1280, height: 800 });
      await openProject(page, "connect-phone");
      await page.setViewportSize(PHONE);
      await page.getByRole("radio", { name: "Chat" }).click();
      const work = page.getByRole("region", { name: "Work" });
      await expect(work).toBeInViewport();
      await work.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: /Connect a model/ }).click();
      const dialog = page.getByRole("dialog", { name: "Connect a model" });
      await expect(dialog).toBeVisible(LONG);

      // A page of its own: the box fills the screen
      await expect
        .poll(async () => {
          const box = await dialog.boundingBox();
          return box && [box.x, box.y, box.width, box.height];
        })
        .toEqual([0, 0, PHONE.width, PHONE.height]);
      // The connect button is in reach without scrolling
      const connect = dialog.getByRole("button", {
        name: "Connect",
        exact: true,
      });
      await expect(connect).toBeInViewport({ ratio: 1 });

      // The longest form: an OpenAI-compatible backend with its key, base URL
      // and model, and every other backend listed above it (a pick folds the
      // list, so it is opened again)
      await dialog.getByRole("radio", { name: /OpenAI-compatible/ }).click();
      await dialog.getByRole("button", { name: "Bring your own key" }).click();
      await expect(
        dialog.getByRole("button", { name: "Hide other backends" })
      ).toHaveAttribute("aria-expanded", "true");
      await dialog.locator("#assistant-api-key").fill("sk-fake-key");
      await dialog
        .locator("#assistant-base-url")
        .fill("http://mock-llm.test/v1");
      await dialog.locator("#assistant-model").fill("mock-model");
      await expect(connect).toBeInViewport({ ratio: 1 });

      // The form scrolls under the footer, which stays where it is: pinned
      // to the bottom of the screen, not carried up with the form
      const body = dialog.locator('[data-slot="modal-body"]');
      const before = (await connect.boundingBox())!;
      const scrolled = await body.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        return el.scrollTop;
      });
      expect(scrolled).toBeGreaterThan(0);
      await expect(connect).toBeInViewport({ ratio: 1 });
      expect((await connect.boundingBox())!.y).toBe(before.y);
      expect(before.y + before.height).toBeGreaterThan(PHONE.height - 80);

      await connect.click();
      await expect(dialog).toBeHidden(LONG);
      await expect(modelButton(page, "mock-model")).toBeVisible();
    });
  });
});

/**
 * The thread's own scenarios. Its items are written through the store the
 * development build puts on `window`, as `thread-restore.e2e.spec.ts` does:
 * what is under test is how the thread draws and answers them, not a model.
 */
type ThreadWindow = Window & {
  __pgAssistant?: {
    threadId?: string | null;
    addUserMessage: (text: string) => void;
    startAssistantMessage: () => string;
    appendToAssistantMessage: (id: string, delta: string) => void;
    setStatus: (status: string) => void;
    requestApproval: (request: unknown) => Promise<unknown>;
    whenPersisted: () => Promise<void>;
  };
};

/**
 * Waits for the store the development build puts on `window`, and for its
 * thread: nothing is written to storage before a thread is open
 */
const storeReady = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(() => !!(window as ThreadWindow).__pgAssistant?.threadId),
      LONG
    )
    .toBe(true);

/** A patch of `lines` changed lines, waiting on the user */
const proposePatch = async (page: Page, lines: number) => {
  await storeReady(page);
  await page.evaluate((count) => {
    const after = Array.from({ length: count }, (_, i) => `line ${i}`).join(
      "\n"
    );
    // Not awaited: it settles only when the card is answered
    void (window as ThreadWindow).__pgAssistant!.requestApproval({
      type: "patch",
      path: "src/lib.rs",
      before: "",
      after,
    });
  }, lines);
};

/** Opens a project at desktop size, then shows the chat at phone size */
const openOnPhone = async (page: Page, name: string) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openProject(page, name);
  await page.setViewportSize(PHONE);
  await page.getByRole("radio", { name: "Chat" }).click();
  await expect(page.getByRole("region", { name: "Work" })).toBeInViewport();
};

const thread = (page: Page) => page.getByRole("log", { name: "Conversation" });

test.describe("The thread", () => {
  test.setTimeout(120_000);

  test("client-v2-assistant: A reply with code on a phone", async ({
    page,
  }) => {
    await stubAgent(page, { configured: true, model: DEFAULT_MODEL }, answer);
    await openOnPhone(page, "thread-code-phone");

    await storeReady(page);
    await page.evaluate((line) => {
      const store = (window as ThreadWindow).__pgAssistant!;
      store.addUserMessage("Show me");
      const id = store.startAssistantMessage();
      store.appendToAssistantMessage(id, "Here:\n\n```rust\n" + line + "\n```");
      store.setStatus("idle");
    }, `let x = "${"a".repeat(200)}";`);

    await expect(thread(page).getByText("Here:")).toBeVisible(LONG);
    // The scroller clips what overflows it, so the page alone cannot show a
    // reply wider than the screen: the thread itself must not scroll sideways
    const viewport = page.locator("[data-slot=message-scroller-viewport]");
    expect(
      await viewport.evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBe(true);
    const block = thread(page).locator("pre").first();
    expect(await block.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(PHONE.width);
  });

  test("client-v2-assistant: A patch card on a phone", async ({ page }) => {
    await stubAgent(page, { configured: true, model: DEFAULT_MODEL }, answer);
    await openOnPhone(page, "thread-patch-phone");

    await proposePatch(page, 60);

    const card = page.locator("[data-slot=diff][data-status=pending]");
    await expect(card).toBeVisible(LONG);
    await expect(card.getByText("src/lib.rs")).toBeInViewport({ ratio: 1 });
    for (const name of ["Apply", "Reject"]) {
      const button = card.getByRole("button", { name });
      await expect(button).toBeInViewport({ ratio: 1 });
      // A thumb's target, 44 px high
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // Code reads in the code font: every `data-slot` element gets the text
    // font from the base layer, so a line must ask for its own
    const font = await card
      .locator("[data-slot=diff-line]")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font).toContain("monospace");
    const content = card.locator("[data-slot=diff-content]");
    expect(
      await content.evaluate((el) => el.scrollHeight > el.clientHeight)
    ).toBe(true);
  });

  test("client-v2-assistant: Reading back during an answer", async ({
    page,
  }) => {
    await stubAgent(page, { configured: true, model: DEFAULT_MODEL }, answer);
    await openProject(page, "thread-read-back");

    await storeReady(page);
    await page.evaluate(() => {
      const store = (window as ThreadWindow).__pgAssistant!;
      for (let i = 0; i < 30; i++) store.addUserMessage(`Message ${i}`);
      (window as unknown as { __replyId: string }).__replyId =
        store.startAssistantMessage();
      store.setStatus("running");
    });
    await expect(thread(page).getByText("Message 29")).toBeVisible(LONG);

    // At the end, the thread follows the answer as it grows
    await page.evaluate(() => {
      const store = (window as ThreadWindow).__pgAssistant!;
      const id = (window as unknown as { __replyId: string }).__replyId;
      for (let i = 0; i < 40; i++) store.appendToAssistantMessage(id, "first ");
    });
    await expect(thread(page).getByText(/first first/)).toBeInViewport(LONG);

    const viewport = page.locator("[data-slot=message-scroller-viewport]");
    await viewport.hover();
    await page.mouse.wheel(0, -100_000);
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollTop))
      .toBeLessThan(10);
    const top = await viewport.evaluate((el) => el.scrollTop);

    await page.evaluate(() => {
      const store = (window as ThreadWindow).__pgAssistant!;
      const id = (window as unknown as { __replyId: string }).__replyId;
      for (let i = 0; i < 20; i++) store.appendToAssistantMessage(id, "more ");
    });

    // A moment for the scroller to have followed, if it were going to
    await page.waitForTimeout(500);
    expect(await viewport.evaluate((el) => el.scrollTop)).toBe(top);

    const toEnd = page.getByRole("button", { name: "Scroll to end" });
    await expect(toEnd).toBeVisible();
    await toEnd.click();
    await expect(thread(page).getByText(/more more/)).toBeInViewport(LONG);
  });

  test("client-v2-assistant: Reloading with a card pending", async ({
    page,
  }) => {
    await stubAgent(page, { configured: true, model: DEFAULT_MODEL }, answer);
    await openProject(page, "thread-reload-pending");

    await proposePatch(page, 3);
    await expect(page.getByRole("button", { name: "Apply" })).toBeVisible(LONG);
    await page.evaluate(() =>
      (window as ThreadWindow).__pgAssistant!.whenPersisted()
    );
    // The write resolves before lightning-fs flushes it to IndexedDB, so a
    // reload straight away can still lose it (as in thread-restore.e2e)
    await page.waitForTimeout(1000);

    await page.reload();

    const card = page.locator("[data-slot=diff][data-status=unanswered]");
    await expect(card).toBeVisible(LONG);
    await expect(card.getByText("Not answered")).toBeVisible();
    await expect(
      card.getByText("not applied -- the session ended before you answered")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  });

  test("client-v2-assistant: Answering an approval is reported once", async ({
    page,
  }) => {
    const lines = linesOn(page);
    await stubAgent(page, { configured: true, model: DEFAULT_MODEL }, answer);
    await openProject(page, "thread-answer-once");

    await proposePatch(page, 2);
    const apply = page.getByRole("button", { name: "Apply" });
    await expect(apply).toBeVisible(LONG);
    // Two presses before the card can re-render as answered
    await apply.evaluate((button: HTMLElement) => {
      button.click();
      button.click();
    });

    await expect
      .poll(() => lineOf(lines, "assistant_approval_answered"))
      .toBeTruthy();
    await page.waitForTimeout(300);
    const answered = lines.filter((l) =>
      l.startsWith("[telemetry:event] assistant_approval_answered ")
    );
    expect(answered).toHaveLength(1);
    expect(answered[0]).toContain("kind: patch");
    expect(answered[0]).toContain("answer: allow");
  });
});
