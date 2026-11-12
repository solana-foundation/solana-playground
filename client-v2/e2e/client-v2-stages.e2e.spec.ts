import type { Locator, Page } from "@playwright/test";
import { Keypair } from "@solana/web3.js";

import { requireFor } from "../src/test-utils/require-for";
import {
  expect,
  FAILED_BUILD_STDERR,
  json,
  LONG,
  seedWorkspace,
  test,
} from "./fixtures";
import { DESK, DOCK_DESK, openPhonePreview, PHONE } from "./viewports";

// These tests drive the project tree as its docked column, which needs a code
// area of 1100 px or more; the default window is too narrow and shows the
// dropdown instead
test.use({ viewport: DOCK_DESK });

/**
 * The scenarios of `client-v2-stages`: what the Build, Deploy and Interact
 * stages show, and where their action sits on a phone; and the
 * `client-v2-search-field` scenarios, which reuse this file's Interact setup.
 */

const PROGRAM_ID = "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj";

/**
 * A small Anchor IDL: the `u64` argument is what "Random fills an instruction
 * value" picks for, the `counter` account gives the form a field with "From
 * seed" for the screenshots, and the `Counter` type is the Accounts section
 * "An address that is not a public key" types into
 */
const IDL = {
  version: "0.1.0",
  name: "e2e_project",
  instructions: [
    {
      name: "initialize",
      accounts: [{ name: "counter", isMut: true, isSigner: false }],
      args: [{ name: "amount", type: "u64" }],
    },
  ],
  accounts: [
    {
      name: "Counter",
      type: { kind: "struct", fields: [{ name: "count", type: "u64" }] },
    },
  ],
};

/**
 * A program account owned by the non-upgradeable loader: the chain read
 * settles on "deployed" with no program-data account to follow
 */
const DEPLOYED_ACCOUNT = {
  data: ["", "base64"],
  executable: true,
  lamports: 1141440,
  owner: "BPFLoader2111111111111111111111111111111111",
  rentEpoch: 0,
  space: 0,
};

/**
 * The cluster answers `getAccountInfo` with `account` (`null`: the program
 * account does not exist); every other call goes to the cluster as usual
 */
const stubProgramAccount = (page: Page, account: object | null) =>
  page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as {
      id?: unknown;
      method?: string;
    } | null;
    if (body?.method !== "getAccountInfo") return route.continue();
    return json(route, {
      jsonrpc: "2.0",
      id: body.id,
      result: { context: { slot: 1 }, value: account },
    });
  });

/**
 * Builds the project as a user does, which gives it a program id, with the
 * build server's answer stubbed to carry the IDL; then opens Interact
 */
const buildThenInteract = async (page: Page, idl: object = IDL) => {
  // CI has no build server: the request is answered here
  await page.route("**/build", (route) =>
    json(route, { stderr: "", uuid: null, idl })
  );
  await page.locator("#flow-stage-tab-build").click();
  const build = page.locator("#flow-stage-panel-build");
  await build.getByRole("button", { name: /^Build$/ }).click();
  await expect(
    build.getByRole("heading", { name: "Build succeeded" })
  ).toBeVisible(LONG);

  await page.locator("#flow-stage-tab-interact").click();
  return page.locator("#flow-stage-panel-interact");
};

/** Where one button sits sideways in one frame, and whether it was busy */
type Edges = { left: number; right: number; busy: boolean };

/**
 * Starts recording, on every animation frame, the left and right edges of
 * each of `buttons`; the function it returns stops and hands back the frames.
 * A layout shift can last a frame or two, so sampling only at the start and
 * the end would miss it.
 */
