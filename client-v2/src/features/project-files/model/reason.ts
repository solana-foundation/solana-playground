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

    it("ignores the message", () => {
      expect(importReasonOf(new Error("rate limit reached (404)"))).toBe(
        "other"
      );
      expect(importReasonOf(new Error("Failed to fetch"))).toBe("other");
    });
  });
}
