/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type { Page } from "@playwright/test";

import { requireFor } from "../src/test-utils/require-for";
import {
  expect,
  LONG,
  streamed,
  stubAiStatus,
  stubSession,
  test,
} from "./fixtures";

const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Tutorial chat" });
const feed = (page: Page) => chat(page).getByRole("log");
const editor = (page: Page) => page.locator(".monaco-editor .view-lines");
/** Step 1's heading in the feed: its objective */
const stepOne = (page: Page) =>
  feed(page).getByRole("heading", {
    name: "Define the hello instruction and log a message",
  });

test.beforeEach(async ({ page }) => {
  // No default backend, whatever the dev server is configured with
  await page.route("**/api/agent", (route) =>
    route.fulfill({ json: { configured: false, model: null } })
  );
});

test("tutorial-conversation: Starting Hello Anchor", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/tutorials/hello-anchor");

  // The intro card, with the finished program in the workspace
  const intro = feed(page).getByRole("region", { name: "Hello Anchor" });
  await expect(intro).toBeVisible(LONG);
  await expect(intro.getByText("What you'll build")).toBeVisible();
  await expect(editor(page)).toContainText("msg!", LONG);

  await intro.getByRole("button", { name: /Start step 1/ }).click();

  // The intro leaves the feed, step 1's heading arrives, and lib.rs opens on
  // step 1's start: empty, then the import and the id the step writes first
  await expect(stepOne(page)).toBeVisible(LONG);
  await expect(intro).toHaveCount(0);
  await expect(editor(page)).toContainText("declare_id!", LONG);
  await expect(editor(page)).not.toContainText("msg!");
  // The step's turns keep arriving on their own, up to its first question
  await expect(
    feed(page).getByRole("button", { name: "Hint", exact: true })
  ).toBeVisible(LONG);
  await expect(
    chat(page)
      .getByRole("navigation", { name: "Tutorial steps" })
      .getByRole("button", { name: /^Step 1 of 4, .*, current$/ })
  ).toHaveAttribute("aria-current", "step");
});

test("a reload opens on the step it left, with no intro", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/tutorials/hello-anchor");
  await feed(page)
    .getByRole("button", { name: /Start step 1/ })
    .click(LONG);
  await expect(stepOne(page)).toBeVisible(LONG);

  await page.reload();
  await expect(stepOne(page)).toBeVisible(LONG);
  await expect(
    feed(page).getByRole("button", { name: /Start step 1/ })
  ).toHaveCount(0);
});

// The prototype's sizes (f7d42bf2e), where they differ from the shared parts
const FAILED_BUILD = {
  stderr:
    "error[E0412]: cannot find type `Initialize` in this scope\n --> /src/lib.rs:9:27\nerror: could not compile `hello`\n",
  // eslint-disable-next-line unicorn/no-null -- the build server's JSON says null on a failed build
  uuid: null,
  // eslint-disable-next-line unicorn/no-null -- the same answer's other field
  idl: null,
};

const failTheBuild = async (page: Page) => {
  await feed(page)
    .getByRole("button", { name: /Start step 1/ })
    .click(LONG);
  await feed(page).getByRole("button", { name: /^msg!/ }).click(LONG);
  await feed(page)
    .getByRole("button", { name: /^Build/ })
    .click(LONG);
};

test("a build writes the program id into the open buffer while the editor is busy", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Answers late, so the id is written while the build holds the editor. The
  // request carries the id the build used, which the buffer must then show
  let builtId = "";
  await page.route("**/build", async (route) => {
    builtId =
      /declare_id!\(\\?"(\w+)\\?"\)/.exec(
        route.request().postData() ?? ""
      )?.[1] ?? "";
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({ json: FAILED_BUILD });
  });
  await page.goto("/tutorials/hello-anchor");
  await failTheBuild(page);

  await expect.poll(() => builtId, LONG).not.toBe("");
  expect(builtId).not.toBe("11111111111111111111111111111111");
  await expect(editor(page)).toContainText(builtId, LONG);
  await expect(
    feed(page).getByRole("button", { name: /Explain the error/ })
  ).toBeVisible(LONG);
  expect(errors.filter((text) => text.includes("program id"))).toEqual([]);
});

test("a failed build's two buttons hold one row of one width at 1280", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route("**/build", (route) =>
    route.fulfill({ json: FAILED_BUILD })
  );
  await page.goto("/tutorials/hello-anchor");
  await failTheBuild(page);

  const explain = feed(page).getByRole("button", { name: /Explain the error/ });
  const fix = feed(page).getByRole("button", { name: "I'll fix it myself" });
  await expect(explain).toBeVisible(LONG);
  // The feed is still scrolling the card into view, so two reads in a row
  // land on different frames: poll until they agree
  await expect
    .poll(async () => {
      const a = requireFor("Explain's box")(await explain.boundingBox());
      const b = requireFor("the fix button's box")(await fix.boundingBox());
      return { sameRow: a.y === b.y, sameWidth: a.width === b.width };
    }, LONG)
    .toEqual({ sameRow: true, sameWidth: true });
});