const recordEdges = async (page: Page, buttons: Locator[]) => {
  const handles = await Promise.all(buttons.map((b) => b.elementHandle()));
  await page.evaluate((elements) => {
    const frames: Edges[][] = [];
    const box = window as unknown as {
      __edges: { frames: Edges[][]; stop: boolean };
    };
    box.__edges = { frames, stop: false };
    const tick = () => {
      frames.push(
        elements.map((element) => {
          if (!element) throw new Error("a recorded button left the page");
          const r = element.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            busy: element.getAttribute("aria-busy") === "true",
          };
        })
      );
      if (!box.__edges.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, handles);
  return () =>
    page.evaluate(() => {
      const box = window as unknown as {
        __edges: { frames: Edges[][]; stop: boolean };
      };
      box.__edges.stop = true;
      return box.__edges.frames;
    });
};

/**
 * Waits until the recording holds five frames with the first button busy: the
 * busy layout has been painted and measured several times over, however slow
 * the machine
 */
const waitForBusyFrames = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(() => {
        const box = window as unknown as {
          __edges: { frames: Edges[][] };
        };
        return box.__edges.frames.filter(([first]) => first.busy).length;
      })
    )
    .toBeGreaterThanOrEqual(5);

/**
 * Every frame's edges equal the first frame's, and the recording caught the
 * first button both idle and busy
 */
const expectHeldStill = (frames: Edges[][]) => {
  expect(frames.some(([first]) => first.busy)).toBe(true);
  expect(frames.some(([first]) => !first.busy)).toBe(true);
  const [start] = frames;
  const moved = frames.filter((frame) =>
    frame.some(
      (edges, i) =>
        Math.abs(edges.left - start[i].left) > 0.5 ||
        Math.abs(edges.right - start[i].right) > 0.5
    )
  );
  expect(moved).toEqual([]);
};

/** The build server's answer to a build that succeeds with `IDL` */
// eslint-disable-next-line unicorn/no-null -- the build server's wire shape
const BUILT = { stderr: "", uuid: null, idl: IDL };

/**
 * Holds every `/build` request, in place of the routes before it, until the
 * returned function is called, so a test can look at the stage while the
 * build runs
 */
const holdBuild = async (page: Page) => {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.unroute("**/build");
  await page.route("**/build", async (route) => {
    await released;
    await json(route, BUILT);
  });
  return release;
};

test.describe("client-v2-stages", () => {
  test("client-v2-stages: A failed build marks the faulty line", async ({
    seededPage: page,
  }) => {
    // CI has no build server: the request is answered here
    await page.route("**/build", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          stderr: FAILED_BUILD_STDERR,
          uuid: null,
          idl: null,
        }),
      })
    );

    await page.locator("#flow-stage-tab-build").click();
    const panel = page.locator("#flow-stage-panel-build");
    await panel.getByRole("button", { name: /^Build$/ }).click();

    const diagnostic = panel.locator('[data-slot="diagnostic"]');
    await expect(diagnostic).toHaveCount(1, LONG);
    await expect(
      diagnostic.locator('[data-slot="diagnostic-code"]')
    ).toHaveText("E0308");
    // The line itself, read from the project, not rustc's excerpt
    const fault = diagnostic.locator("[data-fault]");
    await expect(fault.locator("span").first()).toHaveText("5");
    await expect(fault).toContainText("expected u32, found &str");
    // Spec 04: Explain and Fix on every error card
    await expect(
      diagnostic.getByRole("button", { name: "Explain" })
    ).toBeVisible();
    await expect(diagnostic.getByRole("button", { name: "Fix" })).toBeVisible();
  });

  test("client-v2-stages: Build again keeps the action row in place", async ({
    seededPage: page,
  }) => {
    // CI has no build server: the request is answered here
    await page.route("**/build", (route) => json(route, BUILT));
    await page.locator("#flow-stage-tab-build").click();
    const panel = page.locator("#flow-stage-panel-build");
    await panel.getByRole("button", { name: /^Build$/ }).click();
    await expect(
      panel.getByRole("heading", { name: "Build succeeded" })
    ).toBeVisible(LONG);

    // The frame keeps its scrollbar's room on both edges (headless Chromium
    // draws no scrollbar, so the shift itself is the manual scenario's)
    expect(
      await panel
        .locator("div.overflow-y-auto")
        .first()
        .evaluate((frame) => getComputedStyle(frame).scrollbarGutter)
    ).toBe("stable both-edges");

    const release = await holdBuild(page);
    const again = panel.getByRole("button", { name: "Build again" });
    const next = panel.getByRole("button", { name: "Continue to Deploy" });
    const stop = await recordEdges(page, [again, next]);
    await again.click();
    // Busy, its name is the label it shows
    await expect(
      panel.getByRole("button", { name: "Building…", exact: true })
    ).toHaveAttribute("aria-busy", "true");
    await waitForBusyFrames(page);
    release();
    await expect(again).toBeEnabled(LONG);
    expectHeldStill(await stop());
  });

  test("client-v2-stages: A deployment shows its program id to copy", async ({
    seededPage: page,
  }) => {
    // A deploy needs a wallet and a cluster; the record it leaves is what
    // the stage reads, so the record is written here
    await page.evaluate(
      ([programId, at]) =>
        localStorage.setItem(
          "flow.deploys",
          JSON.stringify([
            {
              id: "e2e-deploy",
              workspace: "e2e-project",
              cluster: "devnet",
              programId,
              signature: null,
              at,
            },
          ])
        ),
      [PROGRAM_ID, Date.now()] as const
    );
    await page.reload();
    await expect(page.locator("#root-dir")).toBeVisible(LONG);

    await page.locator("#flow-stage-tab-deploy").click();
    const result = page
      .locator("#flow-stage-panel-deploy")
      .getByRole("status")
      .filter({ hasText: "Deployed to" });
    await expect(result).toContainText("Deployed to devnet", LONG);
    // Shortened in the middle, whole in its title
    await expect(result.locator("code")).toHaveText("6PNd…AVkj");
    await expect(result.locator("code")).toHaveAttribute("title", PROGRAM_ID);
    await expect(result.locator('[data-slot="copy-button"]')).toBeVisible();
  });
});

