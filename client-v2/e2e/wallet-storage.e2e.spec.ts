import type { Page } from "@playwright/test";
import { Keypair } from "@solana/web3.js";

import { expect, LONG, seedWorkspace, test } from "./fixtures";

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

test("wallet-storage: A wallet in localStorage moves to IndexedDB", async ({
  page,
}) => {
  const keypair = Keypair.generate();
  const kp = Array.from(keypair.secretKey);
  const address = keypair.publicKey.toBase58();

  // The wallet as the previous version left it, on the first load only:
  // the reload below must find what the migration wrote, not a fresh seed
  await page.addInitScript((wallet) => {
    if (sessionStorage.getItem("e2e-wallet-seeded")) return;
    sessionStorage.setItem("e2e-wallet-seeded", "1");
    localStorage.setItem("wallet", wallet);
  }, JSON.stringify({ state: "pg", accounts: [{ kp, name: "Wallet 1" }], currentIndex: 0 }));

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
