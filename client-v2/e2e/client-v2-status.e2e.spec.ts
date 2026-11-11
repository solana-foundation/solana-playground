import type { Page } from "@playwright/test";

// The agent feature's other public entry: Playwright compiles `index.ts` as
// CommonJS, and the telemetry it re-exports holds `import.meta.vitest` blocks
import {
  DAILY_CAP_REASON,
  POOL_EXHAUSTED_REASON,
  REFUSAL_MESSAGES,
  REFUSAL_STATUS,
} from "../src/features/agent/server.mjs";
import {
  consoleTrigger,
  expect,
  json,
  LONG,
  runInTerminal,
  seedWorkspace,
  startProject,
  stubAiStatus,
  stubSession,
  test,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";
import { DESK, PHONE, TABLET, waitForPhonePage, WIDE_DESK } from "./viewports";

/** The stock Sidebar, which holds the navigation and its foot */
const nav = (page: Page) => page.locator('[data-slot="sidebar"]');
const row = (page: Page) => page.getByTestId("status-row");

const network = (page: Page) =>
  row(page).getByRole("button", { name: /^Change cluster, currently devnet/ });
const ai = (page: Page) => row(page).getByRole("button", { name: /^AI, / });
const rust = (page: Page) =>
  row(page).getByRole("button", { name: /^Rust analyzer/ });
const notice = (page: Page) => page.getByTestId("stage-notice");
/** The live region's own element: other status regions sit in the page */
const region = (page: Page) => page.locator("output.sr-only");

const OFFLINE_LINE =
  "You're offline. Editing still works. Build, Deploy and the assistant need a connection.";

/**
 * Devnet answers `getSlot` with one slot that never moves: down by
 * `PgConnection.getIsClusterDown`, which reads the slot twice a second apart
 */
const stallDevnet = (page: Page) =>
  page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as {
      id?: unknown;
      method?: string;
    } | null;
    if (body?.method !== "getSlot") return route.continue();
    return json(route, { jsonrpc: "2.0", result: 123, id: body.id });
  });

/**
 * On top of `stallDevnet`: every other devnet call is left unanswered, so the
 * program's on-chain check never comes back. A cluster this slow is what made
 * the restored build verdict wait on it (HOO-2744).
 */
const holdDevnetCalls = (page: Page) =>
  page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as {
      method?: string;
    } | null;
    if (body?.method === "getSlot") return route.fallback();
    // Never answered: the page sees a request that is still in flight
  });

