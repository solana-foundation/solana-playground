import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { hunkLineClass } from "../src/features/persistence/ui/merge-editor/hunk-class";
import { applyWrite, json, LONG, makeLocalProject, settled } from "./fixtures";

/**
 * The resolve view, against an account stubbed as `account-sync` stubs it.
 *
 * Every conflict here is a real one: this browser hands its project over, so
 * both sides agree; the other device then saves (the stub's row moves); and
 * this browser types into the same lines, so its upload is refused (409) and
 * the merge finds lines both changed. Nothing about the conflict is injected
 * into the page.
 */

type Files = Record<string, string>;
type Write = {
  id?: string;
  baseUpdatedAt?: string;
  files?: Files;
  changed?: Files;
  removed?: string[];
};

const LINE_3 = "// This is your program's public key and it will update";
const LINE_12 =
  'msg!("Changed data to: {}!", data); // Message will show up in the tx logs';
const MINE = "// line 12 from this device";
const THEIRS = "// line 12 from the other device";
const THEIRS_3 = "// line 3 from the other device";

/** A copy of a file map, named rather than spread */
const copy = (files: Files): Files => Object.fromEntries(Object.entries(files));

/** The account's side: one project row, and every write it was sent */
const stubAccount = async (page: Page, id: string, name: string) => {
  let clock = 0;
  const stamp = () =>
    new Date(Date.UTC(2026, 7, 1) + ++clock * 1000).toISOString();
  const account = {
    row: { updatedAt: stamp() } as {
      snapshot?: { files: Files };
      updatedAt: string;
    },
    writes: [] as Write[],
    /** While set, writes wait for it before they are answered */
    hold: null as Promise<void> | null,
    /** The files as the account holds them */
    get files(): Files {
      return account.row.snapshot!.files;
    },
    /** The other device saves: each path to new content, or deleted (null) */
    save(changes: Record<string, string | null>) {
      const files = copy(account.files);
      for (const [path, content] of Object.entries(changes)) {
        if (content === null) delete files[path];
        else files[path] = content;
      }
      account.row = { snapshot: { files }, updatedAt: stamp() };
    },
  };

  await page.route("**/api/auth/get-session", (r) =>
    json(r, { user: { id: "u1", name: "T", image: null, login: "t" } })
  );
  await page.route("**/api/sync", (r) => json(r, { enabled: true, db: "ok" }));
  await page.route("**/api/conversations*", (r) => json(r, { items: [] }));
  await page.route("**/api/projects*", async (r) => {
    const listed = {
      id,
      name,
      kind: "project",
      updatedAt: account.row.updatedAt,
    };
    if (r.request().method() === "PUT") {
      const body: Write = JSON.parse(r.request().postData() ?? "{}");
      account.writes.push(body);
      if (account.hold) await account.hold;
      // The real swap: only a write built on the current token lands
      if (
        account.row.snapshot &&
        body.baseUpdatedAt !== account.row.updatedAt
      ) {
        return r.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            conflict: true,
            updatedAt: account.row.updatedAt,
          }),
        });
      }
      account.row = {
        snapshot: applyWrite(account.row.snapshot, body),
        updatedAt: stamp(),
      };
      return json(r, { updatedAt: account.row.updatedAt });
    }
    const asked = new URL(r.request().url()).searchParams.get("id");
    if (!asked) {
      return json(r, { projects: account.row.snapshot ? [listed] : [] });
    }
    return json(r, {
      project: {
        id: listed.id,
        name: listed.name,
        kind: listed.kind,
        updatedAt: listed.updatedAt,
        snapshot: account.row.snapshot,
      },
    });
  });
  return account;
};

type Account = Awaited<ReturnType<typeof stubAccount>>;

/** A project of this browser's, handed over so both sides agree on it */
const agreedProject = async (page: Page, name: string) => {
  const id = await makeLocalProject(page, name);
  const account = await stubAccount(page, id, name);
  await page.reload();
  await expect.poll(() => !!account.row.snapshot, LONG).toBe(true);
  await settled(page, account.writes);
  await expect(mainEditor(page)).toContainText("declare_id", LONG);
  return account;
};