test.describe("client-v2-stages: Interact", () => {
  test("client-v2-stages: Interact before a deploy", async ({
    seededPage: page,
  }) => {
    await stubProgramAccount(page, null);
    const panel = await buildThenInteract(page);

    await expect(
      panel.getByRole("heading", { name: "Nothing to call yet" })
    ).toBeVisible(LONG);
    const goToDeploy = panel
      .locator('[data-slot="stage-empty-actions"]')
      .getByRole("button", { name: "Go to Deploy" });
    await goToDeploy.click();
    await expect(page.locator("#flow-stage-panel-deploy")).toBeVisible();
  });

  test("Interact draws a deployed program's instructions", async ({
    seededPage: page,
  }) => {
    await stubProgramAccount(page, DEPLOYED_ACCOUNT);
    const panel = await buildThenInteract(page);

    await expect(
      panel.getByRole("button", { name: "Copy program id" })
    ).toBeVisible(LONG);
    // Every instruction is a card, folded on arrival; opened, it ends in Send
    const card = panel.getByRole("button", { name: /^initialize/ });
    await expect(card).toHaveAttribute("aria-expanded", "false");
    await card.click();
    await expect(panel.getByRole("button", { name: "Send" })).toBeVisible();
    await expect(panel.locator('[data-slot="stage-empty"]')).toHaveCount(0);
  });

  test("client-v2-stages: Send keeps the card's row in place", async ({
    seededPage: page,
  }) => {
    // A Playground wallet with SOL, so Send can run; the call then waits on
    // the cluster for as long as the test holds it
    const wallet = Keypair.generate();
    await page.evaluate(
      (kp) =>
        localStorage.setItem(
          "wallet",
          JSON.stringify({
            state: "pg",
            accounts: [{ kp, name: "Wallet 1" }],
            currentIndex: 0,
          })
        ),
      Array.from(wallet.secretKey)
    );

    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const held: string[] = [];
    let slot = 0;
    await page.route("https://api.devnet.solana.com/**", async (route) => {
      const body = (route.request().postDataJSON() ?? {}) as {
        id?: unknown;
        method?: string;
      };
      const answer = (result: unknown) =>
        json(route, { jsonrpc: "2.0", id: body.id, result });
      // Every account reads as the deployed program with 10 SOL in it: the
      // wallet's balance is read from its account as well
      if (body.method === "getAccountInfo") {
        return answer({
          context: { slot: 1 },
          value: {
            data: DEPLOYED_ACCOUNT.data,
            executable: DEPLOYED_ACCOUNT.executable,
            lamports: 10_000_000_000,
            owner: DEPLOYED_ACCOUNT.owner,
            rentEpoch: DEPLOYED_ACCOUNT.rentEpoch,
            space: DEPLOYED_ACCOUNT.space,
          },
        });
      }
      if (body.method === "getBalance") {
        return answer({ context: { slot: 1 }, value: 10_000_000_000 });
      }
      // The app polls the slot on its own, and reads a slot that stands
      // still as a cluster that is down, so each answer moves it on
      if (body.method === "getSlot") return answer((slot += 1));
      // Only the call Send makes should get here: anything else waiting on
      // the hold would leave Send busy for a reason that is not the layout's
      held.push(body.method ?? "(no method)");
      await released;
      return route.abort();
    });
    // Reloaded once the cluster is stubbed: the wallet reads its balance as
    // it loads
    await page.reload();
    await expect(page.locator("#root-dir")).toBeVisible(LONG);
    const panel = await buildThenInteract(page);

    await panel.getByRole("button", { name: /^initialize/ }).click(LONG);
    await panel.getByRole("button", { name: "Fill with Random" }).click();
    const send = panel.getByRole("button", { name: "Send" });
    await expect(send).toBeEnabled(LONG);
    const fill = panel.getByRole("button", { name: "Fill with Random" });
    const reset = panel.getByRole("button", { name: "Reset" });
    // Idle, the narrower label's text sits in the middle of the wider cell,
    // not at its start: the stacked labels keep the button's own centring.
    // Measured on the text itself, since its layer spans the whole cell
    const offCentre = await send.evaluate((button) => {
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && text.textContent !== "Send") text = walker.nextNode();
      if (!text) throw new Error("Send has no label text");
      const range = document.createRange();
      range.selectNodeContents(text);
      const label = range.getBoundingClientRect();
      const box = button.getBoundingClientRect();
      return label.left + label.width / 2 - (box.left + box.width / 2);
    });
    expect(Math.abs(offCentre)).toBeLessThan(1);

    const stop = await recordEdges(page, [send, fill, reset]);
    expect(held).toEqual([]);
    await send.click();
    // Busy, its name is the label it shows
    await expect(
      panel.getByRole("button", { name: "Sending…", exact: true })
    ).toHaveAttribute("aria-busy", "true");
    await waitForBusyFrames(page);
    // Send is busy because its own call is held on the cluster
    await expect.poll(() => held.length).toBeGreaterThan(0);
    release();
    await expect(send).not.toHaveAttribute("aria-busy", "true", LONG);
    expectHeldStill(await stop());
  });

  test("Interact keeps a long instruction name inside the form's column", async ({
    seededPage: page,
  }) => {
    const longName = "initialize_".repeat(12) + "account";
    await stubProgramAccount(page, DEPLOYED_ACCOUNT);
    const panel = await buildThenInteract(page, {
      version: IDL.version,
      name: IDL.name,
      instructions: [
        { name: longName, accounts: [], args: [] },
        { name: "increment", accounts: [], args: [] },
      ],
    });

    const card = panel.getByRole("button", {
      name: new RegExp(`^${longName}`),
    });
    await expect(card).toBeVisible(LONG);
    const nameBox = await card
      .getByText(longName, { exact: true })
      .boundingBox();
    const cardBox = await card.boundingBox();
    if (!nameBox || !cardBox) {
      throw new Error("the instruction card or its name has no box");
    }
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width + 0.5
    );
  });

  // The stage at its 240 px minimum, less the scrollbar gutter on both
  // edges: Upload IDL, the IDL's name and "Build the IDL locally" on one
  // centred row lost both ends. Reached on this spec's 1920 px window with
  // the assistant widened to its 560 px maximum (the code area still wide
  // enough, 1100 px, for the docked tree) and the files column dragged as
  // wide as the stage allows
  test("Interact keeps its IDL actions inside a narrow stage", async ({
    seededPage: page,
  }) => {
    await page.getByRole("button", { name: "Widen the assistant" }).click();
    const handle = page.locator(
      '[data-slot="resizable-handle"][aria-controls="files"]'
    );
    const handleBox = requireFor("the files column's handle box")(
      await handle.boundingBox()
    );
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + 900,
      handleBox.y + handleBox.height / 2,
      { steps: 10 }
    );
    await page.mouse.up();
    // eslint-disable-next-line unicorn/no-null -- the cluster's answer for an account that does not exist
    await stubProgramAccount(page, null);
    const panel = await buildThenInteract(page);
    await expect(
      panel.getByRole("heading", { name: "Nothing to call yet" })
    ).toBeVisible(LONG);

    // The frame's content box, inside its gutters, where it clips. Under
    // 300 px it cannot hold the two buttons side by side (about 270 px) with
    // the IDL's name, so the row must wrap; wider, the test no longer reaches
    // the case it guards
    const frame = await panel
      .locator("div.overflow-y-auto")
      .first()
      .evaluate((el) => {
        // `clientWidth` leaves out both gutters, half of the difference each
        const gutter = (el.offsetWidth - el.clientWidth) / 2;
        const left = el.getBoundingClientRect().left + gutter;
        return { left, right: left + el.clientWidth };
      });
    expect(frame.right - frame.left).toBeLessThan(300);
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    await expect(
      actions.getByRole("button", { name: "Build the IDL locally" })
    ).toBeVisible();
    // The buttons, and the IDL's name beside Upload IDL
    const parts = actions.getByRole("button").or(actions.getByRole("status"));
    for (const part of await parts.all()) {
      const partBox = requireFor("an action's bounding box")(
        await part.boundingBox()
      );
      expect(partBox.x).toBeGreaterThanOrEqual(frame.left - 0.5);
      expect(partBox.x + partBox.width).toBeLessThanOrEqual(frame.right + 0.5);
    }
  });
});

