import { expect, LONG, seedWorkspace, test } from "./fixtures";

/**
 * The scenarios of `client-v2-stages`: what the Build and Deploy stages
 * show, and where their action sits on a phone.
 */

/** What rustc prints for one type error, as the build server returns it */
const FAILED_BUILD_STDERR = [
  "error[E0308]: mismatched types",
  " --> src/lib.rs:5:9",
  "  |",
  '5 |     let x: u32 = "no";',
  "  |            ---   ^^^^ expected `u32`, found `&str`",
  "",
  "error: could not compile `e2e-project` (lib) due to 1 previous error",
].join("\n");

const PROGRAM_ID = "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj";

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
    await expect(
      diagnostic.getByRole("button", { name: "Fix with assistant" })
    ).toBeVisible();
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
    await expect(result.locator("code")).toHaveText(PROGRAM_ID);
    await expect(result.locator('[data-slot="copy-button"]')).toBeVisible();
  });
});

test.describe("client-v2-stages on a phone", () => {
  test("client-v2-stages: The Build action at the foot on a phone", async ({
    page,
  }) => {
    // The project tree lives in a closed Sheet on a phone, which the seeding
    // waits on, so seed on a desktop-sized page and narrow it afterwards
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.locator("#flow-stage-tab-build").click();
    const panel = page.locator("#flow-stage-panel-build");
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    await expect(actions.getByRole("button", { name: /^Build$/ })).toBeVisible(
      LONG
    );

    const panelBox = (await panel.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    const gap =
      panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(32);
  });

  /** Deploy's stage is the longest: its result, history and drop zone */
  test("client-v2-stages: The Deploy action at the foot on a phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
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
    await expect(page.locator("#root-dir")).toBeAttached(LONG);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.locator("#flow-stage-tab-deploy").click();
    const panel = page.locator("#flow-stage-panel-deploy");
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    await expect(
      actions.getByRole("button", { name: /Redeploy to devnet/ })
    ).toBeVisible(LONG);

    const panelBox = (await panel.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    const gap =
      panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(32);
  });
});
