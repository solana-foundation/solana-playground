# Spec Delta

## Purpose

What the product reports when an assistant patch reaches the disk, so the
funnel can count patches that land and the writes that fail.

Every scenario is marked `(manual)`: events leave the browser only through
GA4, which no Playwright test reads. A unit test through the memory provider
holds each one, and each can be checked in GA4's DebugView.

## ADDED Requirements

### Requirement: An approved patch is reported once it is written

The `write_file` tool (`views/sidebar/assistant/model/tools.ts`) SHALL send,
through the `widgets/assistant` tracker, `assistant_patch_written` with no
parameters once an approved patch is on disk, and
`assistant_patch_write_failed { reason }` when the write throws: `reason` is
`limit` when a project limit refused it (`ExplorerLimitError`) and `other`
otherwise. A denied patch, or one that would change nothing, sends neither;
the user's answer is `assistant_approval_answered`. No event carries the path
or the content.

#### Scenario: An approved patch is written (manual)

- **WHEN** the user allows a patch and the file is written
- **THEN** the memory provider records `assistant_patch_written` once

#### Scenario: A write a limit refuses (manual)

- **WHEN** the user allows a patch and the project limit refuses the write
- **THEN** the memory provider records `assistant_patch_write_failed` with
  `{ reason: "limit" }` and no `assistant_patch_written`
