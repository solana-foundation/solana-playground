/**
 * A container that pages sideways, as the phone's pager does: a box in it can
 * sit left or right of the screen because the user moved to another page,
 * where elsewhere off the screen means only a layout that has not settled
 */
const PAGER_ATTR = "data-pager";

/** The attribute to spread on a pager's scroll container */
export const pagerAttrs = { [PAGER_ATTR]: "" } as const;

/** Whether `el` sits inside a pager */
export const isInPager = (el: Element) =>
  el.closest(`[${PAGER_ATTR}]`) !== null;

if (import.meta.vitest) {
  const { describe, it, expect, afterEach } = import.meta.vitest;

  describe("shared/lib/pager", () => {
    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("finds a pager around the element", () => {
      document.body.innerHTML =
        '<div data-pager><div><span id="in"></span></div></div><span id="out"></span>';
      const get = (id: string) => {
        const el = document.getElementById(id);
        if (!el) throw new Error(`#${id} is missing`);
        return el;
      };
      expect(isInPager(get("in"))).toBe(true);
      expect(isInPager(get("out"))).toBe(false);
    });
  });
}
