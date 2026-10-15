import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";
import {
  hasDefaultBackend,
  json,
  NO_DEFAULT_BACKEND,
  seedWorkspace,
} from "./fixtures";

/**
 * The panel comes back usable after a reload, without being asked twice.
 *
 * A key-based backend comes back from this tab's `sessionStorage` (the
 * `assistant-own-key` describe block); the default backend needs no key at all
 * -- and making the user click the same button on every single reload, before
 * the assistant could be used at all, was the whole of the difference.
 *
 * "the default backend reconnects itself after a reload" and "disconnecting is
 * not undone by the next reload" are only reachable on a deployment that
 * serves a default backend, which is what the probe in `Connect` decides; they
 * skip where it is not configured, rather than failing on an environment they
 * were never about. The `assistant-own-key` tests need no default backend and
 * run everywhere.
 */

const LONG = { timeout: 60_000 };

/**
 * How long a negative check waits for something asynchronous that must not
 * happen (a reconnect, a request) before it asserts its absence
 */
const QUIET_WINDOW_MS = 3_000;

type AssistantWindow = Window & {
  __pgAssistant?: { isConnected: boolean; items: unknown[] };
};

/**
 * The panel offers the default backend only to a signed-in user, because
 * `/api/agent` refuses anyone else. Neither test sends a turn, so the
 * browser's view of the session is all they need.
 */
const signIn = (page: Page) =>
  page.route("**/api/auth/get-session", (r) =>
    json(r, { user: { id: "u1", name: "Tester", image: null, login: "t" } })
  );

const isConnected = (page: Page) =>
  page.evaluate(() => !!(window as AssistantWindow).__pgAssistant?.isConnected);

/** The picker's connect button reads "Start" for the keyless default */
const start = (page: Page) =>
  page.getByRole("button", { name: "Start", exact: true });

test("the default backend reconnects itself after a reload", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page);

  await page.goto("/");
  test.skip(!(await hasDefaultBackend(page)), NO_DEFAULT_BACKEND);

  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill("alpha");
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);

  // A first visit still asks: choosing a backend is how the panel introduces
  // what it can reach, and nothing has been chosen yet
  await expect(start(page)).toBeVisible(LONG);
  await start(page).click();
  await expect.poll(() => isConnected(page), LONG).toBe(true);

  await page.reload();

  await expect.poll(() => isConnected(page), LONG).toBe(true);
  await expect(start(page)).toBeHidden(LONG);
});

test("disconnecting is not undone by the next reload", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  await page.goto("/");
  test.skip(!(await hasDefaultBackend(page)), NO_DEFAULT_BACKEND);

  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill("beta");
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);

  await expect(start(page)).toBeVisible(LONG);
  await start(page).click();
  await expect.poll(() => isConnected(page), LONG).toBe(true);

  // Disconnecting says "stop using this backend", and a reload that quietly
  // reconnected would be the app overruling that
  await page.evaluate(() =>
    (
      window as Window & { __pgAssistant?: { disconnect: () => void } }
    ).__pgAssistant!.disconnect()
  );
  await page.reload();

  await expect(start(page)).toBeVisible(LONG);
  expect(await isConnected(page)).toBe(false);
});

const KEY = "sk-e2e-own-key-0123456789";
const OWN = {
  id: "openai",
  apiKey: KEY,
  endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
};
/** Where the openai provider posts a turn, as `model/openai.ts` builds it */
const COMPLETIONS_URL = `${OWN.endpoint.baseUrl}/chat/completions`;
const REPLY = "stubbed provider reply";

type OwnWindow = Window & {
  __pgAssistant?: {
    isConnected: boolean;
    connection: {
      id: string;
      apiKey: string;
      endpoint?: { baseUrl: string; model: string };
    } | null;
    isPickingBackend: boolean;
    connect: (c: unknown) => void;
    disconnect: () => void;
    pickBackend: () => void;
  };
};

const connectOwn = (page: Page, connection: unknown = OWN) =>
  page.evaluate(
    (c) => (window as OwnWindow).__pgAssistant!.connect(c),
    connection
  );

