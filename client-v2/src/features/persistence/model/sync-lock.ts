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

/** How long a request made while holding the lock may take */
export const LOCKED_REQUEST_MS = 15_000;

/**
 * A signal that aborts a request after `ms`, for anything sent while the
 * lock is held.
 *
 * Every other tab's sync waits behind the holder, and `fetch` itself never
 * gives up: a request stuck on a dead connection kept the lock, and with it
 * every tab's reconcile and upload, for as long as the browser let it hang.
 * An aborted request rejects, which lands in the caller's existing catch.
 *
 * @returns the signal, or `undefined` where the browser cannot make one --
 * the request then behaves as it did before
 */
export const timeoutSignal = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== "undefined" &&
  typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