/** The IDE's own editor, behind the dialog */
const mainEditor = (page: Page) =>
  page.locator(".monaco-editor .view-lines").first();

/** This browser comes back to the foreground, and reconciles */
const refocus = (page: Page) =>
  page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

/** Open a file from the tree into the main editor */
const openFile = async (page: Page, path: string) => {
  const tree = page.locator("#root-dir");
  const [dir, file] = path.split("/");
  const item = tree.getByText(file, { exact: true });
  if (!(await item.isVisible())) {
    await tree.getByText(dir, { exact: true }).click();
  }
  await item.click();
  await expect(mainEditor(page)).toBeVisible();
};

/** Replace a whole line of the file open in the main editor */
const typeLine = async (page: Page, line: number, text: string) => {
  await mainEditor(page).click();
  // Monaco's "Go to line" is Ctrl+G on every platform
  await page.keyboard.press("Control+G");
  await page.keyboard.type(String(line));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Home");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.type(text);
};

/** A pane's lines as they are drawn, top to bottom */
const linesIn = (pane: Locator) =>
  pane.locator(".view-lines").evaluate((el) =>
    Array.from(el.querySelectorAll<HTMLElement>(".view-line"))
      .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
      .map((line) => (line.textContent ?? "").replace(/ /g, " ").trim())
  );

/**
 * The looks Monaco draws behind the line of a pane holding `text`: the
 * `hunkLineClass` names on the decoration at that line's height.
 */
const looksOf = (pane: Locator, text: string) =>
  pane.locator(".monaco-editor").evaluate((editor, text) => {
    const line = Array.from(
      editor.querySelectorAll<HTMLElement>(".view-lines .view-line")
    ).find((l) => (l.textContent ?? "").replace(/\u00a0/g, " ").includes(text));
    if (!line) return null;
    const overlay = Array.from(
      editor.querySelectorAll<HTMLElement>(".view-overlays > div")
    ).find((o) => o.style.top === line.style.top);
    return Array.from(overlay?.querySelectorAll("*") ?? [])
      .flatMap((node) => Array.from(node.classList))
      .filter((name) => name.startsWith("pg-merge-hunk-"));
  }, text);

const banner = (page: Page) => page.getByText("changed on another device");

/**
 * Every file this browser has stored whose text holds `marker`, read from
 * the file system's IndexedDB store, as `workspace-migration` reads it. The
 * store keys files by inode, so a file is found by what it holds.
 */
const storedWith = (page: Page, marker: string) =>
  page.evaluate(async (marker) => {
    const dbs: Array<{ name?: string }> = await (
      indexedDB as unknown as {
        databases: () => Promise<Array<{ name?: string }>>;
      }
    ).databases();
    const name = dbs.map((d) => d.name).find((n) => n?.includes("solana"));
    if (!name) return [];
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const store = Array.from(db.objectStoreNames).find((s) =>
      s.includes("files")
    );
    if (!store) return [];
    const values: unknown[] = await new Promise((resolve) => {
      const request = db
        .transaction(store, "readonly")
        .objectStore(store)
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve([]);
    });
    db.close();
    return values
      .map((value) => {
        if (typeof value === "string") return value;
        try {
          return new TextDecoder().decode(value as ArrayBuffer);
        } catch {
          // Not a file's bytes: the superblock or another record
          return "";
        }
      })
      .filter((text) => text.includes(marker));
  }, marker);

/**
 * The next read of the account's projects: a reconcile pass has started.
 * Armed before the step that starts one.
 */
const nextProjectsRead = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().includes("/api/projects") &&
      response.request().method() === "GET",
    LONG
  );

/**
 * The conflict every scenario starts from: both devices changed line 12 of
 * `src/lib.rs`, and the other device also changed line 3.
 */
