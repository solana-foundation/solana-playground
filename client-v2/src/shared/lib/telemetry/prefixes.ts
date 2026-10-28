/** Slice name to the prefix its event names start with; a prefix is never reused */
export const EVENT_PREFIXES = {
  auth: "auth",
  "app-nav": "nav",
  assistant: "assistant",
  catalog: "catalog",
  feedback: "feedback",
  "fund-wallet": "fund",
  home: "home",
  "layout-shell": "layout",
  "new-project": "new_project",
  observability: "obs",
  overlays: "overlay",
  persistence: "sync",
  "session-footer": "session",
  "settings-page": "settings",
  "setup-list": "setup",
} as const;

export type EventPrefix = typeof EVENT_PREFIXES[keyof typeof EVENT_PREFIXES];

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/telemetry/prefixes", () => {
    it("should give each slice its own prefix", () => {
      const sliceOf = new Map<string, string>();
      const clashes: string[] = [];

      for (const [slice, prefix] of Object.entries(EVENT_PREFIXES)) {
        const owner = sliceOf.get(prefix);
        if (owner) clashes.push(`${owner} and ${slice} share "${prefix}"`);
        sliceOf.set(prefix, slice);
      }

      expect(clashes).toEqual([]);
    });
  });
}
