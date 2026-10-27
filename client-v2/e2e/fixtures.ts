import { test as base, expect } from "@playwright/test";
import type { BrowserContext, Page, Route } from "@playwright/test";
import { isUuid } from "../src/shared/lib/ids";

/** For a step that waits on the explorer, sync or a reload */
export const LONG = { timeout: 60_000 };

/** Home, which a start with no project shows in place of the work */
export const home = (page: Page) =>
  page.getByRole("heading", { name: "Where should we begin?" });

/** Home's region, which keeps a query off the navigation's items of the same name */
export const homeRegion = (page: Page) =>
  page.getByRole("region", { name: "Home" });

/**
 * Makes a project from Home's New project tile, through the same Start from
 * scratch the New project dialog holds (`features/new-project`).
 *
 * Scoped to Home's region: the navigation has a "New project" item of the
 * same name.
 */
export const startProject = async (page: Page, name: string, timeout = {}) => {
  await expect(home(page)).toBeVisible(timeout);
  const region = homeRegion(page);
  await region.getByRole("button", { name: /^New project/ }).click();
  await region.getByLabel("Project name").fill(name);
  await region.getByRole("button", { name: /^Start/ }).click();
  await expect(home(page)).toBeHidden(timeout);
};

/**
 * A browser with one project already created.
 *
 * A fresh profile shows Home, not the work, so any test that clicks the
 * canvas needs a project first.
 *
 * Seeds through Home's own "New project" tile rather than writing to
 * `indexedDB`: the explorer's on-disk layout is an internal detail, and the
 * default framework files are bundled, so this needs no network.
 */
export const seedWorkspace = async (page: Page, name = "e2e-project") => {
  await page.goto("/");
  await startProject(page, name);

  // `PgExplorer.createWorkspace` hands the work over, then the explorer
  // re-initializes -- wait for the tree, not just Home going away.
  await expect(page.locator("#root-dir")).toBeVisible();
};

/**
 * The last line `help` prints in the terminal (`test`'s description), so it
 * is in view however narrow the console is. An entry above it scrolls out of
 * the terminal's rows once the stage column is narrow enough to wrap the
 * longer descriptions, and xterm keeps only the rows in view in the page.
 */
export const HELP_TAIL = "Run test(s)";

/**
 * Types `command` into the terminal and runs it.
 *
 * The console prints its prompt a moment after it opens (`PgTerm.open`, then
 * `PgShell.enable`), and the prompt starts a fresh input (`PgTty.read`), which
 * erases whatever was typed before it. So the command goes in once the
 * terminal ends in the prompt, and the click comes after that wait, so
 * nothing can take the focus in between.
 *
 * The labelled input, not the element's centre: the centre can land on the
 * link in the welcome text, and a click on a link does not focus the terminal.
 */
export const runInTerminal = async (page: Page, command: string) => {
  await expect(page.locator(".xterm-rows").first()).toHaveText(/\$\s*$/);
  const input = page.getByLabel("Terminal input").first();
  await input.click();
  await expect(input).toBeFocused();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
};

/** What rustc prints for one type error, as the build server returns it */
export const FAILED_BUILD_STDERR = [
  "error[E0308]: mismatched types",
  " --> src/lib.rs:5:9",
  "  |",
  '5 |     let x: u32 = "no";',
  "  |            ---   ^^^^ expected `u32`, found `&str`",
  "",
  "error: could not compile `e2e-project` (lib) due to 1 previous error",
].join("\n");

/**
 * Waits for the editor to take focus, then moves focus out of it.
 *
 * The editor focuses itself when it opens a file, at a moment that varies
 * with the machine, and on macOS Monaco keeps ⌘E (find with selection)
 * while it has focus. A key the shell binds globally, such as ⌘E for the
 * files column, reaches the shell there only from outside the editor, so a
 * test pressing it first settles where focus is.
 */
export const leaveEditor = async (page: Page) => {
  const editor = page.locator(".monaco-editor textarea.inputarea");
  await expect(editor).toBeFocused();
  await editor.blur();
  await expect(editor).not.toBeFocused();
};

/**
 * Starts every page of a fresh profile on the public devnet, the cluster the
 * specs stub and name, whatever default `REACT_APP_DEVNET_RPC_URL` gives the
 * build. A profile that already holds settings keeps them.
 */
const startOnPublicDevnet = (context: BrowserContext) =>
  context.addInitScript(() => {
    if (localStorage.getItem("settings") !== null) return;
    localStorage.setItem(
      "settings",
      JSON.stringify({ connection: { endpoint: { option: "devnet" } } })
    );
  });

