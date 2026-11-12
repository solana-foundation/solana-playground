import type { Page } from "@playwright/test";

import {
  deployHelloWorldWith,
  expect,
  greetWithAnchor,
  HELLO_ANCHOR_IDL,
  LONG,
  runInTerminal,
  seedPlaynetProject,
  terminalRows,
  test,
} from "./fixtures";

/**
 * `run` and `test` execute project code in a sandboxed, opaque-origin frame
 * (`utils/js-runtime`, `runtime.html`). Every case runs on Playnet, so
 * nothing leaves the browser.
 */

/** Runs a command and waits for the line that says it is over */
const runFor = (page: Page) => async (command: string, expected: RegExp) => {
  await runInTerminal(page, command);
  await expect(terminalRows(page)).toContainText(expected, LONG);
};

/**
 * The terminal's text from its bottom up to its first line. The rows in the
 * DOM are only the ones in view, and Firefox's stack of a failing test (its
 * frames uncapped, async ones included) pushes mocha's summary above them.
 */
const scrollbackOf = async (page: Page) => {
  const viewport = page.locator(".xterm-viewport").first();
  const nextFrame = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
  let text = (await terminalRows(page).textContent()) ?? "";
  for (let isAtTop = false; !isAtTop; ) {
    isAtTop = await viewport.evaluate((el) => {
      el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight / 2);
      return el.scrollTop === 0;
    });
    await nextFrame();
    text = `${(await terminalRows(page).textContent()) ?? ""}${text}`;
  }
  return text;
};