const lineTwelveConflict = async (
  page: Page,
  name: string,
  alsoThere: Record<string, string> = {}
) => {
  const account = await agreedProject(page, name);
  const lib = account.files["src/lib.rs"];
  account.save(
    Object.assign(
      { "src/lib.rs": lib.replace(LINE_3, THEIRS_3).replace(LINE_12, THEIRS) },
      alsoThere
    )
  );
  await typeLine(page, 12, MINE);
  await expect(banner(page)).toBeVisible(LONG);
  return account;
};

const openResolver = async (page: Page) => {
  await page.getByRole("button", { name: "Resolve…" }).click();
  const dialog = page.getByRole("dialog", { name: "Resolve conflicts" });
  await expect(dialog).toBeVisible();
  const pane = {
    left: dialog.getByRole("region", { name: "This device" }),
    result: dialog.getByRole("region", { name: "Result" }),
    right: dialog.getByRole("region", { name: "Other device" }),
  };
  // The editors are made once the dialog is up
  await expect(pane.result.locator(".view-line").first()).toBeVisible();
  return { dialog, pane };
};

const takeBoth = async (dialog: Locator) => {
  await dialog
    .getByRole("button", { name: "Take this device's lines" })
    .click();
  await dialog
    .getByRole("button", { name: "Take the other device's lines" })
    .click();
};

/** The writes that carried `src/lib.rs` with this content */
const uploadsOf = (account: Account, content: (text: string) => boolean) =>
  account.writes.filter((w) => {
    const text = (w.changed ?? w.files)?.["src/lib.rs"];
    return text !== undefined && content(text);
  });

test("project-conflict-resolution: A same-line conflict offers Resolve", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await lineTwelveConflict(page, "Offers");

  await expect(banner(page)).toContainText("src/lib.rs");
  for (const name of [
    "Resolve…",
    "Keep this version",
    "Take the other version",
  ]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
});

test("project-conflict-resolution: Opening the view on a one-line conflict", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await lineTwelveConflict(page, "Opening");
  const { dialog, pane } = await openResolver(page);

  await expect(dialog).toContainText("src/lib.rs");
  await expect(dialog.getByRole("status").first()).toHaveText(
    "1 conflict left"
  );
  await expect.poll(() => linesIn(pane.left)).toContain(MINE);
  await expect.poll(() => linesIn(pane.right)).toContain(THEIRS);
  await expect.poll(() => linesIn(pane.result)).toContain(LINE_12);
  // Merged on its own, so the same in all three
  for (const side of [pane.left, pane.result, pane.right]) {
    await expect.poll(() => linesIn(side)).toContain(THEIRS_3);
  }
  // ...and marked as the other device's change where it shows as one
  const changed = hunkLineClass("changed");
  await expect.poll(() => looksOf(pane.result, THEIRS_3)).toEqual([changed]);
  await expect.poll(() => looksOf(pane.right, THEIRS_3)).toEqual([changed]);
  await expect.poll(() => looksOf(pane.left, THEIRS_3)).toEqual([]);
  // ...and joined to the result by a band on the other device's side only
  const ribbons = dialog.locator('[data-slot="merge-ribbon"]');
  await expect(ribbons.first().locator('[data-state="changed"]')).toHaveCount(
    0
  );
  await expect(ribbons.last().locator('[data-state="changed"]')).toHaveCount(1);
  // Each side's line 12 only where it belongs
  await expect.poll(() => linesIn(pane.result)).not.toContain(MINE);
  await expect.poll(() => linesIn(pane.result)).not.toContain(THEIRS);
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
});

