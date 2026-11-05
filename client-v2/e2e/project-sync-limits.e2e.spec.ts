import type { Page, Route } from "@playwright/test";

import {
  applyWrite,
  currentProject,
  expect,
  json,
  LONG,
  projectMenu,
  projectRow,
  seedWorkspace,
  startProject,
  stubAiStatus,
  stubSession,
  test,
  TEST_USER,
} from "./fixtures";
import { linesOn } from "./telemetry";

/**
 * The limits a project is held to, seen from the browser: the sync banner a
 * project over one raises instead of uploading, and the explorer refusing to
 * create, rename or import past one.
 *
 * A project over a limit reaches the browser the one way the limits allow:
 * restored from the account, which is never refused. `/api/projects` is
 * stubbed with such rows. The server's own refusals are covered against a
 * real database in `api/projects.test.mjs` and `model/projects.test.mjs`,
 * and their scenarios are marked `(manual)` in the spec.
 */

test.describe.configure({ timeout: 180_000 });

type Files = Record<string, string>;
type Write = {
  id: string;
  files?: Files;
  changed?: Files;
  removed?: string[];
};
type Row = { id: string; name: string; files: Files };

const ROW_ID = "7c1d0e5c-2222-4222-8222-222222222222";
const OTHER_ID = "7c1d0e5c-3333-4333-8333-333333333333";
const NAME = "Limits";

const FILE_LIMIT = 128 * 1024;

/**
 * `bytes` of source in lines of 64 bytes, `bytes` a multiple of 64: one line
 * that long stalls the editor's tokenizer, which a real file never asks of it
 */
const sourceOf = (bytes: number) => `${"a".repeat(63)}\n`.repeat(bytes / 64);

/** `count` one-line files, `src/lib.rs` and `src/f1.rs` onward */
const manyFiles = (count: number, content = (i: number) => `// ${i}\n`) => {
  const files: Files = { "src/lib.rs": content(0) };
  for (let i = 1; i < count; i++) files[`src/f${i}.rs`] = content(i);
  return files;
};

/** `src/lib.rs` and `count` files of `bytes` each, `src/f1.rs` onward */
const bigFiles = (count: number, bytes: number) => {
  const files: Files = { "src/lib.rs": "// lib\n" };
  for (let i = 1; i <= count; i++) files[`src/f${i}.rs`] = sourceOf(bytes);
  return files;
};

/** The editor's text for the open file, off its model (dev-only hook) */
const openText = (page: Page) =>
  page.evaluate(
    async () =>
      (await (
        window as unknown as {
          __pgWorkspace?: { openText: () => Promise<string | null> };
        }
      ).__pgWorkspace?.openText()) ?? null
  );

/**
 * An account holding `rows`, the first of them the newest, so the one a
 * fresh browser opens; a file map is one row named `Limits`. It stores what
 * it is sent, or answers every PUT with `refuse` when given one.
 */
