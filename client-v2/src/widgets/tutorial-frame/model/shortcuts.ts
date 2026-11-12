/** The dialog's groups, in their order: what you do in the lesson, the panels, the steps */
export const SHORTCUT_GROUPS = ["In the lesson", "Panels", "Steps"] as const;

/** One row of "Keyboard shortcuts": what it does, its keys one by one, and its group */
export interface Shortcut {
  what: string;
  keys: string[];
  group: typeof SHORTCUT_GROUPS[number];
}

/**
 * Every key a tutorial answers to, as "Keyboard shortcuts" in the chat head's
 * ⋯ menu lists them, in the prototype's order (`keys.ts`, `SHORTCUTS`). The
 * keys belong to their own tasks (the feed's, the question's, the
 * workspace's); this is the one place they are listed. `mac` shows ⌘ and ⌥
 * where elsewhere it is Ctrl and Alt.
 */
export const shortcutsFor = (mac: boolean): Shortcut[] => {
  const mod = mac ? "⌘" : "Ctrl";
  const alt = mac ? "⌥" : "Alt";
  return [
    { what: "Run the live action", keys: [mod, "↵"], group: "In the lesson" },
    {
      what: "Start, or go to the next step",
      keys: ["↵"],
      group: "In the lesson",
    },
    { what: "Pick an answer", keys: ["1", "2", "3"], group: "In the lesson" },
    { what: "Skip the question", keys: ["S"], group: "In the lesson" },
    { what: "Get a hint", keys: ["H"], group: "In the lesson" },
    { what: "Menu", keys: [mod, "B"], group: "Panels" },
    { what: "Files", keys: [mod, "E"], group: "Panels" },
    { what: "Terminal", keys: [mod, "J"], group: "Panels" },
    {
      what: "Previous and next step",
      keys: [`${alt}↑`, `${alt}↓`],
      group: "Steps",
    },
  ];
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-frame/model/shortcuts", () => {
    it("lists every key the spec names", () => {
      expect(shortcutsFor(true).map((s) => s.keys.join(" "))).toEqual([
        "⌘ ↵",
        "↵",
        "1 2 3",
        "S",
        "H",
        "⌘ B",
        "⌘ E",
        "⌘ J",
        "⌥↑ ⌥↓",
      ]);
    });

    it("groups the keys: five in the lesson, three panels, then the steps", () => {
      const groups = shortcutsFor(true).map((s) => s.group);
      expect(groups).toEqual([
        "In the lesson",
        "In the lesson",
        "In the lesson",
        "In the lesson",
        "In the lesson",
        "Panels",
        "Panels",
        "Panels",
        "Steps",
      ]);
    });

    it("names Ctrl and Alt off a Mac", () => {
      const keys = shortcutsFor(false).flatMap((s) => s.keys);
      expect(keys).toContain("Ctrl");
      expect(keys).toContain("Alt↑");
      expect(keys.join()).not.toMatch(/[⌘⌥]/);
    });
  });
}
