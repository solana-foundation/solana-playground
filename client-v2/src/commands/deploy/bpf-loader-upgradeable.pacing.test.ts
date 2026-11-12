// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, so its tests stay out of the modules (AGENTS.md)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";

import { BpfLoaderUpgradeable } from "./bpf-loader-upgradeable";

const METADATA_SIZE = 37;
/** `PACKET_DATA_SIZE` less what `loadBuffer` reserves for the rest of a write */
const CHUNK_SIZE = 1232 - 220 - 44 - 40;

/** The buffer account's data, when each send started, how many to fail and with what */
const chain = vi.hoisted(() => ({
  data: Buffer.alloc(0),
  sentAt: [] as number[],
  failures: 0,
  // What a 429 without CORS headers becomes in the browser
  failWith: (): Error => new TypeError("Failed to fetch"),
  /** Sends that land after each read of the buffer; the rest fail */
  landsPerRead: Number.POSITIVE_INFINITY,
  landsLeft: Number.POSITIVE_INFINITY,
  /** The config of each connection `getUnretriedConnectionFor` built, and the connection each send went through */
  created: [] as object[],
  sentThrough: [] as unknown[],
  /** Buffer reads through the read-buffer RPC; the selected connection has no `getAccountInfo`, so a read there throws */
  bufferReads: 0,
  /** What `PgConnection.getSendTxPerSecond` returns, as the env would set it */
  sendTxPerSecond: undefined as number | undefined,
  /** Every buffer read throws, as from a read-buffer RPC that is down */
  readFails: false,
  /** Sends are accepted but never reach the buffer */
  dropsWrites: false,
  /** How long each send waits before it answers; `Infinity` never answers, as a paused validator */
  answersAfterMs: 0,
  /** Sends, from the first, that never answer whatever `answersAfterMs` says */
  hangingSends: 0,
  current: { rpcEndpoint: "https://rpc.test", commitment: "confirmed" },
  readBufferRpc: {
    rpcEndpoint: "https://read.test/?api-key=secret",
    getAccountInfo: async () => {
      chain.bufferReads++;
      if (chain.readFails) throw new Error("connection refused");
      chain.landsLeft = chain.landsPerRead;
      return { data: Buffer.from(chain.data) };
    },
  },
}));

vi.mock("../../utils", () => ({
  PgCommon: {
    setDefault: <T extends object>(value: T, defaults: object) =>
      Object.assign({}, defaults, value),
    // Rejects on a stop, and at once after one, as `PgCommon.sleep` does
    sleep: (ms: number, abortController: AbortController | undefined) =>
      new Promise((res, rej) => {
        if (abortController?.signal.aborted) {
          rej(new DOMException("Aborted", "AbortError"));
          return;
        }
        const id = setTimeout(res, ms);
        abortController?.signal.addEventListener("abort", () => {
          clearTimeout(id);
          rej(new DOMException("Aborted", "AbortError"));
        });
      }),
  },
  PgConnection: {
    current: chain.current,
    getReadBufferConnection: (connection: unknown) =>
      connection === chain.current ? chain.readBufferRpc : connection,
    getSendTxPerSecond: (connection: unknown) =>
      connection === chain.current ? chain.sendTxPerSecond : undefined,
  },
  PgPlaynet: { isUrlPlaynet: () => false },
  PgTx: {
    send: async (
      ix: { offset: number; bytes: Buffer },
      { connection }: { connection?: unknown }
    ) => {
      chain.sentAt.push(Date.now());
      chain.sentThrough.push(connection);
      const hangs = chain.hangingSends-- > 0;
      if (hangs || chain.answersAfterMs > 0) {
        await new Promise((res) => {
          if (!hangs && Number.isFinite(chain.answersAfterMs)) {
            setTimeout(res, chain.answersAfterMs);
          }
        });
      }
      if (chain.failures-- > 0 || chain.landsLeft-- <= 0) {
        throw chain.failWith();
      }
      if (!chain.dropsWrites) ix.bytes.copy(chain.data, 37 + ix.offset);
      return "sig";
    },
    simulate: async () => ({ unitsConsumed: 1 }),
    confirm: async () => ({}),
  },
  PgWallet: { current: { publicKey: {} } },
  PgWeb3: {
    PACKET_DATA_SIZE: 1232,
    MAX_COMPUTE_UNIT_LIMIT: 1_400_000,
    DEFAULT_MS_PER_SLOT: 400,
    BpfLoaderUpgradeableProgram: {
      BUFFER_METADATA_SIZE: 37,
      write: (ix: { offset: number; bytes: Buffer }) => ix,
    },
  },
}));