const stubAccount = async (
  page: Page,
  rows: Row[] | Files,
  refuse?: (r: Route) => Promise<void>
) => {
  const given = Array.isArray(rows)
    ? rows
    : [{ id: ROW_ID, name: NAME, files: rows }];
  const account = {
    rows: new Map(
      given.map((row, i) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          snapshot: { files: row.files },
          updatedAt: new Date(Date.UTC(2026, 9, 1) - i * 60_000).toISOString(),
        },
      ])
    ),
    writes: [] as Write[],
    deleted: [] as string[],
    /** Whether a write carried `marker` in `path` */
    sent: (path: string, marker: string) =>
      account.writes.some((w) =>
        (w.changed ?? w.files ?? {})[path]?.includes(marker)
      ),
  };

  await page.route("**/api/auth/get-session", (r) =>
    json(r, { user: TEST_USER })
  );
  await page.route("**/api/sync", (r) => json(r, { enabled: true, db: "ok" }));
  await page.route("**/api/conversations*", (r) => json(r, { items: [] }));
  await page.route("**/api/projects*", async (r) => {
    const req = r.request();
    const id = new URL(req.url()).searchParams.get("id");
    if (req.method() === "PUT") {
      const body: Write = req.postDataJSON();
      account.writes.push(body);
      if (refuse) return refuse(r);
      const held = account.rows.get(body.id);
      const updatedAt = new Date().toISOString();
      account.rows.set(body.id, {
        id: body.id,
        name: held?.name ?? body.id,
        snapshot: applyWrite(held?.snapshot, body),
        updatedAt,
      });
      return json(r, { updatedAt });
    }
    if (req.method() === "DELETE") {
      if (id) {
        account.deleted.push(id);
        account.rows.delete(id);
      }
      return json(r, { deleted: true });
    }
    if (!id) {
      return json(r, {
        projects: [...account.rows.values()].map((row) => ({
          id: row.id,
          name: row.name,
          kind: "project",
          updatedAt: row.updatedAt,
        })),
      });
    }
    const row = account.rows.get(id);
    return row
      ? json(r, {
          project: {
            id: row.id,
            name: row.name,
            kind: "project",
            updatedAt: row.updatedAt,
            snapshot: row.snapshot,
          },
        })
      : r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return account;
};

const editor = (page: Page) =>
  page.locator(".monaco-editor .view-lines").first();

const tree = (page: Page) => page.locator("#root-dir");

const inTree = (page: Page, name: string) =>
  tree(page).getByText(name, { exact: true });

const banner = (page: Page) => page.getByTestId("sync-banner");

const bannerText = (page: Page) => banner(page).locator("p");

const limitError = (page: Page) => page.getByTestId("explorer-limit-error");

/** A fresh browser signs in and the account's newest project opens */
const openRestored = async (page: Page, name = NAME) => {
  await page.goto("/");
  await expect(currentProject(page)).toContainText(name, LONG);
  await expect(editor(page)).toBeVisible(LONG);
  // The open file is `src/lib.rs`, so `src` is drawn expanded; clicking in
  // the tree before it is drawn would fold it
  await expect(inTree(page, "lib.rs")).toBeVisible(LONG);
};

/** Open a file from the tree and type at its end */
const editFile = async (page: Page, name = "lib.rs", text = "// edited") => {
  await inTree(page, name).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(`\n${text}`);
};

/** The New File input under `folder`, from the explorer's menu */
const newFileIn = async (page: Page, folder: string, name: string) => {
  await inTree(page, folder).click({ button: "right" });
  await page.getByRole("menuitem", { name: /New File/ }).click();
  const input = tree(page).getByRole("textbox");
  await expect(input).toBeFocused();
  await input.fill(name);
  await page.keyboard.press("Enter");
  return input;
};

/** The limit events the page sent, as their log lines */
const limitEvents = (lines: string[]) =>
  lines.filter((line) => /_limit_(exceeded|refused) /.test(line));

/**
 * Import `contents` from disk, through Settings. Each file is named `src…`
 * so the import's layout conversion keeps it as a program file; the first
 * marks the folder as a native program.
 */
const importFromDisk = async (page: Page, contents: string[]) => {
  await page.locator("[data-settings-trigger]").first().click();
  await page.getByRole("button", { name: "From files" }).click();
  const dialog = page.getByRole("dialog", { name: "Import project" });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles(
    contents.map((content, i) => ({
      name: `src${i}.rs`,
      mimeType: "text/plain",
      buffer: Buffer.from(
        i === 0 ? `entrypoint!(process);\n${content}` : content
      ),
    }))
  );
  await dialog.getByPlaceholder("my local project...").fill("from-disk");
  await dialog.getByRole("button", { name: "Import" }).click();
  return dialog;
};

/* ------------------------------ File size ------------------------------ */

test("project-sync-limits: A file at the limit syncs", async ({ page }) => {
  const account = await stubAccount(page, {
    "src/lib.rs": "// lib\n",
    "src/at.rs": sourceOf(FILE_LIMIT),
  });
  await openRestored(page);

  await editFile(page);

  await expect
    .poll(() => account.sent("src/lib.rs", "// edited"), LONG)
    .toBe(true);
  await expect(banner(page)).toHaveCount(0);
});

test("project-sync-limits: A file one byte over the limit stops the project", async ({
  page,
}) => {
  const account = await stubAccount(page, {
    "src/lib.rs": "// lib\n",
    "src/big.rs": `${sourceOf(FILE_LIMIT)}a`,
  });
  await openRestored(page);

  await editFile(page);

  await expect(bannerText(page)).toContainText(
    "src/big.rs is 129 KB. A file can be at most 128 KB.",
    LONG
  );
  expect(account.writes).toEqual([]);
});

test("project-sync-limits: Multi-byte characters count as bytes", async ({
  page,
}) => {
  await stubAccount(page, {
    "src/lib.rs": "// lib\n",
    // 50,000 characters of three bytes each: 150,000 bytes
    "src/euro.rs": "€".repeat(50_000),
  });
  await openRestored(page);

  await editFile(page);

  await expect(bannerText(page)).toContainText("src/euro.rs is 147 KB.", LONG);
});

/* ------------------------------ Path length ----------------------------- */

test("project-sync-limits: A path of 256 characters syncs", async ({
  page,
}) => {
  const long = `src/${"p".repeat(249)}.rs`;
  expect(long).toHaveLength(256);
  const account = await stubAccount(page, {
    "src/lib.rs": "// lib\n",
    [long]: "// long\n",
  });
  await openRestored(page);

  await editFile(page);

  await expect
    .poll(() => account.sent("src/lib.rs", "// edited"), LONG)
    .toBe(true);
  await expect(banner(page)).toHaveCount(0);
});

test("project-sync-limits: A path of 257 characters stops the project", async ({
  page,
}) => {
  const long = `src/${"p".repeat(250)}.rs`;
  const account = await stubAccount(page, {
    "src/lib.rs": "// lib\n",
    [long]: "// long\n",
  });
  await openRestored(page);

  await editFile(page);

  await expect(bannerText(page)).toContainText(
    "A file path is longer than 256 characters",
    LONG
  );
  expect(account.writes).toEqual([]);
});

/* ----------------------------- Project size ----------------------------- */

test("project-sync-limits: Five files of 100 KiB stop the project", async ({
  page,
}) => {
  // `src/lib.rs` is the fifth file of 102,400 bytes
  const files = bigFiles(4, 102_400);
  files["src/lib.rs"] = sourceOf(102_400);
  const account = await stubAccount(page, files);
  await openRestored(page);

  await editFile(page);
  await expect
    .poll(() => account.sent("src/lib.rs", "// edited"), LONG)
    .toBe(true);

  // A sixth file of 13,000 bytes, pasted in
  await newFileIn(page, "src", "sixth.rs");
  await expect(inTree(page, "sixth.rs")).toBeVisible();
  await inTree(page, "sixth.rs").click();
  await editor(page).click();
  await page.keyboard.insertText(`${"a".repeat(99)}\n`.repeat(130));

  await expect(bannerText(page)).toContainText(
    "A project can be at most 512 KB.",
    LONG
  );
  await expect(bannerText(page)).toContainText(/^This project is 51\d KB\./);
  expect(account.sent("src/sixth.rs", "aaaa")).toBe(false);
});

/* ------------------------------ File count ------------------------------ */

test("project-sync-limits: Fifty files and the generated files sync", async ({
  page,
}) => {
  const files = manyFiles(50);
  files[".tutorial.json"] = '{"pageNumber":1}';
  files[".workspace/tutorial-storage.json"] = "{}";
  const account = await stubAccount(page, files);
  await openRestored(page);

  await editFile(page);

  await expect
    .poll(() => account.sent("src/lib.rs", "// edited"), LONG)
    .toBe(true);
  await expect(banner(page)).toHaveCount(0);
});

test("project-sync-limits: Fifty-one empty files stop the project", async ({
  page,
}) => {
  const account = await stubAccount(
    page,
    manyFiles(51, () => "")
  );
  await openRestored(page);

  await editFile(page);

  await expect(bannerText(page)).toContainText(
    "This project has 51 files.",
    LONG
  );
  expect(account.writes).toEqual([]);
});

/* -------------------------- The client's check -------------------------- */

test("project-sync-limits: A one-line edit to a large project is not sent", async ({
  page,
}) => {
  const account = await stubAccount(page, bigFiles(5, 122_880));
  await openRestored(page);

  await editFile(page);

  await expect(bannerText(page)).toContainText(
    "A project can be at most 512 KB.",
    LONG
  );
  // The editor's push and the debounce after it have both had their turn
  await page.waitForTimeout(5000);
  expect(account.writes).toEqual([]);
});

test("project-sync-limits: Other projects keep syncing", async ({ page }) => {
  const account = await stubAccount(page, [
    { id: ROW_ID, name: "Over", files: manyFiles(64) },
    { id: OTHER_ID, name: "Under", files: { "src/lib.rs": "// under\n" } },
  ]);
  await openRestored(page, "Over");
  await editFile(page);
  await expect(bannerText(page)).toContainText("64 files", LONG);

  await projectRow(page, "Under").click();
  await expect(currentProject(page)).toHaveText("Under", LONG);
  await expect(inTree(page, "lib.rs")).toBeVisible(LONG);
  await editFile(page, "lib.rs", "// under edited");

  await expect
    .poll(
      () =>
        account.writes.some(
          (w) =>
            w.id === OTHER_ID &&
            (w.changed ?? w.files ?? {})["src/lib.rs"]?.includes(
              "// under edited"
            )
        ),
      LONG
    )
    .toBe(true);
  expect(account.writes.some((w) => w.id === ROW_ID)).toBe(false);
});

/* ------------------------------ The banner ------------------------------ */

test("project-sync-limits: One file over the file size limit", async ({
  page,
}) => {
  const account = await stubAccount(page, {
    "src/lib.rs": sourceOf(143_360),
    "src/notes.rs": "// notes\n",
  });
  await openRestored(page);

  await editFile(page, "notes.rs");

  await expect(bannerText(page)).toHaveText(
    "src/lib.rs is 140 KB. A file can be at most 128 KB. Shrink or remove it, then try again.",
    LONG
  );
  await expect(banner(page)).toHaveAttribute("role", "alert");
  await expect(banner(page).getByRole("button")).toHaveText(["Try again"]);
  expect(account.writes).toEqual([]);
});

test("project-sync-limits: Several files over the file size limit", async ({
  page,
}) => {
  const files: Files = { "src/lib.rs": "// lib\n" };
  for (const name of ["e", "c", "a", "d", "b"]) {
    files[`src/${name}.rs`] = sourceOf(FILE_LIMIT + 64);
  }
  await stubAccount(page, files);
  await openRestored(page);

  await editFile(page);

  await expect(bannerText(page)).toHaveText(
    "src/a.rs, src/b.rs, src/c.rs and 2 more are over 128 KB. A file can be at most 128 KB. Shrink or remove them, then try again.",
    LONG
  );
});

test("project-sync-limits: A path over the path limit", async ({ page }) => {
  const long = `src/${"q".repeat(300)}.rs`;
  await stubAccount(page, { "src/lib.rs": "// lib\n", [long]: "// q\n" });
  await openRestored(page);

  await editFile(page);

  await expect(bannerText(page)).toHaveText(
    `A file path is longer than 256 characters: ${long.slice(
      0,
      60
    )}…. A file path can be at most 256 characters. Rename or move it, then try again.`,
    LONG
  );
});

test("project-sync-limits: Too many files", async ({ page }) => {
  const account = await stubAccount(page, manyFiles(64));
  await openRestored(page);

  await editFile(page);

  await expect(bannerText(page)).toHaveText(
    "This project has 64 files. A project can have at most 50. Remove some, then try again.",
    LONG
  );
  expect(account.writes).toEqual([]);
});

test("project-sync-limits: Project over the size limit", async ({ page }) => {
  // 613,447 bytes of user files; the generated `program-info.json` brings
  // the project to under 614,400, which reads as 600 KB
  await stubAccount(page, bigFiles(5, 122_688));
  await openRestored(page);

  await editFile(page);

  await expect(bannerText(page)).toHaveText(
    "This project is 600 KB. A project can be at most 512 KB. Remove or shrink some files, then try again.",
    LONG
  );
});

test("project-sync-limits: Two limits at once", async ({ page }) => {
  const files = manyFiles(59);
  files["src/big.rs"] = sourceOf(140_032);
  await stubAccount(page, files);
  await openRestored(page);

  await editFile(page);

  await expect(bannerText(page)).toHaveText(
    "src/big.rs is 137 KB. A file can be at most 128 KB. Shrink or remove it, then try again.",
    LONG
  );
});

/* ------------------------------ Try again ------------------------------- */

test("project-sync-limits: The user removed the large file", async ({
  page,
}) => {
  const account = await stubAccount(page, {
    "src/lib.rs": "// lib\n",
    "src/big.rs": sourceOf(140_032),
  });
  await openRestored(page);
  await editFile(page);
  await expect(bannerText(page)).toContainText("src/big.rs is 137 KB.", LONG);

  // Through the explorer's own menu, the way a person deletes a file
  await inTree(page, "big.rs").click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(inTree(page, "big.rs")).toHaveCount(0);

  await banner(page).getByRole("button", { name: "Try again" }).click();

  await expect(banner(page)).toHaveCount(0, LONG);
  await expect
    .poll(
      () => account.rows.get(ROW_ID)!.snapshot.files["src/lib.rs"] ?? "",
      LONG
    )
    .toContain("// edited");
  expect(
    account.rows.get(ROW_ID)!.snapshot.files["src/big.rs"]
  ).toBeUndefined();
});

test("project-sync-limits: The user fixed one of two problems", async ({
  page,
}) => {
  const files = manyFiles(59);
  files["src/big.rs"] = sourceOf(140_032);
  const account = await stubAccount(page, files);
  await openRestored(page);
  await editFile(page);
  await expect(bannerText(page)).toContainText("src/big.rs is 137 KB.", LONG);

  // Shrink it to nothing in the editor
  await inTree(page, "big.rs").click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");

  // Pressed until the editor's save has landed and the check sees it
  await expect(async () => {
    await banner(page).getByRole("button", { name: "Try again" }).click();
    await expect(bannerText(page)).toHaveText(
      "This project has 60 files. A project can have at most 50. Remove some, then try again.",
      { timeout: 2000 }
    );
  }).toPass(LONG);
  expect(account.writes).toEqual([]);
});

test("project-sync-limits: The user undid the edit", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const account = await stubAccount(page, { "src/lib.rs": "// lib\n" });
  await openRestored(page);

  await inTree(page, "lib.rs").click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.evaluate(
    (text) => navigator.clipboard.writeText(text),
    sourceOf(150_016)
  );
  await page.keyboard.press("ControlOrMeta+V");
  await expect(bannerText(page)).toContainText("src/lib.rs is 147 KB.", LONG);

  await page.keyboard.press("ControlOrMeta+Z");
  await expect.poll(async () => (await openText(page))?.length, LONG).toBe(7);

  // Pressed until the editor's save of the undo has landed
  await expect(async () => {
    await banner(page)
      .getByRole("button", { name: "Try again" })
      .click({ timeout: 2000 });
    await expect(banner(page)).toHaveCount(0, { timeout: 2000 });
  }).toPass(LONG);
  expect(account.writes).toEqual([]);
});

