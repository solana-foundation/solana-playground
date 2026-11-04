import type { Page } from "@playwright/test";
import { Keypair } from "@solana/web3.js";

import {
  expect,
  LONG,
  runInTerminal,
  seedLocalWallet,
  seedWorkspace,
  test,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/**
 * The built-in wallet's storage (`utils/wallet/wallet-storage.ts`): a wallet
 * found in `localStorage` moves to the wallet's own IndexedDB database on
 * load, and nothing is left behind in `localStorage`.
 */

/** A record in the wallet's IndexedDB database, read in the page */
const storedRecordFor =
  <T>(key: string) =>
  (page: Page) =>
    page.evaluate(
      (record) =>
        new Promise<T | undefined>((resolve, reject) => {
          const open = indexedDB.open("pg-wallet");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("wallet-state")) {
              return resolve(undefined);
            }
            const get = db
              .transaction("wallet-state", "readonly")
              .objectStore("wallet-state")
              .get(record);
            get.onerror = () => reject(get.error);
            get.onsuccess = () => resolve(get.result);
          };
        }),
      key
    );

/** The wallet record in its IndexedDB database */
const storedWallet = storedRecordFor<{
  accounts: Array<{ kp: number[]; name: string }>;
  currentIndex: number;
  state: string;
}>("wallet");

/** The accounts set aside as damaged, in the same database */
const storedSetAside = storedRecordFor<unknown[]>("set-aside");

const walletStep = (page: Page) =>
  page
    .locator('[data-slot="setup-list-item"][data-status="done"]')
    .filter({ hasText: "Connect a wallet" });

/** The "Connect a wallet" step while the wallet could not be read */
const walletWarning = (page: Page) =>
  page
    .locator('[data-slot="setup-list-item"][data-status="warn"]')
    .filter({ hasText: "Wallet unavailable" });

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

/** Make every write of the wallet to `localStorage` fail, in the page */
const failLocalWalletWrites = (page: Page) =>
  page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "wallet") {
        throw new DOMException("e2e: storage full", "QuotaExceededError");
      }
      return setItem.call(this, key, value);
    };
  });

/** The toasts that say the wallet could not be saved */
const saveFailedNotices = (page: Page) =>
  page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Your wallet could not be saved." });

/** Longer than a toast takes to appear once it is raised */
const TOAST_RENDER_MS = 1000;

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
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  await blockWalletDatabase(page);
  await seedLocalWallet(page)({
    state: "disconnected",
    accounts: [{ kp: Array.from(keypair.secretKey), name: "Wallet 1" }],
    currentIndex: 0,
  });
  await seedWorkspace(page);

  // Connecting is a save, and it lands in localStorage
  await page
    .locator('[data-slot="setup-list"]')
    .getByRole("button", { name: "Connect a wallet", exact: true })
    .click();

  await expect(walletStep(page)).toContainText(address.slice(0, 4), LONG);
  await expect
    .poll(async () => JSON.parse((await localWallet(page)) ?? "{}").state, LONG)
    .toBe("pg");

  await page.reload();
  await expect(walletStep(page)).toContainText(address.slice(0, 4), LONG);
});

test("wallet-storage: The store fails and nothing is in localStorage", async ({
  page,
}) => {
  await blockWalletDatabase(page);

  await seedWorkspace(page);

  await expect(walletWarning(page)).toBeVisible(LONG);
  await expect(
    page.getByRole("button", { name: "Continue", exact: true })
  ).toHaveCount(0);
  expect(await localWallet(page)).toBeNull();
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

/** Puts raw `text` in `localStorage['wallet']`, as a damaged copy would be */
const putLocalText = (page: Page) => (text: string) =>
  page.evaluate((value) => localStorage.setItem("wallet", value), text);

/** The console lines the wallet's storage logs, collected from now on */
const walletLogsOf = (page: Page) => {
  const lines: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("wallet:storage")) lines.push(message.text());
  });
  return lines;
};

/** A keypair's first bytes as they would appear in a logged array */
const bytesOf = (kp: number[]) => kp.slice(0, 8).join(",");

