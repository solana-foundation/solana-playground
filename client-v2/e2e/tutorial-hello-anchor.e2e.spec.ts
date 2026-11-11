import type { Page } from "@playwright/test";

import type {
  Ask,
  Beat,
  Text,
  TutorialDefinition,
} from "../src/entities/tutorial";
import hello from "../src/tutorials/hello-anchor/tutorial.json";
import type { FakeBuildServer } from "./fake-build-server";
import { fakeBuildServer } from "./fake-build-server";
import type { FakeDevnet } from "./fake-devnet";
import { fakeDevnet } from "./fake-devnet";
import { expect, LONG, test } from "./fixtures";

/**
 * Hello Anchor from the intro card to the finish card on the desktop, with
 * the build server and devnet answered in the test (`fake-build-server.ts`,
 * `fake-devnet.ts`): the scenarios of `tutorial-conversation` and
 * `tutorial-runs` in `tutorial-flow-v2` that need a whole run. The copy is
 * read from the definition, so tuning the lesson's words breaks nothing here;
 * the cards' own strings are the spec's. Every test that runs on the fakes
 * ends with both fakes' `unhandled` empty: a request they do not model fails
 * the test that made it.
 *
 * `E2E_LIVE=1` runs the first test on the real build server and devnet
 * instead (`docs/testing.md`, T-1) and skips the rest, which steer the fakes.
 */
const isLive = Boolean(process.env.E2E_LIVE);

/** The lesson as the app reads it */
const lesson = hello as unknown as TutorialDefinition;

const beat = <K extends Beat["kind"]>(id: string, kind: K) => {
  const all = lesson.steps.flatMap((s) => s.beats.concat(s.onFail ?? []));
  const found = all.find((b) => b.id === id);
  if (!found || found.kind !== kind)
    throw new Error(`Hello Anchor has no ${kind} beat "${id}"`);
  return found as Extract<Beat, { kind: K }>;
};
const step = (id: string) => {
  const found = lesson.steps.find((s) => s.id === id);
  if (!found) throw new Error(`Hello Anchor has no step "${id}"`);
  return found;
};
/** A text's desktop words */
const words = (text: Text) => (typeof text === "string" ? text : text.text);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Tutorial chat" });
const feed = (page: Page) => chat(page).getByRole("log");

