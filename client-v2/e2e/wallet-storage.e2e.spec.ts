import type { Page } from "@playwright/test";
import { Keypair } from "@solana/web3.js";

import { expect, LONG, seedLocalWallet, seedWorkspace, test } from "./fixtures";

/**
 * The built-in wallet's storage (`utils/wallet/wallet-storage.ts`): a wallet
 * found in `localStorage` moves to the wallet's own IndexedDB database on
 * load, and nothing is left behind in `localStorage`.
 */

/** The wallet record in its IndexedDB database, read in the page */
const storedWallet = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<
        { accounts: Array<{ kp: number[]; name: string }> } | undefined
      >((resolve, reject) => {
        const open = indexedDB.open("pg-wallet");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("state")) return resolve(undefined);
          const get = db
            .transaction("state", "readonly")
            .objectStore("state")
            .get("wallet");
          get.onerror = () => reject(get.error);
          get.onsuccess = () => resolve(get.result);
        };
      })
  );

const walletStep = (page: Page) =>
  page
    .locator('[data-slot="setup-list-item"][data-status="done"]')
    .filter({ hasText: "Connect a wallet" });

const localWallet = (page: Page) =>
  page.evaluate(() => localStorage.getItem("wallet"));

/** A fresh profile's wallet, made through the setup step and Continue */
const createWallet = async (page: Page) => {
  await page
    .locator('[data-slot="setup-list"]')
    .getByRole("button", { name: "Connect a wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(walletStep(page)).toContainText(/\w{4}…\w{4}/, LONG);
  return (await walletStep(page).textContent()) ?? "";
};

/** Make every write to the wallet's own database fail, in the page */
const failWalletWrites = (page: Page) =>
  page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === "pg-wallet") {
        throw new DOMException("e2e: write refused", "QuotaExceededError");
      }
      return put.apply(this, args);
    };
  });

/** Make opening the wallet's own database fail, in the page */
const blockWalletDatabase = (page: Page) =>
  page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => {
      if (name === "pg-wallet") {
        throw new DOMException("e2e: database blocked", "SecurityError");
      }
      return open(name, version);
    };
  });

test("wallet-storage: A new wallet is created", async ({ page }) => {
  await seedWorkspace(page);
  await createWallet(page);

  await expect
    .poll(async () => (await storedWallet(page))?.accounts.length, LONG)
    .toBe(1);
  expect(await localWallet(page)).toBeNull();
});

test("wallet-storage: The wallet survives a reload", async ({ page }) => {
  await seedWorkspace(page);
  const shown = await createWallet(page);
  await expect
    .poll(async () => (await storedWallet(page))?.accounts.length, LONG)
    .toBe(1);
  const stored = await storedWallet(page);

  await page.reload();

  await expect(walletStep(page)).toHaveText(shown, LONG);
  expect(await storedWallet(page)).toEqual(stored);
  expect(await localWallet(page)).toBeNull();
});

test("wallet-storage: The copy fails", async ({ page }) => {
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  const old = {
    state: "pg",
    accounts: [{ kp: Array.from(keypair.secretKey), name: "Wallet 1" }],
    currentIndex: 0,
  };
  await failWalletWrites(page);
  await seedLocalWallet(page)(old);

  await seedWorkspace(page);

  await expect(walletStep(page)).toContainText(address.slice(0, 4), LONG);
  expect(JSON.parse((await localWallet(page)) ?? "{}").accounts).toEqual(
    old.accounts
  );
});

test("wallet-storage: IndexedDB is blocked", async ({ page }) => {
  await blockWalletDatabase(page);
  await seedWorkspace(page);
  const shown = await createWallet(page);

  await expect
    .poll(
      async () =>
        JSON.parse((await localWallet(page)) ?? "{}").accounts?.length,
      LONG
    )
    .toBe(1);

  await page.reload();
  await expect(walletStep(page)).toHaveText(shown, LONG);
});

test("wallet-storage: A wallet in localStorage moves to IndexedDB", async ({
  page,
}) => {
  const keypair = Keypair.generate();
  const kp = Array.from(keypair.secretKey);
  const address = keypair.publicKey.toBase58();

  // The wallet as the previous version left it
  await seedLocalWallet(page)({
    state: "pg",
    accounts: [{ kp, name: "Wallet 1" }],
    currentIndex: 0,
  });

  await seedWorkspace(page);

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("wallet")), LONG)
    .toBeNull();
  expect((await storedWallet(page))?.accounts).toEqual([
    { kp, name: "Wallet 1" },
  ]);
  await expect(walletStep(page)).toContainText(address.slice(0, 4), LONG);
  await expect(walletStep(page)).toContainText(address.slice(-4));

  // The wallet survives a reload, from IndexedDB alone
  await page.reload();
  await expect(walletStep(page)).toContainText(address.slice(0, 4), LONG);
  expect(await page.evaluate(() => localStorage.getItem("wallet"))).toBeNull();
  expect((await storedWallet(page))?.accounts).toEqual([
    { kp, name: "Wallet 1" },
  ]);
});

test("wallet-storage: A legacy single-key wallet moves to IndexedDB", async ({
  page,
}) => {
  const keypair = Keypair.generate();
  const sk = Array.from(keypair.secretKey);
  const address = keypair.publicKey.toBase58();

  // The pre-accounts format, which `migrate` upgrades before the move
  await seedLocalWallet(page)({ setupCompleted: true, connected: true, sk });

  await seedWorkspace(page);

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("wallet")), LONG)
    .toBeNull();
  expect((await storedWallet(page))?.accounts).toEqual([
    { kp: sk, name: "Wallet 1" },
  ]);
  await expect(walletStep(page)).toContainText(address.slice(0, 4), LONG);
});