/** A connected wallet on one fresh account, as `localStorage` holds it */
const walletWithNewAccount = () => {
  const keypair = Keypair.generate();
  return {
    address: keypair.publicKey.toBase58(),
    kp: Array.from(keypair.secretKey),
    wallet: {
      state: "pg",
      accounts: [{ kp: Array.from(keypair.secretKey), name: "Wallet 1" }],
      currentIndex: 0,
    },
  };
};

const storedCount = async (page: Page) =>
  (await storedWallet(page))?.accounts.length;

const localCount = async (page: Page) =>
  JSON.parse((await localWallet(page)) ?? "{}").accounts?.length;

test("wallet-storage: Two tabs load at once", async ({ context, page }) => {
  await seedWorkspace(page);
  const { address, kp, wallet } = walletWithNewAccount();
  await putLocalText(page)(JSON.stringify(wallet));
  const other = await context.newPage();

  await Promise.all([page.reload(), other.goto("/")]);

  await expect.poll(() => localWallet(page), LONG).toBeNull();
  await expect.poll(() => storedCount(page), LONG).toBe(1);
  expect((await storedWallet(page))?.accounts[0].kp).toEqual(kp);
  await expect(walletStep(page)).toContainText(address.slice(0, 4), LONG);
});

test("wallet-storage: A localStorage wallet cannot be read", async ({
  page,
}) => {
  await seedWorkspace(page);
  const shown = await createWallet(page);
  await expect.poll(() => storedCount(page), LONG).toBe(1);
  await putLocalText(page)("{not json");

  await page.reload();

  await expect(walletStep(page)).toHaveText(shown, LONG);
  expect(await localWallet(page)).toBe("{not json");
  expect(
    await page.evaluate(() => localStorage.getItem("wallet.unreadable"))
  ).toBe("{not json");
});

test("wallet-storage: Both stores hold a wallet", async ({ page }) => {
  await seedWorkspace(page);
  await createWallet(page);
  await expect.poll(() => storedCount(page), LONG).toBe(1);
  const before = await storedWallet(page);
  const { address, kp, wallet } = walletWithNewAccount();
  await putLocalText(page)(JSON.stringify(wallet));

  await page.reload();

  await expect.poll(() => localWallet(page), LONG).toBeNull();
  const after = await storedWallet(page);
  expect(after?.accounts.map((account) => account.kp)).toEqual([
    kp,
    before?.accounts[0].kp,
  ]);
  expect(after?.accounts[1].name).not.toBe("Wallet 1");
  await expect(walletStep(page)).toContainText(address.slice(0, 4), LONG);
});

test("wallet-storage: localStorage refuses to be read", async ({ page }) => {
  await seedWorkspace(page);
  const shown = await createWallet(page);
  await expect.poll(() => storedCount(page), LONG).toBe(1);
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === "wallet") {
        throw new DOMException("e2e: storage refused", "SecurityError");
      }
      return getItem.call(this, key);
    };
  });
  const logs = walletLogsOf(page);

  await page.reload();

  await expect(walletStep(page)).toHaveText(shown, LONG);
  await expect.poll(() => logs.length, LONG).toBe(1);
});

test("wallet-storage: The cross-tab lock cannot be taken", async ({ page }) => {
  await page.addInitScript(() => {
    const locks = navigator.locks;
    const request = locks.request.bind(locks);
    const refusing = (name: string, ...rest: unknown[]) =>
      name === "pg-wallet:wallet-state"
        ? Promise.reject(new DOMException("e2e: lock refused", "SecurityError"))
        : (request as (...args: unknown[]) => Promise<unknown>)(name, ...rest);
    locks.request = refusing as LockManager["request"];
  });
  const logs = walletLogsOf(page);
  await seedWorkspace(page);

  await createWallet(page);

  await expect.poll(() => storedCount(page), LONG).toBe(1);
  expect(await localWallet(page)).toBeNull();
  expect(logs).toHaveLength(1);
});