test("project-conflict-resolution: A conflict deep in a long file", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const account = await agreedProject(page, "Long");

  // The other device makes it a 300-line file, and this browser takes that
  const long = Array.from({ length: 300 }, (_, i) => `// line ${i + 1}`);
  account.save({ "src/lib.rs": long.join("\n") });
  await refocus(page);
  await expect(mainEditor(page)).toContainText("// line 1", LONG);
  await settled(page, account.writes);

  // ...then both change line 200
  const theirs = long.map((l, i) => (i === 199 ? "// 200 over there" : l));
  account.save({ "src/lib.rs": theirs.join("\n") });
  await typeLine(page, 200, "// 200 here");
  await expect(banner(page)).toBeVisible(LONG);

  const { dialog, pane } = await openResolver(page);
  await expect(pane.result.locator(".view-lines")).toContainText("// line 200");

  const folds = dialog.getByRole("button", { name: /unchanged lines$/ });
  // Above and below the conflict, in each of the three panes
  await expect(folds).toHaveCount(6);
  await expect(
    pane.result.getByRole("button", {
      name: "196 unchanged lines",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    pane.result.getByRole("button", { name: "96 unchanged lines", exact: true })
  ).toBeVisible();
  await expect.poll(() => linesIn(pane.result)).not.toContain("// line 100");

  await dialog.getByRole("button", { name: "Show all lines" }).click();
  await expect(folds).toHaveCount(0);
  // Every line is there to scroll to: the first one included
  await pane.result.locator(".view-lines").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home"
  );
  await expect.poll(() => linesIn(pane.result)).toContain("// line 1");
  await expect.poll(() => linesIn(pane.result)).toContain("// line 10");
});

test("project-conflict-resolution: Taking both sides", async ({ page }) => {
  test.setTimeout(240_000);
  await lineTwelveConflict(page, "Both");
  const { dialog, pane } = await openResolver(page);

  await takeBoth(dialog);

  await expect
    .poll(async () => {
      const lines = await linesIn(pane.result);
      return lines.slice(lines.indexOf(MINE), lines.indexOf(MINE) + 2);
    })
    .toEqual([MINE, THEIRS]);
  await expect(dialog.getByText("No conflicts left")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeEnabled();
});

test("project-conflict-resolution: Undoing a take", async ({ page }) => {
  test.setTimeout(240_000);
  await lineTwelveConflict(page, "Undo");
  const { dialog, pane } = await openResolver(page);
  const take = dialog.getByRole("button", { name: "Take this device's lines" });

  await take.click();
  await expect.poll(() => linesIn(pane.result)).toContain(MINE);
  await expect(take).toHaveCount(0);

  await pane.result.locator(".view-lines").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z"
  );

  await expect.poll(() => linesIn(pane.result)).toContain(LINE_12);
  await expect.poll(() => linesIn(pane.result)).not.toContain(MINE);
  await expect(take).toBeVisible();
  await expect(dialog.getByText("1 conflict left")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
});

test("project-conflict-resolution: Editing the result by hand", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await lineTwelveConflict(page, "ByHand");
  const { dialog, pane } = await openResolver(page);

  await pane.result
    .locator(".view-line", { hasText: "Changed data to" })
    .click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.type("// typed by hand");

  await expect.poll(() => linesIn(pane.result)).toContain("// typed by hand");
  await expect(dialog.getByText("No conflicts left")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeEnabled();
});

test("project-conflict-resolution: Two files in conflict", async ({ page }) => {
  test.setTimeout(240_000);
  const account = await agreedProject(page, "TwoFiles");

  // The other device adds the test file, and this browser takes it
  const test1 = ['describe("x", () => {', "  // first", "  // second", "});"];
  account.save({ "tests/index.test.ts": test1.join("\n") });
  await refocus(page);
  await expect(page.locator("#root-dir")).toContainText("index.test.ts", LONG);
  await settled(page, account.writes);

  // Both devices change both files on the same lines. This browser's upload
  // is held until it has typed into both, so they are one question.
  account.save({
    "src/lib.rs": account.files["src/lib.rs"].replace(LINE_12, THEIRS),
    "tests/index.test.ts": test1
      .map((l) => (l === "  // second" ? "  // second, there" : l))
      .join("\n"),
  });
  let release!: () => void;
  account.hold = new Promise((resolve) => (release = resolve));
  await typeLine(page, 12, MINE);
  // Autosaved before the tab changes: a switch inside autosave's half second
  // is a different story (the editor's), not this one
  await expect
    .poll(async () => (await storedWith(page, MINE)).length, LONG)
    .toBeGreaterThan(0);
  await openFile(page, "tests/index.test.ts");
  await typeLine(page, 3, "  // second, here");
  await expect
    .poll(async () => (await storedWith(page, "// second, here")).length, LONG)
    .toBeGreaterThan(0);
  release();
  account.hold = null;
  await expect(banner(page)).toBeVisible(LONG);

  const { dialog } = await openResolver(page);
  await expect(dialog).toContainText("file 1 of 2");
  const apply = dialog.getByRole("button", { name: "Apply" });

  // Every hunk of the first file only
  await takeBoth(dialog);
  await expect(apply).toBeDisabled();

  await dialog.getByRole("button", { name: "Next file" }).click();
  await expect(dialog).toContainText("tests/index.test.ts");
  await takeBoth(dialog);
  await expect(apply).toBeEnabled();
});

test("project-conflict-resolution: Deleted on the other device, edited here", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const account = await agreedProject(page, "Deleted");

  account.save({ "src/old.rs": "// an old file\n" });
  await refocus(page);
  await expect(page.locator("#root-dir")).toContainText("old.rs", LONG);
  await settled(page, account.writes);

  // Gone on the other device; edited on this one
  account.save({ "src/old.rs": null });
  await openFile(page, "src/old.rs");
  await typeLine(page, 1, "// edited here");
  await expect(banner(page)).toBeVisible(LONG);
  await expect(banner(page)).toContainText("src/old.rs");

  const dialog = page.getByRole("dialog", { name: "Resolve conflicts" });
  await page.getByRole("button", { name: "Resolve…" }).click();
  await expect(dialog).toBeVisible();
  const right = dialog.getByRole("region", { name: "Other device" });
  await expect(right).toContainText("Deleted on the other device");

  await dialog
    .getByRole("button", { name: "Take the other device's lines" })
    .click();
  const before = account.writes.length;
  await dialog.getByRole("button", { name: "Apply" }).click();

  await expect(dialog).toBeHidden(LONG);
  await expect(banner(page)).toHaveCount(0, LONG);
  await expect(page.locator("#root-dir")).not.toContainText("old.rs");
  await settled(page, account.writes);
  expect(account.files["src/old.rs"]).toBeUndefined();
  // Nothing uploaded since put it back
  for (const write of account.writes.slice(before)) {
    expect((write.changed ?? write.files ?? {})["src/old.rs"]).toBeUndefined();
  }
});

