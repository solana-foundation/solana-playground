# Proposal

## Why

Skills and MCP servers are reachable only from the assistant's own More menu
(Sources and tools). Slava and Sergey both looked for them in Settings and did
not find them (call, 7 Nov). Before Breakpoint the fix is to show the same
controls in Settings › Assistant; the reworked management UI comes after
(HOO-2257).

## What Changes

- Settings › Assistant gets a second card, "Skills and MCP servers", holding
  the controls of Sources and tools: the skills, the community skills, the MCP
  servers and the additional servers editor. Both places read and write the
  one `PgAssistant` store, so a change in either shows in the other and in the
  next turn.
- Opening the section asks the gateway for its skills and servers, and asks
  again for each account, as the panel does (`useMcpSources`, now shared by
  both), so the lists are there even when the assistant panel has not
  mounted.
- The controls' element ids, the server console's included, are made unique
  per view, so both views can be on
  screen at once and a click on a name still toggles its own checkbox.
- The panel's Sources and tools view is unchanged.

## Capabilities

### New Capabilities

- `settings-assistant-sources`: the skills and MCP servers in Settings ›
  Assistant

## Impact

- `client-v2/src/views/sidebar/assistant/Component/Grounding.tsx` and
  `ServerConsole.tsx`, `views/sidebar/assistant/model/use-mcp-sources.ts`
  (new, out of `widgets/assistant/ui/Assistant.tsx`),
  `widgets/settings-page/ui/AssistantSources.tsx` (new), `SettingsPage.tsx`
  and `model/sections.ts`.
- Out of scope: community skills browsing, Refresh tools, servers as JSON,
  the "Call a tool" question (Almaz, after Breakpoint, HOO-2257).
