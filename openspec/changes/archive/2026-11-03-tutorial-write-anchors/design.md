# Design

## Context

`insertBlock` (`features/tutorial-conversation/model/landing.ts`) already
takes the reference file and the start as arguments; `store.ts` passes the
step's target and start for the written file. `checkDefinition` checks every
block against the step's target.

## Goals / Non-Goals

**Goals:** a write placed against its own reference, as the prototype does
(`store.tsx`, `head.ref ?? step.target`, `head.start ?? step.start`); the
check guarding it.

**Non-Goals:** a line-anchor syntax (`after: "…"`); the prototype has none,
and a whole reference file already fixes a repeated `}` or `bump,`.

## Decisions

- **`ref` and `start` are whole files, not anchor lines.** The ticket first
  spoke of an anchor line matched once in the file; the prototype, which
  wins over the ticket, stores whole files, and `insertBlock` already
  rebuilds the file from a reference. A whole file needs no new placement
  code. The check's "exactly once" moves to the block within its `ref`.
- **The write effect carries `ref` and `start`.** The reducer already copies
  the block from the beat into the effect; `store.ts` stays free of beat
  lookups and falls back to the step's files when the effect has none.
- **Uniqueness is checked only for a `ref`.** Requiring it of every block
  against the step's target would change what existing tutorials pass;
  `AUTHORING.md` rule 3 already asks for it there.

## Risks / Trade-offs

- A `ref` repeats most of a file in the JSON. Accepted: steps already carry
  whole files, and an author copies them from the prototype's scripts.