/* ------------------------- The server's refusal ------------------------- */

test("project-sync-limits: The client check is bypassed", async ({ page }) => {
  await stubAccount(page, { "src/lib.rs": "// lib\n" }, (r) =>
    r.fulfill({
      status: 413,
      contentType: "application/json",
      body: JSON.stringify({
        error: "The project is over a sync limit",
        reason: "too-many-files",
        limit: 50,
        count: 52,
      }),
    })
  );
  await openRestored(page);

  await editFile(page);

  await expect(bannerText(page)).toHaveText(
    "This project has 52 files. A project can have at most 50. Remove some, then try again.",
    LONG
  );
});

/* ---------------------------- The account cap --------------------------- */

test("project-sync-limits: The account is at the project cap", async ({
  page,
}) => {
  const account = await stubAccount(page, [], (r) =>
    r.fulfill({
      status: 413,
      contentType: "application/json",
      body: JSON.stringify({
        error: "The account syncs as many projects as it can",
        reason: "too-many-projects",
        kind: "project",
        limit: 10,
        count: 11,
      }),
    })
  );
  await page.goto("/");
  await startProject(page, "eleventh", LONG);
  await expect(editor(page)).toContainText("declare_id", LONG);

  await expect(bannerText(page)).toHaveText(
    "An account can sync at most 10 projects. This one stays in this browser and is not synced. Delete a synced project you no longer need, then try again.",
    LONG
  );
  await expect(currentProject(page)).toContainText("eleventh");

  // No retry loop: the banner holds the project's pushes
  const refused = account.writes.length;
  await editFile(page);
  await page.waitForTimeout(5000);
  expect(account.writes).toHaveLength(refused);
});

