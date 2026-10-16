import { SYNC_LOCK, timeoutSignal, withSyncLock } from "./sync-lock";

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
    const request = vi.fn((_name: string, fn: () => Promise<unknown>) => fn());
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

describe("timeoutSignal", () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  const setTimeoutFn = (value: unknown) =>
    Object.defineProperty(AbortSignal, "timeout", {
      value,
      configurable: true,
      writable: true,
    });

  afterEach(() => {
    if (original) Object.defineProperty(AbortSignal, "timeout", original);
    else delete (AbortSignal as { timeout?: unknown }).timeout;
  });

  it("is undefined where the browser cannot make one", () => {
    setTimeoutFn(undefined);
    expect(timeoutSignal(15_000)).toBeUndefined();
  });

  it("asks the browser for a signal that times out", () => {
    const signal = new AbortController().signal;
    const timeout = vi.fn(() => signal);
    setTimeoutFn(timeout);

    expect(timeoutSignal(15_000)).toBe(signal);
    expect(timeout).toHaveBeenCalledWith(15_000);
  });
});
