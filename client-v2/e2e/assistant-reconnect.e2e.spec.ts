import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";
import { json, seedWorkspace, startProject, stubSession } from "./fixtures";

/**
 * The panel comes back usable after a reload, without being asked twice.
 *
 * A key-based backend comes back from this tab's `sessionStorage` (the
 * `assistant-own-key` describe block); the default backend needs no key at all
 * -- and making the user click the same button on every single reload, before
 * the assistant could be used at all, was the whole of the difference.
 *
 * Each test stubs `/api/agent` to what it needs: the default's tests to a
 * deployment that serves one, the `assistant-own-key` block to one that
 * serves none unless a test says otherwise. So every test runs wherever the
 * dev server runs, configured or not.
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
 * `/api/agent` refuses anyone else. Their turns go to `stubDefault`, so the
 * browser's view of the session is all they need.
 */
const signIn = (page: Page) => stubSession(page);

const isConnected = (page: Page) =>
  page.evaluate(() => !!(window as AssistantWindow).__pgAssistant?.isConnected);

const stubDefault = (page: Page) =>
  page.route("**/api/agent", (route) => {
    if (route.request().method() === "GET")
      return json(route, { configured: true, model: "z-ai/glm-5.3-flash:US" });
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',
    });
  });

const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message the assistant" });

/** The first message connects the default: no key, no connect step */
const sendFirstMessage = async (page: Page) => {
  await composer(page).fill("hi");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => isConnected(page), LONG).toBe(true);
};

test("the default backend reconnects itself after a reload", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page);

  await stubDefault(page);
  await page.goto("/");

  await startProject(page, "alpha", LONG);

  await expect(composer(page)).toBeVisible(LONG);
  await sendFirstMessage(page);

  await page.reload();

  await expect.poll(() => isConnected(page), LONG).toBe(true);
  await expect(
    page.getByRole("button", { name: "Connect a model" })
  ).toBeHidden();
});

test("disconnecting is not undone by the next reload", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  await stubDefault(page);
  await page.goto("/");

  await startProject(page, "beta", LONG);

  await expect(composer(page)).toBeVisible(LONG);
  await sendFirstMessage(page);

  // Disconnecting says "stop using this backend", and a reload that quietly
  // reconnected would be the app overruling that
  await page.evaluate(() =>
    (
      window as Window & { __pgAssistant?: { disconnect: () => void } }
    ).__pgAssistant!.disconnect()
  );
  await page.reload();

  // The composer is back with the default named, and nothing is connected
  await expect(page.getByRole("button", { name: "GLM 5.3 Flash" })).toBeVisible(
    LONG
  );
  // The model button reads "GLM 5.3 Flash" only once the shared probe has
  // answered, and the reconnect effect has run by then
  expect(await isConnected(page)).toBe(false);
});

const KEY = "sk-e2e-own-key-0123456789";
const OWN = {
  id: "openai",
  apiKey: KEY,
  endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
};
/** Where the openai provider posts a turn: `@ai-sdk/openai-compatible` appends the path */
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

/**
 * The composer's model button with nothing connected and no default on the
 * deployment (`stubNoDefault`). It reads so only once the shared probe has
 * answered, and the kept-key reconnect runs on mount, before that: a
 * connection made on load would already show here.
 */
const connectButton = (page: Page) =>
  page.getByRole("button", { name: "Connect a model", exact: true });

/**
 * Nothing connected: the store says so, and the composer offers to connect.
 * Its own step, since the composer and the store answer at different times.
 */
const expectNothingConnected = async (page: Page) => {
  await expect(connectButton(page)).toBeVisible(LONG);
  expect(await connected(page)).toBeNull();
};

/**
 * The deployment serves no default backend, for every page of the context
 * (`A new tab asks again` opens a second): with nothing connected, the
 * composer's model button then reads "Connect a model" wherever the suite
 * runs
 */
const stubNoDefault = (page: Page) =>
  page
    .context()
    .route("**/api/agent", (route) =>
      json(route, { configured: false, model: null })
    );

