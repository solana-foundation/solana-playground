import type { Page, Route } from "@playwright/test";
import { address, lamports, signature } from "@solana/kit";
import { Keypair } from "@solana/web3.js";
import {
  AccountDiscriminator,
  findCanonicalPda,
} from "@solana-program/program-metadata";

import { clusterOf } from "../src/commands/anchor/__fixtures__/cluster";
import { GENESIS_HASHES } from "../src/entities/cluster/model/genesis-hashes";
import {
  consoleTrigger,
  expect,
  LONG,
  reloadAndBoot,
  runInTerminal,
  test,
} from "./fixtures";
import { hasSavedText } from "./saved-files";
import { lineOf, linesOn } from "./telemetry";

// The browser path of `anchor idl` on a custom RPC that LiteSVM answers in Playwright's process; what each subcommand computes is `anchor.integration.test.ts`'s

/** Neither `localhost` nor `127.0.0.1`, which `init` and `upgrade` skip as Anchor does */
const RPC = "https://litesvm.test/";
const RPC_WS = /^wss:\/\/litesvm\.test\/?$/;

const PROGRAM = address(
  Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey.toBase58()
);

/** An Anchor 0.30+ IDL of {@link PROGRAM} on one line, which the editor keeps as inserted */
const idlText = (version: string, docs: string[]) =>
  JSON.stringify({
    address: PROGRAM,
    metadata: { name: "counter", version, spec: "0.1.0" },
    docs,
    instructions: [],
  });

/** Text zlib cannot shrink, so the IDL needs a buffer and more than one transaction */
const incompressible = (length: number) => {
  let seed = 7;
  let text = "";
  while (text.length < length) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    text += seed.toString(36);
  }
  return text.slice(0, length);
};

type Cluster = ReturnType<typeof clusterOf>;

interface RpcCall {
  id: unknown;
  method: string;
  params?: unknown[];
}

/** The methods the UI calls on its own, beside those of the `anchor` subcommands that the cluster answers */
const uiAnswerFor = (cluster: Cluster) => {
  // A slot that stands still between two reads is a cluster that is down
  let slot = 0;
  return ({ method, params }: RpcCall): unknown => {
    switch (method) {
      // The RPC is a custom one that serves Devnet, as "An upload through a custom RPC is tracked" has it
      case "getGenesisHash":
        return GENESIS_HASHES.devnet;
      case "getVersion":
        return { "solana-core": "2.0.0", "feature-set": 0 };
      case "getSlot":
        slot += 1;
        return slot;
      case "getBalance":
        return {
          context: { slot: 1 },
          value: Number(
            cluster.svm.getBalance(address(String(params?.[0]))) ?? 0n
          ),
        };
      default:
        return undefined;
    }
  };
};

/**
 * Serves {@link RPC} from `cluster`: JSON-RPC through `page.route`, and the
 * subscriptions web3.js confirms through on the same host. Returns the
 * methods neither the UI's answers nor the cluster had an answer for.
 */
const serveFrom = (cluster: Cluster) => async (page: Page) => {
  const uiAnswer = uiAnswerFor(cluster);
  const unanswered = new Set<string>();
  const answer = (call: RpcCall) => {
    const result = uiAnswer(call);
    if (result !== undefined) return { jsonrpc: "2.0", id: call.id, result };
    try {
      return JSON.parse(cluster.respond(JSON.stringify(call)));
    } catch (error) {
      unanswered.add(call.method);
      return {
        jsonrpc: "2.0",
        id: call.id,
        error: { code: -32601, message: String(error) },
      };
    }
  };
  await page.route(`${RPC}**`, async (route: Route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        Array.isArray(body) ? body.map(answer) : answer(body)
      ),
    });
  });

  // Every subscription is accepted; a signature one is notified at once for a transaction LiteSVM ran
  await page.routeWebSocket(RPC_WS, (ws) => {
    let next = 0;
    ws.onMessage((message) => {
      const { id, method, params } = JSON.parse(String(message)) as RpcCall;
      if (method.endsWith("Unsubscribe")) {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: true }));
        return;
      }
      next += 1;
      const subscription = next;
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: subscription }));
      if (method !== "signatureSubscribe") return;
      if (!cluster.svm.getTransaction(signature(String(params?.[0])))) return;
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "signatureNotification",
          params: {
            subscription,
            result: {
              context: { slot: 1 },
              // eslint-disable-next-line unicorn/no-null -- the JSON-RPC wire format
              value: { err: null },
            },
          },
        })
      );
    });
  });
  return unanswered;
};

