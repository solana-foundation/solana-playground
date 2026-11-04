import type { BrowserContext, Page } from "@playwright/test";
import { Keypair } from "@solana/web3.js";

import {
  expect,
  LONG,
  openTerminal,
  playnetReady,
  replaceFile,
  runInTerminal,
  seedLocalWallet,
  seedNativeWorkspace,
  startOnPlaynet,
  terminalRows,
  test,
} from "./fixtures";

/**
 * `run` and `test` execute project code in a sandboxed, opaque-origin frame
 * (`utils/js-runtime`, `runtime.html`). Every case runs on Playnet, so
 * nothing leaves the browser.
 */

/** A seeded wallet and a Native project on Playnet, with the terminal open */
const setUp = async (context: BrowserContext, page: Page) => {
  const keypair = Keypair.generate();
  await seedLocalWallet(page)({
    state: "pg",
    accounts: [{ kp: Array.from(keypair.secretKey), name: "Wallet 1" }],
    currentIndex: 0,
  });
  await startOnPlaynet(page);
  await seedNativeWorkspace(page);
  await playnetReady(page);
  await openTerminal(page);
  return {
    keypair,
    address: keypair.publicKey.toBase58(),
    writeClient: (code: string) =>
      replaceFile(context, page)("client", "client.ts", code),
    writeTest: (code: string) =>
      replaceFile(context, page)("tests", "native.test.ts", code),
  };
};

/** Runs a command and waits for the line that says it is over */
const runFor = (page: Page) => async (command: string, expected: RegExp) => {
  await runInTerminal(page, command);
  await expect(terminalRows(page)).toContainText(expected, LONG);
};

test.describe("project-code-sandbox", () => {
  test("project-code-sandbox: The default client runs", async ({
    context,
    page,
  }) => {
    const { address } = await setUp(context, page);

    await runFor(page)("run", /My balance: [\d.]+ SOL/);

    await expect(terminalRows(page)).toContainText(`My address: ${address}`);
  });

  test("project-code-sandbox: Imports resolve inside the sandbox", async ({
    context,
    page,
  }) => {
    const { writeClient } = await setUp(context, page);
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
    const { writeClient } = await setUp(context, page);
    await writeClient('console.log("a" "b");');

    await runInTerminal(page, "run");

    await expect(terminalRows(page)).toContainText("',' expected", LONG);
    // The prompt is back: the command ended
    await expect(terminalRows(page)).toHaveText(/\$\s*$/, LONG);
  });

  test("project-code-sandbox: A failing test is reported", async ({
    context,
    page,
  }) => {
    const { writeTest } = await setUp(context, page);
    await writeTest(
      [
        'describe("Suite", () => {',
        '  it("passes", () => assert.equal(1, 1));',
        '  it("fails", () => assert.equal(1, 2));',
        "});",
      ].join("\n")
    );

    await runFor(page)("test", /1 failing/);

    await expect(terminalRows(page)).toContainText("1 passing");
    await expect(terminalRows(page)).toHaveText(/\$\s*$/, LONG);
  });

  test("project-code-sandbox: A script runs against Playnet", async ({
    context,
    page,
  }) => {
    const { writeClient } = await setUp(context, page);
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
    const { writeClient, address } = await setUp(context, page);
    await writeClient(
      [
        "const results = [];",
        "const probe = async (name, read) => {",
        "  try {",
        "    const value = await read();",
        '    results.push(`${name}:${value ? "found " + value : "empty"}`);',
        "  } catch (e) {",
        "    results.push(`${name}:threw`);",
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
    const { writeClient } = await setUp(context, page);
    await writeClient(
      [
        "const results = [];",
        "const probe = (name, read) => {",
        "  try {",
        "    read();",
        "    results.push(`${name}:read`);",
        "  } catch (e) {",
        "    results.push(`${name}:${e.name}`);",
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
    const { writeClient, keypair } = await setUp(context, page);
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
    const { writeClient, address } = await setUp(context, page);
    await writeClient(
      [
        'console.log("waiting");',
        "await sleep(3000);",
        'console.log("still running:", pg.wallet.publicKey.toBase58());',
      ].join("\n")
    );

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
