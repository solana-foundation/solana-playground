/* eslint-disable layers/curry-order, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import {
  parseBuildReport,
  pickDiagnostic,
} from "../../../views/flow/stages/build-report";
import type { BuildError } from "./progress";

/**
 * The error a failed build's card shows, from the server's raw log, by
 * `pickDiagnostic`'s rule: the one holding the step's `failsWith` line, else
 * the first that is not a `#[program]` macro symptom.
 *
 * @param stderr the build server's raw log
 * @param failsWith the step's line that marks its planned failure
 * @returns the error, or null when the log names none
 */
export const pickBuildError = (
  stderr: string,
  failsWith?: string
): BuildError | null => {
  const picked = pickDiagnostic(
    parseBuildReport(stderr).diagnostics,
    failsWith
  );
  if (!picked) return null;
  return {
    code: picked.code,
    file: picked.file,
    line: picked.line,
    column: picked.col,
    message: picked.title,
  };
};

/** Whether a failed build's log holds the line marking the planned failure */
export const isPlannedLog = (log: string, failsWith: string) =>
  log.includes(failsWith);

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("features/tutorial-conversation/model/build-error", () => {
    let PLANNED: string;
    let PLANNED_1_1_2: string;
    let NO_CODE: string;
    let PASSED: string;
    beforeAll(async () => {
      ({ PLANNED, PLANNED_1_1_2, NO_CODE, PASSED } = await import(
        "./build-logs.fixture"
      ));
    });
    const FAILS_WITH = "could not find `__client_accounts_hello`";
    const E0432 = {
      code: "E0432",
      file: "src/lib.rs",
      line: 5,
      column: 1,
      message: "unresolved import `crate`",
    };

    it("shows the error holding the step's line, on Anchor 0.29 and 1.1.2", () => {
      expect(pickBuildError(PLANNED, FAILS_WITH)).toEqual(E0432);
      expect(pickBuildError(PLANNED_1_1_2, FAILS_WITH)).toEqual(E0432);
    });

    it("shows the E0412 at line 9 past the macro symptom when no line is marked", () => {
      expect(pickBuildError(PLANNED)).toMatchObject({ code: "E0412", line: 9 });
    });

    it("reads an error with no code like one with a code", () => {
      expect(pickBuildError(NO_CODE)).toEqual({
        code: null,
        file: "src/lib.rs",
        line: 10,
        column: 30,
        message: "expected `;`, found keyword `let`",
      });
    });

    it("finds no error in a pass or in a server's own message", () => {
      expect(pickBuildError(PASSED)).toBeNull();
      expect(pickBuildError("Invalid path")).toBeNull();
    });

    it("falls back to a symptom when it is the only error", () => {
      expect(pickBuildError(PLANNED_1_1_2)).toEqual(E0432);
    });

    it("tells the planned log by its line, on Anchor 0.29 and 1.1.2", () => {
      expect(isPlannedLog(PLANNED, FAILS_WITH)).toBe(true);
      expect(isPlannedLog(PLANNED_1_1_2, FAILS_WITH)).toBe(true);
      expect(isPlannedLog(NO_CODE, FAILS_WITH)).toBe(false);
    });
  });
}