test.describe("project-code-sandbox", () => {
  test("project-code-sandbox: The default client runs", async ({
    context,
    page,
  }) => {
    const { address } = await seedPlaynetProject(context, page);

    await runFor(page)("run", /My balance: [\d.]+ SOL/);

    await expect(terminalRows(page)).toContainText(`My address: ${address}`);
  });

  test("project-code-sandbox: Imports resolve inside the sandbox", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      [
        'import * as anchor from "@coral-xyz/anchor";',
        'import { getAssociatedTokenAddressSync } from "@solana/spl-token";',
        'console.log("imports:", typeof anchor.Program, typeof getAssociatedTokenAddressSync);',
      ].join("\n")
    );

    await runFor(page)("run", /imports: function function/);
  });

  test("project-code-sandbox: A syntax error ends the run", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient('console.log("a" "b");');

    await runInTerminal(page, "run");

    await expect(terminalRows(page)).toContainText("',' expected", LONG);
    // The prompt is back: the command ended
    await expect(terminalRows(page)).toHaveText(/\$\s*$/, LONG);
  });

  test("project-code-sandbox: An error thrown in a callback the code awaits ends the run", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      [
        "await new Promise(() => {",
        '  setTimeout(() => { throw new Error("boom"); }, 0);',
        "});",
      ].join("\n")
    );

    await runInTerminal(page, "run");

    // Not "Script error.": the sandbox loads its scripts with CORS, so the
    // browser does not mute their errors
    await expect(terminalRows(page)).toContainText(
      "Uncaught error: boom",
      LONG
    );
    // The prompt is back: the command ended
    await expect(terminalRows(page)).toHaveText(/\$\s*$/, LONG);
  });

  test("project-code-sandbox: A callback the code does not await still gets its reply", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      'pg.connection.getBalance(pg.wallet.publicKey).then((b) => console.log("late balance:", b));'
    );

    await runInTerminal(page, "run");

    // As in the old runtime: printed after the run ended
    await expect(terminalRows(page)).toContainText(/late balance: \d+/, LONG);
  });

  test("project-code-sandbox: An error after the run ended says so", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      'setTimeout(() => { throw new Error("late"); }, 500);\nconsole.log("ran");'
    );

    await runInTerminal(page, "run");

    await expect(terminalRows(page)).toContainText(
      "Uncaught error after the run ended: late",
      LONG
    );
  });

  test("project-code-sandbox: A failing test is reported", async ({
    context,
    page,
  }) => {
    const { writeTest } = await seedPlaynetProject(context, page);
    await writeTest(
      [
        'describe("Suite", () => {',
        '  it("passes", () => assert.equal(1, 1));',
        '  it("fails", () => assert.equal(1, 2));',
        "});",
      ].join("\n")
    );

    await runInTerminal(page, "test");
    await expect(terminalRows(page)).toContainText("Running tests", LONG);
    await expect(terminalRows(page)).toHaveText(/\$\s*$/, LONG);

    const output = await scrollbackOf(page);
    expect(output).toContain("1 passing");
    expect(output).toContain("1 failing");
  });

  test("project-code-sandbox: Anchor workspace and program are ready", async ({
    context,
    page,
  }) => {
    test.slow();
    const { writeTest } = await seedPlaynetProject(context, page);
    // Written before the deploy, while the editor still has the focus
    await writeTest(greetWithAnchor("signers"));
    await deployHelloWorldWith(HELLO_ANCHOR_IDL)(page);

    await runFor(page)("test", /1 passing/);

    await expect(terminalRows(page)).toContainText("same program: true true");
    await expect(terminalRows(page)).toContainText("landed: true");
  });

  test("project-code-sandbox: A refused IDL says why where the program would be", async ({
    context,
    page,
  }) => {
    test.slow();
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      [
        'import * as anchor from "@coral-xyz/anchor";',
        'try { pg.program; } catch (e) { console.log("program:", e.message); }',
        'try { anchor.workspace.helloAnchor; } catch (e) { console.log("workspace:", e.message); }',
        'console.log("keys:", Object.keys(pg).includes("program"));',
      ].join("\n")
    );
    // Names a program but is no Anchor IDL, so `readIdl` refuses it
    await deployHelloWorldWith({
      address: "x",
      metadata: { name: "hello_anchor" },
    })(page);

    await runFor(page)("run", /keys: false/);

    await expect(terminalRows(page)).toContainText(
      "program: The program's IDL can't be called"
    );
    await expect(terminalRows(page)).toContainText(
      "workspace: The program's IDL can't be called"
    );
  });

  test("project-code-sandbox: A script runs against Playnet", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      [
        "const airdrop = await pg.connection.requestAirdrop(pg.wallet.publicKey, 2 * web3.LAMPORTS_PER_SOL);",
        "await pg.connection.confirmTransaction(airdrop);",
        "const before = await pg.connection.getBalance(pg.wallet.publicKey);",
        "const to = web3.Keypair.generate().publicKey;",
        "const sig = await web3.sendAndConfirmTransaction(pg.connection, new web3.Transaction().add(",
        "  web3.SystemProgram.transfer({ fromPubkey: pg.wallet.publicKey, toPubkey: to, lamports: 1000000 })",
        "), [pg.wallet.keypair]);",
        'console.log("balance:", before > 0, "received:", await pg.connection.getBalance(to));',
      ].join("\n")
    );

    await runFor(page)("run", /balance: true received: 1000000/);
  });

  test("project-code-sandbox: A sandboxed script cannot read the page's storage", async ({
    context,
    page,
  }) => {
    const { writeClient, address } = await seedPlaynetProject(context, page);
    await writeClient(
      [
        "const results = [];",
        "const probe = async (name, read) => {",
        "  try {",
        "    const value = await read();",
        '    results.push(name + ":" + (value ? "found " + value : "empty"));',
        "  } catch (e) {",
        '    results.push(name + ":threw");',
        "  }",
        "};",
        'await probe("localStorage", () => localStorage.getItem("wallet"));',
        'await probe("sessionStorage", () => sessionStorage.getItem("e2e-wallet-seeded"));',
        'await probe("indexedDB", () => new Promise((resolve, reject) => {',
        '  const request = indexedDB.open("pg-wallet");',
        "  request.onsuccess = () => resolve(request.result.objectStoreNames.length);",
        "  request.onerror = () => reject(request.error);",
        "}));",
        'await probe("cookie", () => document.cookie);',
        'console.log(results.join(" "));',
      ].join("\n")
    );

    await runFor(page)("run", /cookie:(threw|empty)/);

    const rows = terminalRows(page);
    for (const name of ["localStorage", "sessionStorage", "indexedDB"]) {
      await expect(rows).toContainText(new RegExp(`${name}:(threw|empty)`));
    }
    await expect(rows).not.toContainText("found");
    await expect(rows).not.toContainText(address.slice(0, 12), {
      timeout: 1,
    });
  });

  test("project-code-sandbox: A sandboxed script cannot reach the page", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      [
        "const results = [];",
        "const probe = (name, read) => {",
        "  try {",
        "    read();",
        '    results.push(name + ":read");',
        "  } catch (e) {",
        '    results.push(name + ":" + e.name);',
        "  }",
        "};",
        'probe("parent.document", () => window.parent.document.title);',
        'probe("top.localStorage", () => window.top.localStorage.length);',
        'const p = "par" + "ent";',
        'probe("parent.PgWallet", () => self[p].PgWallet.current);',
        'console.log(results.join(" "));',
      ].join("\n")
    );

    await runFor(page)("run", /parent\.PgWallet:\w+/);

    const rows = terminalRows(page);
    await expect(rows).toContainText("parent.document:SecurityError");
    await expect(rows).toContainText("top.localStorage:SecurityError");
    await expect(rows).toContainText("parent.PgWallet:SecurityError");
  });

  test("project-code-sandbox: A sandboxed script cannot find the key on pg", async ({
    context,
    page,
  }) => {
    const { writeClient, keypair } = await seedPlaynetProject(context, page);
    const privateKeyHex = Buffer.from(keypair.secretKey.slice(0, 32)).toString(
      "hex"
    );
    await writeClient(
      [
        // The test knows the key; the script looks for it in every form
        `const keyHex = "${privateKeyHex}";`,
        'const keyBytes = Buffer.from(keyHex, "hex");',
        'const forms = [keyHex, new web3.PublicKey(keyBytes).toBase58(), keyBytes.toString("base64")];',
        "const holdsKey = (value) => {",
        '  if (typeof value === "string") return forms.some((form) => value.includes(form));',
        '  if (value instanceof Uint8Array || (Array.isArray(value) && value.every((n) => typeof n === "number")))',
        '    return Buffer.from(value).toString("hex").includes(keyHex);',
        "  return false;",
        "};",
        "const seen = new Set();",
        "let found = false;",
        "let visited = 0;",
        "const walk = (value, depth) => {",
        '  if (value === null || (typeof value !== "object" && typeof value !== "function")) {',
        "    if (holdsKey(value)) found = true;",
        "    return;",
        "  }",
        "  if (seen.has(value) || depth > 6) return;",
        "  seen.add(value);",
        "  visited++;",
        "  if (holdsKey(value)) found = true;",
        "  for (const key of Reflect.ownKeys(value)) {",
        "    let child;",
        "    try { child = value[key]; } catch (e) { continue; }",
        "    walk(child, depth + 1);",
        "  }",
        "  walk(Object.getPrototypeOf(value), depth + 1);",
        "};",
        "walk(pg, 0);",
        "walk(pg.wallet, 0);",
        "walk(pg.wallet.keypair, 0);",
        'console.log("walked:", visited > 10, "key found:", found);',
      ].join("\n")
    );

    await runFor(page)("run", /walked: true key found: false/);
  });

  test("project-code-sandbox: A message to sign that is not bytes fails the call, not the run", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      [
        "try {",
        '  await pg.wallet.signMessage("hello");',
        "} catch (e) {",
        '  console.log("refused:", e.message);',
        "}",
        'const signature = await pg.wallet.signMessage(new TextEncoder().encode("hello"));',
        'console.log("signed:", signature.length);',
      ].join("\n")
    );

    await runFor(page)("run", /signed: 64/);
    await expect(terminalRows(page)).toContainText(
      "refused: signMessage takes the message as bytes"
    );

    // The run ended, so the next one starts
    await runFor(page)("run", /signed: 64[\s\S]*signed: 64/);
    await expect(terminalRows(page)).not.toContainText("already running");
  });

  test("project-code-sandbox: A run whose frame reloads ends", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      [
        'console.log("reloading");',
        "location.reload();",
        "await sleep(60000);",
      ].join("\n")
    );

    await runFor(page)("run", /reloaded or navigated away/);
    await expect(terminalRows(page)).toHaveText(/\$\s*$/, LONG);

    // The run ended, so the next one starts
    await runFor(page)(
      "run",
      /reloaded or navigated away[\s\S]*reloaded or navigated away/
    );
    await expect(terminalRows(page)).not.toContainText("already running");
  });

  test("project-code-sandbox: The runtime is served sandboxed, for the app's frames only", async ({
    page,
  }) => {
    const response = await page.request.get("/runtime.html");
    expect(response.headers()["content-security-policy"]).toBe(
      "sandbox allow-scripts; frame-ancestors 'self'"
    );
  });

  test("project-code-sandbox: The runtime refuses to start on the app's origin", async ({
    context,
    page,
  }) => {
    await seedPlaynetProject(context, page);
    // The runtime's page as a `srcdoc`, which has no CSP of its own: without
    // a `sandbox` attribute it runs on the app's origin
    const runtimePage = await (await page.request.get("/runtime.html")).text();

    /** Whether the runtime, framed with this `sandbox`, announces itself */
    const announces = (sandbox: string | undefined) =>
      page.evaluate(
        ([html, attribute]) =>
          new Promise<boolean>((resolve) => {
            const frame = document.createElement("iframe");
            if (attribute !== undefined) {
              frame.setAttribute("sandbox", attribute);
            }
            const handleMessage = (event: MessageEvent) => {
              if (
                event.source === frame.contentWindow &&
                (event.data as { type?: string })?.type === "ready"
              ) {
                resolve(true);
              }
            };
            window.addEventListener("message", handleMessage);
            setTimeout(() => resolve(false), 10_000);
            frame.srcdoc = html;
            document.body.appendChild(frame);
          }),
        [runtimePage, sandbox] as const
      );

    expect(await announces("allow-scripts")).toBe(true);
    expect(await announces(undefined)).toBe(false);
  });

  test("project-code-sandbox: A run's code never reaches the next run", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    // The first run keeps announcing itself as a fresh runtime, and answers
    // any port it is handed as if it ran the next run's code
    await writeClient(
      [
        'setInterval(() => parent.postMessage({ type: "ready" }, "*"), 0);',
        'window.addEventListener("message", (e) => {',
        "  const port = e.ports[0];",
        "  if (!port) return;",
        '  port.postMessage({ type: "output", level: "log", text: "stolen" });',
        '  port.postMessage({ type: "end" });',
        "});",
        'console.log("armed");',
      ].join("\n")
    );
    await runFor(page)("run", /armed/);

    // The same code again: it prints only if it reached the new runtime
    await runFor(page)("run", /armed[\s\S]*armed/);

    await expect(terminalRows(page)).not.toContainText("stolen");
  });

  test("project-code-sandbox: Messages from elsewhere are ignored", async ({
    context,
    page,
  }) => {
    // Records every message the page posts on a port, the sandbox's included
    await page.addInitScript(() => {
      const log: unknown[] = [];
      Object.assign(window, { __portLog: log });
      const post = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (
        this: MessagePort,
        ...args: Parameters<MessagePort["postMessage"]>
      ) {
        const data = args[0] as { type?: string; id?: number };
        log.push({ type: data?.type, id: data?.id });
        return post.apply(this, args);
      };
    });
    const { writeClient, address } = await seedPlaynetProject(context, page);
    await writeClient(
      [
        'console.log("waiting");',
        "await sleep(3000);",
        'console.log("still running:", pg.wallet.publicKey.toBase58());',
      ].join("\n")
    );

    // Another frame announces itself as the runtime from before the run
    // starts until it ends: the page must wait for its own frame's handshake
    await page.evaluate(() => {
      const forger = document.createElement("iframe");
      forger.srcdoc =
        "<script>setInterval(() => parent.postMessage({ type: 'ready' }, '*'), 5)</script>";
      document.body.appendChild(forger);
    });
    await runInTerminal(page, "run");
    await expect(terminalRows(page)).toContainText("waiting", LONG);
    // A window that is not the sandbox asks the page to sign, and to hand
    // over a port
    await page.evaluate((publicKey) => {
      const forged = {
        type: "sign",
        id: 999,
        publicKey,
        kind: "message",
        bytes: new Uint8Array([1, 2, 3]),
      };
      window.postMessage(forged, "*");
      window.postMessage({ type: "ready" }, "*");
      const other = document.createElement("iframe");
      document.body.appendChild(other);
      other.contentWindow?.parent.postMessage(forged, "*");
    }, address);

    await expect(terminalRows(page)).toContainText(
      `still running: ${address}`,
      LONG
    );
    const posted = await page.evaluate(
      () => (window as unknown as { __portLog: unknown[] }).__portLog
    );
    expect(posted).toContainEqual({ type: "run", id: undefined });
    expect(posted).not.toContainEqual({ type: "sign", id: 999 });
    expect(
      posted.filter((m) => (m as { type: string }).type === "sign")
    ).toEqual([]);
  });
});
