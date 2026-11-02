import {
  Keypair,
  SystemInstruction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import type { Page } from "@playwright/test";

import { installFakeWallet } from "./fake-wallet";
import { expect, LONG, runInTerminal, test } from "./fixtures";

// Funding the Playground wallet from the user's own wallet
// (`features/fund-wallet`). The cluster is stubbed: devnet's JSON-RPC answers
// for the two accounts involved, and its websocket confirms what was sent.

const DEVNET = /^https:\/\/api\.devnet\.solana\.com\/?$/;
const DEVNET_WS = /^wss:\/\/api\.devnet\.solana\.com\/?$/;
const SOL = 1_000_000_000;

const nav = (page: Page) => page.locator('[data-slot="sidebar"]');
const account = (page: Page) =>
  nav(page)
    .locator('[data-slot="sidebar-footer"]')
    .getByRole("button", { name: /^Account/ });
const fundItem = (page: Page) =>
  page.getByRole("menuitem", { name: "Fund from a wallet" });
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Fund your Playground wallet" });

/**
 * Reloads and waits for the editor to take the focus it takes when it mounts
 * (`createMountOpen` in `Monaco.tsx`), as `seededPage` does: landing later,
 * it would steal the focus from whatever a test clicked meanwhile, and it
 * never comes back to the editor after a menu or a dialog has held it.
 */
const reloadSettled = async (page: Page) => {
  await page.reload();
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused(
    LONG
  );
};

const setUpPlaygroundWallet = async (page: Page) => {
  await account(page).click();
  await page.getByRole("menuitem", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(account(page)).toContainText("SOL", LONG);
};

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58, for the signature the stub answers with; `bs58` is not a dependency */
const base58 = (bytes: Uint8Array) => {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
};

/** What the stubbed cluster saw sent */
interface Cluster {
  sent: Transaction[];
}

/**
 * Devnet, answered locally: balances per address (the payer starts with
 * `payerLamports`, 5 SOL unless set; everyone else with 0), a blockhash, and a confirmed status for every
 * transaction sent, which also moves the lamports it transfers. Anything else
 * goes to the real devnet, as in the rest of the suite.
 */
const stubDevnet = async (
  page: Page,
  payer: string,
  payerLamports = 5 * SOL
): Promise<Cluster> => {
  const balances = new Map<string, number>([[payer, payerLamports]]);
  const cluster: Cluster = { sent: [] };
  const answer = (method: string, params: unknown[]): unknown => {
    switch (method) {
      case "getBalance":
        return {
          context: { slot: 1 },
          value: balances.get(params[0] as string) ?? 0,
        };
      case "getLatestBlockhash":
        return {
          context: { slot: 1 },
          value: {
            blockhash: Keypair.generate().publicKey.toBase58(),
            lastValidBlockHeight: 1_000_000,
          },
        };
      case "getRecentPrioritizationFees":
        return [];
      case "sendTransaction": {
        const tx = Transaction.from(Buffer.from(params[0] as string, "base64"));
        cluster.sent.push(tx);
        for (const ix of tx.instructions) {
          if (!ix.programId.equals(SystemProgram.programId)) continue;
          const { fromPubkey, toPubkey, lamports } =
            SystemInstruction.decodeTransfer(ix);
          const from = fromPubkey.toBase58();
          const to = toPubkey.toBase58();
          balances.set(from, (balances.get(from) ?? 0) - Number(lamports));
          balances.set(to, (balances.get(to) ?? 0) + Number(lamports));
        }
        return base58(tx.signatures[0].signature ?? Buffer.alloc(64));
      }
      case "getSignatureStatuses":
        return {
          context: { slot: 1 },
          value: (params[0] as string[]).map(() => ({
            slot: 1,
            confirmations: null,
            err: null,
            confirmationStatus: "confirmed",
          })),
        };
      default:
        return undefined;
    }
  };

  await page.route(DEVNET, async (route) => {
    const body = route.request().postDataJSON() as {
      id: number;
      method: string;
      params?: unknown[];
    };
    const result = answer(body.method, body.params ?? []);
    if (result === undefined) return route.fallback();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
    });
  });

  // Every subscription is accepted; a signature one is confirmed at once
  let next = 1;
  await page.routeWebSocket(DEVNET_WS, (ws) => {
    ws.onMessage((message) => {
      const { id, method } = JSON.parse(String(message)) as {
        id: number;
        method: string;
      };
      const subscription = next++;
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: subscription }));
      if (method === "signatureSubscribe") {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "signatureNotification",
            params: {
              subscription,
              result: { context: { slot: 1 }, value: { err: null } },
            },
          })
        );
      }
    });
  });

  return cluster;
};

test("client-v2-wallet-funding: No Playground wallet yet", async ({
  seededPage: page,
}) => {
  await account(page).click();

  await expect(
    page.getByRole("menuitem", { name: "Connect wallet" })
  ).toBeVisible();
  await expect(fundItem(page)).toHaveCount(0);
});

test("client-v2-wallet-funding: Playground wallet set up", async ({
  seededPage: page,
}) => {
  await setUpPlaygroundWallet(page);

  await account(page).click();

  await expect(fundItem(page)).toBeVisible();
});