/* --------------------------- Under every limit -------------------------- */

test("project-sync-limits: A tutorial project", async ({ page }) => {
  const lines = linesOn(page);
  // 12 KB in 3 files, the size of the largest bundled tutorial
  const account = await stubAccount(page, {
    "src/lib.rs": "// program\n".repeat(700),
    "client/client.ts": "// client\n".repeat(300),
    "tests/index.test.ts": "// test\n".repeat(150),
  });
  await openRestored(page);

  await editFile(page);

  await expect
    .poll(() => account.sent("src/lib.rs", "// edited"), LONG)
    .toBe(true);
  await expect(banner(page)).toHaveCount(0);
  expect(limitEvents(lines)).toEqual([]);
});

/* ----------------------- Stored before the limits ----------------------- */

/** A 2 MiB project, sixteen files at the file size limit */
const twoMegabytes = () => bigFiles(16, FILE_LIMIT);

test("project-sync-limits: Restoring a stored project over the limit", async ({
  page,
}) => {
  const account = await stubAccount(page, twoMegabytes());
  await openRestored(page);
  await expect(inTree(page, "f16.rs")).toBeVisible();

  await editFile(page);

  await expect(bannerText(page)).toContainText(
    "A project can be at most 512 KB.",
    LONG
  );
  expect(account.writes).toEqual([]);
});

