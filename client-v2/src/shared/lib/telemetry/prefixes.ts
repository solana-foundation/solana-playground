/**
 * Slice name to the prefix its event names start with; a prefix is never reused
 * by another slice. A slice may declare more than one tracker under its prefix
 * (`views/sidebar/assistant/model/telemetry.ts` sends `assistant_key_deleted`).
 */
export const EVENT_PREFIXES = {
  agent: "agent",
  auth: "auth",
  "app-nav": "nav",
  assistant: "assistant",
  catalog: "catalog",
  "cli-deploy": "cli",
  deploy: "deploy",
  "docs-link": "docs_link",
  // The legacy `utils/explorer`, which has no slice yet
  explorer: "explorer",
  feedback: "feedback",
  "fund-wallet": "fund",
  gist: "gist",
  home: "home",
  "idl-build-guide": "idl_guide",
  "layout-shell": "layout",
  mcp: "mcp",
  "new-project": "new_project",
  observability: "obs",
  overlays: "overlay",
  persistence: "sync",
  "program-build": "build",
  "program-interact": "interact",
  "program-keypair": "keypair",
  "project-export": "export",
  "project-files": "project",
  run: "run",
  "session-footer": "session",
  "settings-page": "settings",
  "setup-list": "setup",
  skills: "skills",
  status: "status",
  "unknown-command": "unknown_command",
  tutorial: "tutorial",
  "tutorial-frame": "tutorial_frame",
  "tutorial-workspace": "tutorial_workspace",
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
