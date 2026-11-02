/** One row of "Keyboard shortcuts": what it does, and its keys one by one */
export interface Shortcut {
  what: string;
  keys: string[];
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
    { what: "Run the live action", keys: [mod, "↵"] },
    { what: "Start, or go to the next step", keys: ["↵"] },
    { what: "Pick an answer", keys: ["1", "2", "3"] },
    { what: "Skip the question", keys: ["S"] },
    { what: "Get a hint", keys: ["H"] },
    { what: "Menu", keys: [mod, "B"] },
    { what: "Files", keys: [mod, "E"] },
    { what: "Terminal", keys: [mod, "J"] },
    { what: "Previous and next step", keys: [`${alt}↑`, `${alt}↓`] },
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

    it("names Ctrl and Alt off a Mac", () => {
      const keys = shortcutsFor(false).flatMap((s) => s.keys);
      expect(keys).toContain("Ctrl");
      expect(keys).toContain("Alt↑");
      expect(keys.join()).not.toMatch(/[⌘⌥]/);
    });
  });
}