test.describe("client-v2-stages on a phone", () => {
  test("client-v2-stages: The Build action at the foot on a phone", async ({
    page,
  }) => {
    // The project tree lives in a closed Sheet on a phone, which the seeding
    // waits on, so seed on a desktop-sized page and narrow it afterwards
    await page.setViewportSize(DESK);
    await seedWorkspace(page);
    await page.setViewportSize(PHONE);
    // The stage tabs are on the preview page, inert while Work shows
    await openPhonePreview(page);

    await page.locator("#flow-stage-tab-build").click();
    const panel = page.locator("#flow-stage-panel-build");
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    await expect(actions.getByRole("button", { name: /^Build$/ })).toBeVisible(
      LONG
    );

    const panelBox = requireFor("the panel's bounding box")(
      await panel.boundingBox()
    );
    const actionsBox = requireFor("the actions' bounding box")(
      await actions.boundingBox()
    );
    const gap =
      panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(32);
  });

  /** Deploy's stage is the longest: its result, history and drop zone */
  test("client-v2-stages: The Deploy action at the foot on a phone", async ({
    page,
  }) => {
    await page.setViewportSize(DESK);
    await seedWorkspace(page);
    await page.evaluate(
      ([programId, at]) =>
        localStorage.setItem(
          "flow.deploys",
          JSON.stringify([
            {
              id: "e2e-deploy",
              workspace: "e2e-project",
              cluster: "devnet",
              programId,
              signature: null,
              at,
            },
          ])
        ),
      [PROGRAM_ID, Date.now()] as const
    );
    await page.reload();
    // The explorer back: at 1280 the tree is not on the page (its dropdown
    // is closed), so the editor's tab says it
    await expect(page.locator("#tabs")).toContainText("lib.rs", LONG);
    await page.setViewportSize(PHONE);
    await openPhonePreview(page);

    await page.locator("#flow-stage-tab-deploy").click();
    const panel = page.locator("#flow-stage-panel-deploy");
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    // Nothing is built in this page, so the pill is Go to Build
    await expect(
      actions.getByRole("button", { name: "Go to Build" })
    ).toBeVisible(LONG);

    const panelBox = requireFor("the panel's bounding box")(
      await panel.boundingBox()
    );
    const actionsBox = requireFor("the actions' bounding box")(
      await actions.boundingBox()
    );
    const gap =
      panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(32);
  });

  test("client-v2-stages: The Interact action at the foot on a phone", async ({
    page,
  }) => {
    await page.setViewportSize(DESK);
    await seedWorkspace(page);
    await stubProgramAccount(page, null);
    await page.setViewportSize(PHONE);
    await openPhonePreview(page);

    const panel = await buildThenInteract(page);
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    await expect(
      actions.getByRole("button", { name: "Go to Deploy" })
    ).toBeVisible(LONG);

    const panelBox = requireFor("the panel's bounding box")(
      await panel.boundingBox()
    );
    const actionsBox = requireFor("the actions' bounding box")(
      await actions.boundingBox()
    );
    const gap =
      panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(32);
    // The row's fade starts from the colour behind it, so no band shows
    const [fadeFrom, behind] = await actions.evaluate((el) => {
      let under = el.parentElement;
      while (
        under &&
        getComputedStyle(under).backgroundColor === "rgba(0, 0, 0, 0)"
      ) {
        under = under.parentElement;
      }
      const fade = getComputedStyle(el).backgroundImage;
      return [
        /rgb\([^)]*\)/.exec(fade)?.[0],
        under && getComputedStyle(under).backgroundColor,
      ];
    });
    expect(fadeFrom).toBe(behind);
    // A long program id or meta line scrolls inside the stage, never the page
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(PHONE.width);
  });
});

