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
    let NO_CODE: string;
    let PASSED: string;
    beforeAll(async () => {
      ({ PLANNED, NO_CODE, PASSED } = await import("./build-logs.fixture"));
    });
    const FAILS_WITH = "cannot find type `Hello` in this scope";

    it("shows the planned E0412 at line 9, past the macro symptom at line 5", () => {
      const e0412 = {
        code: "E0412",
        file: "src/lib.rs",
        line: 9,
        column: 32,
        message: FAILS_WITH,
      };
      expect(pickBuildError(PLANNED, FAILS_WITH)).toEqual(e0412);
      expect(pickBuildError(PLANNED)).toEqual(e0412);
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
      const onlySymptom = PLANNED.split("error[E0412]")[0];
      expect(pickBuildError(onlySymptom)).toMatchObject({
        code: "E0432",
        line: 5,
      });
    });

    it("tells the planned log by its line", () => {
      expect(isPlannedLog(PLANNED, FAILS_WITH)).toBe(true);
      expect(isPlannedLog(NO_CODE, FAILS_WITH)).toBe(false);
    });
  });
}