test("wallet-storage: A save to IndexedDB fails", async ({ context, page }) => {
  await failWalletWrites(page);
  await seedWorkspace(page);
  await createWallet(page);
  await expect.poll(() => localCount(page), LONG).toBe(1);
  await page.close();

  // The next load, without the fault, moves it back
  const next = await context.newPage();
  await next.goto("/");

  await expect.poll(() => storedCount(next), LONG).toBe(1);
  await expect.poll(() => localWallet(next), LONG).toBeNull();
});

test("wallet-storage: A failing migration is logged", async ({ page }) => {
  const { kp, wallet } = walletWithNewAccount();
  await failWalletWrites(page);
  await seedLocalWallet(page)(wallet);
  const logs = walletLogsOf(page);

  await seedWorkspace(page);

  await expect.poll(() => logs.length, LONG).toBeGreaterThan(0);
  expect(logs.join("\n")).not.toContain(bytesOf(kp));
});

test("wallet-storage: A truncated localStorage wallet is logged", async ({
  page,
}) => {
  const { kp, wallet } = walletWithNewAccount();
  await page.addInitScript((text) => {
    if (sessionStorage.getItem("e2e-wallet-seeded")) return;
    sessionStorage.setItem("e2e-wallet-seeded", "1");
    localStorage.setItem("wallet", text);
  }, JSON.stringify(wallet).slice(0, -40));
  const logs = walletLogsOf(page);

  await seedWorkspace(page);

  await expect.poll(() => logs.length, LONG).toBeGreaterThan(0);
  expect(logs.join("\n")).not.toContain(bytesOf(kp));
});

test("wallet-storage: The tab closes before a save lands", async ({
  context,
  page,
}) => {
  await seedWorkspace(page);

  // Another tab takes the wallet's lock and keeps it
  const holder = await context.newPage();
  await holder.goto("/");
  await holder.evaluate(() => {
    void navigator.locks.request(
      "pg-wallet:wallet-state",
      () => new Promise<void>(() => {})
    );
  });

  await createWallet(page);
  await page.close({ runBeforeUnload: true });

  const kept = JSON.parse((await localWallet(holder)) ?? "{}");
  expect(kept.accounts).toHaveLength(1);

  // The holder's reload frees the lock, and the load moves the kept save in
  await holder.reload();
  await expect.poll(() => storedCount(holder), LONG).toBe(1);
  await expect.poll(() => localWallet(holder), LONG).toBeNull();
  expect((await storedWallet(holder))?.accounts[0].kp).toEqual(
    kept.accounts[0].kp
  );
});

/** Opens the console drawer and runs `connect`, which saves the wallet */
const toggleConnection = async (page: Page) => {
  const drawer = page.getByRole("button", { name: "Terminal", exact: true });
  if ((await drawer.getAttribute("aria-expanded")) !== "true") {
    await drawer.click();
  }
  await runInTerminal(page, "connect");
};

test("wallet-storage: Neither store saves the wallet", async ({ page }) => {
  await failWalletWrites(page);
  await failLocalWalletWrites(page);
  await seedWorkspace(page);

  await createWallet(page);

  await expect(saveFailedNotices(page)).toHaveCount(1, LONG);
  await expect(saveFailedNotices(page)).toContainText(
    "Changes are kept until you reload; export your keypair to keep it."
  );

  // A second save, disconnecting, fails the same way and tells no one again
  await toggleConnection(page);
  await expect(page.locator(".xterm-rows").first()).toContainText(
    "Disconnected."
  );
  await page.waitForTimeout(TOAST_RENDER_MS);
  expect(await saveFailedNotices(page).count()).toBe(1);
});

/** Three accounts, the middle one damaged: a 10-byte keypair */
const walletWithDamagedAccount = (currentIndex: number) => {
  const keypairs = [Keypair.generate(), Keypair.generate()];
  const damaged = {
    kp: Array.from(keypairs[0].secretKey.slice(0, 10)),
    name: "Damaged",
  };
  const valid = keypairs.map((keypair, i) => ({
    kp: Array.from(keypair.secretKey),
    name: `Wallet ${i + 1}`,
  }));
  return {
    addresses: keypairs.map((keypair) => keypair.publicKey.toBase58()),
    damaged,
    valid,
    wallet: {
      state: "pg",
      accounts: [valid[0], damaged, valid[1]],
      currentIndex,
    },
  };
};