vi.mock("@/entities/cluster", () => ({
  getUnretriedConnectionFor: (commitment: string) => (endpoint: string) => {
    const config = { endpoint, commitment, disableRetryOnRateLimit: true };
    chain.created.push(config);
    return config;
  },
}));

/** Load a program of `chunks` writes and return when each send started */
const loadWith = async (
  opts: {
    loadConcurrency: number;
    writesPerSecond: number;
    onRateLimit?: (retryAfter: number, reason: string) => void;
    onRefusal?: (message: string) => void;
  },
  chunks: number
) => {
  const bytes = new Uint8Array(chunks * CHUNK_SIZE).fill(1);
  chain.data = Buffer.alloc(METADATA_SIZE + bytes.length);

  const loading = BpfLoaderUpgradeable.loadBuffer({} as never, bytes, opts);
  await vi.runAllTimersAsync();
  await loading;
  return chain.sentAt;
};

describe("commands/deploy/bpf-loader-upgradeable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chain.sentAt = [];
    chain.failures = 0;
    chain.failWith = () => new TypeError("Failed to fetch");
    chain.landsPerRead = Number.POSITIVE_INFINITY;
    chain.created = [];
    chain.sentThrough = [];
    chain.bufferReads = 0;
    chain.sendTxPerSecond = undefined;
    chain.readFails = false;
    chain.dropsWrites = false;
    chain.answersAfterMs = 0;
    chain.hangingSends = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    resetLogger();
  });

  it("sends no more writes in a second than the cap, however many workers run", async () => {
    const sentAt = await loadWith(
      { loadConcurrency: 4, writesPerSecond: 5 },
      12
    );

    expect(sentAt).toHaveLength(12);
    for (let i = 0; i + 5 < sentAt.length; i++) {
      expect(sentAt[i + 5] - sentAt[i]).toBeGreaterThanOrEqual(1000);
    }
  });

  it("pauses longer after each send that fails for a reason other than a rate limit, and no longer once one lands", async () => {
    chain.failures = 2;
    chain.failWith = () => new Error("Blockhash not found");

    const sentAt = await loadWith(
      { loadConcurrency: 1, writesPerSecond: 1000 },
      4
    );

    const gaps = sentAt.slice(1).map((t, i) => t - sentAt[i]);
    expect(gaps[0]).toBeGreaterThan(1);
    expect(gaps[1]).toBeGreaterThan(gaps[0]);
    expect(gaps[2]).toBeLessThan(gaps[0]);
  });

  it("waits out a Helius -32429 write and passes its reason to onRateLimit", async () => {
    chain.failures = 1;
    chain.failWith = () =>
      Object.assign(new Error("Too many requests"), { code: -32429 });
    const onRateLimit = vi.fn();

    const sentAt = await loadWith(
      { loadConcurrency: 1, writesPerSecond: 1000, onRateLimit },
      2
    );

    expect(onRateLimit).toHaveBeenCalledWith(10, "Helius: Too many requests");
    expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(10_000);
  });

  const rateLimited = (): Error =>
    Object.assign(new Error("Too many requests"), { code: -32429 });
  const fetchFailed = (): Error => new TypeError("Failed to fetch");

  it.each([
    {
      label: "halves the rate after a rate-limited write",
      failWith: rateLimited,
      writesPerSecond: 8,
      gapAfter: 250,
    },
    {
      label: "keeps the floor after a rate-limited write",
      failWith: rateLimited,
      writesPerSecond: 1,
      gapAfter: 1000,
    },
    {
      label: "halves the rate after a write the browser blocked",
      failWith: fetchFailed,
      writesPerSecond: 8,
      gapAfter: 250,
    },
    {
      label: "keeps the rate after a write the RPC refused",
      failWith: (): Error => new Error("Blockhash not found"),
      writesPerSecond: 8,
      gapAfter: 125,
    },
    {
      label: "keeps the rate after a TypeError that is not a failed fetch",
      failWith: (): Error =>
        new TypeError("Cannot read properties of undefined"),
      writesPerSecond: 8,
      gapAfter: 125,
    },
  ])("$label", async ({ failWith, writesPerSecond, gapAfter }) => {
    chain.failures = 1;
    chain.failWith = failWith;

    const sentAt = await loadWith({ loadConcurrency: 1, writesPerSecond }, 3);

    expect(sentAt[2] - sentAt[1]).toBe(gapAfter);
  });

  it.each([
    { label: "raises the rate", writesPerSecond: 1, gapAfter: 500 },
    { label: "keeps the ceiling", writesPerSecond: 20, gapAfter: 50 },
  ])(
    "$label after ten landed writes in a row",
    async ({ writesPerSecond, gapAfter }) => {
      const sentAt = await loadWith(
        { loadConcurrency: 1, writesPerSecond },
        12
      );

      // The turn of the 11th write was taken at the old rate, so the 12th is the first at the new one
      expect(sentAt[11] - sentAt[10]).toBe(gapAfter);
    }
  );

  it("starts at the cluster's send cap below the start rate and stays there after a run of landed writes", async () => {
    chain.sendTxPerSecond = 2;

    const bytes = new Uint8Array(13 * CHUNK_SIZE).fill(1);
    chain.data = Buffer.alloc(METADATA_SIZE + bytes.length);
    const loading = BpfLoaderUpgradeable.loadBuffer({} as never, bytes, {
      loadConcurrency: 1,
    });
    await vi.runAllTimersAsync();
    await loading;

    const gaps = chain.sentAt.slice(1).map((t, i) => t - chain.sentAt[i]);
    expect(gaps).toEqual(new Array(12).fill(500));
  });

  it("logs refused writes once per load, with the first refusal's message", async () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    chain.failures = 3;

    await loadWith({ loadConcurrency: 1, writesPerSecond: 1000 }, 2);

    expect(
      logged.entries.map(({ level, message }) => ({ level, message }))
    ).toEqual([
      {
        level: "debug",
        message:
          "Buffer writes: 3 refused, each sent again until the load ended; the first: Failed to fetch",
      },
    ]);
  });

  it("sends writes through the selected RPC without a 429 retry, and reads the buffer through the read-buffer RPC", async () => {
    await loadWith({ loadConcurrency: 1, writesPerSecond: 1000 }, 2);

    expect(chain.created).toEqual([
      {
        endpoint: "https://rpc.test",
        commitment: "confirmed",
        disableRetryOnRateLimit: true,
      },
    ]);
    expect(chain.sentThrough).toEqual([chain.created[0], chain.created[0]]);
    expect(chain.bufferReads).toBeGreaterThan(0);
  });

  it("throws once rounds in a row land no chunk, naming the last rate limit", async () => {
    chain.landsPerRead = 0;
    chain.failWith = () =>
      Object.assign(new Error("Too many requests"), { code: 429 });

    const bytes = new Uint8Array(2 * CHUNK_SIZE).fill(1);
    chain.data = Buffer.alloc(METADATA_SIZE + bytes.length);

    const loading = BpfLoaderUpgradeable.loadBuffer({} as never, bytes, {
      loadConcurrency: 1,
    });
    // Attached before the timers run, so the rejection is never unhandled
    const failure = expect(loading).rejects.toThrow(
      "The RPC kept refusing buffer writes: no chunk landed in 5 rounds in a row (last rate limit: Solana RPC: Too many requests)"
    );
    await vi.runAllTimersAsync();
    await failure;
  });

  it("keeps loading while each round lands a chunk, past the stalled-round cap", async () => {
    chain.landsPerRead = 1;

    const sentAt = await loadWith(
      { loadConcurrency: 1, writesPerSecond: 1000 },
      8
    );

    expect(chain.data.subarray(METADATA_SIZE).every((b) => b === 1)).toBe(true);
    expect(sentAt.length).toBeGreaterThan(8);
  });

  it("returns without a throw when stopped during a pause", async () => {
    chain.failures = Number.POSITIVE_INFINITY;
    const bytes = new Uint8Array(4 * CHUNK_SIZE).fill(1);
    chain.data = Buffer.alloc(METADATA_SIZE + bytes.length);
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 100);

    const loading = BpfLoaderUpgradeable.loadBuffer({} as never, bytes, {
      loadConcurrency: 1,
      abortController,
    });
    await vi.runAllTimersAsync();

    await expect(loading).resolves.toBeUndefined();
    expect(chain.sentAt).toHaveLength(1);
  });

  it("returns without a throw when stopped during a rate-limit wait", async () => {
    chain.failures = 1;
    chain.failWith = rateLimited;
    const bytes = new Uint8Array(2 * CHUNK_SIZE).fill(1);
    chain.data = Buffer.alloc(METADATA_SIZE + bytes.length);
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 5000);

    const loading = BpfLoaderUpgradeable.loadBuffer({} as never, bytes, {
      loadConcurrency: 1,
      abortController,
    });
    // Attached before the timers run, so a rejection is never unhandled
    const settled = expect(loading).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await settled;
  });

  it("stops the other workers' sends after one write is rate-limited", async () => {
    chain.failures = 1;
    chain.failWith = rateLimited;

    const sentAt = await loadWith(
      { loadConcurrency: 4, writesPerSecond: 1000 },
      12
    );

    // The first send is refused; the three in flight land, and nothing more goes before the wait
    expect(sentAt.filter((t) => t - sentAt[0] < 10_000)).toHaveLength(4);
  });

  it("keeps a send cap below one write per second after a rate limit", async () => {
    chain.sendTxPerSecond = 0.5;
    chain.failures = 1;
    chain.failWith = rateLimited;

    const sentAt = await loadWith(
      { loadConcurrency: 1, writesPerSecond: 4 },
      3
    );

    expect(sentAt[2] - sentAt[1]).toBe(2000);
  });

  it("gives up on a read-buffer RPC that does not answer, naming it and logging the first failure", async () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    chain.readFails = true;
    const bytes = new Uint8Array(2 * CHUNK_SIZE).fill(1);
    chain.data = Buffer.alloc(METADATA_SIZE + bytes.length);

    const loading = BpfLoaderUpgradeable.loadBuffer({} as never, bytes, {
      loadConcurrency: 1,
    });
    const failure = expect(loading).rejects.toThrow(
      "Could not read the buffer account from the read-buffer RPC (read.test) in 30 attempts"
    );
    await vi.runAllTimersAsync();
    await failure;

    expect(
      logged.entries.map(({ level, context }) => ({ level, context }))
    ).toEqual([
      {
        level: "warn",
        context: { endpoint: "read.test", error: "connection refused" },
      },
    ]);
  });

  it("fails a stalled load with the last refusal as its cause, and logs the refusals at warn", async () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    chain.landsPerRead = 0;
    const refusal = new Error("Insufficient funds for fee");
    chain.failWith = () => refusal;
    const bytes = new Uint8Array(2 * CHUNK_SIZE).fill(1);
    chain.data = Buffer.alloc(METADATA_SIZE + bytes.length);

    const loading = BpfLoaderUpgradeable.loadBuffer({} as never, bytes, {
      loadConcurrency: 1,
    });
    const failure = loading.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const error = (await failure) as Error;

    expect(error.message).toBe(
      "The RPC kept refusing buffer writes: no chunk landed in 5 rounds in a row (last refusal: Insufficient funds for fee)"
    );
    expect(error.cause).toBe(refusal);
    expect(logged.entries.map(({ level }) => level)).toEqual(["warn"]);
  });

  it("reports the first refused write of each round to onRefusal, with the cluster's message", async () => {
    // Each round lands one chunk and refuses the rest: three chunks take three rounds, two with refusals
    chain.landsPerRead = 1;
    chain.failWith = () =>
      Object.assign(
        new Error(
          "Simulation failed. \nMessage: Transaction simulation failed: Insufficient funds for fee. \nLogs: \n[]."
        ),
        {
          transactionMessage:
            "Transaction simulation failed: Insufficient funds for fee",
        }
      );
    const onRefusal = vi.fn();

    await loadWith({ loadConcurrency: 4, writesPerSecond: 1000, onRefusal }, 3);

    expect(onRefusal.mock.calls).toEqual([
      ["Transaction simulation failed: Insufficient funds for fee"],
      ["Transaction simulation failed: Insufficient funds for fee"],
    ]);
  });

  it("names a refusal without a cluster message by the first line of its error", async () => {
    chain.failures = 1;
    chain.failWith = () => new Error("connection reset\nat fetch");
    const onRefusal = vi.fn();

    await loadWith({ loadConcurrency: 1, writesPerSecond: 1000, onRefusal }, 2);

    expect(onRefusal.mock.calls).toEqual([["connection reset"]]);
  });

  it("names a refusal by its error when the cluster's message is blank", async () => {
    chain.failures = 1;
    chain.failWith = () =>
      Object.assign(new Error("Simulation failed.\nLogs: []"), {
        transactionMessage: "  ",
      });
    const onRefusal = vi.fn();

    await loadWith({ loadConcurrency: 1, writesPerSecond: 1000, onRefusal }, 2);

    expect(onRefusal.mock.calls).toEqual([["Simulation failed."]]);
  });

  it("reports no refusal for a send that fails after a stop", async () => {
    const abortController = new AbortController();
    chain.failures = 1;
    chain.failWith = () => {
      abortController.abort();
      return new TypeError("Failed to fetch");
    };
    const onRefusal = vi.fn();
    const bytes = new Uint8Array(2 * CHUNK_SIZE).fill(1);
    chain.data = Buffer.alloc(METADATA_SIZE + bytes.length);

    const loading = BpfLoaderUpgradeable.loadBuffer({} as never, bytes, {
      loadConcurrency: 1,
      abortController,
      onRefusal,
    });
    await vi.runAllTimersAsync();
    await loading;

    expect(chain.sentAt).toHaveLength(1);
    expect(onRefusal).not.toHaveBeenCalled();
  });

  it("reports a write the browser could not send as refused, naming the failed fetch", async () => {
    chain.failures = 1;
    chain.failWith = fetchFailed;
    const onRefusal = vi.fn();

    await loadWith({ loadConcurrency: 1, writesPerSecond: 1000, onRefusal }, 2);

    expect(onRefusal.mock.calls).toEqual([["Failed to fetch"]]);
  });

  it("prints one line for a round with a refusal and then a rate limit: the refusal", async () => {
    const answers = [
      () => new Error("Insufficient funds for fee"),
      rateLimited,
    ];
    chain.failures = 2;
    chain.failWith = () => (answers.shift() ?? rateLimited)();
    const onRefusal = vi.fn();
    const onRateLimit = vi.fn();

    const sentAt = await loadWith(
      { loadConcurrency: 1, writesPerSecond: 1000, onRefusal, onRateLimit },
      3
    );

    expect(onRefusal.mock.calls).toEqual([["Insufficient funds for fee"]]);
    expect(onRateLimit).not.toHaveBeenCalled();
    // The round still waits out the rate limit
    expect(sentAt[2] - sentAt[1]).toBeGreaterThanOrEqual(10_000);
  });

  it("names a fetch the browser could not make Failed to fetch, whatever the browser calls it", async () => {
    chain.failures = 1;
    // Safari's words for a failed fetch
    chain.failWith = () => new TypeError("Load failed");
    const onRefusal = vi.fn();

    await loadWith({ loadConcurrency: 1, writesPerSecond: 1000, onRefusal }, 2);

    expect(onRefusal.mock.calls).toEqual([["Failed to fetch"]]);
  });

  it("names a failed blockhash fetch Failed to fetch, as web3.js words it in text", async () => {
    chain.failures = 1;
    chain.failWith = () =>
      new Error("failed to get recent blockhash: TypeError: Load failed");
    const onRefusal = vi.fn();

    await loadWith({ loadConcurrency: 1, writesPerSecond: 1000, onRefusal }, 2);

    expect(onRefusal.mock.calls).toEqual([["Failed to fetch"]]);
  });

  it("cuts a long refusal message, such as an RPC's error page", async () => {
    chain.failures = 1;
    chain.failWith = () =>
      new Error(`502 Bad Gateway: ${"<html>".repeat(100)}`);
    const onRefusal = vi.fn();

    await loadWith({ loadConcurrency: 1, writesPerSecond: 1000, onRefusal }, 2);

    const [[message]] = onRefusal.mock.calls as [[string]];
    expect(message.startsWith("502 Bad Gateway: <html>")).toBe(true);
    expect(message).toHaveLength(201);
  });

  it("leaves a rate-limited write to onRateLimit, not onRefusal", async () => {
    chain.failures = 1;
    chain.failWith = rateLimited;
    const onRefusal = vi.fn();

    await loadWith({ loadConcurrency: 1, writesPerSecond: 1000, onRefusal }, 2);

    expect(onRefusal).not.toHaveBeenCalled();
  });

  it("says writes were accepted but never landed when no send was refused", async () => {
    chain.dropsWrites = true;
    const bytes = new Uint8Array(2 * CHUNK_SIZE).fill(1);
    chain.data = Buffer.alloc(METADATA_SIZE + bytes.length);

    const loading = BpfLoaderUpgradeable.loadBuffer({} as never, bytes, {
      loadConcurrency: 1,
    });
    const failure = expect(loading).rejects.toThrow(
      "The RPC accepted buffer writes that never landed: no chunk landed in 5 rounds in a row"
    );
    await vi.runAllTimersAsync();
    await failure;
  });

  it("refuses a write that never answers within 20 s, ends its round, and fails the load at the stalled-round limit", async () => {
    chain.answersAfterMs = Number.POSITIVE_INFINITY;
    const refusedAt: number[] = [];
    const onRefusal = vi.fn<(message: string) => void>(() => {
      refusedAt.push(Date.now());
    });
    const bytes = new Uint8Array(8 * CHUNK_SIZE).fill(1);
    chain.data = Buffer.alloc(METADATA_SIZE + bytes.length);
    const start = Date.now();

    const loading = BpfLoaderUpgradeable.loadBuffer({} as never, bytes, {
      loadConcurrency: 2,
      writesPerSecond: 1000,
      onRefusal,
    });
    // Attached before the timers run, so the rejection is never unhandled
    const failure = expect(loading).rejects.toThrow(
      "The RPC kept refusing buffer writes: no chunk landed in 5 rounds in a row (last refusal: No answer in 20 s)"
    );
    await vi.runAllTimersAsync();
    await failure;

    // One line a round, the first 20 s after the load starts (its first write goes at once)
    expect(onRefusal.mock.calls).toEqual(
      new Array(5).fill(["No answer in 20 s"])
    );
    expect(refusedAt[0] - start).toBe(20_000);
    // Each round sends its two workers' first writes and nothing more
    expect(chain.sentAt).toHaveLength(10);
  });

  it("lands a write that answers just under 20 s", async () => {
    chain.answersAfterMs = 19_999;
    const onRefusal = vi.fn();

    await loadWith({ loadConcurrency: 1, writesPerSecond: 1000, onRefusal }, 2);

    expect(onRefusal).not.toHaveBeenCalled();
    expect(chain.sentAt).toHaveLength(2);
    expect(chain.data.subarray(METADATA_SIZE).every((b) => b === 1)).toBe(true);
  });

  it("sends nothing more in a round once one write goes unanswered, and sends that chunk again next round", async () => {
    // A turn every 8 s: worker A's write at 0 s never answers, worker B lands writes at 8 s and 16 s and waits for
    // its 24 s turn when A's write times out at 20 s
    chain.hangingSends = 1;
    const onRefusal = vi.fn();

    const sentAt = await loadWith(
      { loadConcurrency: 2, writesPerSecond: 0.125, onRefusal },
      4
    );

    expect(onRefusal.mock.calls).toEqual([["No answer in 20 s"]]);
    const sentAfter = sentAt.map((t) => t - sentAt[0]);
    expect(sentAfter.slice(0, 3)).toEqual([0, 8000, 16_000]);
    // The next round's first turn is the one after B's skipped 24 s turn
    expect(sentAfter[3]).toBe(32_000);
    expect(chain.data.subarray(METADATA_SIZE).every((b) => b === 1)).toBe(true);
  });

  it("returns at once, with no refusal, when stopped while a write waits for an answer", async () => {
    chain.hangingSends = 1;
    const start = Date.now();
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 100);
    const onRefusal = vi.fn();
    const bytes = new Uint8Array(2 * CHUNK_SIZE).fill(1);
    chain.data = Buffer.alloc(METADATA_SIZE + bytes.length);
    let returnedAt: number | undefined;

    const loading = BpfLoaderUpgradeable.loadBuffer({} as never, bytes, {
      loadConcurrency: 1,
      abortController,
      onRefusal,
    }).then(() => {
      returnedAt = Date.now();
    });
    await vi.runAllTimersAsync();
    await loading;

    expect(returnedAt === undefined ? undefined : returnedAt - start).toBe(100);
    expect(onRefusal).not.toHaveBeenCalled();
    expect(chain.sentAt).toHaveLength(1);
  });

  it("logs the outcome of a write that answers after its time limit", async () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    chain.answersAfterMs = 25_000;

    await loadWith({ loadConcurrency: 1, writesPerSecond: 1000 }, 1);

    // The read at 20 s misses the first write, which lands at 25 s, so the chunk is sent again and that send answers
    // late too
    expect(
      logged.entries.filter(
        ({ message }) =>
          message === "A buffer write answered after its time limit"
      )
    ).toHaveLength(2);
  });
});