/** Markdown's inline code as the page reads it: the words, no backticks */
const plain = (text: string) => text.replace(/`/g, "");

/** The option `index` of a question, as its button */
const option = (ask: Ask, index: number) => (page: Page) =>
  feed(page).getByRole("button", {
    name: new RegExp(`^${escape(plain(ask.options[index]))}`),
  });
/** Picks the right answer of `ask` once it is in the feed */
const answer = async (page: Page, ask: Ask) => {
  await option(ask, ask.answer)(page).click(LONG);
};

/** The live act card of `id`, and its button */
const act = (page: Page, id: string) => {
  const a = beat(id, "act");
  return feed(page).getByRole("button", { name: a.button, exact: true }).last();
};

/** The step's win card has landed: its headline is in the feed */
const won = async (page: Page, id: string) => {
  await expect(
    feed(page)
      .getByText(words(step(id).win.headline), { exact: false })
      .first()
  ).toBeVisible(LONG);
};
/** A passed step's act keeps no live button: only the latest card acts */
const spent = async (page: Page, ...ids: string[]) => {
  for (const id of ids) {
    await expect(
      feed(page).getByRole("button", {
        name: beat(id, "act").button,
        exact: true,
      })
    ).toHaveCount(0);
  }
};
/** The live Next, "Next: <the next step's title>" */
const next = (page: Page) =>
  feed(page).getByRole("button", { name: /^Next/ }).last();

const start = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tutorials/hello-anchor");
  await feed(page)
    .getByRole("button", { name: /Start step 1/ })
    .click(LONG);
};

/** Step 1 through the planned failure, fixed by the learner's own pick */
const passStepOne = async (page: Page) => {
  await answer(page, beat("s1.q1", "ask"));
  await act(page, "s1.build").click(LONG);
  await expect(feed(page).getByText("Build failed").last()).toBeVisible(LONG);
  await expect(feed(page).getByText("E0432 · line 5").last()).toBeVisible();
  await feed(page).getByRole("button", { name: "I'll fix it myself" }).click();
  await answer(page, beat("f1.q2", "ask"));
  await act(page, "f1.build").click(LONG);
  await won(page, "write-program");
  await spent(page, "s1.build", "f1.build");
};

/** The airdrop card's line in a browser that has no wallet yet */
const NEW_WALLET = "A new Playground wallet, made in this browser";

/**
 * Step 2: the airdrop card makes the wallet and the faucet funds it
 * (HOO-2677), then the deploy pays from it
 */
const passStepTwo = async (page: Page) => {
  await answer(page, beat("s2.q2", "ask"));
  await expect(feed(page).getByText(NEW_WALLET)).toBeVisible(LONG);
  await act(page, "s2.airdrop").click(LONG);
  await expect(
    feed(page).getByText(/Made a wallet and added [\d.]+ SOL/)
  ).toBeVisible(LONG);
  await act(page, "s2.deploy").click(LONG);
  await won(page, "deploy");
  await spent(page, "s2.airdrop", "s2.deploy");
};

test.describe("tutorial: Hello Anchor on a stubbed build server and devnet", () => {
  let devnet: FakeDevnet;
  let builds: FakeBuildServer;

  test.beforeEach(async ({ page }) => {
    // No default backend, whatever the dev server is configured with
    await page.route("**/api/agent", (route) =>
      // eslint-disable-next-line unicorn/no-null -- the endpoint's JSON says null
      route.fulfill({ json: { configured: false, model: null } })
    );
    if (isLive) return;
    builds = await fakeBuildServer(page);
    devnet = await fakeDevnet(page);
  });

  test.afterEach(() => {
    // Unset when beforeEach failed, whose own error is the one to read
    if (isLive || !builds || !devnet) return;
    expect(builds.unhandled).toEqual([]);
    expect(devnet.unhandled).toEqual([]);
  });

  // The whole walk, with a reload in step 3 (tutorial-conversation: Reload in
  // step 3), ending on the scenario it is named after
  test("tutorial-conversation: Finishing Hello Anchor", async ({ page }) => {
    test.setTimeout(300_000);
    await start(page);
    await passStepOne(page);
    await next(page).click();

    await passStepTwo(page);
    // The result's details link the program to Explorer on devnet
    await feed(page)
      .getByRole("button", { name: /^Deployed to devnet/ })
      .click();
    const program = feed(page)
      .locator(
        "a[href*='explorer.solana.com/address/'][href*='cluster=devnet']"
      )
      .first();
    await expect(program).toBeVisible();
    const programId = /address\/(\w+)/.exec(
      (await program.getAttribute("href")) ?? ""
    )?.[1];
    expect(programId).toBeDefined();
    if (!isLive) expect(devnet.programs()).toEqual([programId]);
    await next(page).click();

    // Step 3 creates client.ts, then asks; a wrong pick, then a reload, which
    // opens on that question with the pick still ruled out and step 2's win
    // still in the feed
    const q3 = beat("s3.q3", "ask");
    const wrong = q3.why.findIndex((why) => why !== null);
    await option(q3, wrong)(page).click(LONG);
    await expect(option(q3, wrong)(page)).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await page.reload();
    await expect(option(q3, q3.answer)(page)).toBeVisible(LONG);
    await expect(option(q3, wrong)(page)).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await won(page, "deploy");
    await expect(
      feed(page).getByRole("button", { name: /Start step 1/ })
    ).toHaveCount(0);
    await answer(page, q3);
    await act(page, "s3.run").click(LONG);
    await expect(feed(page).getByText("Confirmed").last()).toBeVisible(LONG);
    await expect(
      feed(page).getByText("Program log: Hello, World!").last()
    ).toBeVisible();
    await won(page, "call-client");
    await next(page).click();

    // Step 4: the new argument, an upgrade at the same address, the call.
    // The airdrop card funds for the 400 KB estimate (the real port knows no
    // binary length), which step 2's deploy left the wallet short of, so it
    // asks the faucet; the deploy then checks only the real binary's need
    await answer(page, beat("s4.q4", "ask"));
    await act(page, "s4.airdrop").click(LONG);
    await expect(
      feed(page)
        .getByText(/Added [\d.]+ SOL/)
        .last()
    ).toBeVisible(LONG);
    await act(page, "s4.ship").click(LONG);
    await expect(feed(page).getByText("Upgraded").last()).toBeVisible(LONG);
    // The upgrade keeps the address
    await feed(page)
      .getByRole("button", { name: /^Upgraded/ })
      .click();
    await expect(
      feed(page)
        .locator(`a[href*='explorer.solana.com/address/${programId}']`)
        .last()
    ).toBeVisible();
    if (!isLive) expect(devnet.programs()).toEqual([programId]);
    await feed(page).getByRole("textbox", { name: "name" }).fill("Alex");
    await act(page, "s4.call").click(LONG);
    await won(page, "greet-by-name");

    // The finish card, with the last call's receipt, and no step's Next after
    // it (the card's own "Next: <tutorial>" points past the lesson)
    await expect(
      feed(page).getByText(words(lesson.finish.headline), { exact: false })
    ).toBeVisible(LONG);
    for (const { title } of lesson.steps) {
      await expect(
        feed(page).getByRole("button", { name: `Next: ${title}`, exact: true })
      ).toHaveCount(0);
    }
    const finished = feed(page).getByRole("region", { name: "Finished" });
    await finished.getByText("Transaction details").click();
    await expect(
      finished.getByText("Program log: Hello, Alex!").first()
    ).toBeVisible();
  });

  test("tutorial-conversation: A wrong pick, then the right one", async ({
    page,
  }) => {
    test.skip(isLive, "steers the fakes");
    test.setTimeout(120_000);
    const q1 = beat("s1.q1", "ask");
    const wrong = q1.why.findIndex((why) => why !== null);
    await start(page);
    await option(q1, wrong)(page).click(LONG);
    // The row is ruled out with the definition's reason under it, and the
    // build waits for the right pick
    await expect(
      feed(page).getByRole("button", {
        name: beat("s1.build", "act").button,
        exact: true,
      })
    ).toHaveCount(0);
    const ruled = option(q1, wrong)(page);
    await expect(ruled).toHaveAttribute("aria-disabled", "true");
    await expect(ruled.getByText("Not quite.", { exact: true })).toBeVisible();
    await expect(ruled).toHaveAccessibleDescription(
      new RegExp(escape(plain(q1.why[wrong] ?? "").slice(0, 30)))
    );
    await answer(page, q1);
    await expect(feed(page).getByText(/· 2nd try/)).toBeVisible(LONG);
  });

  test("tutorial-conversation: The planned failure", async ({ page }) => {
    test.skip(isLive, "steers the fakes");
    test.setTimeout(120_000);
    await start(page);
    await answer(page, beat("s1.q1", "ask"));
    await act(page, "s1.build").click(LONG);
    await expect(feed(page).getByText("E0432 · line 5").last()).toBeVisible(
      LONG
    );
    // The definition's line on the card, then Explain's explanation and question
    const planned = step("write-program").planned;
    if (!planned) throw new Error("Hello Anchor's step 1 plans no failure");
    await expect(
      feed(page).getByText(words(planned), { exact: false })
    ).toBeVisible();
    await feed(page)
      .getByRole("button", { name: /Explain the error/ })
      .click();
    const explain = beat("f1.explain", "say");
    await expect(
      feed(page).getByText(plain(words(explain.text)).slice(0, 40), {
        exact: false,
      })
    ).toBeVisible(LONG);
    const fix = beat("f1.q2", "ask");
    await expect(
      feed(page).getByRole("group", { name: plain(words(fix.question)) })
    ).toBeVisible(LONG);
  });

  test("tutorial-runs: The faucet is at its limit", async ({ page }) => {
    test.skip(isLive, "steers the fakes");
    test.setTimeout(240_000);
    await start(page);
    await passStepOne(page);
    await next(page).click();

    devnet.faucet = "refuse";
    await answer(page, beat("s2.q2", "ask"));
    await act(page, "s2.airdrop").click(LONG);
    await expect(feed(page).getByText("Not enough devnet SOL")).toBeVisible(
      LONG
    );
    await expect(
      feed(page).getByRole("link", { name: /Open the web faucet/ })
    ).toBeVisible();
    await expect(feed(page).getByText("Asks the faucet again")).toBeVisible();
    expect(devnet.programs()).toEqual([]);

    // A wallet of one's own is the other way round: the card opens the Fund
    // dialog, which says so when this browser has no wallet extension
    await feed(page)
      .getByRole("button", { name: "Send from your wallet" })
      .click();
    const fund = page.getByRole("dialog");
    await expect(
      fund.getByText("No wallet extension found in this browser.")
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(fund).toBeHidden();

    // Try again, under the red card, asks the faucet again; once it pays,
    // the deploy follows
    devnet.faucet = "ok";
    await feed(page).getByRole("button", { name: "Try again" }).last().click();
    await expect(feed(page).getByText(/Added [\d.]+ SOL/)).toBeVisible(LONG);
    await act(page, "s2.deploy").click(LONG);
    await won(page, "deploy");
    expect(devnet.programs()).toHaveLength(1);
  });

  test("tutorial-runs: A slow devnet confirms late", async ({ page }) => {
    test.skip(isLive, "steers the fakes");
    test.setTimeout(300_000);
    await start(page);
    await passStepOne(page);
    await next(page).click();
    await passStepTwo(page);
    await next(page).click();
    await answer(page, beat("s3.q3", "ask"));
    await act(page, "s3.run").click(LONG);
    await won(page, "call-client");
    await next(page).click();
    // Step 2's deploy left the wallet short of the 400 KB estimate, so step
    // 4's airdrop card asks the faucet before the upgrade
    await answer(page, beat("s4.q4", "ask"));
    await act(page, "s4.airdrop").click(LONG);
    await expect(
      feed(page)
        .getByText(/Added [\d.]+ SOL/)
        .last()
    ).toBeVisible(LONG);
    await act(page, "s4.ship").click(LONG);
    await expect(feed(page).getByText("Upgraded").last()).toBeVisible(LONG);

    // Devnet takes the call but has not indexed it when the reads run out
    devnet.index = "lag";
    await feed(page).getByRole("textbox", { name: "name" }).fill("Alex");
    await act(page, "s4.call").click(LONG);
    await expect(feed(page).getByText("Not confirmed yet")).toBeVisible(LONG);
    await expect(feed(page).getByText("Call failed")).toHaveCount(0);
    const sends = () =>
      devnet.calls.filter((c) => c === "sendTransaction").length;
    const sent = sends();

    // Check again reads the same transaction, sends nothing, and passes
    devnet.index = "ok";
    await feed(page).getByRole("button", { name: "Check again" }).click();
    await won(page, "greet-by-name");
    expect(sends()).toBe(sent);
  });

  // The Call panel is on the branch (HOO-2358, #357); the scenario below is
  // still to be written against it (HOO-2364)
  test.fixme(
    "tutorial-runs: Passing step 3 from the Call panel",
    {
      annotation: {
        type: "issue",
        description:
          "HOO-2364: the scenario is not written against the Call panel yet",
      },
    },
    async () => {
      // 1. Pass steps 1 and 2 (passStepOne, passStepTwo) and press Next.
      // 2. With q3 still open, call `hello` from the Call panel.
      // 3. The panel shows the result; step 3's win follows in the feed with
      //    the definition's Call line and "Write it in client.ts".
      // 4. After Next, q3's record reads "· skipped, called from the Call
      //    panel".
      throw new Error("the Call panel scenario is not written yet");
    }
  );
});
