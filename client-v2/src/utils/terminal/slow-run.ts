/**
 * Spec 13 (TRM-52): a running command that prints nothing for this long gets
 * `SLOW_RUN_LINE`, once.
 */
export const SLOW_RUN_MS = 10_000;

/** What a quiet run gets; the same words as Spec 08's failure catalogue */
export const SLOW_RUN_LINE = "This is taking longer than usual.";

/**
 * Where a watched run's clock is: stopped between counts, counting down to
 * the line, paused on a question, or done with the line already printed
 */
type ClockState =
  | { kind: "idle" }
  | { kind: "counting"; timer: ReturnType<typeof setTimeout> }
  | { kind: "waiting" }
  | { kind: "fired" };

interface Clock {
  state: ClockState;
  readonly print: (line: string) => void;
}

/**
 * The one clock: one top-level command runs at a time (Spec 13), and a newer
 * watch replaces an older one
 */
let clock: Clock | undefined;

const halt = (own: Clock) => {
  if (own.state.kind === "counting") clearTimeout(own.state.timer);
};

/** Start the full 10 s again, unless the line is out or a question is open */
const arm = (own: Clock) => {
  if (own.state.kind === "fired" || own.state.kind === "waiting") return;
  halt(own);
  own.state = {
    kind: "counting",
    timer: setTimeout(() => {
      // Set first: the line is output, and must not re-arm its own clock
      own.state = { kind: "fired" };
      own.print(SLOW_RUN_LINE);
    }, SLOW_RUN_MS),
  };
};

/**
 * Start the clock for a run.
 *
 * @param print how the line reaches the terminal
 * @returns a function that ends the clock when the run ends
 */
export const watchSlowRun = (print: (line: string) => void) => {
  if (clock) halt(clock);
  const own: Clock = { state: { kind: "idle" }, print };
  clock = own;
  arm(own);
  return () => {
    halt(own);
    if (clock === own) clock = undefined;
  };
};

/** The terminal printed something: the 10 s start again */
export const noteOutput = () => {
  if (clock) arm(clock);
};

/** A question is open: the person's time to answer is not the command's */
export const noteQuestion = () => {
  if (!clock || clock.state.kind === "fired") return;
  halt(clock);
  clock.state = { kind: "waiting" };
};

/** The person answered: the full 10 s start again */
export const noteAnswer = () => {
  if (clock?.state.kind !== "waiting") return;
  clock.state = { kind: "idle" };
  arm(clock);
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach, afterEach } = import.meta
    .vitest;

  describe("utils/terminal/slow-run", () => {
    let printed: string[];
    let stop: () => void;
    const start = () => {
      stop = watchSlowRun((line) => {
        printed.push(line);
        // The line is output too, as `PgTerm.print` reports it
        noteOutput();
      });
    };

    beforeEach(() => {
      vi.useFakeTimers();
      printed = [];
    });

    afterEach(() => {
      stop?.();
      vi.useRealTimers();
    });

    it("prints the line once after 10 s of quiet", () => {
      start();
      vi.advanceTimersByTime(SLOW_RUN_MS - 1);
      expect(printed).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(printed).toEqual([SLOW_RUN_LINE]);

      vi.advanceTimersByTime(SLOW_RUN_MS * 3);
      expect(printed).toEqual([SLOW_RUN_LINE]);
    });

    it("starts the 10 s again on output", () => {
      start();
      vi.advanceTimersByTime(SLOW_RUN_MS - 1);
      noteOutput();
      vi.advanceTimersByTime(SLOW_RUN_MS - 1);
      expect(printed).toEqual([]);

      vi.advanceTimersByTime(1);
      expect(printed).toEqual([SLOW_RUN_LINE]);
    });

    it("does not count time spent waiting on an answer", () => {
      start();
      vi.advanceTimersByTime(SLOW_RUN_MS - 1);
      noteQuestion();
      vi.advanceTimersByTime(SLOW_RUN_MS * 5);
      expect(printed).toEqual([]);

      noteAnswer();
      vi.advanceTimersByTime(SLOW_RUN_MS - 1);
      expect(printed).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(printed).toEqual([SLOW_RUN_LINE]);
    });

    it("keeps a newer clock when an older run's stop comes late", () => {
      const stopOlder = watchSlowRun(() => {});
      start();
      stopOlder();
      vi.advanceTimersByTime(SLOW_RUN_MS);
      expect(printed).toEqual([SLOW_RUN_LINE]);
    });

    it("prints nothing for a run that ends in time", () => {
      start();
      vi.advanceTimersByTime(SLOW_RUN_MS - 1);
      stop();
      vi.advanceTimersByTime(SLOW_RUN_MS);
      expect(printed).toEqual([]);
    });

    it("ignores output and questions while no run is watched", () => {
      noteOutput();
      noteQuestion();
      noteAnswer();
      vi.advanceTimersByTime(SLOW_RUN_MS * 2);
      expect(printed).toEqual([]);
    });
  });
}