test.describe("on a 1440 px window", () => {
  test.use({ viewport: WIDE_DESK });

  test("client-v2-status: Three indicators in one pattern", async ({
    seededPage: page,
  }) => {
    for (const indicator of [network(page), ai(page), rust(page)]) {
      await expect(indicator).toBeVisible();
      await expect(indicator.locator('[data-slot="status-dot"]')).toHaveCount(
        1
      );
    }
    await expect(network(page)).toContainText("Devnet");
    await expect(rust(page)).toContainText("Rust");
  });

  test("client-v2-status: No model connected", async ({ seededPage: page }) => {
    const lines = linesOn(page);
    await expect(ai(page)).toHaveText("AI · Off");
    await ai(page).click();
    await expect(
      page.getByRole("dialog", { name: "Connect a model" })
    ).toBeVisible();
    await expect
      .poll(() => lineOf(lines, "assistant_connect_opened"))
      .toContain("{via: status}");
  });

  test("client-v2-status: Picking an indicator is measured", async ({
    seededPage: page,
  }) => {
    const lines = linesOn(page);
    await ai(page).click();
    await expect
      .poll(() => lineOf(lines, "status_indicator_picked"))
      // No model is grey (`idle`), which is measured as ready
      .toContain("{indicator: ai, state: ready, from: row}");
  });

  test("client-v2-status: A cluster that stops answering", async ({
    seededPage: page,
  }) => {
    await stallDevnet(page);
    await page.reload();

    const down = row(page).getByRole("button", {
      name: "Change cluster, currently devnet, not responding",
    });
    await expect(down).toHaveText("Devnet · Not responding", {
      timeout: 15_000,
    });
    // Waiting, not broken: the offline notice's warning colour, not red
    await expect(down.locator('[data-slot="status-dot"]')).toHaveAttribute(
      "data-variant",
      "warning"
    );
    const lines = linesOn(page);
    // A cluster that does not answer opens a panel that can ask it again
    await down.click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Network", { exact: true })).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Try again" })
    ).toBeVisible();
    await panel.getByRole("button", { name: "Change network" }).click();
    await expect
      .poll(() => lineOf(lines, "settings_opened"))
      .toContain("{from: cluster}");
    const networks = page
      .getByRole("region", { name: "Settings" })
      .getByRole("radiogroup", { name: "Network" });
    await expect(networks).toBeVisible();
    // The closing panel's focus return does not take it back from the field
    await expect(networks.getByRole("radio", { checked: true })).toBeFocused();
  });

  test("client-v2-status: The hosted model does not answer", async ({
    seededPage: page,
  }) => {
    let failing = true;
    await stubAiStatus(page, "own");
    // Registered last, so it sees each request first and hands it to the stub
    await page.route("**/api/ai/status", (route) => {
      if (failing) return route.fulfill({ status: 500, body: "down" });
      return route.fallback();
    });
    await page.reload();

    const down = row(page).getByRole("button", { name: "AI, not responding" });
    await expect(down).toHaveText("AI · Not responding", LONG);
    await expect(down.locator('[data-slot="status-dot"]')).toHaveAttribute(
      "data-variant",
      "error"
    );
    const lines = linesOn(page);
    await down.click();
    const panel = page.getByRole("dialog");
    await expect(
      panel.getByRole("button", { name: "Add an API key" })
    ).toBeVisible();
    // Still down: the press says so, and the panel stays to press it again
    await panel.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByText("Could not reach the hosted model.")
    ).toBeVisible();
    await expect
      .poll(() => lineOf(lines, "status_retried"))
      .toContain("{indicator: ai, from: row, answered: false}");
    failing = false;
    await panel.getByRole("button", { name: "Try again" }).click();
    await expect(ai(page)).toHaveText("AI · Off");
    await expect
      .poll(() => lines.join("\n"))
      .toContain("{indicator: ai, from: row, answered: true}");
  });

  test("client-v2-status: Going offline and back", async ({
    seededPage: page,
  }) => {
    const before = await rust(page).textContent();
    await page.context().setOffline(true);
    await expect(network(page)).toHaveText("Devnet · Offline");
    await expect(ai(page)).toHaveText("AI · Offline");
    await expect(rust(page)).toHaveText("Rust · Offline");
    await page.context().setOffline(false);
    await expect(network(page)).not.toContainText("Offline");
    await expect(ai(page)).toHaveText("AI · Off");
    await expect(rust(page)).not.toContainText("Offline");
    expect(before).not.toContain("Offline");
  });

  test("client-v2-status: Offline shows one line over the stage", async ({
    seededPage: page,
  }) => {
    const lines = linesOn(page);
    await page.locator("#flow-stage-tab-build").click();
    const build = page.getByRole("button", { name: "Build", exact: true });
    await expect(build).toBeEnabled();
    await expect(notice(page)).toHaveCount(0);

    await page.context().setOffline(true);
    await expect(notice(page).getByRole("alert")).toHaveText(OFFLINE_LINE);
    await expect(build).toBeDisabled();
    await expect
      .poll(() => lineOf(lines, "status_notice_shown"))
      .toContain("{notice: offline}");

    await page.context().setOffline(false);
    await expect(notice(page)).toHaveCount(0);
    await expect(build).toBeEnabled();
  });

  test("client-v2-status: A notice is measured once per onset", async ({
    seededPage: page,
  }) => {
    const lines = linesOn(page);
    const shown = () =>
      lines.filter((line) =>
        line.startsWith("[telemetry:event] status_notice_shown ")
      );
    await page.locator("#flow-stage-tab-build").click();
    await page.context().setOffline(true);
    await expect(notice(page)).toBeVisible();
    await page.locator("#flow-stage-tab-deploy").click();
    await page.locator("#flow-stage-tab-build").click();
    await expect(notice(page)).toBeVisible();
    await expect.poll(() => shown().length).toBe(1);
    expect(shown()[0]).toContain("{notice: offline}");
    await page.context().setOffline(false);
  });

  test("client-v2-status: Offline, a stage not loaded yet keeps the app up", async ({
    seededPage: page,
  }) => {
    await page.context().setOffline(true);
    await expect(notice(page).getByRole("alert")).toHaveText(OFFLINE_LINE);
    await page.locator("#flow-stage-tab-deploy").click();

    const panel = page.locator("#flow-stage-panel-deploy");
    await expect(panel.getByText("Deploy needs a connection")).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Try again" })
    ).toBeVisible();

    // The editor is still there, and the stage loads when the network returns
    await page.locator("#flow-stage-tab-write").click();
    await expect(page.locator("#flow-stage-panel-write")).toBeVisible();
    await page.locator("#flow-stage-tab-deploy").click();
    await expect(panel.getByText("Deploy needs a connection")).toBeVisible();
    await page.context().setOffline(false);
    await expect(panel.getByText("Deploy needs a connection")).toHaveCount(0);
    await expect(panel.getByRole("heading").first()).toBeVisible();
  });

  test("client-v2-status: A stage whose code is gone points to a reload", async ({
    seededPage: page,
  }) => {
    // A new release removes the old hashed files: the chunk answers 404
    const chunks = "**/static/js/*.js";
    await page.route(chunks, (route) => route.fulfill({ status: 404 }));
    await page.locator("#flow-stage-tab-deploy").click();

    const panel = page.locator("#flow-stage-panel-deploy");
    await expect(panel.getByText("Deploy couldn't load")).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Reload page" })
    ).toBeVisible();

    await panel.getByRole("button", { name: "Try again" }).click();
    await expect(
      panel.getByText("Reload the page to get the latest version.")
    ).toBeVisible();

    await page.unroute(chunks);
    await panel.getByRole("button", { name: "Try again" }).click();
    await expect(panel.getByText("Deploy couldn't load")).toHaveCount(0);
    await expect(panel.getByRole("heading").first()).toBeVisible();
  });

  test("client-v2-status: A cluster that does not answer on Deploy", async ({
    seededPage: page,
  }) => {
    await stallDevnet(page);
    await page.reload();
    await expect(
      row(page).getByRole("button", {
        name: "Change cluster, currently devnet, not responding",
      })
    ).toBeVisible({ timeout: 15_000 });
    // Build does not wait for the cluster: no line there
    await page.locator("#flow-stage-tab-build").click();
    await expect(notice(page)).toHaveCount(0);

    await page.locator("#flow-stage-tab-deploy").click();
    await expect(notice(page).getByRole("alert")).toContainText(
      "Devnet is not responding. Try again, or change the network."
    );
    // The cluster recovers; Try again asks it now, and the line clears
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await notice(page).getByRole("button", { name: "Try again" }).click();
    await expect(notice(page)).toHaveCount(0, { timeout: 15_000 });
  });

  test("client-v2-status: The cluster does not answer", async ({
    seededPage: page,
  }) => {
    await page.route("**/build", (route) =>
      // eslint-disable-next-line unicorn/no-null -- the build server's own answer
      json(route, { stderr: "", uuid: null, idl: null })
    );
    await page.locator("#flow-stage-tab-build").click();
    const build = page.locator("#flow-stage-panel-build");
    await build.getByRole("button", { name: /^Build$/ }).click();
    await expect(
      build.getByRole("heading", { name: "Build succeeded" })
    ).toBeVisible({ timeout: 60_000 });

    await stallDevnet(page);
    await holdDevnetCalls(page);
    await page.reload();
    await expect(region(page)).toHaveText("Devnet, not responding", {
      timeout: 15_000,
    });
    // On Deploy the notice says it, and the pill waits with the same reason
    await page.locator("#flow-stage-tab-deploy").click();
    await expect(notice(page).getByRole("alert")).toBeVisible();
    const pill = page.getByRole("button", { name: /Deploy to devnet/ });
    await expect(pill).toBeDisabled();
    await expect(pill).toHaveAttribute("title", "Devnet is not responding");
  });

  test("client-v2-status: The notice says it already", async ({
    seededPage: page,
  }) => {
    await page.locator("#flow-stage-tab-build").click();
    await page.context().setOffline(true);
    await expect(notice(page).getByRole("alert")).toHaveText(OFFLINE_LINE);
    await expect(region(page)).toHaveText("");
    await page.context().setOffline(false);
  });

  test("client-v2-status: A deploy from elsewhere", async ({
    seededPage: page,
  }) => {
    await stallDevnet(page);
    await page.reload();
    await expect(network(page)).toContainText("Not responding", {
      timeout: 15_000,
    });
    const drawer = consoleTrigger(page);
    if ((await drawer.getAttribute("aria-expanded")) !== "true") {
      await drawer.click();
    }
    await runInTerminal(page, "deploy");
    await expect(page.locator(".xterm-rows").first()).toContainText(
      "Devnet is not responding. Deploy waits for the network."
    );
    await expect(page.locator("#flow-stage-tab-deploy")).not.toHaveAttribute(
      "aria-label",
      /failed/
    );
  });

  test("client-v2-status: The setup row warns while the cluster does not answer", async ({
    seededPage: page,
  }) => {
    const setupRow = page
      .getByRole("listitem")
      .filter({ hasText: "Choose a network" });
    await expect(setupRow).toHaveAttribute("data-status", "done");
    await stallDevnet(page);
    await page.reload();
    await expect(setupRow).toHaveAttribute("data-status", "warn", {
      timeout: 15_000,
    });
    await expect(setupRow).toHaveAttribute("title", "Devnet is not responding");
  });

  test("client-v2-status: Change network from the notice", async ({
    seededPage: page,
  }) => {
    await stallDevnet(page);
    await page.reload();
    await page.locator("#flow-stage-tab-deploy").click();
    const lines = linesOn(page);
    await notice(page)
      .getByRole("button", { name: "Change network" })
      .click({ timeout: 15_000 });
    await expect(
      page
        .getByRole("region", { name: "Settings" })
        .getByRole("radiogroup", { name: "Network" })
    ).toBeVisible();
    await expect
      .poll(() => lineOf(lines, "status_notice_action"))
      .toContain("{notice: cluster-down, action: change-network}");
  });
});

