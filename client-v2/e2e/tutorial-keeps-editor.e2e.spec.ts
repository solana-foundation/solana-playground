import type { Page } from "@playwright/test";

import { currentProject, expect, LONG, projectRow, test } from "./fixtures";

/** The line the cursor is on and the first line in view */
interface EditorPlace {
  cursor: number;
  firstInView: number;
}

/**
 * Where the editor stands, as the user sees it. Read from the gutter, which
 * numbers only the lines Monaco draws.
 */
const editorPlace = (page: Page): Promise<EditorPlace> =>
  page.locator(".monaco-editor").evaluate((editor) => {
    const top = editor.getBoundingClientRect().top;
    const inView = Array.from(
      editor.querySelectorAll<HTMLElement>(".margin .line-numbers")
    )
      .filter((n) => n.getBoundingClientRect().bottom > top + 1)
      .map((n) => Number(n.textContent));
    return {
      cursor: Number(
        editor.querySelector(".margin .line-numbers.active-line-number")
          ?.textContent
      ),
      firstInView: Math.min(...inView),
    };
  });

/** Reads the place until two reads agree: the wheel scrolls smoothly */
const settledPlace = async (page: Page) => {
  let last = "";
  let place = await editorPlace(page);
  await expect
    .poll(async () => {
      last = JSON.stringify(place);
      place = await editorPlace(page);
      return JSON.stringify(place) === last;
    })
    .toBe(true);
  return place;
};

const navItem = (page: Page, name: string) =>
  page
    .locator('[data-slot="sidebar"]')
    .getByRole("button", { name, exact: true });

// HOO-2731: the first entry into a tutorial makes its workspace, and making a
// workspace used to drop the open project's saved cursor and top line, so the
// way back opened the file at line 1
test("entering and leaving a tutorial keeps the editor's place", async ({
  seededPage: page,
}) => {
  test.setTimeout(120_000);
  // Short, so the starter's lib.rs scrolls
  await page.setViewportSize({ width: 1440, height: 520 });
  // No default backend, whatever the dev server is configured with
  await page.route("**/api/agent", (route) =>
    // eslint-disable-next-line unicorn/no-null -- the endpoint answers JSON, where "no model" is null
    route.fulfill({ json: { configured: false, model: null } })
  );
  // The editor also writes its metadata to disk every 5 s while the window
  // has focus (`Editor.tsx`). A tick between moving the cursor and entering
  // the tutorial would save the place by itself, and the test would pass
  // without the save on creating a workspace that it is about
  await page.evaluate(() => {
    document.hasFocus = () => false;
  });

  await page.locator(".monaco-editor .view-lines").click();
  // The top of the file: ⌘↑ on a Mac, Ctrl+Home elsewhere, where Ctrl+↑
  // scrolls instead
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home"
  );
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
  const lineHeight = await page
    .locator(".monaco-editor .view-line")
    .first()
    .evaluate((line) => line.getBoundingClientRect().height);
  await page.locator(".monaco-editor").hover();
  await page.mouse.wheel(0, lineHeight * 3);
  const before = await settledPlace(page);
  expect(before.cursor).toBe(13);
  expect(before.firstInView).toBeGreaterThan(1);
  // The editor saves its place on a one-second interval, in memory, where the
  // page cannot see it: wait out two ticks
  await page.waitForTimeout(2000);

  await navItem(page, "Tutorials").click();
  await page.getByRole("button", { name: "Open Hello Anchor" }).click();
  await expect(
    page.getByRole("complementary", { name: "Tutorial chat" })
  ).toBeVisible(LONG);

  // The frame folds the navigation to its rail, which lists no projects
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await projectRow(page, "e2e-project").click();
  await expect(currentProject(page)).toHaveText("e2e-project", LONG);

  // The cursor exactly. The editor saves the first line Monaco counts in
  // view, and a line only partly in view brings the next one back to the
  // top: the scroll is kept to within that line
  await expect
    .poll(async () => {
      const after = await editorPlace(page);
      return (
        after.cursor === before.cursor &&
        after.firstInView >= before.firstInView &&
        after.firstInView <= before.firstInView + 1
      );
    }, LONG)
    .toBe(true);
});
