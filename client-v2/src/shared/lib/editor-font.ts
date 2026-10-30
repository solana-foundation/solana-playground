/**
 * Monaco's font size and line height for an editor of the product. On a
 * phone the code is read at arm's length, so it is a step up: 15 px with a
 * 23 px line, a set pair rather than Monaco's ratio. Off a phone, 0 hands both
 * back to Monaco: its default size, and a line height derived from it. The
 * code editor and the merge editor's panes both read it, so they agree.
 */
export const editorFont = ({ phone }: { phone: boolean }) => ({
  fontSize: phone ? 15 : 0,
  lineHeight: phone ? 23 : 0,
});

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/editor-font", () => {
    it("is 15 px on a 23 px line on a phone", () => {
      expect(editorFont({ phone: true })).toEqual({
        fontSize: 15,
        lineHeight: 23,
      });
    });

    it("leaves both to Monaco off a phone", () => {
      expect(editorFont({ phone: false })).toEqual({
        fontSize: 0,
        lineHeight: 0,
      });
    });
  });
}