/** The toasts that say accounts were set aside */
const setAsideNotices = (page: Page) =>
  page.locator("[data-sonner-toast]").filter({
    hasText: "Some wallet accounts could not be read and were set aside.",
  });

test("wallet-storage: One of three accounts is damaged", async ({ page }) => {
  const { addresses, damaged, valid, wallet } = walletWithDamagedAccount(2);
  await seedLocalWallet(page)(wallet);

  await seedWorkspace(page);

  await expect(walletStep(page)).toContainText(addresses[1].slice(0, 4), LONG);
  await expect.poll(() => localWallet(page), LONG).toBeNull();
  expect((await storedWallet(page))?.accounts).toEqual(valid);
  expect(await storedSetAside(page)).toEqual([damaged]);
  await expect(setAsideNotices(page)).toHaveCount(1, LONG);
  await page.waitForTimeout(TOAST_RENDER_MS);
  expect(await setAsideNotices(page).count()).toBe(1);
});

test("wallet-storage: The current account is the damaged one", async ({
  page,
}) => {
  const { addresses, wallet } = walletWithDamagedAccount(1);
  await seedLocalWallet(page)(wallet);

  await seedWorkspace(page);

  await expect(walletStep(page)).toContainText(addresses[0].slice(0, 4), LONG);
  await expect(walletStep(page)).toContainText(addresses[0].slice(-4));
  await expect
    .poll(async () => (await storedWallet(page))?.currentIndex, LONG)
    .toBe(0);
});

test("wallet-storage: Persistence is requested once", async ({ page }) => {
  await page.addInitScript(() => {
    const calls = { count: 0 };
    Object.assign(window, { e2ePersistCalls: calls });
    navigator.storage.persist = async () => {
      calls.count++;
      return false;
    };
  });
  const persistCalls = () =>
    page.evaluate(
      () =>
        (window as unknown as { e2ePersistCalls: { count: number } })
          .e2ePersistCalls.count
    );
  await seedWorkspace(page);
  await createWallet(page);
  await expect.poll(() => storedCount(page), LONG).toBe(1);

  // A second save to IndexedDB: disconnecting
  await toggleConnection(page);
  await expect(page.locator(".xterm-rows").first()).toContainText(
    "Disconnected."
  );
  await expect
    .poll(async () => (await storedWallet(page))?.state, LONG)
    .toBe("disconnected");

  expect(await persistCalls()).toBe(1);
});

test("wallet-storage: Try again reads the wallet", async ({ page }) => {
  await seedWorkspace(page);
  const shown = await createWallet(page);
  await expect.poll(() => storedCount(page), LONG).toBe(1);
  // The database refuses to open until the test lets it
  await page.addInitScript(() => {
    Object.assign(window, { e2eWalletBlocked: true });
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => {
      const isBlocked = (window as unknown as { e2eWalletBlocked: boolean })
        .e2eWalletBlocked;
      if (name === "pg-wallet" && isBlocked) {
        throw new DOMException("e2e: database blocked", "SecurityError");
      }
      return open(name, version);
    };
  });
  const events = linesOn(page);
  await page.reload();
  await expect(walletWarning(page)).toBeVisible(LONG);

  await page.evaluate(() => Object.assign(window, { e2eWalletBlocked: false }));
  await page
    .getByRole("button", { name: "Wallet unavailable, try again" })
    .click();

  await expect(walletStep(page)).toHaveText(shown, LONG);
  await expect
    .poll(() => lineOf(events, "setup_wallet_retried"), LONG)
    .toContain("outcome: loaded");
});

test("wallet-storage: A browser without IndexedDB gets Setup", async ({
  page,
}) => {
  // The app's files need IndexedDB, so only the wallet's database goes: its
  // open fails as the keystore's does where `indexedDB` is undefined
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => {
      if (name === "pg-wallet") throw new Error("indexedDB is not available");
      return open(name, version);
    };
  });
  await seedWorkspace(page);

  await createWallet(page);

  await expect(walletWarning(page)).toHaveCount(0);
  await expect.poll(() => localCount(page), LONG).toBe(1);
});