test("project-conflict-resolution: Resolved hunk by hunk and applied", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const account = await lineTwelveConflict(page, "Applied");
  const { dialog } = await openResolver(page);

  await takeBoth(dialog);
  await dialog.getByRole("button", { name: "Apply" }).click();

  await expect(dialog).toBeHidden(LONG);
  await expect(banner(page)).toHaveCount(0, LONG);
  await expect(mainEditor(page)).toContainText(MINE);
  await expect(mainEditor(page)).toContainText(THEIRS);
  await settled(page, account.writes);
  // This device's line, then the other device's (which kept its indent)
  const chosen = (text: string) =>
    new RegExp(`${MINE}\n\\s*${THEIRS}`).test(text) && text.includes(THEIRS_3);
  expect(uploadsOf(account, chosen)).toHaveLength(1);
  expect(chosen(account.files["src/lib.rs"])).toBe(true);
});

/**
 * The product events the page tracks from now on, as the development build
 * logs them (`logProvider`: `[telemetry:event] <name> <params>`), filtered to
 * those starting with `prefix`
 */
const trackedEvents = (page: Page, prefix: string) => {
  const events: Array<{ name: string; params: unknown }> = [];
  page.on("console", async (message) => {
    if (!message.text().startsWith("[telemetry:event]")) return;
    const [, name, params] = await Promise.all(
      message.args().map((arg) => arg.jsonValue())
    );
    if (typeof name === "string" && name.startsWith(prefix)) {
      events.push({ name, params });
    }
  });
  return events;
};

