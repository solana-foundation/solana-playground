import type { Page, Route } from "@playwright/test";
import { address, signature } from "@solana/kit";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";

import { clusterOf } from "../src/commands/anchor/__fixtures__/cluster";
import { GENESIS_HASHES } from "../src/entities/cluster/model/genesis-hashes";
import {
  consoleTrigger,
  DEVNET_RPC,
  DEVNET_WS,
  expect,
  LONG,
  reloadAndBoot,
  runInTerminal,
} from "./fixtures";
import { hasSavedText } from "./saved-files";

// The browser path of `anchor idl` on an RPC that LiteSVM answers in Playwright's process, shared by the `client-v2-program-idl` specs

/** An endpoint the specs serve from LiteSVM: what Settings stores for it, the URLs its requests go to, and its genesis hash */
export interface Network {
  endpoint: { option: string; url?: string };
  rpc: RegExp;
  ws: RegExp;
  genesisHash: string;
}

/** Neither `localhost` nor `127.0.0.1`, which `init` and `upgrade` skip as Anchor does */
const CUSTOM_RPC_URL = "https://litesvm.test/";

/** A custom RPC that serves Devnet, as "An upload through a custom RPC is tracked" has it */
export const CUSTOM_RPC: Network = {
  endpoint: { option: "custom", url: CUSTOM_RPC_URL },
  rpc: /^https:\/\/litesvm\.test\/?$/,
  ws: /^wss:\/\/litesvm\.test\/?$/,
  genesisHash: GENESIS_HASHES.devnet,
};

export const DEVNET: Network = {
  endpoint: { option: "devnet" },
  rpc: DEVNET_RPC,
  ws: DEVNET_WS,
  genesisHash: GENESIS_HASHES.devnet,
};

export const MAINNET: Network = {
  endpoint: { option: "mainnet-beta" },
  rpc: /^https:\/\/api\.mainnet-beta\.solana\.com\/?$/,
  ws: /^wss:\/\/api\.mainnet-beta\.solana\.com\/?$/,
  genesisHash: GENESIS_HASHES["mainnet-beta"],
};

/** web3.js opens Localnet's subscriptions on the port after its RPC's */
export const LOCALNET: Network = {
  endpoint: { option: "localnet" },
  rpc: /^http:\/\/localhost:8899\/?$/,
  ws: /^ws:\/\/localhost:8900\/?$/,
  // A local validator's genesis hash is its own; any fixed hash stands for it
  genesisHash: GENESIS_HASHES.testnet,
};

export const keypairOf = (seed: number) =>
  Keypair.fromSeed(new Uint8Array(32).fill(seed));

export const PROGRAM = address(keypairOf(2).publicKey.toBase58());

/** An Anchor 0.30+ IDL of `program` on one line, which the editor keeps as inserted */
export const idlTextFor =
  (program: string) => (version: string, docs: string[]) =>
    JSON.stringify({
      address: program,
      metadata: { name: "counter", version, spec: "0.1.0" },
      docs,
      instructions: [],
    });

/** An Anchor 0.30+ IDL of {@link PROGRAM} */
export const idlText = idlTextFor(PROGRAM);

/** Text zlib cannot shrink, so the IDL needs a buffer and more than one transaction */
export const incompressible = (length: number) => {
  let seed = 7;
  let text = "";
  while (text.length < length) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    text += seed.toString(36);
  }
  return text.slice(0, length);
};

export type Cluster = ReturnType<typeof clusterOf>;

interface RpcCall {
  id: unknown;
  method: string;
  params?: unknown[];
}