test("project-sync-limits: Deleting it", async ({ page }) => {
  const account = await stubAccount(page, [
    { id: ROW_ID, name: NAME, files: twoMegabytes() },
    { id: OTHER_ID, name: "Other", files: { "src/lib.rs": "// other\n" } },
  ]);
  await openRestored(page);

  const menu = await projectMenu(page, NAME);
  await menu.getByRole("menuitem", { name: `Delete ${NAME}` }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete project" })
    .click();

  await expect.poll(() => account.deleted, LONG).toEqual([ROW_ID]);
});

/* ------------------------------ The events ------------------------------ */

test("project-sync-limits: sync_file_limit_exceeded", async ({ page }) => {
  const lines = linesOn(page);
  await stubAccount(page, {
    "src/lib.rs": "// lib\n",
    "src/big.rs": sourceOf(140_032),
  });
  await openRestored(page);

  await editFile(page);

  await expect(banner(page)).toBeVisible(LONG);
  await expect.poll(() => limitEvents(lines)).toHaveLength(1);
  const [line] = limitEvents(lines);
  expect(line).toContain("sync_file_limit_exceeded");
  expect(line).toMatch(/by\W+client/);
  expect(line).toMatch(/limit\W+size/);
  expect(line).toMatch(/files\W+1\b/);
});

test("project-sync-limits: sync_project_limit_exceeded", async ({ page }) => {
  const lines = linesOn(page);
  await stubAccount(page, bigFiles(5, 122_688));
  await openRestored(page);

  await editFile(page);

  await expect(banner(page)).toBeVisible(LONG);
  await expect.poll(() => limitEvents(lines)).toHaveLength(1);
  const [line] = limitEvents(lines);
  expect(line).toContain("sync_project_limit_exceeded");
  expect(line).toMatch(/by\W+client/);
  expect(line).toMatch(/kib\W+600\b/);
});

test("project-sync-limits: sync_files_count_limit_exceeded", async ({
  page,
}) => {
  const lines = linesOn(page);
  await stubAccount(page, manyFiles(64));
  await openRestored(page);

  await editFile(page);

  await expect(banner(page)).toBeVisible(LONG);
  await expect.poll(() => limitEvents(lines)).toHaveLength(1);
  const [line] = limitEvents(lines);
  expect(line).toContain("sync_files_count_limit_exceeded");
  expect(line).toMatch(/by\W+client/);
  expect(line).toMatch(/files\W+64\b/);
});

test("project-sync-limits: A banner already up sends nothing more", async ({
  page,
}) => {
  const lines = linesOn(page);
  await stubAccount(page, manyFiles(64));
  await openRestored(page);
  await editFile(page);
  await expect(banner(page)).toBeVisible(LONG);

  await editFile(page, "f1.rs", "// more");
  await editFile(page, "f2.rs", "// more");
  await page.waitForTimeout(5000);

  expect(limitEvents(lines)).toHaveLength(1);
});

/* ---------------------- The explorer: creating files --------------------- */

test("project-sync-limits: The 51st file from the New File dialog", async ({
  page,
}) => {
  const account = await stubAccount(page, manyFiles(50));
  await openRestored(page);

  const input = await newFileIn(page, "src", "extra.rs");

  await expect(limitError(page)).toHaveText(
    "A project can have at most 50 files."
  );
  await expect(input).toBeVisible();
  await expect(inTree(page, "extra.rs")).toHaveCount(0);
  expect(account.sent("src/extra.rs", "")).toBe(false);
});

test("project-sync-limits: A folder is not a file", async ({ page }) => {
  await stubAccount(page, manyFiles(50));
  await openRestored(page);

  await inTree(page, "src").click({ button: "right" });
  await page.getByRole("menuitem", { name: /New Folder/ }).click();
  const input = tree(page).getByRole("textbox");
  await expect(input).toBeFocused();
  await input.fill("more");
  await page.keyboard.press("Enter");

  await expect(inTree(page, "more")).toBeVisible();
  await expect(limitError(page)).toHaveCount(0);
});

test("project-sync-limits: The assistant writes a file over the size limit", async ({
  page,
}) => {
  const turns: string[] = [];
  const sse = (...frames: unknown[]) =>
    frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") +
    "data: [DONE]\n\n";
  const writeBig = {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_write",
              function: {
                name: "write_file",
                arguments: JSON.stringify({
                  path: "src/lib.rs",
                  content: sourceOf(200_000),
                }),
              },
            },
          ],
        },
      },
    ],
  };
  await stubSession(page);
  await stubAiStatus(page, "z-ai/glm-5.3-flash:US");
  await page.route("**/api/agent", (route) => {
    turns.push(route.request().postData() ?? "");
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        turns.length === 1
          ? sse(writeBig, {
              choices: [{ delta: {}, finish_reason: "tool_calls" }],
            })
          : sse({ choices: [{ delta: { content: "Understood" } }] }),
    });
  });
  await page.goto("/");
  await startProject(page, "assistant-big", LONG);
  await expect(editor(page)).toContainText("declare_id", LONG);
  const before = await openText(page);

  await page
    .getByRole("textbox", { name: "Message the assistant" })
    .fill("Write a big file");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Apply" }).click(LONG);

  await expect.poll(() => turns.length, LONG).toBe(2);
  expect(turns[1]).toContain("A file can be at most 128 KB.");
  expect(await openText(page)).toBe(before);
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(
    page.getByText("not written: A file can be at most 128 KB.")
  ).toBeVisible();
});

