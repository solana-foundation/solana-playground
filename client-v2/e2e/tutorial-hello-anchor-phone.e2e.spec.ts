import type { Page } from "@playwright/test";

import type { Ask } from "../src/entities/tutorial";
import type { FakeBuildServer } from "./fake-build-server";
import { fakeBuildServer } from "./fake-build-server";
import type { FakeDevnet } from "./fake-devnet";
import { fakeDevnet } from "./fake-devnet";
import { expect, LONG, test } from "./fixtures";
import { beat, cardsFor, lesson, step, words } from "./hello-anchor";
import { PHONE } from "./viewports";

/**
 * Hello Anchor from the intro card to the finish card at 390 px, on the same
 * stubbed build server and devnet as the desktop's run
 * (`tutorial-hello-anchor`): the phone half of tutorial-flow-v2 task 6.5. The
 * phone shows the same conversation in its Chat space, with the code one tap
 * away in Code, and leaves typing code to the desktop (tutorial-phone). The
 * tablet band (768 to 1023 px) draws the same layout with a centred chat and
 * is not walked here.
 */

/** The phone layout's Chat space, below the frame's width */
const chat = (page: Page) => page.getByRole("region", { name: "Chat" });
const feed = (page: Page) => chat(page).getByRole("log");
const code = (page: Page) => page.getByRole("region", { name: "Code" });

const { optionFor, answer, act, won, spent, next } = cardsFor(feed);

/**
 * Which space is on screen. Both stay mounted in one strip that slides, so
 * visibility proves nothing; the one out of view is inert.
 */
const showing = async (page: Page, space: "chat" | "code") => {
  const [shown, hidden] =
    space === "chat" ? [chat(page), code(page)] : [code(page), chat(page)];
  await expect(shown).not.toHaveAttribute("inert");
  await expect(hidden).toHaveAttribute("inert");
};

/** A live question offers Hint, and no "Type it myself": a phone can't type */
const askedOnThePhone = async (page: Page, ask: Ask) => {
  await expect(optionFor(ask, ask.answer)(page)).toBeVisible(LONG);
  await expect(
    feed(page).getByRole("button", { name: /^Hint/ }).last()
  ).toBeVisible();
  await expect(
    feed(page).getByRole("button", { name: "Type it myself", exact: true })
  ).toHaveCount(0);
};

/** A win card, with no "Open Call": Call lives in Code's head on the phone */
const wonOnThePhone = async (page: Page, id: string) => {
  await won(page, id);
  await expect(
    feed(page).getByRole("button", { name: "Open Call", exact: true })
  ).toHaveCount(0);
};

