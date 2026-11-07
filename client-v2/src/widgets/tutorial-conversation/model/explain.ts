/* eslint-disable layers/curry-order -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type { RunResult } from "@/features/tutorial-conversation";

/** The log the prompt carries at most, from its end: the error sits there */
const LOG_LIMIT = 4000;

/** How long a sent prompt may wait for its turn to start before giving up */
const NO_TURN_MS = 15_000;

/**
 * What the assistant is asked about an unplanned failure: the error the card
 * shows, then the log, as the spec's "Explain SHALL ask the live assistant
 * about this error with the build log" has it.
 */
export const explainPrompt = (result: RunResult): string => {
  const lines = [
    "My build in this tutorial step failed. Explain the error and how to fix it.",
  ];
  if (result.act === "build" && !result.ok) {
    const e = result.error;
    if (e) {
      // "src/lib.rs:10:9", as far as the log names it
      const place = [e.file, e.line, e.column]
        .filter((part) => part !== null)
        .join(":");
      const code = e.code ? `${e.code}: ` : "";
      const where = e.file ? ` at ${place}` : "";
      lines.push("", `${code}${e.message}${where}`);
    }
    const log = result.log.slice(-LOG_LIMIT);
    if (log) lines.push("", "Build log:", "```", log, "```");
  } else if (!result.ok && "message" in result) {
    lines.push("", result.message);
  }
  return lines.join("\n");
};

/** What `whenAnswered` reads of the assistant */
export interface AssistantTurns {
  readonly isConnected: boolean;
  readonly turnRunning: boolean;
  onDidChange(cb: () => void): { dispose(): void };
}

/**
 * Calls `onDone` once the assistant's turn for a prompt just sent has ended:
 * at once when no assistant is connected to answer, and after `NO_TURN_MS`
 * when no turn ever started (the prompt waits for a panel that never
 * mounted), so "Show me the fix" is never withheld for good.
 *
 * @returns a disposer that cancels the wait without calling `onDone`
 */
export const whenAnswered = (
  assistant: AssistantTurns,
  onDone: () => void
): (() => void) => {
  if (!assistant.isConnected) {
    onDone();
    return () => {};
  }
  // A turn already running (the learner's own question) is not ours: ours
  // starts after it ends
  let phase: "busy" | "waiting" | "ours" = assistant.turnRunning
    ? "busy"
    : "waiting";
  let settled = false;
  const stop = () => {
    settled = true;
    sub.dispose();
    clearTimeout(timer);
  };
  const finish = () => {
    if (settled) return;
    stop();
    onDone();
  };
  const sub = assistant.onDidChange(() => {
    const running = assistant.turnRunning;
    if (phase === "busy" && !running) phase = "waiting";
    else if (phase === "waiting" && running) phase = "ours";
    else if (phase === "ours" && !running) finish();
  });
  const timer = setTimeout(() => {
    if (phase !== "ours") finish();
  }, NO_TURN_MS);
  return () => {
    if (!settled) stop();
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;

  describe("widgets/tutorial-conversation/model/explain", () => {
    const fake = (connected = true) => {
      const listeners = new Set<() => void>();
      const a = {
        isConnected: connected,
        turnRunning: false,
        onDidChange: (cb: () => void) => {
          listeners.add(cb);
          return { dispose: () => listeners.delete(cb) };
        },
        set(running: boolean) {
          a.turnRunning = running;
          listeners.forEach((cb) => cb());
        },
        listeners,
      };
      return a;
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it("asks with the error the card shows and the log's tail", () => {
      const text = explainPrompt({
        act: "build",
        ok: false,
        seconds: 1,
        reason: "compiler",
        error: {
          code: "E0308",
          file: "src/lib.rs",
          line: 10,
          column: 9,
          message: "mismatched types",
        },
        log: "error[E0308]: mismatched types",
      });
      expect(text).toContain("E0308: mismatched types at src/lib.rs:10:9");
      expect(text).toContain(
        "Build log:\n```\nerror[E0308]: mismatched types\n```"
      );
    });

    it("answers once the turn it started ends, and only once", () => {
      const a = fake();
      const done = vi.fn();
      whenAnswered(a, done);
      a.set(true);
      expect(done).not.toHaveBeenCalled();
      a.set(false);
      a.set(true);
      a.set(false);
      expect(done).toHaveBeenCalledTimes(1);
      expect(a.listeners.size).toBe(0);
    });

    it("waits past a turn that was already running for its own", () => {
      const a = fake();
      a.turnRunning = true;
      const done = vi.fn();
      whenAnswered(a, done);
      a.set(false);
      expect(done).not.toHaveBeenCalled();
      a.set(true);
      a.set(false);
      expect(done).toHaveBeenCalledTimes(1);
    });

    it("answers at once with no assistant connected", () => {
      const done = vi.fn();
      whenAnswered(fake(false), done);
      expect(done).toHaveBeenCalledTimes(1);
    });

    it("gives up waiting when no turn ever starts", () => {
      vi.useFakeTimers();
      const done = vi.fn();
      whenAnswered(fake(), done);
      vi.advanceTimersByTime(NO_TURN_MS);
      expect(done).toHaveBeenCalledTimes(1);
    });

    it("cancels without answering", () => {
      vi.useFakeTimers();
      const a = fake();
      const done = vi.fn();
      const cancel = whenAnswered(a, done);
      cancel();
      a.set(true);
      a.set(false);
      vi.advanceTimersByTime(NO_TURN_MS);
      expect(done).not.toHaveBeenCalled();
    });
  });
}