test("project-sync-limits: A project already over a limit", async ({
  page,
}) => {
  await stubAccount(page, manyFiles(60));
  await openRestored(page);

  await newFileIn(page, "src", "extra.rs");

  await expect(limitError(page)).toHaveText(
    "A project can have at most 50 files."
  );
  await expect(inTree(page, "extra.rs")).toHaveCount(0);
});

test("project-sync-limits: A small file beside a file over the size limit", async ({
  page,
}) => {
  // What a paste leaves behind: the editor's save is not refused
  await stubAccount(page, { "src/lib.rs": sourceOf(150_016) });
  await openRestored(page);

  await newFileIn(page, "src", "notes.md");

  await expect(inTree(page, "notes.md")).toBeVisible(LONG);
  await expect(limitError(page)).toHaveCount(0);
});

/* ------------------------ The explorer: renaming ------------------------ */

test("project-sync-limits: Renaming a folder pushes a file over", async ({
  page,
}) => {
  // `dir/` + 243 + `.rs`: 250 code points
  const file = `${"n".repeat(243)}.rs`;
  await stubAccount(page, { "src/lib.rs": "// lib\n", [`dir/${file}`]: "x" });
  await openRestored(page);

  await inTree(page, "dir").click({ button: "right" });
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  const dialog = page.getByRole("dialog", { name: "Rename 'dir'" });
  await dialog.getByRole("textbox").fill("d".repeat(13));
  await page.keyboard.press("Enter");

  await expect(dialog.getByTestId("explorer-limit-error")).toHaveText(
    "A file path can be at most 256 characters."
  );
  await expect(inTree(page, "dir")).toBeVisible();
});