/** Selects {@link RPC} and a Playground wallet that holds `wallet`, then reloads onto both */
const selectRpcAndWallet = (wallet: Keypair) => async (page: Page) => {
  await page.evaluate(
    ({ url, kp }) => {
      const settings = JSON.parse(localStorage.getItem("settings") ?? "{}");
      settings.connection = settings.connection ?? {};
      settings.connection.endpoint = { option: "custom", url };
      localStorage.setItem("settings", JSON.stringify(settings));
      localStorage.setItem(
        "wallet",
        JSON.stringify({
          state: "pg",
          accounts: [{ kp, name: "Wallet 1" }],
          currentIndex: 0,
          // eslint-disable-next-line unicorn/no-null -- the stored wallet state names no Wallet Standard wallet with `null`
          standardName: null,
        })
      );
    },
    { url: RPC, kp: Array.from(wallet.secretKey) }
  );
  await reloadAndBoot(page);
};

/** Creates `src/<name>` from the Files column's foot and puts `text` in it; returns the path the terminal takes */
const writeFileWith = (text: string) => async (page: Page, name: string) => {
  await page.getByRole("button", { name: "New file" }).click();
  const field = page.locator("#root-dir input");
  await expect(field).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await expect(field).toHaveCount(0, LONG);
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused(
    LONG
  );
  // Inserted, not typed: the editor closes a typed bracket or quote itself
  await page.keyboard.insertText(text);
  await expect.poll(() => hasSavedText(page, text), LONG).toBe(true);
  return `src/${name}`;
};

/** The terminal's rows in view, which is all of a short output */
const terminalOf = (page: Page) => page.locator(".xterm-rows").first();

const openTerminal = async (page: Page) => {
  const drawer = consoleTrigger(page);
  if ((await drawer.getAttribute("aria-expanded")) !== "true") {
    await drawer.click();
  }
};

/** Runs `line` and waits for the terminal to print `printed` */
const runUntil = (printed: string) => async (page: Page, line: string) => {
  await runInTerminal(page, line);
  await expect(terminalOf(page)).toContainText(printed, LONG);
};

const BASE58 = "[1-9A-HJ-NP-Za-km-z]";