test.describe("tutorial: Hello Anchor on a phone, on a stubbed build server and devnet", () => {
  let devnet: FakeDevnet;
  let builds: FakeBuildServer;

  test.beforeEach(async ({ page }) => {
    // No default backend, whatever the dev server is configured with
    await page.route("**/api/agent", (route) =>
      // eslint-disable-next-line unicorn/no-null -- the endpoint's JSON says null
      route.fulfill({ json: { configured: false, model: null } })
    );
    builds = await fakeBuildServer(page);
    devnet = await fakeDevnet(page);
  });

  test.afterEach(() => {
    // Unset when beforeEach failed, whose own error is the one to read
    if (!builds || !devnet) return;
    expect(builds.unhandled).toEqual([]);
    expect(devnet.unhandled).toEqual([]);
  });

  test("walks Hello Anchor from the intro to the finish at 390 px", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(PHONE);
    await page.goto("/tutorials/hello-anchor");
    // Before Start the one Start button takes the composer's place, under
    // the thumb; the intro card draws none on the phone
    const startButton = chat(page).getByRole("button", {
      name: /Start step 1/,
    });
    await expect(startButton).toHaveCount(1, LONG);
    await expect(
      page.getByRole("complementary", { name: "Tutorial chat" })
    ).toHaveCount(0);
    await showing(page, "chat");
    await startButton.click();

    // Step 1: the planned E0412, which the phone only explains: it cannot
    // type the fix, so the learner picks it
    const q1 = beat("s1.q1", "ask");
    await askedOnThePhone(page, q1);
    await answer(page, q1);
    await act(page, "s1.build").click(LONG);
    await expect(feed(page).getByText("E0412 · line 9").last()).toBeVisible(
      LONG
    );
    const planned = step("write-program").planned;
    if (!planned) throw new Error("Hello Anchor's step 1 plans no failure");
    await expect(
      feed(page).getByText(words(planned), { exact: false })
    ).toBeVisible();
    await expect(
      feed(page).getByRole("button", { name: "I'll fix it myself" })
    ).toHaveCount(0);
    await feed(page)
      .getByRole("button", { name: /Explain the error/ })
      .click();
    const fix = beat("f1.q2", "ask");
    await askedOnThePhone(page, fix);
    await answer(page, fix);
    await act(page, "f1.build").click(LONG);
    await wonOnThePhone(page, "write-program");
    await spent(page, "s1.build", "f1.build");

    // The code, one tap away, and back
    await page.getByRole("button", { name: /^Show the code/ }).click();
    await showing(page, "code");
    await expect(code(page).getByText("lib.rs").first()).toBeVisible(LONG);
    await page.getByRole("button", { name: "Back to the chat" }).click();
    await showing(page, "chat");
    await next(page).click();

    // Step 2: the airdrop card makes the wallet and funds it; the deploy
    const q2 = beat("s2.q2", "ask");
    await askedOnThePhone(page, q2);
    await answer(page, q2);
    await act(page, "s2.airdrop").click(LONG);
    await expect(
      feed(page).getByText(/Made a wallet and added [\d.]+ SOL/)
    ).toBeVisible(LONG);
    await act(page, "s2.deploy").click(LONG);
    await wonOnThePhone(page, "deploy");
    expect(devnet.programs()).toHaveLength(1);

    // The terminal drawer's bar opens and folds it in Code: the drawer
    // follows the phone's own console state, the one the bar writes. (It did
    // not open by itself: Code was inert behind Chat when the deploy landed)
    await page.getByRole("button", { name: /^Show the code/ }).click();
    await showing(page, "code");
    const terminal = code(page).getByRole("button", { name: "Terminal" });
    // The drawer is Code's last child; folded it is its bar alone (28 px)
    const drawerHeight = () =>
      code(page)
        .locator("> div")
        .last()
        .evaluate((el) => el.getBoundingClientRect().height);
    await expect(terminal).toHaveAttribute("aria-expanded", "false");
    await expect.poll(drawerHeight).toBeLessThan(40);
    await terminal.click();
    await expect(terminal).toHaveAttribute("aria-expanded", "true");
    // Open, it takes its share of the space: the bar alone reads expanded on
    // the bug this guards, with the body still clipped to the bar
    await expect.poll(drawerHeight).toBeGreaterThan(120);
    await terminal.click();
    await expect(terminal).toHaveAttribute("aria-expanded", "false");
    await expect.poll(drawerHeight).toBeLessThan(40);
    await page.getByRole("button", { name: "Back to the chat" }).click();
    await showing(page, "chat");
    await next(page).click();

    // Step 3: a wrong pick, then a reload, which opens on Chat, still the
    // phone layout, at that question with the pick still ruled out and step
    // 2's win in the feed
    const q3 = beat("s3.q3", "ask");
    const wrong = q3.why.findIndex((why) => why !== null);
    await askedOnThePhone(page, q3);
    await optionFor(q3, wrong)(page).click(LONG);
    await expect(optionFor(q3, wrong)(page)).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await page.reload();
    await expect(optionFor(q3, q3.answer)(page)).toBeVisible(LONG);
    await showing(page, "chat");
    await expect(
      page.getByRole("complementary", { name: "Tutorial chat" })
    ).toHaveCount(0);
    await expect(optionFor(q3, wrong)(page)).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await won(page, "deploy");
    await answer(page, q3);
    await act(page, "s3.run").click(LONG);
    await expect(
      feed(page).getByText("Program log: Hello, World!").last()
    ).toBeVisible(LONG);
    await wonOnThePhone(page, "call-client");
    await next(page).click();

    // Step 4: the new argument, an upgrade at the same address, the call
    const q4 = beat("s4.q4", "ask");
    await askedOnThePhone(page, q4);
    await answer(page, q4);
    await act(page, "s4.airdrop").click(LONG);
    await expect(
      feed(page)
        .getByText(/Added [\d.]+ SOL/)
        .last()
    ).toBeVisible(LONG);
    await act(page, "s4.ship").click(LONG);
    await expect(feed(page).getByText("Upgraded").last()).toBeVisible(LONG);
    expect(devnet.programs()).toHaveLength(1);
    await feed(page).getByRole("textbox", { name: "name" }).fill("Alex");
    await act(page, "s4.call").click(LONG);
    await wonOnThePhone(page, "greet-by-name");

    // The finish is the chat's finish card, and the header says done
    await expect(
      feed(page).getByText(words(lesson.finish.headline), { exact: false })
    ).toBeVisible(LONG);
    const finished = feed(page).getByRole("region", { name: "Finished" });
    await finished.getByText("Transaction details").click();
    await expect(
      finished.getByText("Program log: Hello, Alex!").first()
    ).toBeVisible();
    const count = lesson.steps.length;
    await expect(
      page.getByRole("button", {
        name: new RegExp(`Done · ${count} of ${count}\\. Show the steps$`),
      })
    ).toBeVisible();
  });
});
