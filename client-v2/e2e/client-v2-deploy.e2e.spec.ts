import { expect, LONG, test } from "./fixtures";
import { DOCK_DESK } from "./viewports";

// These tests drive the project tree as its docked column, which needs a code
// area of 1100 px or more; the default window is too narrow and shows the
// dropdown instead
test.use({ viewport: DOCK_DESK });

/**
 * The browser scenarios of `client-v2-deploy`. The rest of its scenarios
 * need a real devnet and are walked by hand (`(manual)` in the spec).
 */

const PROGRAM_ID = "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj";

test("client-v2-deploy: A devnet record viewed on testnet", async ({
  seededPage: page,
}) => {
  // Testnet is the selected network; its requests are refused, so CI never reaches
  // it: the cluster is read from the endpoint's URL, not from an answer
  await page.route("https://api.testnet.solana.com/**", (route) =>
    route.abort("connectionrefused")
  );
  await page.evaluate(
    ([programId, at]) => {
      const settings = JSON.parse(localStorage.getItem("settings") ?? "{}");
      settings.connection = settings.connection ?? {};
      settings.connection.endpoint = { option: "testnet" };
      localStorage.setItem("settings", JSON.stringify(settings));
      localStorage.setItem(
        "flow.deploys",
        JSON.stringify([
          {
            id: "e2e-deploy",
            workspace: "e2e-project",
            cluster: "devnet",
            programId,
            // eslint-disable-next-line unicorn/no-null -- `flow.deploys` persists `signature: null` for a deploy with no signature
            signature: null,
            at,
          },
        ])
      );
    },
    [PROGRAM_ID, Date.now()] as const
  );
  await page.reload();
  await expect(page.locator("#root-dir")).toBeVisible(LONG);

  await page.locator("#flow-stage-tab-deploy").click();
  const history = page
    .locator("#flow-stage-panel-deploy")
    .getByRole("region", { name: "History" });
  const link = history.getByRole("link", {
    name: `View deployment (${PROGRAM_ID}) on Explorer (Devnet)`,
  });
  await expect(link).toHaveText("Explorer (Devnet)", LONG);
  await expect(link).toHaveAttribute("href", /[?&]cluster=devnet(&|$)/);

  // The devnet deployment is not on testnet: the stage is empty here, with
  // no count and no result card, the network in the summary's row, and the
  // pill is no redeploy: Go to Build, since this project was never built
  const panel = page.locator("#flow-stage-panel-deploy");
  await expect(panel.locator('[data-slot="stage-empty-meta"]')).toHaveCount(0);
  await expect(panel.getByLabel("Network", { exact: true })).toContainText(
    "Testnet"
  );
  await expect(panel.getByText("Nothing deployed yet")).toBeVisible();
  await expect(
    panel.getByRole("status", { name: "Deploy result" })
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Go to Build" })
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Redeploy/ })).toHaveCount(0);
});
