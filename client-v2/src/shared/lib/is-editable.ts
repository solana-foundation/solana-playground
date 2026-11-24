/**
 * Whether a key pressed on `target` is typed into something: a field, or
 * an element the user edits in place. A global key that would act on the key
 * there instead of the text leaves it to the field.
 */
export const isEditable = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
  ) !== null;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/is-editable", () => {
    const make = (html: string) => {
      const host = document.createElement("div");
      // eslint-disable-next-line no-unsanitized/property -- the test's own markup literals, never user input
      host.innerHTML = html;
      return host.firstElementChild as Element;
    };

    it("is true for a text field and a text area", () => {
      expect(isEditable(make("<input />"))).toBe(true);
      expect(isEditable(make("<textarea></textarea>"))).toBe(true);
    });

    it("is true inside an element edited in place", () => {
      const host = make('<div contenteditable="true"><span>x</span></div>');
      expect(isEditable(host.firstElementChild)).toBe(true);
    });

    it("is false for a button, plain text and an opted-out editable", () => {
      expect(isEditable(make("<button>Go</button>"))).toBe(false);
      expect(isEditable(make("<p>text</p>"))).toBe(false);
      expect(isEditable(make('<div contenteditable="false"></div>'))).toBe(
        false
      );
    });

    it("is false for a target that is not an element", () => {
      expect(isEditable(document.createTextNode("x"))).toBe(false);
      expect(isEditable(window)).toBe(false);
    });
  });
}
