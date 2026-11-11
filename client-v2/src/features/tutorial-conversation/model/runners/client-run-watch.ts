import { createLogger } from "@/shared/lib/logger";

import type { Disposable } from "../../../../utils/types";
import type { RunInput } from "../ports";
import type { RunResult } from "../progress";
import type { Captured } from "./capture";
import { CAPTURE_BUSY, isCaptureBusy } from "./capture";

const log = createLogger("tutorial-conversation:client-run-watch");

/** What a run handed to the chain, and what it threw, if anything */
export interface Sends {
  captured: Captured[];
  error: unknown;
}

/** What the watcher reads of the `run` command and the chain */
export interface ClientRunWatchPort {
  /** Every run of the `run` command, from any caller, as it starts, with its input */
  onDidStart(cb: (input: string | null) => void): Disposable;
  /** The same runs as they finish: help finishes nothing */
  onDidFinish(cb: (result: { err?: unknown }) => void): Disposable;
  /** The same runs as they end, however they ended */
  onDidEnd(cb: () => void): Disposable;
  /**
   * Records every transaction sent until `until` settles; answers
   * `CAPTURE_BUSY` as its error when a capture is already running, which is
   * the run act's own: its run goes through `run` inside its capture
   */
  capture(until: Promise<void>): Promise<Sends>;
  /**
   * Readies the run as the run act readies its own, before the run's
   * handler starts: `pg.program` from the deployed IDL when the stored one
   * is empty
   */
  prepare(input: RunInput): void;
  /** The result the run act would post for the same sends, if it can be read */
  read(
    input: RunInput,
    sends: Sends,
    startedAt: number
  ): Promise<RunResult | undefined>;
  now(): number;
}

/** What the conversation answers as a run starts: what to judge it with, and where the result goes */
export interface ClientRunJudging {
  input: RunInput;
  onResult(result: RunResult): void;
}

/** The client file a run act runs, as `run` is given it; `real-run` runs it */
export const CLIENT_FILE = "client.ts";

/**
 * Whether a `run` runs the client file: `run` alone (every client script),
 * or paths that each name it (`client.ts`, `client/client.ts`, the full
 * path). Help runs nothing
 */
const isClientRun = (input: string | null) => {
  const paths = (input ?? "").trim().split(/\s+/).slice(1);
  return paths.every(
    (path) => path === CLIENT_FILE || path.endsWith(`/${CLIENT_FILE}`)
  );
};

/**
 * Judge every run of the client file that did not start from its act card
 * (the terminal's `run`, the explorer's Run, the docs' Run) as the run act
 * judges its own (HOO-2806): `begin` says, as the run starts, whether the
 * live step waits on a call and with what input; the run's transactions are
 * captured until it finishes, read back, and the result handed on. A run the
 * card started is already inside the card's capture, so it is not seen
 * twice.
 *
 * @param begin the live step's judging, or undefined when nothing waits on a run
 * @param port the `run` command and the chain
 * @returns a disposable that stops watching
 */