/* ------------------------ The explorer: importing ----------------------- */

test("project-sync-limits: A folder of 64 files from disk", async ({
  page,
}) => {
  await seedWorkspace(page);

  const dialog = await importFromDisk(
    page,
    Array.from({ length: 64 }, (_, i) => `// ${i}\n`)
  );

  await expect(dialog.getByTestId("explorer-limit-error")).toHaveText(
    "This project has 64 files. A project can have at most 50."
  );
  await expect(dialog).toBeVisible();
  await expect(currentProject(page)).not.toHaveText("from-disk");
});

test("project-sync-limits: A GitHub repository with one large file", async ({
  page,
}) => {
  const LIB = "use solana_program::entrypoint;\nentrypoint!(process);\n";
  const DATA = sourceOf(143_360);
  await page.route("https://api.github.com/repos/e2e/big/**", (r) =>
    json(r, {
      truncated: false,
      tree: [
        { path: "src/lib.rs", type: "blob", sha: "1", url: "" },
        { path: "src/data.rs", type: "blob", sha: "2", url: "" },
      ],
    })
  );
  await page.route("https://raw.githubusercontent.com/e2e/big/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/plain",
      body: r.request().url().endsWith("data.rs") ? DATA : LIB,
    })
  );
  await seedWorkspace(page);

  await page.locator("[data-settings-trigger]").first().click();
  await page.getByRole("button", { name: "From GitHub" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "GitHub URL" });
  await dialog
    .getByPlaceholder("https://github.com/...")
    .fill("https://github.com/e2e/big");
  // The examples carry Import buttons of their own; this is the dialog's
  await dialog.locator('button[type="submit"]').click();

  await expect(dialog.getByTestId("explorer-limit-error")).toHaveText(
    "src/data.rs is 140 KB. A file can be at most 128 KB.",
    LONG
  );
  await expect(currentProject(page)).not.toContainText("github-e2e");
});

