import { expect, test } from "./fixtures";

test.describe("on a 1440 px window", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("client-v2-failure-states: An unmapped build failure opens the log", async ({
    seededPage: page,
  }) => {
    test.setTimeout(120_000);
    // The server answers with an error the product does not map: ANY-00
    await page.route("**/build", (route) =>
      route.fulfill({ status: 500, body: "boom" })
    );
    const drawer = page.getByRole("button", { name: "Terminal", exact: true });
    if ((await drawer.getAttribute("aria-expanded")) === "true") {
      await drawer.click();
    }
    await expect(drawer).toHaveAttribute("aria-expanded", "false");
    await page.locator("#flow-stage-tab-build").click();
    await page.getByRole("button", { name: "Build", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Could not build." })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Show details" })
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Show full log" }).click();
    await expect(drawer).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".xterm-rows").first()).toContainText(
      /Server request failed/
    );
  });
});