test("a failed build's two buttons stay inside the card in a narrower column", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1152, height: 800 });
  await page.route("**/build", (route) =>
    route.fulfill({ json: FAILED_BUILD })
  );
  await page.goto("/tutorials/hello-anchor");
  await failTheBuild(page);

  const explain = feed(page).getByRole("button", { name: /Explain the error/ });
  const fix = feed(page).getByRole("button", { name: "I'll fix it myself" });
  await expect(explain).toBeVisible(LONG);
  // The row's parent is the card's body, inside its clipping edge
  const card = explain.locator("xpath=../..");
  await expect
    .poll(async () => {
      const a = requireFor("Explain's box")(await explain.boundingBox());
      const b = requireFor("the fix button's box")(await fix.boundingBox());
      const c = requireFor("the card's box")(await card.boundingBox());
      return { sameRow: a.y === b.y, inside: b.x + b.width <= c.x + c.width };
    }, LONG)
    .toEqual({ sameRow: true, inside: true });
});

test("the folded composer is 46 px below md with a fine pointer", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto("/tutorials/hello-anchor");
  // Under the frame's width the phone layout opens on its Chat space (5.1)
  await page.getByRole("button", { name: /Start step 1/ }).click(LONG);
  await expect(
    page.getByRole("button", { name: "Hint", exact: true })
  ).toBeVisible(LONG);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  const composer = page.locator("form:has([data-slot=composer-send]):visible");
  await expect
    .poll(async () => (await composer.boundingBox())?.height, LONG)
    .toBe(46);
  await expect(composer.locator("textarea")).toHaveCSS("font-size", "15px");
});

/**
 * Hello Anchor's step 1 with a hosted model stubbed to answer `answer`, after
 * a question is sent from the composer. Resolves once a model has it: with
 * no model picked yet, the question opens Connect a model first
 */
const askOnStepOneWith =
  (answer: string) => async (page: Page, question: string) => {
    await stubSession(page);
    // A hosted model, whatever the dev server is configured with
    await stubAiStatus(page, "test-model");
    await page.route("**/api/agent", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: streamed(answer),
      })
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/tutorials/hello-anchor");
    await feed(page)
      .getByRole("button", { name: /Start step 1/ })
      .click(LONG);
    await expect(
      feed(page).getByRole("button", { name: "Hint", exact: true })
    ).toBeVisible(LONG);

    const composer = chat(page).getByRole("textbox");
    await composer.fill(question);
    await composer.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Connect a model" });
    const answered = feed(page).getByText(answer.split("\n")[0]);
    await expect(dialog.or(answered)).toBeVisible(LONG);
    if (await dialog.isVisible()) {
      await dialog.getByRole("button", { name: "Start", exact: true }).click();
      await expect(dialog).toBeHidden(LONG);
      await composer.press("Enter");
    }
  };

// An answer longer than the feed puts the live card off screen, so the pill
// floats over the feed's foot while it is scrolled to its end
test("the back pill leaves the feed's last line clear at its end", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const answer = Array.from(
    { length: 30 },
    (_, i) => `Paragraph ${i + 1} of a long answer.`
  ).join("\n\n");
  await askOnStepOneWith(answer)(page, "tell me more");
  const last = feed(page).getByText("Paragraph 30 of a long answer.");
  await expect(last).toBeVisible(LONG);
  await feed(page).evaluate((log) => {
    const box = log.parentElement;
    box?.scrollTo(0, box.scrollHeight);
  });
  const pill = chat(page).getByRole("button", { name: "Back to step 1" });
  await expect(pill).toBeVisible();
  await expect
    .poll(async () => {
      const line = await last.boundingBox();
      const over = await pill.boundingBox();
      return line && over ? over.y - (line.y + line.height) : undefined;
    })
    .toBeGreaterThanOrEqual(8);
});

// What Explain sends: a fenced build log, its lines long and full of
// backticks, which the learner's bubble shows as written
test("a question carrying a build log keeps its lines and the feed its width", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const log = [
    "error: expected item, found keyword `let`",
    " --> ../src/lib.rs:5:1 | 5 | let broken = ; | ^^^ consider using `const` or `static` instead of `let` for global variables",
    "error: could not compile `solpg` (lib) due to previous error; Compiling solpg v0.1.0 (/home/solpg/programs/solpg-a-long-path-that-runs-past-the-column)",
  ].join("\n");
  const question = `My build failed.\n\nBuild log:\n\`\`\`\n${log}\n\`\`\``;
  await askOnStepOneWith("The keyword let cannot start an item.")(
    page,
    question
  );

  const bubble = feed(page).getByText("My build failed.", { exact: false });
  await expect(bubble).toBeVisible(LONG);
  // As written: the fence and every line of the log, none made a chip
  await expect(bubble).toContainText("```");
  await expect(bubble).toContainText("consider using `const` or `static`");
  // and inside the column: the feed never scrolls sideways
  await expect
    .poll(() =>
      feed(page).evaluate((el) => {
        const box = el.parentElement;
        return box ? box.scrollWidth - box.clientWidth : -1;
      })
    )
    .toBe(0);
});

test.describe("on a coarse pointer", () => {
  test.use({
    viewport: { width: 390, height: 800 },
    hasTouch: true,
    isMobile: true,
  });

  test("Send keeps 44 px for a finger and the field its 16 px text", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // The phone layout opens on its Chat space (5.1)
    await page.goto("/tutorials/hello-anchor");
    await page.getByRole("button", { name: /Start step 1/ }).click(LONG);
    const send = page.locator("[data-slot=composer-send]:visible");
    await expect(send).toHaveCSS("height", "44px", LONG);
    await expect(page.locator("[data-slot=composer-input]:visible")).toHaveCSS(
      "font-size",
      "16px"
    );
  });
});
