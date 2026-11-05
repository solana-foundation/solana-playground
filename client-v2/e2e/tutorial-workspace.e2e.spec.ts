/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type { Page } from "@playwright/test";

import {
  expect,
  LONG,
  streamed,
  stubAiStatus,
  stubSession,
  test,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/** The workspace's head, over the editor in the tutorial frame */
const head = (page: Page) => page.getByTestId("tutorial-workspace-head");
/** The active tab's chevron, the tree's way in from beside the file's name */
const chevron = (page: Page) =>
  head(page)
    .getByRole("button", { name: "Files", expanded: false })
    .or(head(page).getByRole("button", { name: "Files", expanded: true }));

/** Monaco's own text field, focused when the editor has focus */
const editorInput = (page: Page) =>
  page.locator(".monaco-editor textarea.inputarea");

/** The open file's text: shown once the editor listens for opens and focus */
const openFileLines = (page: Page) =>
  page.locator(".monaco-editor .view-lines");

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

/**
 * Hello Anchor's tree holds a Docs folder: its own pages, or, should it list
 * none, the test pages a dev server started with `TUTORIAL_TEST_DOCS` gives
 * it (a reused `yarn dev` does not)
 */
const expectDocs = async (page: Page) => {
  await chevron(page).click();
  await expect(
    page.getByRole("tree", { name: "Files" }).getByRole("treeitem", {
      name: "Docs",
    }),
    "no Docs folder: Hello Anchor lists no doc pages, and the dev server was not started with TUTORIAL_TEST_DOCS=1 (playwright.config.mts)"
  ).toBeVisible();
  await page.keyboard.press("Escape");
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
    await expect(openFileLines(page)).toContainText("use anchor_lang");
    await page.keyboard.press("Enter");
    await expect(tree).toBeHidden();
    await expect(
      head(page).getByRole("tab", { name: "lib.rs" })
    ).toHaveAttribute("aria-selected", "true");
    await expect(editorInput(page)).toBeFocused();
  });

  // Starting a step writes its start files and opens the step's file again,
  // whenever that lands: the event stands in for it, so it always lands here
  test("keeps the tree open when an open nobody asked for lands", async ({
    page,
  }) => {
    await startHelloAnchor(page);
    await expect(openFileLines(page)).toContainText("use anchor_lang");
    await chevron(page).click();
    const libRs = page
      .getByRole("tree", { name: "Files" })
      .getByRole("treeitem", { name: /lib\.rs/ });
    await expect(libRs).toBeFocused();

    await page.evaluate(() =>
      document.dispatchEvent(
        new CustomEvent("explorerondidopenfile", {
          detail: { path: "/Hello Anchor/src/lib.rs", content: "" },
        })
      )
    );
    // The editor would have taken focus by now, closing the tree
    await page.waitForTimeout(500);
    await expect(libRs).toBeFocused();
    await expect(chevron(page)).toHaveAttribute("aria-expanded", "true");
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

  // The scenario reads "on step 2"; step 1 holds the same head, and getting
  // past it takes a real build. What it proves is the link, not the step
  test("tutorial-workspace: A doc from the assistant's answer", async ({
    page,
  }) => {
    const lines = linesOn(page);
    await stubSession(page);
    // A hosted model, whatever the dev server is configured with
    await stubAiStatus(page, "test-model");
    await page.route("**/api/agent", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: streamed(
          "The [IDL](https://www.anchor-lang.com/docs/basics/idl) lists `hello` and its arguments."
        ),
      })
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/tutorials/hello-anchor");
    const chat = page.getByRole("complementary", { name: "Tutorial chat" });
    await chat.getByRole("button", { name: /Start step 1/ }).click(LONG);
    await expect(head(page)).toBeVisible(LONG);
    await expectDocs(page);

    const composer = chat.getByRole("textbox");
    await composer.fill("what is the IDL?");
    await composer.press("Enter");
    // With no model picked yet, the question opens Connect a model first;
    // whichever comes, it is waited for
    const dialog = page.getByRole("dialog", { name: "Connect a model" });
    const link = chat.getByRole("link", { name: "IDL" });
    await expect(dialog.or(link)).toBeVisible(LONG);
    if (await dialog.isVisible()) {
      await dialog.getByRole("button", { name: "Start", exact: true }).click();
      await expect(dialog).toBeHidden(LONG);
      await composer.press("Enter");
    }

    // The page never opens by itself; the link opens it, beside lib.rs
    await expect(link).toBeVisible(LONG);
    await expect(head(page).getByRole("tab", { name: "IDL" })).toHaveCount(0);
    // One underline on hover: the link's own border, which runs under its icon
    await link.hover();
    await expect(link).toHaveCSS("text-decoration-line", "none");
    await link.click();
    const tab = head(page).getByRole("tab", { name: "IDL" });
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(head(page).getByRole("tab")).toHaveText(["lib.rs", "IDL"]);
    const doc = page.getByTestId("tutorial-doc-page");
    await expect(
      doc.getByRole("heading", { name: "Program IDL File", exact: true })
    ).toBeVisible();
    await expect(
      doc.getByRole("link", { name: /Open on anchor-lang\.com/ })
    ).toHaveAttribute("href", "https://www.anchor-lang.com/docs/basics/idl");
    // Read only: the page is Markdown, not an editor
    await expect(doc.getByRole("textbox")).toHaveCount(0);
    await expect
      .poll(() => lineOf(lines, "tutorial_workspace_doc_opened"))
      .toContain("via: assistant");

    await head(page).getByRole("button", { name: "Close IDL" }).click();
    await expect(tab).toHaveCount(0);
    await expect(doc).toHaveCount(0);
    await expect(
      head(page).getByRole("tab", { name: "lib.rs" })
    ).toHaveAttribute("aria-selected", "true");
  });

  test("a doc opens from the tree's Docs folder and stays open across a reload", async ({
    page,
  }) => {
    const lines = linesOn(page);
    await startHelloAnchor(page);
    await expectDocs(page);
    await chevron(page).click();
    const tree = page.getByRole("tree", { name: "Files" });
    await tree
      .getByRole("treeitem", { name: "Docs" })
      .getByRole("treeitem", { name: "Programs" })
      .click();
    await expect(tree).toBeHidden();
    await expect(
      head(page).getByRole("tab", { name: "Programs" })
    ).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => lineOf(lines, "tutorial_workspace_doc_opened"))
      .toContain("via: tree");
    expect(lineOf(lines, "tutorial_workspace_doc_opened")).toContain(
      "doc: programs.md"
    );
    // The editor under the page takes no focus until a file is in front
    await expect(
      page.locator("[inert]").filter({ has: page.locator(".monaco-editor") })
    ).toHaveCount(1);

    // A second page opens at its top, wherever the first was scrolled to
    const body = page
      .getByTestId("tutorial-doc-page")
      .locator(".overflow-y-auto");
    await body.evaluate((el) => el.scrollTo(0, 600));
    // With a page in front no file tab carries the tree's chevron
    await page.keyboard.press("ControlOrMeta+e");
    await tree
      .getByRole("treeitem", { name: "Docs" })
      .getByRole("treeitem", { name: "Transactions" })
      .click();
    await expect(
      head(page).getByRole("tab", { name: "Transactions" })
    ).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(0);

    // A pick of lib.rs from the tree brings the editor back with focus, though
    // it was inert under the page when the pick asked for it
    await page.keyboard.press("ControlOrMeta+e");
    await tree.getByRole("treeitem", { name: /lib\.rs/ }).click();
    await expect(page.getByTestId("tutorial-doc-page")).toHaveCount(0);
    await expect(editorInput(page)).toBeFocused();

    // Back to lib.rs by its tab: the page keeps its tab
    await head(page).getByRole("tab", { name: "Programs" }).click();
    await expect(page.getByTestId("tutorial-doc-page")).toHaveCount(1);
    await head(page).getByRole("tab", { name: "lib.rs" }).click();
    await expect(page.getByTestId("tutorial-doc-page")).toHaveCount(0);
    await expect(
      page.locator("[inert]").filter({ has: page.locator(".monaco-editor") })
    ).toHaveCount(0);
    await expect(head(page).getByRole("tab")).toHaveText([
      "lib.rs",
      "Programs",
      "Transactions",
    ]);

    // A reload brings back the tabs, and the page that was in front
    await head(page).getByRole("tab", { name: "Transactions" }).click();
    await page.reload();
    await expect(head(page)).toBeVisible(LONG);
    await expect(head(page).getByRole("tab")).toHaveText([
      "lib.rs",
      "Programs",
      "Transactions",
    ]);
    await expect(
      head(page).getByRole("tab", { name: "Transactions" })
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page
        .getByTestId("tutorial-doc-page")
        .getByRole("heading", { name: "Transactions", level: 1 })
    ).toBeVisible();

    // and a page closed from the front leaves the code in front for good
    await head(page)
      .getByRole("button", { name: "Close Transactions" })
      .click();
    await page.reload();
    await expect(head(page)).toBeVisible(LONG);
    await expect(
      head(page).getByRole("tab", { name: "lib.rs" })
    ).toHaveAttribute("aria-selected", "true");
  });
});
