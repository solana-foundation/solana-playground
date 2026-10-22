/**
 * What holds the screen beside the navigation, decided once from the shell's
 * two slots: the work, Home in its place, or a page (`cover`) over either. A
 * page wins over Home, and Home over the work; every layer of the shell
 * switches on this rather than weighing the two slots itself.
 */
export type Screen<H, C> =
  | { kind: "work" }
  | { kind: "home"; home: H }
  | { kind: "page"; over: "work"; cover: C }
  | { kind: "page"; over: "home"; cover: C; home: H };

export const screenOf = <H, C>(
  home: H | undefined,
  cover: C | undefined
): Screen<H, C> => {
  if (cover !== undefined && home !== undefined) {
    return { kind: "page", over: "home", cover, home };
  }
  if (cover !== undefined) return { kind: "page", over: "work", cover };
  if (home !== undefined) return { kind: "home", home };
  return { kind: "work" };
};

/**
 * Whether Home or a page holds the screen: the shell's keys and a deploy's
 * opening of the console then stand down
 */
export const isCovered = (screen: Screen<unknown, unknown>) =>
  screen.kind !== "work";

/**
 * Whether the work stands in the frame: it does under a page over it, kept
 * `inert`; under Home, and a page over Home, it does not (`keepWork` may
 * still keep it mounted off the page)
 */
export const isWorkInFrame = (screen: Screen<unknown, unknown>) =>
  screen.kind === "work" || (screen.kind === "page" && screen.over === "work");

/** Home, while it is on screen or under a page; its Sheet is the assistant then */
export const homeOf = <H, C>(screen: Screen<H, C>): H | undefined => {
  if (screen.kind === "home") return screen.home;
  if (screen.kind === "page" && screen.over === "home") return screen.home;
  return undefined;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/layout-shell/model/screen", () => {
    it("is the work with neither slot", () => {
      expect(screenOf(undefined, undefined)).toEqual({ kind: "work" });
    });

    it("is Home with Home alone", () => {
      expect(screenOf("h", undefined)).toEqual({ kind: "home", home: "h" });
    });

    it("is a page over the work with a cover alone", () => {
      expect(screenOf(undefined, "c")).toEqual({
        kind: "page",
        over: "work",
        cover: "c",
      });
    });

    it("frames the work only with no Home over it, and covers it with anything", () => {
      const work = screenOf(undefined, undefined);
      const home = screenOf("h", undefined);
      const overWork = screenOf(undefined, "c");
      const overHome = screenOf("h", "c");
      expect([work, home, overWork, overHome].map(isWorkInFrame)).toEqual([
        true,
        false,
        true,
        false,
      ]);
      expect([work, home, overWork, overHome].map(isCovered)).toEqual([
        false,
        true,
        true,
        true,
      ]);
    });

    it("finds Home on screen or under a page, and nowhere else", () => {
      expect(homeOf(screenOf("h", undefined))).toBe("h");
      expect(homeOf(screenOf("h", "c"))).toBe("h");
      expect(homeOf(screenOf(undefined, "c"))).toBeUndefined();
      expect(homeOf(screenOf(undefined, undefined))).toBeUndefined();
    });

    it("is a page over Home with both, the page winning", () => {
      expect(screenOf("h", "c")).toEqual({
        kind: "page",
        over: "home",
        cover: "c",
        home: "h",
      });
    });
  });
}
