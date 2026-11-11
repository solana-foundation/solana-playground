import type { BrowserContext, Page, Route } from "@playwright/test";
import { expect, test as base } from "@playwright/test";

import { isUuid } from "../src/shared/lib/ids";
import { requireFor } from "../src/test-utils/require-for";

/** For a step that waits on the explorer, sync or a reload */
export const LONG = { timeout: 60_000 };

/** Devnet's JSON-RPC and websocket endpoints, as a route matches them whole */
export const DEVNET_RPC = /^https:\/\/api\.devnet\.solana\.com\/?$/;
export const DEVNET_WS = /^wss:\/\/api\.devnet\.solana\.com\/?$/;

/** Home, which a start with no project shows in place of the work */
export const home = (page: Page) =>
  page.getByRole("heading", { name: "Where should we begin?" });

/** Home's region, which keeps a query off the navigation's items of the same name */
export const homeRegion = (page: Page) =>
  page.getByRole("region", { name: "Home" });

/** The New project page, which covers Home or the work while it shows */
export const newProjectPage = (page: Page) =>
  page.getByRole("region", { name: "New project" });

/**
 * Makes a project from Home's New project tile, through Start from scratch on
 * the New project page it opens (`features/new-project`).
 *
 * The tile is scoped to Home's region: the navigation has a "New project"
 * item of the same name.
 */
// eslint-disable-next-line layers/curry-order, max-params -- 15 call sites in other specs pass `(page, name, LONG)`; they move to `startProjectWith(timeout)(page, name)` together
export const startProject = async (page: Page, name: string, timeout = {}) => {
  await expect(home(page)).toBeVisible(timeout);
  await homeRegion(page)
    .getByRole("button", { name: /^New project/ })
    .click();
  const created = newProjectPage(page);
  await created.getByLabel("Project name").fill(name);
  await created.getByRole("button", { name: /^Start/ }).click();
  await expect(created).toBeHidden(timeout);
  await expect(home(page)).toBeHidden(timeout);
};

/** The editor head's Files toggle (client-v2-editor-head) */
export const filesToggle = (page: Page) => page.locator("#editor-head-files");

/**
 * The editor holding the focus it takes when it mounts and opens the current
 * file. Monaco is a lazy chunk, and on a loaded runner it arrives well past
 * an assertion's 20 s (30 s seen on CI): the wait is the page load's,
 * as for the About page's Start.
 */
export const editorTookFocus = (page: Page) =>
  expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused(LONG);

/**
 * A reload, then the app up again: every lazy chunk is fetched anew, so the
 * app's boot, not the step a test waits for after the reload, spends that
 * step's timeout
 */
export const reloadAndBoot = async (page: Page) => {
  await page.reload();
  await editorTookFocus(page);
};

/**
 * The About page's Start, which begins a tutorial. The page draws it only once
 * the tutorial's lazy chunk loads, which a cold dev server compiles in more
 * than an action's 10 s: the wait names the button if it never comes. `exact`
 * keeps it off Connect a model's own Start.
 */
export const startTutorialFromAbout = async (page: Page) => {
  const start = page.getByRole("button", { name: "Start", exact: true });
  await expect(start).toBeVisible(LONG);
  await start.click();
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
// eslint-disable-next-line layers/curry-order -- 60 call sites in other specs call `seedWorkspace(page)` or `(page, name)`
export const seedWorkspace = async (page: Page, name = "e2e-project") => {
  await page.goto("/");
  await startProject(page, name);

  // `PgExplorer.createWorkspace` hands the work over, then the explorer
  // re-initializes -- wait for the work, not just Home going away: its
  // editor head, and the tree when the layout has it open. A spec that
  // clears the tree-open seed (playwright.config's `storageState`) gets a
  // closed tree, which `openFiles` opens.
  const toggle = filesToggle(page);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-pressed")) === "true") {
    await expect(page.locator("#root-dir")).toBeVisible();
  }
};

/**
 * The console bar's own "Terminal" button; the editor head's toggle has the
 * same name (`#editor-head-terminal`), so a role lookup finds both
 */
export const consoleTrigger = (page: Page) =>
  page.locator('[data-slot="console-drawer-trigger"]');

