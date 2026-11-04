## Why

#272 (Almaz's DES-194 fixes) shipped UI details that no OpenSpec requirement names: the Interact instruction
card, the Deploy stage's idle copy, the phone editor's scrollbar, the base border colour, where a toast's Close
sits and where the sync banner's answers sit. Almaz built them from his stand, so his layout and copy are the
design; the specs follow the code, not the other way round.

## What Changes

- Interact: an instruction card heads its inputs "n args · n accounts", groups them under fixed "Arguments" and
  "Accounts" headings, offers Test with "Fill with Random" and Reset beside it, says why Test waits, and keeps
  Copy inside the field it copies.
- Deploy: the cluster sits over the title with a dot; the copy before a build, after a failed deploy, and Upload
  IDL as a link under the pill.
- Phone editor: no minimap or overview ruler, a 3 px scrollbar that shows only while the code moves, smooth
  scrolling.
- Themes: a border with no colour of its own draws in the hairline colour, never the text colour.
- Overlays: a toast's Close sits inside the card at its end, on the first line.
- Sync banner: its answers sit under the question, across the width on a phone.
- Telemetry: this change's specs add, rename or remove no event. The code already shipped; this change only
  writes it down. (The `wbdi-flow` edit in the same PR drops the planned `build_project_exported`, which never
  shipped: no code emits it.)

## Capabilities

### New Capabilities

- `client-v2-stages`: the Interact instruction card and the Deploy stage's idle state (the umbrella `ui-migration`
  holds this capability's other requirements until it archives).
- `client-v2-themes`: the base border colour (likewise).

### Modified Capabilities

- `client-v2-layout`: the phone editor's scrollbar, minimap and overview ruler.
- `client-v2-overlays`: where a toast's Close sits.
- `project-conflict-resolution`: where the sync banner's answers sit.

## Impact

- Docs only: `openspec/`. No code or test change, and no shipped event changes; the behaviour is already on `scope/interface-2`.
- Also in this PR, outside this change: the ui-migration plan 5.12 and design.md (Interact's texts; Build
  succeeded no longer offers Export project), and `wbdi-flow` (no `build_project_exported`; Build again is the
  Build control), the #281 follow-ups from Design alignment.
- Out of scope: the DES-194 follow-up fixes (toast progress, field validator, lesson progress), which their own
  ticket carries.