const connected = (page: Page) =>
  page.evaluate(() => (window as OwnWindow).__pgAssistant?.connection ?? null);

/**
 * Every key and value one of the page's storages holds, read through the
 * `Storage` API rather than spread into a new shape
 */
const storedValues = (page: Page, store: "localStorage" | "sessionStorage") =>
  page.evaluate((name) => {
    const storage = window[name];
    const values: Record<string, string | null> = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) values[key] = storage.getItem(key);
    }
    return values;
  }, store);

/** Whether a request carries the key anywhere: its URL, a header or its body */
const carriesKey = (req: Request) =>
  [req.url(), JSON.stringify(req.headers()), req.postData() ?? ""].some(
    (part) => part.includes(KEY)
  );

/** The picker's heading when nothing is connected */
const picker = (page: Page) =>
  page.getByText("An assistant that can see your project");

/** Every value the origin's IndexedDB holds, as one string */
const indexedDbDump = (page: Page) =>
  page.evaluate(async () => {
    const out: unknown[] = [];
    let records = 0;
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => ok(req.result);
        req.onerror = () => fail(req.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const all = await new Promise<unknown[]>((ok, fail) => {
          const req = db.transaction(store).objectStore(store).getAll();
          req.onsuccess = () => ok(req.result);
          req.onerror = () => fail(req.error);
        });
        out.push(all);
        records += all.length;
      }
      db.close();
    }
    // Binary values (lightning-fs chunks) stringify as {} and hide nothing
    // text-shaped; decode them so the key cannot hide in a file's bytes
    const text = JSON.stringify(out, (_, v) =>
      v instanceof Uint8Array || v instanceof ArrayBuffer
        ? new TextDecoder().decode(v)
        : v
    );
    return { text, records };
  });