/** The search field, where the Interact stage's values are picked */
test.describe("client-v2-search-field", () => {
  test("client-v2-search-field: Random fills an instruction value", async ({
    seededPage: page,
  }) => {
    await stubProgramAccount(page, DEPLOYED_ACCOUNT);
    const panel = await buildThenInteract(page);
    await panel.getByRole("button", { name: /^initialize/ }).click();

    // Reached by its id: `updateRefs` (InstructionInput) finds dependent
    // inputs by it, so SearchBar must keep it
    const amount = panel.locator("#initializeargsamount");
    // A number's one pick is Random, a button in the field with no list
    await amount
      .locator("xpath=..")
      .getByRole("button", { name: "Random" })
      .click();
    await expect(amount).toHaveValue(/^\d+$/);
  });

  test("client-v2-search-field: An address that is not a public key", async ({
    seededPage: page,
  }) => {
    await stubProgramAccount(page, DEPLOYED_ACCOUNT);
    const panel = await buildThenInteract(page);
    await panel.getByRole("button", { name: "Counter" }).click();

    // Account's address field offers nothing to pick, so it is a textbox
    const address = panel.getByRole("textbox").last();
    await address.fill("not-a-key");
    await expect(address).toHaveAttribute("aria-invalid", "true");
  });
});
