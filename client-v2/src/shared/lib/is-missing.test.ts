import { describe, expect, it } from "vitest";

import { isMissing } from "./is-missing";

describe("isMissing", () => {
  it("reads ENOENT from the code or from the message", () => {
    expect(isMissing({ code: "ENOENT" })).toBe(true);
    expect(isMissing(new Error("ENOENT: no such file or directory"))).toBe(
      true
    );
  });

  it("does not read another failure, or nothing at all, as a missing file", () => {
    expect(isMissing(new SyntaxError("Unexpected token"))).toBe(false);
    expect(isMissing({ code: "EACCES" })).toBe(false);
    expect(isMissing(null)).toBe(false);
    expect(isMissing(undefined)).toBe(false);
  });
});
