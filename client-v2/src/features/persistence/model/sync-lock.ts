/** One name for the whole origin: every tab decides against the same marks */
export const SYNC_LOCK = "pg-project-sync";

/**
 * Run `fn` while no other tab of this browser is deciding or writing.
 *
 * Tabs share the sync marks, so a reconcile in one tab and an upload in
 * another read and write the same state in whatever order they happen to
 * run. The tab-switch race came from exactly that: B listed the account
 * before A's flush landed and read the mark after it, and so saw a
 * divergence that was only A's own edit in flight.
 *
 * Held per tab, not per call. Every caller in this tab shares one Web Lock,
 * taken by the first and released when the last one finishes, so a caller
 * that already holds it -- a push that hits a 409 and merges, a reconcile
 * that adopts -- never waits for itself. Web Locks are not re-entrant, and
 * threading a "the caller holds it" flag through every path that can reach
 * a push was how a missed one would deadlock the tab. Ordering *within* a
 * tab is not this lock's job: the per-project queue and the push gate in
 * `project-sync.ts` do that.
 *
 * Where the browser has no Web Locks (jsdom, very old engines) `fn` just
 * runs. That loses cross-tab ordering, not correctness within a tab.
 */
export const withSyncLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) return await fn();

  // Counted before waiting, so a holder that finishes meanwhile does not
  // release a lock this caller is about to rely on
  holders++;
  held ??= acquire(locks);
  try {
    await held;
    return await fn();
  } finally {
    holders--;
    if (!holders) {
      held = null;
      release?.();
      release = null;
    }
  }
};

/** Callers in this tab inside, or waiting for, the shared lock */
let holders = 0;
/** Settles once this tab holds the lock; `null` while it does not */
let held: Promise<void> | null = null;
/** Lets the lock go */
let release: (() => void) | null = null;

const acquire = (locks: LockManager) =>
  new Promise<void>((acquired, failed) => {
    locks
      .request(
        SYNC_LOCK,
        () =>
          new Promise<void>((done) => {
            release = done;
            acquired();
          })
      )
      .catch(failed);
  });

/**
 * How long a request made while holding the lock may take.
 *
 * Every other tab's sync waits behind the holder, so a request stuck on a dead
 * connection kept the lock, and with it every tab's reconcile and upload. Sent
 * with `timeoutSignal` (`shared/lib/timeout-signal`).
 */
export const LOCKED_REQUEST_MS = 15_000;

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;

  describe("features/persistence/model/sync-lock", () => {
    const setLocks = (locks: unknown) =>
      Object.defineProperty(navigator, "locks", {
        value: locks,
        configurable: true,
      });

    afterEach(() => setLocks(undefined));

    describe("withSyncLock", () => {
      it("runs directly where the browser has no Web Locks", async () => {
        setLocks(undefined);
        expect(await withSyncLock(async () => 7)).toBe(7);
      });

      it("asks for the one shared lock by name", async () => {
        const request = vi.fn((_name: string, fn: () => Promise<unknown>) =>
          fn()
        );
        setLocks({ request });

        expect(await withSyncLock(async () => "done")).toBe("done");
        expect(request).toHaveBeenCalledWith(SYNC_LOCK, expect.any(Function));
      });

      /** A browser's lock manager, with another tab that can hold the lock */
      const browser = () => {
        let tail: Promise<unknown> = Promise.resolve();
        const request = vi.fn((_name: string, fn: () => Promise<unknown>) => {
          const run = tail.then(fn);
          tail = run.catch(() => {});
          return run;
        });
        setLocks({ request });
        const otherTab = () => {
          let letGo!: () => void;
          void request(
            SYNC_LOCK,
            () => new Promise<void>((done) => (letGo = done))
          );
          return () => letGo();
        };
        return { request, otherTab };
      };

      const settle = () => new Promise((done) => setTimeout(done, 0));

      it("waits while another tab holds the lock", async () => {
        const { otherTab } = browser();
        const letGo = otherTab();

        let ran = false;
        const mine = withSyncLock(async () => {
          ran = true;
        });
        await settle();
        expect(ran).toBe(false);

        letGo();
        await mine;
        expect(ran).toBe(true);
      });

      it("lets a holder in this tab take it again without waiting for itself", async () => {
        // A push that hits a 409 merges, and the merge's own upload is a push:
        // with a lock per call, the inner request would queue behind the outer
        // one, which is waiting for it
        browser();
        const result = await withSyncLock(async () =>
          withSyncLock(async () => "inner")
        );
        expect(result).toBe("inner");
      });

      it("asks once for callers that overlap in this tab", async () => {
        const { request } = browser();
        let finish!: () => void;
        const first = withSyncLock(
          () => new Promise<void>((done) => (finish = done))
        );
        await settle();
        const second = withSyncLock(async () => "second");

        expect(await second).toBe("second");
        finish();
        await first;
        expect(request).toHaveBeenCalledTimes(1);
      });

      it("lets another tab in once the last holder here is done", async () => {
        const { request } = browser();
        await withSyncLock(async () => {});

        let theirs = false;
        await request(SYNC_LOCK, async () => {
          theirs = true;
        });
        expect(theirs).toBe(true);
      });

      it("releases after a holder throws", async () => {
        const { request } = browser();
        await expect(
          withSyncLock(async () => {
            throw new Error("boom");
          })
        ).rejects.toThrow("boom");

        let theirs = false;
        await request(SYNC_LOCK, async () => {
          theirs = true;
        });
        expect(theirs).toBe(true);
      });
    });
  });
}