/** The methods the UI calls on its own, beside those of the `anchor` subcommands that the cluster answers */
const uiAnswerFor = (network: Network) => (cluster: Cluster) => {
  // A slot that stands still between two reads is a cluster that is down
  let slot = 0;
  return ({ method, params }: RpcCall): unknown => {
    switch (method) {
      case "getGenesisHash":
        return network.genesisHash;
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
 * Serves `network` from `cluster`: JSON-RPC through `page.route`, and the
 * subscriptions web3.js confirms through. Returns the methods neither the
 * UI's answers nor the cluster had an answer for.
 */
export const serveFor =
  (network: Network) => (cluster: Cluster) => async (page: Page) => {
    const uiAnswer = uiAnswerFor(network)(cluster);
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
    await page.route(network.rpc, async (route: Route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          Array.isArray(body) ? body.map(answer) : answer(body)
        ),
      });
    });

    // Every subscription is accepted; a signature one is notified at once for a transaction LiteSVM ran
    await page.routeWebSocket(network.ws, (ws) => {
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

/** The Playground wallet as `localStorage` holds it, with `keypair` its one account */
export interface StoredWallet {
  state: "pg" | "disconnected";
  keypair: Keypair;
}

export const connectedWallet = (keypair: Keypair): StoredWallet => ({
  state: "pg",
  keypair,
});

/** The Playground wallet set up and holding `keypair`, but not connected, so a command that needs a wallet asks for one */
export const disconnectedWallet = (keypair: Keypair): StoredWallet => ({
  state: "disconnected",
  keypair,
});

/** Selects `network` and the Playground wallet `wallet`, then reloads onto both */
export const selectNetworkAndWalletFor =
  (network: Network) => async (page: Page, wallet: StoredWallet) => {
    await page.evaluate(
      ({ endpoint, state, kp }) => {
        const settings = JSON.parse(localStorage.getItem("settings") ?? "{}");
        settings.connection = settings.connection ?? {};
        settings.connection.endpoint = endpoint;
        localStorage.setItem("settings", JSON.stringify(settings));
        localStorage.setItem(
          "wallet",
          JSON.stringify({
            state,
            accounts: [{ kp, name: "Wallet 1" }],
            currentIndex: 0,
            // eslint-disable-next-line unicorn/no-null -- the stored wallet state names no Wallet Standard wallet with `null`
            standardName: null,
          })
        );
      },
      {
        endpoint: network.endpoint,
        state: wallet.state,
        kp: Array.from(wallet.keypair.secretKey),
      }
    );
    await reloadAndBoot(page);
  };

/** Creates `src/<name>` from the Files column's foot and puts `text` in it; returns the path the terminal takes */
export const writeFileWith =
  (text: string) => async (page: Page, name: string) => {
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
export const terminalOf = (page: Page) => page.locator(".xterm-rows").first();

export const openTerminal = async (page: Page) => {
  const drawer = consoleTrigger(page);
  if ((await drawer.getAttribute("aria-expanded")) !== "true") {
    await drawer.click();
  }
};

/** Runs `line` and waits for the terminal to print `printed` */
export const runAndWaitFor =
  (printed: string) => async (page: Page, line: string) => {
    await runInTerminal(page, line);
    await expect(terminalOf(page)).toContainText(printed, LONG);
  };

export const BASE58 = "[1-9A-HJ-NP-Za-km-z]";

/** The page's record of what it last wrote to the clipboard, which {@link recordClipboardWrites} keeps */
interface ClipboardRecord {
  __copied?: string;
}

/** Keeps the page's clipboard writes on the page from its next load, where {@link printedBy} reads them without a clipboard permission */
export const recordClipboardWrites = (page: Page) =>
  page.addInitScript(() => {
    const record = window as unknown as ClipboardRecord;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          record.__copied = text;
        },
      },
    });
  });

/**
 * Every line the terminal printed, through the console's Copy log, which
 * reads the whole buffer, not only the rows in view, when the console opens.
 * Needs {@link recordClipboardWrites}.
 */
const copyLog = async (page: Page) => {
  const drawer = consoleTrigger(page);
  await drawer.click();
  await expect(drawer).toHaveAttribute("aria-expanded", "false");
  await drawer.click();
  await expect(drawer).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Copy log" }).click();
  return page.evaluate(() => (window as ClipboardRecord).__copied ?? "");
};

/** What `line` printed in `log`, from the line after it to the prompt that follows; empty while the log does not hold both */
const getPrintedFor = (line: string) => (log: string) => {
  // The prompt before it, since the output may quote the line itself
  const typed = `$ ${line}\n`;
  const at = log.lastIndexOf(typed);
  if (at === -1) return "";
  const after = log.slice(at + typed.length - 1);
  const end = after.lastIndexOf("\n");
  return end === -1 ? "" : after.slice(after.indexOf("\n") + 1, end);
};

/** Runs `line` and returns what it printed, wrapped lines joined; for a line that prints something */
export const printedBy = async (page: Page, line: string) => {
  await runInTerminal(page, line);
  // The prompt comes back once the command has ended
  await expect(terminalOf(page)).toHaveText(/\$\s*$/, LONG);
  let printed = "";
  // Copy takes the log a moment after the console opens, so an early click copies an older log
  await expect
    .poll(
      async () => (printed = getPrintedFor(line)(await copyLog(page))),
      LONG
    )
    .not.toBe("");
  return printed;
};

/** The first byte of a Compute Budget instruction: its kind */
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;
const LAMPORTS_PER_SIGNATURE = 5000n;
/** The compute-unit limits the runtime gives each instruction of a transaction that sets none: a builtin program's, and any other's */
const DEFAULT_BUILTIN_UNITS = 3_000n;
const DEFAULT_PROGRAM_UNITS = 200_000n;
/** The builtin programs the subcommands' transactions call */
const BUILTINS = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  SystemProgram.programId.toBase58(),
]);

/** The fee a sent transaction paid: one signature's for each signer, and its compute-unit price over its compute-unit limit */
export const feeOf = (raw: Uint8Array) => {
  const { message } = VersionedTransaction.deserialize(raw);
  const keys = message.staticAccountKeys.map((key) => key.toBase58());
  const budget = message.compiledInstructions.filter(
    ({ programIdIndex }) =>
      keys[programIdIndex] === ComputeBudgetProgram.programId.toBase58()
  );
  const view = (data: Uint8Array) =>
    new DataView(data.buffer, data.byteOffset, data.byteLength);
  const limit = budget.find(({ data }) => data[0] === SET_COMPUTE_UNIT_LIMIT);
  const price = budget.find(({ data }) => data[0] === SET_COMPUTE_UNIT_PRICE);
  const units = limit
    ? BigInt(view(limit.data).getUint32(1, true))
    : message.compiledInstructions.reduce(
        (sum, { programIdIndex }) =>
          sum +
          (BUILTINS.has(keys[programIdIndex])
            ? DEFAULT_BUILTIN_UNITS
            : DEFAULT_PROGRAM_UNITS),
        0n
      );
  const microLamports = price ? view(price.data).getBigUint64(1, true) : 0n;
  const priority = (units * microLamports + 999_999n) / 1_000_000n;
  return (
    BigInt(message.header.numRequiredSignatures) * LAMPORTS_PER_SIGNATURE +
    priority
  );
};