test.describe("client-v2-program-idl", () => {
  let cluster: Cluster;
  let metadata: string;
  // Set before any hook runs, so a setup that fails before `serveFrom` reports its own error here
  let unanswered = new Set<string>();

  test.beforeEach(async ({ seededPage: page }) => {
    cluster = clusterOf();
    const wallet = Keypair.generate();
    cluster.svm.airdrop(
      address(wallet.publicKey.toBase58()),
      lamports(10_000_000_000n)
    );
    await cluster.deploy(PROGRAM, wallet.publicKey.toBase58());
    [metadata] = await findCanonicalPda({ program: PROGRAM, seed: "idl" });
    unanswered = await serveFrom(cluster)(page);
    await selectRpcAndWallet(wallet)(page);
    await openTerminal(page);
  });

  // A method nobody answered is a request the browser path makes and this file does not serve
  test.afterEach(() => {
    const seen = Array.from(unanswered);
    unanswered = new Set();
    expect(seen).toEqual([]);
  });

  test("client-v2-program-idl: An IDL file", async ({ seededPage: page }) => {
    const text = idlText("0.1.0", []);
    const path = await writeFileWith(text)(page, "counter.json");

    await runUntil(`IDL initialized. Program Metadata account: ${metadata}`)(
      page,
      `anchor idl init --filepath ${path}`
    );

    await runUntil(text)(page, `anchor idl fetch ${PROGRAM}`);
  });

  test("client-v2-program-idl: An upload through a custom RPC is tracked", async ({
    seededPage: page,
  }) => {
    const lines = linesOn(page);
    const path = await writeFileWith(idlText("0.1.0", []))(
      page,
      "counter.json"
    );

    await runUntil("IDL initialized.")(
      page,
      `anchor idl init --filepath ${path}`
    );

    await expect
      .poll(() => lineOf(lines, "idl_uploaded"), LONG)
      .toContain("{target: metadata, cluster: custom}");
    expect(lineOf(lines, "idl_upload_started")).toContain(
      "{target: metadata, cluster: custom}"
    );
  });

  test("client-v2-program-idl: A second upload replaces the first", async ({
    seededPage: page,
  }) => {
    const first = await writeFileWith(idlText("0.1.0", []))(
      page,
      "counter.json"
    );
    const second = idlText("0.2.0", ["Counts"]);
    const secondPath = await writeFileWith(second)(page, "counter-v2.json");
    await runUntil("IDL initialized.")(
      page,
      `anchor idl init --filepath ${first}`
    );

    await runUntil(`IDL upgraded. Program Metadata account: ${metadata}`)(
      page,
      `anchor idl upgrade --filepath ${secondPath}`
    );

    await runUntil(second)(page, `anchor idl fetch ${PROGRAM}`);
  });

  test("client-v2-program-idl: Publish through a buffer", async ({
    seededPage: page,
  }) => {
    const text = idlText("0.1.0", []);
    const path = await writeFileWith(text)(page, "counter.json");
    await runUntil("Buffer created successfully.")(
      page,
      `anchor idl create-buffer --filepath ${path}`
    );
    // The address ends where the prompt that follows the line begins
    const created = new RegExp(`Buffer account: (${BASE58}{32,44})\\s*\\$`);
    await expect(terminalOf(page)).toHaveText(created);
    const [, buffer] =
      created.exec((await terminalOf(page).textContent()) ?? "") ?? [];

    await runUntil("Metadata written successfully using buffer.")(
      page,
      `anchor idl write-buffer ${PROGRAM} --buffer ${buffer} --close-buffer`
    );

    await runUntil(text)(page, `anchor idl fetch ${PROGRAM}`);
    expect(cluster.svm.getAccount(address(buffer)).exists).toBe(false);
  });

  test("client-v2-program-idl: A program without a published IDL", async ({
    seededPage: page,
  }) => {
    await runUntil(
      `Program ${PROGRAM} has no published IDL on the selected network.`
    )(page, `anchor idl fetch ${PROGRAM}`);
  });

  test("client-v2-program-idl: Running init again finishes the upload", async ({
    seededPage: page,
  }) => {
    const text = idlText("0.1.0", [incompressible(3000)]);
    const path = await writeFileWith(text)(page, "large.json");
    // The first transaction turns the canonical account into a buffer; the RPC drops the second
    cluster.dropSendAt(1);
    await runUntil("Run the same `anchor idl init` again to finish it.")(
      page,
      `anchor idl init --filepath ${path}`
    );

    await runUntil("IDL initialized.")(
      page,
      `anchor idl init --filepath ${path}`
    );

    const account = cluster.svm.getAccount(address(metadata));
    expect(account.exists && account.data[0]).toBe(
      AccountDiscriminator.Metadata
    );
    // The IDL outgrows the rows in view, so its end stands for it
    await runUntil(text.slice(-60))(page, `anchor idl fetch ${PROGRAM}`);
  });

  test("client-v2-program-idl: Help lists two legacy subcommands", async ({
    seededPage: page,
  }) => {
    const line = "anchor legacy-idl --help";
    await runInTerminal(page, line);

    /** What the line printed, up to the prompt after it */
    const printed = async () => {
      const text = (await terminalOf(page).textContent()) ?? "";
      return text.slice(text.lastIndexOf(line) + line.length);
    };
    await expect.poll(printed, LONG).toMatch(/Commands:[\s\S]*\$\s*$/);
    const help = await printed();
    const commands = help.slice(help.indexOf("Commands:"));
    expect(commands).toMatch(/\bclose\b[\s\S]*\bfetch\b/);
    for (const name of [
      "init",
      "upgrade",
      "authority",
      "write-buffer",
      "set-buffer",
      "set-authority",
      "erase-authority",
    ]) {
      expect(commands).not.toContain(name);
    }
  });
});
