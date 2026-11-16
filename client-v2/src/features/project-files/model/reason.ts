import { ConversionError, GithubImportError } from "@/utils/import-error";

import type { ImportReason } from "./telemetry";

/**
 * The reason an import or a GitHub link view reports for a failure, read from
 * the error's type, never from its message: a `GithubImportError` and a
 * `ConversionError` carry theirs (a request that got no answer is already
 * `network` in the former); anything else is `other`.
 *
 * @param error what the import threw
 * @returns the reason telemetry sends
 */
export const importReasonOf = (error: unknown): ImportReason => {
  if (error instanceof GithubImportError) return error.reason;
  if (error instanceof ConversionError) return error.reason;
  return "other";
};

/**
 * Whether an import or a GitHub link view failed for a reason the link or
 * the user's network caused (a path with no code, a repository that is gone,
 * a rate limit, no answer): its `reason` already counts it, so it is logged,
 * not reported. Only `other` is a failure nobody expected.
 *
 * @param error what the import threw
 */
export const isExpectedImportFailure = (error: unknown) =>
  importReasonOf(error) !== "other";

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/project-files/model/reason", () => {
    it.each([
      ["not-found", new GithubImportError("not found", "not-found")],
      ["rate-limited", new GithubImportError("limit", "rate-limited")],
      ["too-large", new GithubImportError("truncated", "too-large")],
      ["no-source", new GithubImportError("no code", "no-source")],
      ["network", new GithubImportError("no answer", "network")],
      ["other", new GithubImportError("status 500", "other")],
      ["unsupported", new ConversionError("not a program", "unsupported")],
      ["no-source", new ConversionError("no code", "no-source")],
      ["other", new Error("Invalid program url")],
      ["other", new TypeError("Cannot read properties of undefined")],
      ["other", "a string"],
    ] as const)("reads %s from the error's type", (reason, error) => {
      expect(importReasonOf(error)).toBe(reason);
    });

    it.each([
      [true, new GithubImportError("not found", "not-found")],
      [true, new GithubImportError("no code", "no-source")],
      [true, new GithubImportError("no answer", "network")],
      [true, new ConversionError("not a program", "unsupported")],
      [false, new GithubImportError("status 500", "other")],
      [false, new TypeError("Cannot read properties of undefined")],
    ] as const)("says %s for %s", (expected, error) => {
      expect(isExpectedImportFailure(error)).toBe(expected);
    });

    it("ignores the message", () => {
      expect(importReasonOf(new Error("rate limit reached (404)"))).toBe(
        "other"
      );
      expect(importReasonOf(new Error("Failed to fetch"))).toBe("other");
    });
  });
}