test("client-v2-wallet-funding: Successful funding", async ({
  page,
  seededPage,
}) => {
  void seededPage;
  const phantom = await installFakeWallet(page, {
    name: "Phantom",
    sign: true,
  });
  const cluster = await stubDevnet(page, phantom.address);
  await reloadSettled(page);
  await setUpPlaygroundWallet(page);
  await account(page).click();
  await fundItem(page).click();
  await expect(dialog(page)).toBeVisible();

  await dialog(page).getByRole("button", { name: "Connect Phantom" }).click();
  await expect(dialog(page)).toContainText(phantom.short);
  await expect(dialog(page)).toContainText("5 SOL");
  await dialog(page).getByRole("button", { name: "Send 1 SOL" }).click();

  await expect(page.getByText(/^Sent 1 SOL to Wallet 1\.$/)).toBeVisible(LONG);
  await expect(dialog(page)).toHaveCount(0);
  expect(cluster.sent).toHaveLength(1);
  const [transfer] = cluster.sent[0].instructions.map((ix) =>
    SystemInstruction.decodeTransfer(ix)
  );
  expect(transfer.fromPubkey.toBase58()).toBe(phantom.address);
  expect(Number(transfer.lamports)).toBe(SOL);
});

/** Set up the Playground wallet and open the Fund dialog */
const openFund = async (page: Page) => {
  await setUpPlaygroundWallet(page);
  await account(page).click();
  await fundItem(page).click();
  await expect(dialog(page)).toBeVisible();
};

test("client-v2-wallet-funding: No wallet installed", async ({
  seededPage: page,
}) => {
  await openFund(page);

  await expect(dialog(page)).toContainText(
    "No wallet extension found in this browser."
  );
  await expect(dialog(page).getByLabel("Amount (SOL)")).toHaveCount(0);
});

test("client-v2-wallet-funding: The user declines the connection", async ({
  page,
  seededPage,
}) => {
  void seededPage;
  await installFakeWallet(page, { name: "Phantom", reject: "connect" });
  await reloadSettled(page);
  await openFund(page);

  await dialog(page).getByRole("button", { name: "Connect Phantom" }).click();

  await expect(dialog(page).getByRole("alert")).toContainText(
    "You declined in Phantom. Nothing was sent."
  );
  await expect(
    dialog(page).getByRole("button", { name: "Connect Phantom" })
  ).toBeVisible();
});

test("client-v2-wallet-funding: Amount above the balance", async ({
  page,
  seededPage,
}) => {
  void seededPage;
  const phantom = await installFakeWallet(page, { name: "Phantom" });
  await stubDevnet(page, phantom.address, SOL / 2);
  await reloadSettled(page);
  await openFund(page);
  await dialog(page).getByRole("button", { name: "Connect Phantom" }).click();

  await expect(dialog(page)).toContainText("Phantom holds 0.5 SOL.");
  await expect(
    dialog(page).getByRole("button", { name: "Send 1 SOL" })
  ).toBeDisabled();
});

test("client-v2-wallet-funding: The user declines the transfer", async ({
  page,
  seededPage,
}) => {
  void seededPage;
  const phantom = await installFakeWallet(page, {
    name: "Phantom",
    reject: "sign",
  });
  const cluster = await stubDevnet(page, phantom.address);
  await reloadSettled(page);
  await openFund(page);
  await dialog(page).getByRole("button", { name: "Connect Phantom" }).click();
  await dialog(page).getByLabel("Amount (SOL)").fill("0.5");

  await dialog(page).getByRole("button", { name: "Send 0.5 SOL" }).click();

  await expect(dialog(page).getByRole("alert")).toContainText(
    "You declined in Phantom. Nothing was sent."
  );
  await expect(dialog(page).getByLabel("Amount (SOL)")).toHaveValue("0.5");
  expect(cluster.sent).toHaveLength(0);
});

test("client-v2-external-wallet: A payer beside the current extension", async ({
  page,
  seededPage,
}) => {
  void seededPage;
  const phantom = await installFakeWallet(page, { name: "Phantom" });
  const solflare = await installFakeWallet(page, { name: "Solflare" });
  await stubDevnet(page, solflare.address);
  await reloadSettled(page);
  await setUpPlaygroundWallet(page);
  const drawer = page.getByRole("button", { name: "Terminal", exact: true });
  if ((await drawer.getAttribute("aria-expanded")) !== "true")
    await drawer.click();
  await runInTerminal(page, "connect phantom");
  await expect(account(page)).toContainText(phantom.short, LONG);

  await account(page).click();
  await fundItem(page).click();
  await dialog(page).getByRole("button", { name: "Connect Solflare" }).click();
  await expect(dialog(page)).toContainText(solflare.short);

  await page.keyboard.press("Escape");
  // Phantom stays the current wallet, and both stay connected
  await expect(account(page)).toContainText(phantom.short);
  await page
    .locator("#tabs")
    .getByRole("button")
    .filter({ hasText: /^Wallet$/ })
    .click();
  await page
    .locator(".react-draggable")
    .getByRole("button", { name: "More" })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Disconnect from Phantom" })
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Disconnect from Solflare" })
  ).toBeVisible();
});