test("project-conflict-resolution: Resolving is measured", async ({ page }) => {
  test.setTimeout(240_000);
  const account = await lineTwelveConflict(page, "Measured");
  const events = trackedEvents(page, "sync_resolve");
  const { dialog } = await openResolver(page);

  await takeBoth(dialog);
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden(LONG);
  await settled(page, account.writes);

  await expect
    .poll(() => events)
    .toEqual([
      { name: "sync_resolve_opened", params: { files: 1, hunks: 1 } },
      {
        name: "sync_resolve_hunk_resolved",
        params: { how: "take", side: "other-device" },
      },
      { name: "sync_resolve_applied", params: { files: 1 } },
    ]);
});

test("project-conflict-resolution: The account's copy comes back unchanged", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const account = await lineTwelveConflict(page, "Unchanged");
  const { dialog } = await openResolver(page);
  await takeBoth(dialog);
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden(LONG);
  await settled(page, account.writes);

  account.writes.length = 0;
  const read = nextProjectsRead(page);
  await page.reload();
  await expect(mainEditor(page)).toContainText(MINE, LONG);
  await expect(mainEditor(page)).toContainText(THEIRS);
  // The reload's reconcile pass has read the account and had its say
  await read;
  await settled(page, account.writes);
  await expect(banner(page)).toHaveCount(0);
  // Nothing of the user's goes up. The one write a reload may make is the
  // generated `program-info.json`, which this account never received and
  // PgProgramInfo writes on every open -- the known sync gap that
  // `account-sync`'s "reloading a project the account already has writes
  // nothing" is quarantined for on CI, not something the resolution sent.
  for (const write of account.writes) {
    expect(Object.keys(write.changed ?? write.files ?? {})).toEqual([
      ".workspace/program-info.json",
    ]);
  }
  expect(account.files["src/lib.rs"]).toContain(MINE);
});

test("project-conflict-resolution: Cancelled after taking a side", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const account = await lineTwelveConflict(page, "Cancelled");
  await settled(page, account.writes);
  const before = account.writes.length;
  const { dialog } = await openResolver(page);

  await dialog
    .getByRole("button", { name: "Take this device's lines" })
    .click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  // A side was taken, so closing asks first
  await expect(dialog.getByRole("alert")).toHaveText("Discard your choices?");
  await dialog.getByRole("button", { name: "Discard" }).click();

  await expect(dialog).toBeHidden();
  // A pass runs, so anything Cancel had left to write or send would have
  const read = nextProjectsRead(page);
  await refocus(page);
  await read;
  await settled(page, account.writes);

  await expect(mainEditor(page)).toContainText(MINE);
  await expect(mainEditor(page)).not.toContainText(THEIRS);
  // The half-built result (the other device's line 3 merged in, this
  // device's line 12 taken) is not what this device holds: the stored file
  // is this device's own, line 3 as both started
  const stored = await storedWith(page, MINE);
  expect(stored.length).toBeGreaterThan(0);
  for (const text of stored) {
    expect(text).toContain(LINE_3);
    expect(text).not.toContain(THEIRS_3);
    expect(text).not.toContain(THEIRS);
  }
  await expect(mainEditor(page)).toContainText(LINE_3);
  await expect(mainEditor(page)).not.toContainText(THEIRS_3);
  expect(account.writes.length).toBe(before);
  await expect(page.getByRole("button", { name: "Resolve…" })).toBeVisible();
});

test("project-conflict-resolution: The other device saves while the view is open", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const account = await lineTwelveConflict(page, "Moved");
  await settled(page, account.writes);
  const { dialog, pane } = await openResolver(page);

  const again = "// line 12 again from the other device";
  account.save({
    "src/lib.rs": account.files["src/lib.rs"].replace(THEIRS, again),
  });
  const before = account.writes.length;
  await takeBoth(dialog);
  await dialog.getByRole("button", { name: "Apply" }).click();

  await expect(
    dialog.getByText("src/lib.rs changed on the other device.")
  ).toBeVisible(LONG);
  await expect.poll(() => linesIn(pane.right)).toContain(again);
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
  expect(account.writes.length).toBe(before);
});

