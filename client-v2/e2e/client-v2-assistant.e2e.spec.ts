import type { Page, Route } from "@playwright/test";
import { expect, json, LONG, startProject, test } from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/**
 * The assistant's composer: the model it names, sending without a key,
 * Send turning to Stop. Every test stubs `/api/agent`, so none depends on the
 * dev server's own default backend.
 */

const DEFAULT_MODEL = "z-ai/glm-5.3-flash:US";
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

  await expect(
    page.getByRole("button", { name: "Medium: 2 of 5" })
  ).toBeVisible(LONG);
  await expect(modelButton(page, "Opus 5.5")).toBeVisible();
  expect(anthropicRequests).toBe(0);
});

test("client-v2-assistant: The first message on the hosted default", async ({
  page,
}) => {
  let turns = 0;
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

test("client-v2-assistant: No default backend", async ({ page }) => {
  await stubAgent(page, { configured: false, model: null }, answer);
  await openProject(page, "no-default");
  await expect(modelButton(page, "Connect a model")).toBeVisible(LONG);

  await input(page).fill("Say hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // Connect a model is open, with its key field on screen
  const dialog = page.getByRole("dialog", { name: "Connect a model" });
  await expect(dialog.locator("#assistant-api-key")).toBeVisible(LONG);
  // The prompt waits in the composer, but no notice says so once the dialog is
  // what the user is looking at: the notice is for a prompt asked for from
  // outside the panel, such as Fix with assistant
  await expect(
    page.getByText(
      "Connect a backend, or sign in for the default one, to send this to the assistant. Your prompt is waiting in the composer."
    )
  ).toBeHidden();
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
    const PHONE = { width: 390, height: 844 };

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