test("client-v2-status: The rail's dots", async ({ page }) => {
  await page.setViewportSize(DESK);
  await seedWorkspace(page);
  await page.setViewportSize(TABLET);
  const rail = nav(page).getByTestId("status-rail");
  await expect(
    rail.getByRole("button", { name: /^Cluster: devnet/ })
  ).toBeVisible();
  await expect(rail.getByRole("button", { name: /^AI, / })).toBeVisible();
  await expect(
    rail.getByRole("button", { name: /^Rust analyzer/ })
  ).toBeVisible();
  // The rail has no words, so each dot's tooltip says its state
  await rail.getByRole("button", { name: /^Cluster: devnet/ }).hover();
  await expect(page.getByRole("tooltip")).toHaveText(/^Devnet · /);
  const lines = linesOn(page);
  await rail.getByRole("button", { name: /^Cluster: devnet/ }).click();
  await expect
    .poll(() => lineOf(lines, "settings_opened"))
    .toContain("{from: rail}");
});

/**
 * Send a turn the hosted model refuses with `reason`, then open the AI
 * indicator's panel; returns the panel and Connect a model
 */
const refuseAndOpenAi = async (
  page: Page,
  reason: typeof DAILY_CAP_REASON | typeof POOL_EXHAUSTED_REASON
) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubAiStatus(page, "test-model");
  await page.route("**/api/agent", (route) =>
    route.fulfill({
      status: REFUSAL_STATUS[reason],
      contentType: "application/json",
      body: JSON.stringify({
        error: REFUSAL_MESSAGES[reason],
        reason,
        tier: "newcomer",
      }),
    })
  );
  await stubSession(page);
  await page.goto("/");
  await startProject(page, `status-${reason}`, LONG);
  const composer = page.getByRole("textbox", { name: "Message the assistant" });
  await expect(composer).toBeVisible(LONG);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Connect a model/ }).click();
  const connect = page.getByRole("dialog", { name: "Connect a model" });
  await connect.getByRole("button", { name: "Start", exact: true }).click(LONG);
  await expect(connect).toBeHidden(LONG);

  await composer.fill("a question");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(REFUSAL_MESSAGES[reason])).toBeVisible(LONG);

  const limited = row(page).getByRole("button", { name: "AI, limit reached" });
  await expect(limited).toHaveText("AI · Limit reached");
  await limited.click();
  return { panel: page.getByRole("dialog", { name: "AI" }), connect };
};

