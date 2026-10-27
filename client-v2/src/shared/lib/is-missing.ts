/**
 * Whether an error just means "no such file" -- usually the expected case,
 * and not worth a report. The browser filesystem says it as a code and in
 * the message.
 */
export const isMissing = (error: unknown) => {
  const e = error as { code?: string; message?: string };
  return e?.code === "ENOENT" || !!e?.message?.includes("ENOENT");
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/is-missing", () => {
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
}
