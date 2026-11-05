# Proposal

## Why

The legacy Build & Deploy sidebar let a user create, import and export the
program keypair and point the project at a custom program id. client-v2's
Deploy stage shows the id but cannot change it, so a user cannot carry a
program id to another device or deploy under an id they own (HOO-2397).

## What Changes

- A folded "Program id" block on the Deploy stage, built from
  design-system parts, under the program facts. Before the first deploy it
  sits under the payer line; after one, under the history.
- Five actions in it, matching the legacy sidebar: New keypair (asks first
  when one exists, offering to save the old one), Import keypair, Export
  keypair, Change program id, Remove custom id.
- A warning in the block when a custom id does not match the keypair, the
  case in which a first deploy refuses.
- A refused import says why on the page; the legacy code only logged it.
- New slice `features/program-keypair` (model, ui, telemetry). It reads and
  writes the existing `PgProgramInfo` state; `PgProgramInfo` does not change.
- Telemetry: the slice adds, with prefix `keypair`,
  `keypair_generated`, `keypair_imported`, `keypair_import_refused`,
  `keypair_exported`, `keypair_custom_id_set`, `keypair_custom_id_removed`.
  No event carries a key, an address or a program id.

## Capabilities

### New Capabilities

- `client-v2-program-keypair`: the program keypair and custom program id
  controls on the Deploy stage, what each does to the project's program id,
  and their events.

### Modified Capabilities

None. The deploy command's refusal of a mismatched id is unchanged.

## Impact

- `client-v2/src/features/program-keypair/` (new), its telemetry prefix in
  `shared/lib/telemetry/prefixes.ts`.
- `client-v2/src/views/flow/stages/BaseDeploy.tsx` and `Deploy.tsx` gain one
  `ReactNode` prop for the block, as `idlUpload` does.
- The keypair the user sets is written to `.workspace/program-info.json` by
  `PgProgramInfo` as today, so it syncs with the project like a build's
  keypair.

Out of scope: importing a `.so`; the on-chain IDL actions (HOO-2398); moving
the stages into a widget slice (HOO-2414); any design of the block beyond
the design system's parts. It goes to design review after merge.