/** Opens the file tree from the editor head, if it is not open already */
export const openFiles = async (page: Page) => {
  const toggle = filesToggle(page);
  await expect(toggle).toBeVisible(LONG);
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
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
  // Focused, not clicked: xterm sizes its helper textarea only while the
  // terminal has the focus, and a console that opened on its own (a wallet's
  // setup, a run) keeps the focus where it was, so the textarea is 0 x 0 and
  // never reads as visible for a click
  await input.focus();
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
 * Starts every page of a fresh profile on Devnet, the cluster the specs stub
 * and name. The dev server runs with the platform RPC URLs blanked
 * (`playwright.config.mts`), so Devnet is the public endpoint. A profile that
 * already holds settings keeps them.
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
    await editorTookFocus(page);
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
  const files: Record<string, string> = {};
  if (body.files) Object.assign(files, body.files);
  else Object.assign(files, held?.files, body.changed);
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

/** The chat-completions stream `/api/agent` answers with: `text`, then stop */
export const streamed = (text: string) =>
  [
    { choices: [{ index: 0, delta: { role: "assistant", content: text } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ]
    .map((c) => `data: ${JSON.stringify(c)}\n\n`)
    .join("") + "data: [DONE]\n\n";

/**
 * What `GET /api/ai/status` answers, whatever the dev server is configured
 * with: the hosted model's id (a string, or `null` for one with no name), or
 * `"own"` for a deployment with no hosted key. The client takes signed-in-ness
 * from the session (`stubSession`), not from `reason`, so a hosted answer
 * carries `reason: "signed-out"` either way; only `reason: "unavailable"`
 * would change what the client reads.
 */
export const stubAiStatus = (
  target: Page | BrowserContext,
  hosted: string | null | "own"
) =>
  target.route("**/api/ai/status", (r) =>
    json(
      r,
      hosted === "own"
        ? // eslint-disable-next-line unicorn/no-null -- the `GET /api/ai/status` body: `null` is on the wire
          { available: false, key: "own", reason: null, model: null }
        : {
            available: false,
            key: "hosted",
            reason: "signed-out",
            model: hosted,
          }
    )
  );

/** The user the session stubs sign in as */
export const TEST_USER = {
  id: "u1",
  name: "Tester",
  // eslint-disable-next-line unicorn/no-null -- the session endpoint answers `image: null` for an account without one
  image: null,
  login: "t",
};

/**
 * What the browser reads as its session: `TEST_USER`, or nobody for `null`.
 * The default backend answers only a signed-in user, so a test that sends to
 * it signs in first; its turns go to the test's own `/api/agent` stub.
 */
// eslint-disable-next-line layers/curry-order -- 15 call sites in other specs call `stubSession(page)` or `(page, null)`
export const stubSession = (page: Page, user: unknown = TEST_USER) =>
  page.route("**/api/auth/get-session", (r) => json(r, { user }));

/** What the browser reads as its session when nobody is signed in */
export const stubSignedOut = (page: Page) =>
  page.route("**/api/auth/get-session", (r) =>
    json(r, {
      // eslint-disable-next-line unicorn/no-null -- the session endpoint answers `user: null` for nobody
      user: null,
    })
  );

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
  const refuseWith = (status: number) => (r: Route, body: unknown) =>
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
        return refuseWith(400)(r, { error: "id, name and kind required" });
      }
      // A patch is made against a stored row: without one it is the
      // conflict the real endpoint answers, not a project of the changed
      // files alone
      if (!body.files && !rows.has(body.id)) {
        return refuseWith(409)(r, {
          conflict: true,
          // eslint-disable-next-line unicorn/no-null -- the endpoint's conflict answer carries `updatedAt: null` for a missing row
          updatedAt: null,
        });
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
      return refuseWith(405)(r, { error: "Method not allowed" });
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
      : refuseWith(404)(r, { error: "Not found" });
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
  page.evaluate(async (workspaceName) => {
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
            )?.find?.((w) => w.name === workspaceName);
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
    return undefined;
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

  const seen: { id?: string } = {};
  await expect
    .poll(async () => (seen.id = await workspaceIdOf(page, name)), LONG)
    .toBeTruthy();
  const workspaceId = requireFor(`the workspace id of ${name}`)(seen.id);
  expect(isUuid(workspaceId)).toBe(true);
  return workspaceId;
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

/** Opens the New project page through the navigation's New project item */
export const openGallery = async (page: Page) => {
  await page
    .locator('[data-slot="sidebar"]')
    .getByRole("button", { name: "New project" })
    .click();
};

/**
 * Starts another project from the New project page, opened from the navigation, while
 * a project is open; a fresh profile starts from Home instead (`startProject`)
 */
export const startAnotherProject = async (page: Page, name: string) => {
  await openGallery(page);
  const gallery = page.locator("[data-new-project]");
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

/**
 * Whether any value in the page's IndexedDB holds `needle` as text: a file
 * the app wrote has reached the store, so a reload reads it. Values are
 * tried whole, as `workspaceIdOf` does, since files are kept by inode.
 */
export const isStored = (page: Page, needle: string) =>
  page.evaluate(async (text) => {
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
          let decoded = "";
          if (typeof value === "string") decoded = value;
          else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
            decoded = new TextDecoder().decode(value as ArrayBuffer);
          }
          if (decoded.includes(text)) {
            db.close();
            return true;
          }
        }
      }
      db.close();
    }
    return false;
  }, needle);
