# Program keypair block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, chosen by the fleet method). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Deploy stage's folded "Program id" block: New / Import / Export keypair, Change / Remove custom id, mismatch warning (HOO-2397).

**Architecture:** New slice `client-v2/src/features/program-keypair` — a pure keypair-file model, a props-only `BaseProgramKeypair`, a connected `ProgramKeypair` over `PgProgramInfo`, telemetry. `BaseDeploy` receives the block as a `programKeypair: ReactNode` prop.

**Tech Stack:** React, Tailwind, DS parts in `shared/ui` (collapsible, field, input, copy-button, button, dialog, callout, drop-zone), vitest + Testing Library.

**Spec:** `openspec/changes/deploy-program-keypair/specs/client-v2-program-keypair/spec.md`, `design.md`.

## Global Constraints

- Copy, aria-labels and event names exactly as in the spec.
- No change to `src/utils/program-info.ts` or `src/commands/deploy/`.
- All block controls outline or ghost; Deploy stays the only accent.
- Unit tests of the model in an in-source block; React tests in `*.test.tsx`; no spread to build fixtures (AGENTS.md).
- Logger namespace `program-keypair:<module>`; telemetry prefix `keypair`.

## Review Focus

- A JSON array of 64 numbers where one is 256 or -1 or 1.5: refused (`wrong_shape`), not wrapped.
- A 64-byte array that is not a valid ed25519 secret key: `Keypair.fromSecretKey` throws → refused `wrong_shape`, keypair unchanged.
- Pressing "Change program id" with the same id already applied: no event, no change (button hidden while text equals the id).
- A build creating the first keypair while the fold is open: the field fills from `onDidChangePk`.
- Field text with surrounding spaces: trimmed before parsing.

---

### Task 1: keypair file model + telemetry (tasks.md 1.1)

**Files:** Create `src/features/program-keypair/model/keypair-file.ts`, `model/telemetry.ts`, `index.ts`; Modify `src/shared/lib/telemetry/prefixes.ts` (add `"program-keypair": "keypair"`).

**Interfaces — Produces:**
- `parseKeypairFile(text: string): { ok: true; secretKey: Uint8Array } | { ok: false; reason: "not_json" | "wrong_shape" }`
- `keypairFileContent(secretKey: Uint8Array): number[]`
- `KEYPAIR_FILE_NAME = "program-keypair.json"`
- `programKeypairTelemetry` with events `keypair_generated {replaced: boolean}`, `keypair_imported`, `keypair_import_refused {reason}`, `keypair_exported {from: "block" | "dialog"}`, `keypair_custom_id_set`, `keypair_custom_id_removed`.

- [ ] In-source tests under `describe("features/program-keypair/model/keypair-file")`: valid 64 → ok with equal bytes; `"{"` → `not_json`; 32 numbers → `wrong_shape`; 64 with a 256 → `wrong_shape`; object → `wrong_shape`; `keypairFileContent` round-trips through `parseKeypairFile(JSON.stringify(...))`.
- [ ] Run `yarn vitest run src/features/program-keypair/model/keypair-file.ts` → FAIL, then implement → PASS.
- [ ] `yarn vitest run src/app/slice-structure.test.ts src/shared/lib/telemetry/prefixes.ts` → PASS.

### Task 2: BaseProgramKeypair + ProgramKeypair (tasks.md 1.2)

**Files:** Create `ui/BaseProgramKeypair.tsx`, `ui/BaseProgramKeypair.test.tsx`, `ui/ProgramKeypair.tsx`, `ui/ProgramKeypair.test.tsx`.

**Interfaces — Produces:**
```ts
type KeypairNote = "changed" | "invalid" | "removed" | "refused" | null;
interface BaseProgramKeypairProps {
  programId: string | null;      // pk
  hasKeypair: boolean;
  customId: boolean;             // customPk set
  mismatch: boolean;             // customPk && kp && !equal
  note: KeypairNote;
  open: boolean; onOpenChange(open: boolean): void;
  confirming: boolean;           // New-keypair dialog open
  onNew(): void;                 // container: generate or open dialog
  onConfirmNew(): void; onCancelNew(): void; onSaveOld(): void;
  onImport(file: File): void; onExport(): void;
  onEdit(): void;                // field typed in: the container drops a stale note
  onChangeId(text: string): void; onRemoveCustomId(): void;
}
```
`ProgramKeypair` (no props) owns `note`, `open` (initially `mismatch`, forced true when mismatch turns on), `confirming`; subscribes to `PgProgramInfo.onDidChangePk/Kp/CustomPk` via `useRenderOnChange`; emits the events.

- [ ] Base tests (one per action): closed by default shows only the trigger; open shows field with id, copy, hint; New calls `onNew`; dialog shows the legacy copy and Generate/Save keypair call their handlers; drop zone file calls `onImport`; Export hidden when `!hasKeypair || customId`; typing shows "Change program id" and passes trimmed text; Remove shows only with `customId`; mismatch shows the warning; each `note` shows its line.
- [ ] Container tests with `vi.mock("@/utils")` holding a fake `PgProgramInfo` (and `@/hooks`, `@/shared/lib/report-button-failure`) and the memory provider: import valid → `update({kp, customPk: null})` + `keypair_imported`; import bad → no update + `keypair_import_refused {reason:"wrong_shape"}`; New with kp → dialog, Generate → `keypair_generated {replaced:true}`; export → `PgCommon.export("program-keypair.json", [...])` + `keypair_exported {from:"block"}`; change valid / invalid; remove.
- [ ] Run both files → FAIL, implement → PASS.

### Task 3: wire into the Deploy stage (tasks.md 2.1)

**Files:** Modify `src/views/flow/stages/BaseDeploy.tsx` (prop `programKeypair: ReactNode`, rendered after the payer line when no deploy, after `<History>` otherwise), `Deploy.tsx` (`programKeypair={<ProgramKeypair />}`), `BaseDeploy.test.tsx` (both placements, and the fixture's new prop).

- [ ] Test: a `<div data-testid="pk-block" />` passed in renders before the first deploy and after one; then implement; `yarn vitest run src/views/flow/stages` → PASS.
- [ ] `yarn run check` → PASS; screenshots (Playwright) of the fold closed, open, mismatch; commit `feat(client-v2): program keypair and custom program id in the Deploy stage (HOO-2397)`.