test("project-conflict-resolution: Keeping this version from the view", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // A file only the other device touched, which merges on its own
  const other = "// added on the other device";
  const account = await lineTwelveConflict(page, "KeepFromView", {
    "src/other.rs": other,
  });
  const { dialog } = await openResolver(page);

  await dialog.getByRole("button", { name: "Keep this version" }).click();

  await expect(dialog).toBeHidden(LONG);
  await expect(banner(page)).toHaveCount(0, LONG);
  await settled(page, account.writes);
  // The conflicted file is this device's copy, as the banner's answer has it
  const lib = account.files["src/lib.rs"];
  expect(lib).toContain(MINE);
  expect(lib).not.toContain(THEIRS);
  expect(lib).toContain(LINE_3);
  await expect(mainEditor(page)).toContainText(MINE);
  // ...and every other file keeps what merged
  expect(account.files["src/other.rs"]).toBe(other);
  await expect(page.locator("#root-dir")).toContainText("other.rs");
});

/**
 * How far below the bottom of the last line drawn in the result the first
 * hunk bar starts, in px: never negative, or the bar covers the lines it
 * decides.
 */
const barGap = async (pane: Locator) => {
  const bar = await pane
    .locator('[data-slot="merge-hunk-bar"]')
    .first()
    .boundingBox();
  const bottom = await pane
    .locator(".view-lines .view-line")
    .evaluateAll((lines) =>
      Math.max(...lines.map((line) => line.getBoundingClientRect().bottom))
    );
  return bar ? bar.y - bottom : null;
};

/** The phone's width, as the spec's manual scenario has it */
const PHONE = { width: 390, height: 844 };

test("a phone's hunk bar sits under a whole-file conflict, not over its lines", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const account = await agreedProject(page, "PhoneWhole");
  account.save({ "src/old.rs": "// an old file\n" });
  await refocus(page);
  await expect(page.locator("#root-dir")).toContainText("old.rs", LONG);
  await settled(page, account.writes);
  account.save({ "src/old.rs": null });
  await openFile(page, "src/old.rs");
  await typeLine(page, 1, "// edited here");
  await expect(banner(page)).toContainText("src/old.rs", LONG);

  await page.setViewportSize(PHONE);
  const { pane } = await openResolver(page);

  await expect(
    pane.result.getByRole("button", { name: "Take this device's lines" })
  ).toBeVisible();
  // The whole file is the hunk: its bar goes after the file's last line
  await expect.poll(() => barGap(pane.result)).toBeGreaterThanOrEqual(-0.5);
  await expect.poll(() => barGap(pane.result)).toBeLessThan(2);
});

test("a phone's hunk bar sits under a conflict at the end of a file, not over it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const account = await agreedProject(page, "PhoneEnd");
  const three = ["fn a() {}", "fn b() {}", "fn c() {}"];
  account.save({ "src/end.rs": three.join("\n") });
  await refocus(page);
  await expect(page.locator("#root-dir")).toContainText("end.rs", LONG);
  await settled(page, account.writes);
  // Both change the last line, which ends the file
  account.save({
    "src/end.rs": three
      .map((l, i) => (i === 2 ? "fn c_there() {}" : l))
      .join("\n"),
  });
  await openFile(page, "src/end.rs");
  await typeLine(page, 3, "fn c_here() {}");
  await expect(banner(page)).toContainText("src/end.rs", LONG);

  await page.setViewportSize(PHONE);
  const { pane } = await openResolver(page);

  await expect.poll(() => linesIn(pane.result)).toContain("fn c() {}");
  // The code a step up, as in the code editor on a phone
  await expect(pane.result.locator(".view-line").first()).toHaveCSS(
    "font-size",
    "15px"
  );
  await expect.poll(() => barGap(pane.result)).toBeGreaterThanOrEqual(-0.5);
  await expect.poll(() => barGap(pane.result)).toBeLessThan(2);
});