/** Forget key, from the head's More */
const forgetKey = async (page: Page) => {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Forget key" }).click();
};

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
  test.beforeEach(({ page }) => stubNoDefault(page));

  test("assistant-own-key: Reloading the tab keeps the connection", async ({
    page,
  }) => {
    // The deployment serves a default, and this browser remembers picking it
    // once: the key kept for this tab still wins, because it reconnects on
    // load before the probe can answer and the default's reconnect then
    // finds a connection
    await page.route("**/api/agent", (route) =>
      json(route, { configured: true, model: "z-ai/glm-5.3-flash:US" })
    );
    await seedWorkspace(page, "own-key-reload");
    await connectOwn(page);
    await page.evaluate(() =>
      localStorage.setItem("assistant.backend", "default")
    );
    await page.reload();

    await expect
      .poll(() => connected(page), LONG)
      .toMatchObject({ id: "openai", apiKey: KEY, endpoint: OWN.endpoint });
    // Connected, the model button names the model instead
    await expect(page.getByRole("button", { name: "gpt-x" })).toBeVisible(LONG);
    // Nothing asks for the key again
    await expect(page.locator("#assistant-api-key")).toHaveCount(0);
    // The probe has answered by now; give the default's reconnect a window
    // to show itself
    await page.waitForTimeout(QUIET_WINDOW_MS);
    expect(await connected(page)).toMatchObject({ id: "openai", apiKey: KEY });
  });

  test("a model tuned in the composer comes back after a reload", async ({
    page,
  }) => {
    await seedWorkspace(page, "own-key-tuned");
    await connectOwn(page, {
      id: "anthropic",
      apiKey: KEY,
      settings: { model: "claude-opus-5-5", effort: "medium" },
    });
    await page.getByRole("button", { name: "Opus 5.5" }).click(LONG);
    await page.getByRole("menuitemradio", { name: /Sonnet 5\.5/ }).click();
    await expect(page.getByRole("button", { name: "Sonnet 5.5" })).toBeVisible(
      LONG
    );

    await page.reload();

    await expect(page.getByRole("button", { name: "Sonnet 5.5" })).toBeVisible(
      LONG
    );
    expect(await connected(page)).toMatchObject({
      id: "anthropic",
      apiKey: KEY,
    });
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
    await expectNothingConnected(page);
  });

  test("assistant-own-key: Changing the backend is not undone", async ({
    page,
  }) => {
    await seedWorkspace(page, "own-key-change");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: /Connect a model/ }).click();
    const dialog = page.getByRole("dialog", { name: "Connect a model" });
    await expect(dialog.locator("#assistant-api-key")).toBeVisible(LONG);

    // A key kept for this tab, with nothing connected: what the panel's
    // reconnect on mount picks up
    await page.evaluate(
      (c) => sessionStorage.setItem("assistant.connection", JSON.stringify(c)),
      OWN
    );
    // Folding the panel unmounts it and opening it mounts it again, and with
    // it the reconnect; the dialog stays, since it lives outside the panel
    const expand = page.locator('[aria-label="Expand assistant"]');
    await page.keyboard.press("ControlOrMeta+r");
    await expect(expand).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+r");
    await expect(expand).toHaveCount(0);

    // A reconnect would be asynchronous, so give one a window to show itself
    await page.waitForTimeout(QUIET_WINDOW_MS);

    expect(await connected(page)).toBeNull();
    expect(
      await page.evaluate(
        () => (window as OwnWindow).__pgAssistant!.isPickingBackend
      )
    ).toBe(true);
    await expect(dialog.locator("#assistant-api-key")).toBeVisible();
  });

  test("assistant-own-key: A new tab asks again", async ({ page, context }) => {
    await seedWorkspace(page, "own-key-tab");
    await connectOwn(page);

    const second = await context.newPage();
    await second.goto("/");
    await expectNothingConnected(second);
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

    await forgetKey(page);
    await expectNothingConnected(page);
    await page.reload();

    await expectNothingConnected(page);
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
        body: `data: ${JSON.stringify({
          choices: [{ delta: { content: REPLY } }],
        })}\n\ndata: [DONE]\n\n`,
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
  /**
   * A thread answered by the user's own key, then a new tab: signed in, on a
   * deployment that serves a default whose turns are counted, so a send that
   * fell back to it would show
   */
  const keyedThreadInNewTab = async (page: Page) => {
    const defaultTurns: string[] = [];
    await page.context().route("**/api/agent", (route) => {
      if (route.request().method() === "GET")
        return json(route, {
          configured: true,
          model: "z-ai/glm-5.3-flash:US",
        });
      defaultTurns.push(route.request().postData() ?? "");
      return route.fulfill({ status: 500 });
    });
    await page.context().route(COMPLETIONS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [{ delta: { content: REPLY }, finish_reason: "stop" }],
        })}\n\ndata: [DONE]\n\n`,
      })
    );
    await signIn(page);
    await seedWorkspace(page, "own-key-thread");
    await connectOwn(page);
    await composer(page).fill("hello");
    await composer(page).press("Enter");
    await expect(page.getByText(REPLY)).toBeVisible(LONG);

    const second = await page.context().newPage();
    await signIn(second);
    await second.goto("/");
    await expect(second.getByText(REPLY)).toBeVisible(LONG);
    await composer(second).fill("again");
    await composer(second).press("Enter");
    return { second, defaultTurns };
  };

  test("assistant-own-key: A new tab does not continue a keyed thread on the default", async ({
    page,
  }) => {
    const { second, defaultTurns } = await keyedThreadInNewTab(page);

    const dialog = second.getByRole("dialog", { name: "Connect a model" });
    await expect(dialog).toBeVisible(LONG);
    await expect(
      dialog.getByRole("radio", { name: /^OpenAI-compatible/ })
    ).toBeChecked();
    await expect(second.locator("#assistant-base-url")).toHaveValue(
      OWN.endpoint.baseUrl
    );
    await expect(second.locator("#assistant-model")).toHaveValue("gpt-x");
    await expect(second.locator("#assistant-api-key")).toHaveValue("");
    // The dialog hides the panel behind it; closed, the prompt is still there
    await second.keyboard.press("Escape");
    await expect(composer(second)).toHaveValue("again");
    expect(defaultTurns).toEqual([]);
  });

  test("assistant-own-key: Entering the key continues the same thread", async ({
    page,
  }) => {
    const { second, defaultTurns } = await keyedThreadInNewTab(page);

    await second.locator("#assistant-api-key").fill(KEY);
    await second
      .getByRole("dialog", { name: "Connect a model" })
      .getByRole("button", { name: "Connect" })
      .click();
    await composer(second).press("Enter");

    await expect(second.getByText(REPLY)).toHaveCount(2, LONG);
    const log = second.getByRole("log", { name: "Conversation" });
    await expect(log).toContainText("You: hello");
    await expect(log).toContainText("You: again");
    expect(defaultTurns).toEqual([]);
  });
  /**
   * A conversation on the user's own key, then Connect a model open over it
   * with another model typed in: a different connection, which used to start
   * a new conversation
   */
  const switchingModel = async (page: Page) => {
    const turns: { model?: string; messages?: unknown[] }[] = [];
    await page.route(COMPLETIONS_URL, (route) => {
      turns.push(JSON.parse(route.request().postData() ?? "{}"));
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [{ delta: { content: REPLY }, finish_reason: "stop" }],
        })}\n\ndata: [DONE]\n\n`,
      });
    });
    await seedWorkspace(page, "own-key-switch");
    await connectOwn(page);
    await composer(page).fill("hello");
    await composer(page).press("Enter");
    await expect(page.getByText(REPLY)).toBeVisible(LONG);

    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: /Connect a model/ }).click();
    const dialog = page.getByRole("dialog", { name: "Connect a model" });
    await dialog.locator("#assistant-model").fill("gpt-y");
    return { dialog, turns };
  };

  test("assistant-own-key: Switching backends keeps the thread", async ({
    page,
  }) => {
    const { dialog, turns } = await switchingModel(page);
    await dialog.getByRole("button", { name: "Switch" }).click();
    await expect(dialog).toBeHidden(LONG);

    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log).toContainText("You: hello");
    await composer(page).fill("again");
    await composer(page).press("Enter");
    await expect(page.getByText(REPLY)).toHaveCount(2, LONG);
    expect(turns.map((t) => t.model)).toEqual(["gpt-x", "gpt-y"]);
    expect(JSON.stringify(turns[1].messages)).toContain("hello");
  });

  test("assistant-own-key: No warning about a new conversation", async ({
    page,
  }) => {
    const { dialog } = await switchingModel(page);

    await expect(dialog.locator("#assistant-model")).toHaveValue("gpt-y");
    await expect(dialog).not.toContainText("new conversation");
  });
  test("assistant-own-key: A 401 offers Enter key", async ({ page }) => {
    await page.route(COMPLETIONS_URL, (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Incorrect API key" } }),
      })
    );
    await seedWorkspace(page, "own-key-401");
    await connectOwn(page);
    await composer(page).fill("hello");
    await composer(page).press("Enter");

    await expect(
      page.getByText(
        "OpenAI-compatible did not accept this key. Check it and enter it again, or pick another model."
      )
    ).toBeVisible(LONG);
    await page.locator("#assistant-enter-key").click();

    const dialog = page.getByRole("dialog", { name: "Connect a model" });
    await expect(dialog).toBeVisible(LONG);
    await expect(dialog.locator("#assistant-model")).toHaveValue("gpt-x");
    await expect(dialog.locator("#assistant-api-key")).toHaveValue("");
  });
  /** A deployment serving a default whose turns are counted, signed in */
  const countedDefault = async (page: Page) => {
    const defaultTurns: string[] = [];
    await page.context().route("**/api/agent", (route) => {
      if (route.request().method() === "GET")
        return json(route, {
          configured: true,
          model: "z-ai/glm-5.3-flash:US",
        });
      defaultTurns.push(route.request().postData() ?? "");
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      });
    });
    await signIn(page);
    return defaultTurns;
  };

  test("assistant-own-key: The remembered choice holds no key", async ({
    page,
  }) => {
    await seedWorkspace(page, "own-key-choice");
    await connectOwn(page);

    const stored = await storedValues(page, "localStorage");
    expect(JSON.parse(stored["assistant.backend"] ?? "null")).toEqual({
      provider: "openai",
      model: "gpt-x",
      baseUrl: OWN.endpoint.baseUrl,
    });
    expect(JSON.stringify(stored)).not.toContain(KEY);
  });

  test("assistant-own-key: A new thread takes the last chosen backend", async ({
    page,
  }) => {
    const defaultTurns = await countedDefault(page);
    await seedWorkspace(page, "own-key-new-thread");
    await connectOwn(page);

    const second = await page.context().newPage();
    await signIn(second);
    await second.goto("/");
    await composer(second).fill("hi");
    await composer(second).press("Enter");

    const dialog = second.getByRole("dialog", { name: "Connect a model" });
    await expect(dialog).toBeVisible(LONG);
    await expect(dialog.locator("#assistant-model")).toHaveValue("gpt-x");
    await expect(dialog.locator("#assistant-api-key")).toHaveValue("");
    expect(defaultTurns).toEqual([]);
  });

  test("assistant-own-key: A thread answered by the default reconnects the default", async ({
    page,
  }) => {
    const defaultTurns = await countedDefault(page);
    await seedWorkspace(page, "own-key-default-thread");
    await composer(page).fill("hi");
    await composer(page).press("Enter");
    await expect(page.getByText("Hello", { exact: true })).toBeVisible(LONG);

    const second = await page.context().newPage();
    await signIn(second);
    await second.goto("/");
    await expect(second.getByText("Hello", { exact: true })).toBeVisible(LONG);
    await composer(second).fill("again");
    await composer(second).press("Enter");

    await expect.poll(() => defaultTurns.length, LONG).toBe(2);
    await expect(
      second.getByRole("dialog", { name: "Connect a model" })
    ).toHaveCount(0);
  });
});