export const test = base.extend<{ seededPage: Page }>({
  context: async ({ context }, use) => {
    await startOnPublicDevnet(context);
    await use(context);
  },
  // `E2E_CPU_THROTTLE=<n>` slows the test's page `n` times, to show a race
  // that only the runner hits (`docs/testing.md`, "Parallel runs")
  page: async ({ page }, use) => {
    const rate = Number(process.env.E2E_CPU_THROTTLE ?? 1);
    if (!(Number.isFinite(rate) && rate >= 1)) {
      throw new Error(
        `E2E_CPU_THROTTLE must be a number of 1 or more, got "${process.env.E2E_CPU_THROTTLE}".`
      );
    }
    if (rate > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    }
    await use(page);
  },
  seededPage: async ({ page }, use) => {
    await seedWorkspace(page);
    // The tree shows before the editor: Monaco is a lazy chunk, and when it
    // mounts it opens the current file and focuses itself, unless the user
    // is typing in a field (`createMountOpen` in `Monaco.tsx`). On a loaded
    // machine that lands after a test has already put the focus somewhere
    // else -- a right-clicked file -- and takes it away. Hand the page over
    // once the editor holds the focus, so it has nothing left to take.
    await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused(
      LONG
    );
    await use(page);
  },
});

type WriteBody = {
  files?: Record<string, string>;
  changed?: Record<string, string>;
  removed?: string[];
};

/**
 * What `/api/projects` stores for a write: the whole file set, or a patch on
 * what it already holds. Route stubs use it so a patch does not quietly
 * become a project holding only the files that changed.
 */
export const applyWrite = (
  held: { files: Record<string, string> } | undefined,
  body: WriteBody
) => {
  const files = body.files
    ? { ...body.files }
    : { ...(held?.files ?? {}), ...(body.changed ?? {}) };
  for (const path of body.removed ?? []) delete files[path];
  return { files };
};

export { expect };

export const json = (r: Route, body: unknown) =>
  r.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

/** The user the session stubs sign in as */
export const TEST_USER = { id: "u1", name: "Tester", image: null, login: "t" };

/**
 * What the browser reads as its session: `TEST_USER`, or nobody for `null`.
 * The default backend answers only a signed-in user, so a test that sends to
 * it signs in first; its turns go to the test's own `/api/agent` stub.
 */
export const stubSession = (page: Page, user: unknown = TEST_USER) =>
  page.route("**/api/auth/get-session", (r) => json(r, { user }));

/**
 * An account that is signed in and holds what it accepts, for a test that is
 * about something other than sync: `TEST_USER`'s session, sync enabled, no
 * conversations, and a project store that lists and returns every upload.
 *
 * A store that takes an upload and then lists nothing is not an empty
 * account: the project was uploaded and is gone, which reads as deleted on
 * another device, and the next reconcile deletes it here too (or asks about
 * it, if it holds edits not yet uploaded). On a loaded runner that pass lands
 * mid-test and takes the test's project with it.
 *
 * The version checks are the sync specs' business, so a well-formed write is
 * accepted whatever version it names; one the real endpoint refuses for its
 * shape is refused here too. On the context, so a second tab signs in to the
 * same account.
 */
export const stubSignedIn = async (context: BrowserContext) => {
  // The shape `api/projects.mjs` stores and answers with
  type Row = {
    id: string;
    name: string;
    kind: "project" | "tutorial";
    updatedAt: string;
    snapshot: { files: Record<string, string> };
  };
  const refuse = (r: Route, status: number, body: unknown) =>
    r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  const rows = new Map<string, Row>();

  await context.route("**/api/auth/get-session", (r) =>
    json(r, { user: TEST_USER })
  );
  await context.route("**/api/sync", (r) =>
    json(r, { enabled: true, db: "ok" })
  );
  await context.route("**/api/conversations*", (r) => json(r, { items: [] }));
  await context.route("**/api/projects*", (r) => {
    const req = r.request();
    const id = new URL(req.url()).searchParams.get("id");
    if (req.method() === "PUT") {
      const body = req.postDataJSON();
      if (
        !body.id ||
        !body.name ||
        !["project", "tutorial"].includes(body.kind)
      ) {
        return refuse(r, 400, { error: "id, name and kind required" });
      }
      // A patch is made against a stored row: without one it is the
      // conflict the real endpoint answers, not a project of the changed
      // files alone
      if (!body.files && !rows.has(body.id)) {
        return refuse(r, 409, { conflict: true, updatedAt: null });
      }
      const updatedAt = new Date().toISOString();
      rows.set(body.id, {
        id: body.id,
        name: body.name,
        kind: body.kind,
        updatedAt,
        snapshot: applyWrite(rows.get(body.id)?.snapshot, body),
      });
      return json(r, { updatedAt });
    }
    if (req.method() === "DELETE") {
      if (id) rows.delete(id);
      return json(r, { deleted: true });
    }
    if (req.method() !== "GET") {
      return refuse(r, 405, { error: "Method not allowed" });
    }
    if (!id) {
      const projects = Array.from(rows.values(), (row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        updatedAt: row.updatedAt,
      }));
      return json(r, { projects });
    }
    const row = rows.get(id);
    return row
      ? json(r, { project: row })
      : refuse(r, 404, { error: "Not found" });
  });
};

