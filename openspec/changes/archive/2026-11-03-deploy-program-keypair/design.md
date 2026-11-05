# Design

## Context

`PgProgramInfo` (`client-v2/src/utils/program-info.ts`) already holds `kp`
and `customPk`, derives `pk` from them (custom first), and persists both to
`.workspace/program-info.json`, which project sync carries. It fires
`onDidChangeKp`, `onDidChangeCustomPk` and `onDidChangePk`. The deploy
command (`commands/deploy/deploy.ts`) already refuses a first deploy whose
custom id differs from the keypair. What is missing is UI. No design source
(DS prototype, design system, Almaz's stand, designers' spec 03) has a frame
for it; the decision recorded on HOO-2397 is a block of design-system parts,
reviewed by design after merge.

## Goals / Non-Goals

**Goals:** the legacy sidebar's five actions on the Deploy stage, testable
without a store; one place that parses a keypair file.

**Non-Goals:** changing `PgProgramInfo` or the deploy command; a keypair
picker across projects; any look beyond the design system's parts.

## Decisions

- **A feature slice, wired through a prop.** `features/program-keypair`
  holds `model/keypair-file.ts` (parse and serialise the CLI format, pure,
  in-source tests), `model/telemetry.ts`, `ui/BaseProgramKeypair.tsx` (all
  props, no store) and `ui/ProgramKeypair.tsx` (connects `PgProgramInfo`).
  `BaseDeploy` takes it as a `programKeypair: ReactNode` prop, as it takes
  `idlUpload`, so the stage stays drawable from props. Alternative: put the
  block inside `views/flow/stages/` — rejected, new UI may not go into legacy
  roots, and HOO-2414 moves the stage into a widget later; a feature it can
  import is what that move needs.
- **The model returns the bytes, the container builds the `Keypair`.**
  `parseKeypairFile(text)` returns `{ ok: true, secretKey: Uint8Array } |
  { ok: false, reason: "not_json" | "wrong_shape" }`. Checking that each
  entry is an integer 0–255 is stricter than legacy (which took any 64
  numbers and let `Uint8Array` wrap them); a wrapped value would yield a
  keypair that is not the exported one. `Keypair.fromSecretKey` still
  validates the curve point; its throw is caught and reported as
  `wrong_shape`.
- **Collapsible closed by default, opened by a mismatch.** The prototype's
  empty stage stays as drawn; a mismatch, the one state that blocks a
  deploy, is not hidden behind a fold. The open state is controlled so the
  mismatch can open it, and the user can still close it.
- **Import is the DS `DropZone`, every control quiet** (Design alignment,
  2026-11-03): the design system's drop zone is "where a file lands: an IDL,
  a keypair", and the deploy result block's rule is one accent action, which
  is Deploy. So New, Export, Change and Remove are outline or ghost buttons,
  and `components/ImportButton` is not used here.
- **Export through `PgCommon.export`**, the helper the wallet export uses, so
  the file is `JSON.stringify` of a number array — byte-identical to
  `solana-keygen`'s output shape.
- **The field shows `pk`, and resyncs on `onDidChangePk`**, so a build that
  creates the first keypair, or an import, fills it; text the user is
  editing is replaced only by such a change, as in legacy.

## Risks / Trade-offs

- A project already deployed under its keypair, then given a new keypair,
  deploys as a new program. Legacy had the same behaviour; the dialog's
  "Save keypair" is the guard, and the copy is the legacy copy.
- Design may restyle the block after review; ids and aria-labels in the
  spec are what tests hold, so a restyle does not break them.