test.describe("assistant-own-key", () => {
  test.setTimeout(240_000);

  test("assistant-own-key: Reloading the tab keeps the connection", async ({
    page,
  }) => {
    await seedWorkspace(page, "own-key-reload");
    await connectOwn(page);
    await page.reload();

    await expect
      .poll(() => connected(page), LONG)
      .toMatchObject({ id: "openai", apiKey: KEY, endpoint: OWN.endpoint });
    // The picker opens on the keyless default, which has no key field, so
    // only its heading says whether it is on screen
    await expect(picker(page)).toBeHidden();
  });

  test("assistant-own-key: Storage that refuses access", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await seedWorkspace(page, "own-key-blocked");
    await connectOwn(page);
    await expect
      .poll(() => connected(page), LONG)
      .toMatchObject({ id: "openai" });

    await page.reload();
    await expect(picker(page)).toBeVisible(LONG);
    expect(await connected(page)).toBeNull();
  });

  test("assistant-own-key: Changing the backend is not undone", async ({
    page,
  }) => {
    await seedWorkspace(page, "own-key-change");
    await connectOwn(page);
    await page.evaluate(() =>
      (window as OwnWindow).__pgAssistant!.pickBackend()
    );
    await expect(page.locator("#assistant-api-key")).toBeVisible(LONG);

    // A reconnect would be asynchronous, so give one a window to show itself
    await page.waitForTimeout(QUIET_WINDOW_MS);

    expect(await connected(page)).toMatchObject({ id: "openai", apiKey: KEY });
    expect(
      await page.evaluate(
        () => (window as OwnWindow).__pgAssistant!.isPickingBackend
      )
    ).toBe(true);
    await expect(page.locator("#assistant-api-key")).toBeVisible();
  });

  test("assistant-own-key: A new tab asks again", async ({ page, context }) => {
    await seedWorkspace(page, "own-key-tab");
    await connectOwn(page);

    const second = await context.newPage();
    await second.goto("/");
    // The picker on screen means `Connect` has mounted, and its reconnect
    // from `sessionStorage` runs on mount: a connection now would be one
    await expect(picker(second)).toBeVisible(LONG);
    expect(await connected(second)).toBeNull();
    expect(
      JSON.stringify(await storedValues(second, "sessionStorage"))
    ).not.toContain(KEY);
  });

  test("assistant-own-key: Forgetting the key, then reload", async ({
    page,
  }) => {
    await seedWorkspace(page, "own-key-forget");
    await connectOwn(page);
    expect(
      JSON.stringify(await storedValues(page, "sessionStorage"))
    ).toContain(KEY);

    await page.getByRole("button", { name: "Forget key" }).click();
    await expect(picker(page)).toBeVisible(LONG);
    await page.reload();

    await expect(picker(page)).toBeVisible(LONG);
    expect(await connected(page)).toBeNull();
    expect(
      JSON.stringify(await storedValues(page, "sessionStorage"))
    ).not.toContain(KEY);
  });

  test("assistant-own-key: Switching to the default backend", async ({
    page,
  }) => {
    await seedWorkspace(page, "own-key-switch");
    await connectOwn(page);
    expect(
      JSON.stringify(await storedValues(page, "sessionStorage"))
    ).toContain(KEY);
    await connectOwn(page, { id: "default", apiKey: "" });

    expect(
      JSON.stringify(await storedValues(page, "sessionStorage"))
    ).not.toContain(KEY);
  });

  test("assistant-own-key: Nothing durable holds the key", async ({ page }) => {
    await seedWorkspace(page, "own-key-durable");
    await connectOwn(page);
    await page.reload();
    await expect
      .poll(() => connected(page), LONG)
      .toMatchObject({ apiKey: KEY });

    expect(
      JSON.stringify(await storedValues(page, "localStorage"))
    ).not.toContain(KEY);
    // The seeded workspace's files live here, so zero records means the
    // read found nothing and the check below would pass for no reason
    const dump = await indexedDbDump(page);
    expect(dump.records).toBeGreaterThan(0);
    expect(dump.text).not.toContain(KEY);
  });

  test("assistant-own-key: Requests to our origin carry no key", async ({
    page,
    baseURL,
  }) => {
    // Connecting and reloading send no provider request, so this guards
    // against a regression that would send the key to our own origin on load
    // or reconnect
    const leaks: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).origin !== new URL(baseURL!).origin) return;
      if (carriesKey(req)) leaks.push(req.url());
    });

    await seedWorkspace(page, "own-key-requests");
    await connectOwn(page);
    await page.reload();
    await expect
      .poll(() => connected(page), LONG)
      .toMatchObject({ apiKey: KEY });
    // `networkidle` never arrives under the dev server (HMR socket, polling),
    // so give the post-connect requests a fixed window to show up instead
    await page.waitForTimeout(QUIET_WINDOW_MS);

    expect(leaks).toEqual([]);
  });

  test("assistant-own-key: Sending a message sends the key to the provider only", async ({
    page,
    baseURL,
  }) => {
    const providerAuth: (string | undefined)[] = [];
    await page.route(COMPLETIONS_URL, (route) => {
      providerAuth.push(route.request().headers()["authorization"]);
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body:
          `data: ${JSON.stringify({
            choices: [{ delta: { content: REPLY } }],
          })}\n\n` + "data: [DONE]\n\n",
      });
    });
    const leaks: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).origin !== new URL(baseURL!).origin) return;
      if (carriesKey(req)) leaks.push(req.url());
    });

    await seedWorkspace(page, "own-key-send");
    await connectOwn(page);
    const composer = page.getByRole("textbox", {
      name: "Message the assistant",
    });
    await composer.fill("hello");
    await composer.press("Enter");

    await expect(page.getByText(REPLY)).toBeVisible(LONG);
    expect(providerAuth).toEqual([`Bearer ${KEY}`]);
    expect(leaks).toEqual([]);

    // The thread is written shortly after the reply lands; wait for it, so a
    // dump taken before the write cannot pass for a clean one
    await expect
      .poll(async () => (await indexedDbDump(page)).text, LONG)
      .toContain(REPLY);
    expect((await indexedDbDump(page)).text).not.toContain(KEY);
  });
});