test("client-v2-status: The free daily limit is used", async ({ page }) => {
  test.setTimeout(240_000);
  const { panel, connect } = await refuseAndOpenAi(page, DAILY_CAP_REASON);
  await expect(
    panel.getByText(
      /^The free daily limit is used\. It comes back at \d\d:\d\d,/
    )
  ).toBeVisible();
  await panel.getByRole("button", { name: "Add an API key" }).click();
  await expect(connect).toBeVisible();
});

test("client-v2-status: The free pool is spent", async ({ page }) => {
  test.setTimeout(240_000);
  const { panel, connect } = await refuseAndOpenAi(page, POOL_EXHAUSTED_REASON);
  await expect(
    panel.getByText(
      "The free assistant is out of capacity for now. Try again later, or add a key of your own to keep going."
    )
  ).toBeVisible();
  await panel.getByRole("button", { name: "Add an API key" }).click();
  await expect(connect).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE });

  test("client-v2-status: The phone chip names what is down", async ({
    page,
  }) => {
    // No model alone is not a failure and is not counted: something has to
    // be down for the chip to name it
    await stallDevnet(page);
    // The seed waits on the tree a phone keeps in a closed Sheet
    await page.setViewportSize(DESK);
    await seedWorkspace(page);
    await page.setViewportSize(PHONE);

    const chip = page.getByTestId("status-chip");
    await expect(chip).toHaveAccessibleName("Status, 1 not ready", {
      timeout: 15_000,
    });
    await waitForPhonePage(page, "Work");
    expect((await chip.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await chip.click();

    const sheet = page.getByRole("dialog", { name: "Status" });
    await expect(sheet.locator("[data-status]")).toHaveCount(3);
    for (const name of ["Network", "AI", "Rust analyzer"]) {
      await expect(sheet.getByText(name, { exact: true })).toBeVisible();
    }
    const aiRow = sheet.locator('[data-status="ai"]');
    await expect(aiRow.getByText("Off", { exact: true })).toBeVisible();
    await aiRow.getByRole("button", { name: "Connect a model" }).click();
    await expect(
      page.getByRole("dialog", { name: "Connect a model" })
    ).toBeVisible();
  });

  test("client-v2-status: The phone chip reads Offline", async ({ page }) => {
    await page.setViewportSize(DESK);
    await seedWorkspace(page);
    await page.setViewportSize(PHONE);

    await page.context().setOffline(true);
    const chip = page.getByTestId("status-chip");
    await expect(chip).toHaveAccessibleName("Status, offline");
    await expect(chip).toContainText("Offline");
  });
});