export const watchClientRuns = (
  begin: () => ClientRunJudging | undefined,
  port: ClientRunWatchPort
): Disposable => {
  let release: ((error: unknown) => void) | undefined;
  /** Stopped watching: a run still captured is left unjudged */
  let disposed = false;
  const settle = (error: unknown) => {
    release?.(error);
    release = undefined;
  };
  const subs = [
    port.onDidStart((input) => {
      if (release || !isClientRun(input)) return;
      const judging = begin();
      if (!judging) return;
      port.prepare(judging.input);
      const startedAt = port.now();
      let error: unknown;
      const until = new Promise<void>((resolve) => {
        release = (thrown) => {
          error = thrown;
          resolve();
        };
      });
      port
        .capture(until)
        .then(async (sends) => {
          const isBusy =
            sends.error instanceof Error && isCaptureBusy(sends.error.message);
          // The card's own run, or another act sending: theirs to judge
          if (isBusy) {
            log.debug("A client run while another capture held the send path");
            return;
          }
          // Cut short by the watcher's end, not by the run: what it sent so
          // far is not the run's result
          if (disposed) return;
          const result = await port.read(
            judging.input,
            { captured: sends.captured, error },
            startedAt
          );
          if (result) judging.onResult(result);
        })
        .catch((e) => {
          log.error(e, {
            report: true,
            context: {
              stage: "judging a client run",
              beatId: judging.input.beatId,
            },
          });
        });
    }),
    port.onDidFinish((result) => settle(result.err)),
    port.onDidEnd(() => settle(undefined)),
  ];
  return {
    dispose: () => {
      disposed = true;
      settle(undefined);
      subs.forEach((s) => s.dispose());
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("features/tutorial-conversation/model/runners/client-run-watch", () => {
    const INPUT: RunInput = { beatId: "client-run", log: "Hello, World!" };
    const RESULT: RunResult = {
      act: "run",
      ok: true,
      seconds: 1,
      signatures: ["sig"],
      line: "Program log: Hello, World!",
      called: [{ instruction: "hello", args: {} }],
    };

    const SENT: Captured[] = [
      { kind: "sent", signature: "sig", encoded: "tx" },
    ];
    /** A `run` command whose runs the test starts and ends, and a chain that sent `sent` */
    const fakePort = ({
      isBusy,
      sent,
    }: {
      isBusy: boolean;
      sent: Captured[];
    }) => {
      const start = new Set<(input: string | null) => void>();
      const finish = new Set<(result: { err?: unknown }) => void>();
      const end = new Set<() => void>();
      const on =
        <T>(set: Set<T>) =>
        (cb: T): Disposable => {
          set.add(cb);
          return { dispose: () => set.delete(cb) };
        };
      const read = vi.fn(async () => RESULT);
      const port: ClientRunWatchPort = {
        onDidStart: on(start),
        onDidFinish: on(finish),
        onDidEnd: on(end),
        capture: async (until) => {
          if (isBusy) {
            return { captured: [], error: new Error(CAPTURE_BUSY) };
          }
          await until;
          return { captured: sent, error: undefined };
        },
        prepare: vi.fn(),
        read,
        now: () => 1000,
      };
      const run = async (input: string, result: { err?: unknown }) => {
        start.forEach((cb) => cb(input));
        finish.forEach((cb) => cb(result));
        end.forEach((cb) => cb());
        await vi.waitFor(() => Promise.resolve());
        await new Promise((r) => setTimeout(r, 0));
      };
      /** Only the start: the run has not finished */
      const startOnly = (input: string) => start.forEach((cb) => cb(input));
      return { port, read, run, startOnly };
    };

    it("reads a run the terminal started against the live step, and hands the result on", async () => {
      const { port, read, run } = fakePort({ isBusy: false, sent: SENT });
      const onResult = vi.fn();
      const watch = watchClientRuns(() => ({ input: INPUT, onResult }), port);

      await run("run client.ts", {});

      expect(read).toHaveBeenCalledWith(
        INPUT,
        { captured: SENT, error: undefined },
        1000
      );
      expect(onResult).toHaveBeenCalledWith(RESULT);
      watch.dispose();
    });

    it("hands on what the run threw with its sends", async () => {
      const { port, read, run } = fakePort({ isBusy: false, sent: SENT });
      const thrown = new Error("boom");
      const watch = watchClientRuns(
        () => ({ input: INPUT, onResult: () => {} }),
        port
      );

      await run("run", { err: thrown });

      expect(read).toHaveBeenCalledWith(
        INPUT,
        expect.objectContaining({ error: thrown }),
        1000
      );
      watch.dispose();
    });

    it("leaves the card's own run to the card: its capture is already running", async () => {
      const { port, read, run } = fakePort({ isBusy: true, sent: SENT });
      const onResult = vi.fn();
      const watch = watchClientRuns(() => ({ input: INPUT, onResult }), port);

      await run("run client.ts", {});

      expect(read).not.toHaveBeenCalled();
      expect(onResult).not.toHaveBeenCalled();
      watch.dispose();
    });

    it("judges nothing a run sent before the watcher stopped", async () => {
      const { port, read, startOnly } = fakePort({ isBusy: false, sent: SENT });
      const onResult = vi.fn();
      const watch = watchClientRuns(() => ({ input: INPUT, onResult }), port);
      startOnly("run");
      watch.dispose();
      await new Promise((r) => setTimeout(r, 0));
      expect(read).not.toHaveBeenCalled();
      expect(onResult).not.toHaveBeenCalled();
    });

    it("captures nothing when no step waits on a run, for help, or for another script", async () => {
      const { port, read, run } = fakePort({ isBusy: false, sent: SENT });
      const begin = vi.fn(() => undefined);
      const watch = watchClientRuns(begin, port);

      await run("run", {});
      expect(begin).toHaveBeenCalledTimes(1);

      const judged = watchClientRuns(
        () => ({ input: INPUT, onResult: () => {} }),
        port
      );
      await run("run --help", {});
      await run("run scratch.ts", {});

      expect(read).not.toHaveBeenCalled();
      watch.dispose();
      judged.dispose();
    });
  });
}
