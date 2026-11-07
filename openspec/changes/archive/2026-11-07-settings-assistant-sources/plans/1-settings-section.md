# Plan: Skills and MCP servers in Settings › Assistant

Ticket: HOO-2710. Change: `settings-assistant-sources`, task 1.1.

1. Test first (`Grounding.test.tsx`): two Grounding views rendered at once;
   unticking a skill by its name in the second unticks it in the first and
   `load_skill` no longer loads it; with every collapsible open, no id repeats
   and each view's server console gets its own prefix. Fails today on the
   repeated ids.
2. `Grounding.tsx`: `useId()` prefix on every element id, passed on to
   `ServerConsole`; an `embedded` prop that drops the panel's scroll and grow
   classes.
3. The panel's "ask the gateway on mount and per account" effect moves into
   `useMcpSources`; `AssistantSources` calls it and renders
   `<Grounding embedded />`; `SettingsPage.tsx` puts it in a second card,
   "Skills and MCP servers", in the Assistant section.
4. Gate: `yarn run check`; screenshots of Settings › Assistant before/after.