/**
 * Wait until the browser has stopped uploading.
 *
 * A first sign-in is not one write. `program-info.json` is written after the
 * workspace opens, asynchronously and by something other than the editor, so
 * it lands after the first push and schedules its own -- and until that one
 * has been accepted the sync mark describes a snapshot without it. Reloading
 * inside that window is a race, and the losing side looks exactly like a real
 * divergence.
 */
export const settled = async (page: Page, writes: unknown[]) => {
  let last = -1;
  while (last !== writes.length) {
    last = writes.length;
    await page.waitForTimeout(4000);
  }
};

/**
 * The id the explorer gave a workspace, read off its config in IndexedDB.
 *
 * From the store rather than from a handle on the page, which has none for
 * it: the assistant's is the conversation's id, which has not been the
 * workspace's since a project could hold several conversations. Every value
 * is tried, because the volume keeps file contents by inode and the config
 * is simply the one that parses as a workspace list naming this project.
 */
export const workspaceIdOf = (page: Page, name: string) =>
  page.evaluate(async (name) => {
    const dbs: Array<{ name?: string }> = await (
      indexedDB as unknown as {
        databases: () => Promise<Array<{ name?: string }>>;
      }
    ).databases();

    for (const { name: dbName } of dbs) {
      if (!dbName) continue;
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      for (const store of Array.from(db.objectStoreNames)) {
        const values: unknown[] = await new Promise((resolve) => {
          const request = db
            .transaction(store, "readonly")
            .objectStore(store)
            .getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve([]);
        });

        for (const value of values) {
          try {
            const text =
              typeof value === "string"
                ? value
                : new TextDecoder().decode(value as ArrayBuffer);
            const parsed = JSON.parse(text);
            const found = (
              parsed?.workspaces as Array<{ id: string; name: string }>
            )?.find?.((w) => w.name === name);
            if (found) {
              db.close();
              return found.id;
            }
          } catch {
            // Not text, or not JSON: some other file, or the superblock
          }
        }
      }
      db.close();
    }
    return null;
  }, name);

/**
 * A project of this browser's own, to hand over and then reload against.
 *
 * @returns the workspace's id, which is what the account has to list it under
 * for the reload to be about this project. A different id is a project the
 * browser has never seen: it is imported beside this one as "<name>
 * imported", and everything the stub records is about the wrong project.
 */
export const makeLocalProject = async (page: Page, name: string) => {
  await page.goto("/");
  await startProject(page, name, LONG);

  let id: string | null = null;
  await expect
    .poll(async () => (id = await workspaceIdOf(page, name)), LONG)
    .toBeTruthy();
  expect(isUuid(id!)).toBe(true);
  return id!;
};

/**
 * A project's row in the navigation's list: inside its groups, which are
 * where the list is drawn both in the stock Sidebar and on a phone's menu
 * page
 */
export const projectRow = (page: Page, name: string) =>
  page
    .locator('[data-sidebar="group"]')
    .getByRole("button", { name, exact: true });

/** The open project's row (`aria-current="page"`) in the navigation's list */
export const currentProject = (page: Page) =>
  page.locator(
    '[data-sidebar="group"] [data-sidebar="menu-button"][aria-current="page"]'
  );

/** Opens a project's menu in the navigation's list and returns it */
export const projectMenu = async (page: Page, name: string) => {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
};

/** Opens the gallery through the navigation's New project item */
export const openGallery = async (page: Page) => {
  await page
    .locator('[data-slot="sidebar"]')
    .getByRole("button", { name: "New project" })
    .click();
};

/**
 * Starts another project from the gallery, opened from the navigation, while
 * a project is open; a fresh profile starts from Home instead (`startProject`)
 */
export const startAnotherProject = async (page: Page, name: string) => {
  await openGallery(page);
  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill(name);
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);
  await expect(currentProject(page)).toHaveText(name, LONG);
};

/** One program, whose repository the GitHub stubs below serve */
export const PROGRAM = {
  name: "e2e-counter",
  description: "A counter for the catalog's e2e",
  repo: "https://github.com/e2e/counter",
  icon: "/favicon.ico",
  framework: "Native",
  categories: ["Examples"],
};
const LIB_RS = `use solana_program::{account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey};

entrypoint!(process_instruction);

pub fn process_instruction(_program_id: &Pubkey, _accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    Ok(())
}
`;

/** Serves `PROGRAM` as the whole registry, and its repository from GitHub */
export const stubPrograms = async (page: Page) => {
  await page.route("**/programs/programs.json", (r) => json(r, [PROGRAM]));
  await page.route("https://api.github.com/repos/e2e/counter/**", (r) =>
    json(r, {
      truncated: false,
      tree: [{ path: "src/lib.rs", type: "blob", sha: "1", url: "" }],
    })
  );
  await page.route("https://raw.githubusercontent.com/e2e/counter/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/plain", body: LIB_RS })
  );
};