/* ---------------------- Editor writes and restores ---------------------- */

test("project-sync-limits: Pasting past the file size limit", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const account = await stubAccount(page, { "src/lib.rs": "// lib\n" });
  await openRestored(page);

  await inTree(page, "lib.rs").click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  // Through the clipboard: typed or inserted, 150 KB is one edit per
  // character, which the editor takes minutes over
  await page.evaluate(
    (text) => navigator.clipboard.writeText(text),
    sourceOf(150_016)
  );
  await page.keyboard.press("ControlOrMeta+V");

  await expect(bannerText(page)).toContainText("src/lib.rs is 147 KB.", LONG);
  expect((await openText(page))?.length).toBeGreaterThan(150_000);
  expect(account.sent("src/lib.rs", "aaaa")).toBe(false);
});

test("project-sync-limits: Restoring a large project", async ({ page }) => {
  await stubAccount(page, twoMegabytes());
  await openRestored(page);

  await expect(tree(page).getByText(/^f\d+\.rs$/)).toHaveCount(16, LONG);
});

/* ------------------------ The explorer's events ------------------------- */

test("project-sync-limits: The 51st file", async ({ page }) => {
  const lines = linesOn(page);
  await stubAccount(page, manyFiles(50));
  await openRestored(page);

  await newFileIn(page, "src", "extra.rs");
  await expect(limitError(page)).toBeVisible();

  await expect.poll(() => limitEvents(lines)).toHaveLength(1);
  const [line] = limitEvents(lines);
  expect(line).toContain("explorer_limit_refused");
  expect(line).toMatch(/action\W+create/);
  expect(line).toMatch(/limit\W+count/);
});

test("project-sync-limits: A refused import", async ({ page }) => {
  const lines = linesOn(page);
  await seedWorkspace(page);

  const dialog = await importFromDisk(
    page,
    Array.from({ length: 6 }, () => sourceOf(100_032))
  );
  await expect(dialog.getByTestId("explorer-limit-error")).toContainText(
    "A project can be at most 512 KB."
  );

  await expect.poll(() => limitEvents(lines)).toHaveLength(1);
  const [line] = limitEvents(lines);
  expect(line).toContain("explorer_limit_refused");
  expect(line).toMatch(/action\W+import/);
  expect(line).toMatch(/limit\W+project/);
});
