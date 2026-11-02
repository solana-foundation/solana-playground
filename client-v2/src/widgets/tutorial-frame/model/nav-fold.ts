/**
 * The navigation in a tutorial: folded to its rail, open as an overlay over
 * the chat, or pinned open beside it. Outside a tutorial the saved layout
 * decides, and none of this applies.
 */
export type NavFold = "rail" | "overlay" | "pinned";

/**
 * What can happen to it: entering a tutorial (Start, Continue or a card);
 * ⌘B, the rail's opener or the head's fold button asking it open (`open`) or
 * folded (`fold`); a pick, the scrim or Esc (`close`); and the pin in the
 * overlay's head.
 */
export type NavFoldEvent =
  | { type: "enter" }
  | { type: "open" }
  | { type: "fold" }
  | { type: "close" }
  | { type: "pin" }
  | { type: "unpin" };

/** Entering folds it, whatever the saved layout holds */
export const NAV_FOLD_ON_ENTRY: NavFold = "rail";

/**
 * The fold rules. A pinned navigation is the learner's own choice, so only
 * ⌘B, the fold button, the pin or leaving the tutorial folds it: a pick or
 * Esc does not.
 */
export const foldNav = (fold: NavFold, event: NavFoldEvent): NavFold => {
  switch (event.type) {
    case "enter":
      return NAV_FOLD_ON_ENTRY;
    case "open":
      return fold === "rail" ? "overlay" : fold;
    case "fold":
      return "rail";
    case "close":
      return fold === "overlay" ? "rail" : fold;
    case "pin":
      return "pinned";
    case "unpin":
      return fold === "pinned" ? "rail" : fold;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-frame/model/nav-fold", () => {
    it("folds on entry from any state", () => {
      for (const from of ["rail", "overlay", "pinned"] as const) {
        expect(foldNav(from, { type: "enter" })).toBe("rail");
      }
    });

    it("opens the overlay from the rail and folds it again", () => {
      expect(foldNav("rail", { type: "open" })).toBe("overlay");
      expect(foldNav("overlay", { type: "fold" })).toBe("rail");
    });

    it("keeps a pinned navigation pinned when asked open", () => {
      expect(foldNav("pinned", { type: "open" })).toBe("pinned");
    });

    it("closes the overlay on a pick, the scrim or Esc", () => {
      expect(foldNav("overlay", { type: "close" })).toBe("rail");
    });

    it("leaves a pinned navigation open on a pick or Esc", () => {
      expect(foldNav("pinned", { type: "close" })).toBe("pinned");
      expect(foldNav("rail", { type: "close" })).toBe("rail");
    });

    it("pins from the overlay, and fold or unpin folds it", () => {
      expect(foldNav("overlay", { type: "pin" })).toBe("pinned");
      // The shell's pick-close lands after the pin's own click
      expect(foldNav("pinned", { type: "close" })).toBe("pinned");
      expect(foldNav("rail", { type: "pin" })).toBe("pinned");
      expect(foldNav("pinned", { type: "fold" })).toBe("rail");
      expect(foldNav("pinned", { type: "unpin" })).toBe("rail");
    });

    it("unpin does nothing to a navigation that is not pinned", () => {
      expect(foldNav("overlay", { type: "unpin" })).toBe("overlay");
    });
  });
}
