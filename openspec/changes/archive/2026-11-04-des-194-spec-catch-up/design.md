## Context

The behaviour is already in the code (#272 on `scope/interface-2`). See proposal.md, Why. Two of the capabilities
it touches, `client-v2-stages` and `client-v2-themes`, have no main spec yet: their requirements live in the
umbrella `ui-migration`, which stays open.

## Goals / Non-Goals

**Goals:** every detail #272 shipped is named by a requirement a reviewer can check; the change archives in the
PR that writes it, as `des-194-component-fixes` did.

**Non-Goals:** changing behaviour; rewriting `ui-migration`'s own requirements.

## Decisions

- **A change of its own, not an edit to the umbrella.** Every ticket appending to `ui-migration`'s specs makes
  every merge conflict the rest (Slava, 2026-10-22). Alternative, editing `ui-migration/specs/client-v2-stages`,
  was rejected for that reason.
- **ADDED requirements for `client-v2-stages` and `client-v2-themes`.** Archiving creates their main specs;
  `ui-migration`'s later archive appends its own ADDED requirements, whose names differ, so the two do not
  collide. A MODIFIED delta against a requirement only the umbrella holds would fail to archive.
- **Archived in this PR.** Nothing is left to build, so the change has no open task.

## Risks / Trade-offs

- [`ui-migration` later adds a requirement with one of these names] → `openspec validate --all --strict` fails on
  the duplicate at that archive, so it cannot slip through.
