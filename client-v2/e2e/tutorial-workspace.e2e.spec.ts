import type { Page } from "@playwright/test";

import { LONG, expect, test } from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/** The workspace's head, over the editor in the tutorial frame */
const head = (page: Page) => page.getByTestId("tutorial-workspace-head");
/** The active tab's chevron, the tree's way in from beside the file's name */
const chevron = (page: Page) =>
  head(page)
    .getByRole("button", { name: "Files", expanded: false })
    .or(head(page).getByRole("button", { name: "Files", expanded: true }));

/**
 * Hello Anchor has a definition: opening it opens the frame on its intro
 * card, and the card's Start begins step 1
 */
const startHelloAnchor = async (page: Page) => {
  // No default backend, whatever the dev server is configured with
  await page.route("**/api/agent", (route) =>
    route.fulfill({ json: { configured: false, model: null } })
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tutorials/hello-anchor");
  await page
    .getByRole("complementary", { name: "Tutorial chat" })
    .getByRole("button", { name: /Start step 1/ })
    .click(LONG);
  await expect(head(page)).toBeVisible(LONG);
};

test.describe("tutorial-workspace", () => {
  test.setTimeout(120_000);

  test("the head holds file tabs that never close, then Files and Terminal", async ({
    page,
  }) => {
    await startHelloAnchor(page);
    await expect(head(page).getByRole("tab")).toHaveText(["lib.rs"]);
    await expect(
      head(page).getByRole("button", { name: /close/i })
    ).toHaveCount(0);
    await expect(
      head(page).getByRole("button", { name: /^(build|deploy|run)/i })
    ).toHaveCount(0);
    // The editor's own tab row is not drawn under the head
    await expect(page.getByRole("tablist")).toHaveCount(1);

    const terminal = head(page).getByRole("button", { name: "Terminal" });
    await expect(terminal).toHaveAttribute("aria-pressed", "false");
    await terminal.click();
    await expect(terminal).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("Nothing run yet. Builds, deploys and calls print here.")
    ).toBeVisible();
    await expect(page.locator("[data-console-status]")).toHaveText("Ready");
  });

  test("the tree opens from the active tab, picks with Enter and closes with Esc", async ({
    page,
  }) => {
    await startHelloAnchor(page);
    await chevron(page).click();
    await expect(chevron(page)).toHaveAttribute("aria-expanded", "true");
    const tree = page.getByRole("tree", { name: "Files" });
    await expect(tree).toBeVisible();
    // client.ts comes in step 3: listed, said so, and not to be picked
    const client = tree.getByRole("treeitem", { name: /client\.ts/ });
    await expect(client).toContainText("Created in step 3");
    await expect(client).toBeDisabled();
    await expect(tree.getByRole("treeitem", { name: /lib\.rs/ })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(tree).toBeHidden();
    await expect(chevron(page)).toBeFocused();

    // ⌘E opens it too, and Enter on lib.rs opens the file and closes it
    await page.keyboard.press("ControlOrMeta+e");
    await expect(tree).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(tree).toBeHidden();
    await expect(
      head(page).getByRole("tab", { name: "lib.rs" })
    ).toHaveAttribute("aria-selected", "true");
  });

  test("tutorial-workspace: Opening the tree with ⌘E", async ({ page }) => {
    const lines = linesOn(page);
    await startHelloAnchor(page);
    await page.keyboard.press("ControlOrMeta+e");
    await expect(page.getByRole("tree", { name: "Files" })).toBeVisible();
    await expect
      .poll(() => lineOf(lines, "tutorial_workspace_tree_opened"))
      .toContain("via: key");
  });
});
