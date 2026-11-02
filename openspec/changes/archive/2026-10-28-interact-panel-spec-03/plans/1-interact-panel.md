# Interact panel (Spec 03) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Interact stage picks an instruction from chips, calls it with "Call", shows the result and a call history in the panel, and warns when the code is newer than the deploy or the wallet cannot pay the fee.

**Architecture:** A `localStorage` call history store and a `runCall` helper sit in `views/flow`; `BaseCallResult`/`BaseCallHistory` render plain props; `InteractBody` connects chips, the existing `Instruction` form (which now delegates the call), the result and the history; `BaseInteract` gains the program id and two callouts, fed by `Interact`.

**Tech Stack:** React, Tailwind 4, design-system parts in `@/shared/ui` (Segmented chips, Callout, CopyButton, StatusDot, Collapsible, AsyncButton), vitest + Testing Library.

**Spec:** `openspec/changes/interact-panel-spec-03/specs/client-v2-interact/spec.md`, `design.md`.

## Global Constraints

- Copy is verbatim from the spec: "Call <instruction>", "Calling…", "Succeeded", "Failed", "Show all logs", "View on Explorer (<network>)", "Call history", "Copy program id", "Copy signature", "Redeploy", "The deployed program is older than your code. Redeploy to call the latest version.", "This call needs a small fee in <network> SOL. Your wallet has <balance> SOL.", "Get <network> SOL", "Fee paid by Playground wallet · <balance> SOL".
- Fee threshold: 5000 lamports (`0.000005` SOL). History cap: 50 records, key `flow.calls`, no logs stored.
- Failing line: first log containing "Error Code:", "custom program error" or "failed:"; else last log; else the error message.
- Every `AsyncButton`/`CopyButton` passes `onError={reportButtonFailure("…")}`.
- Do not edit `state/deploy-history.ts` or `utils/block-explorers/*` (HOO-2385 owns them).
- Unit tests of a pure module go in its in-source block (`client-v2/AGENTS.md`); render tests keep `*.test.tsx`.

## Review Focus

- A history record from hand-edited storage (missing fields, wrong types) is dropped, not rendered — test in Task 1.
- A call that throws before sending (wallet locked, bad input) still ends "Calling…" and shows Failed with the message — test in Task 2 (`failingLine` with no logs) and Task 5 (state returns to idle).
- An IDL whose instructions change while a chip is picked falls back to the first instruction — test in Task 5.
- Balance `null` (not read yet / no wallet) never shows the SOL needed callout — test in Task 6 (`solNeeded`).
- No deploy record for this network: the built-after-deploy callout stays hidden — test in Task 6 (`builtAfterDeploy`).

---

### Task 1: Call history store

**Files:** Create `client-v2/src/views/flow/state/call-history.ts` (in-source tests).

**Interfaces — Produces:**
```ts
export interface CallRecord { id: string; programId: string; cluster: string; instruction: string; ok: boolean; signature: string | null; failingLine: string | null; at: number }
export class PgCallHistory {
  static list(programId: string, cluster: string): CallRecord[]  // newest first
  static add(r: Omit<CallRecord, "id" | "at">): CallRecord
  static onDidChange(cb: () => void): Disposable                 // calls cb once on subscribe
}
```
- [ ] Tests: `add` then `list` returns newest first and filters by program and cluster; the 51st add drops the oldest; a stored entry missing `instruction` or with `ok: "yes"` is dropped; invalid JSON reads as `[]`; `onDidChange` fires on add.
- [ ] Implement mirroring `deploy-history.ts` (shape guard, `MAX_RECORDS = 50`, listeners set).
- [ ] `yarn test-unit src/views/flow/state/call-history.ts` passes; commit.

### Task 2: runCall

**Files:** Create `client-v2/src/views/flow/stages/call-outcome.ts` (`CallOutcome`, `failingLine`, in-source tests) and `run-call.ts` (`runCall`, tests in `run-call.test.ts`).

**Interfaces — Produces:**
```ts
export interface CallOutcome { instruction: string; ok: boolean; signature: string | null; logs: string[]; failingLine: string | null }
export const failingLine: (logs: string[], message?: string) => string | null
export const runCall: (ix: GeneratableInstruction) => Promise<CallOutcome>   // never rejects
```
- [ ] Tests for `failingLine`: picks "Program log: Error Code: AccountNotInitialized…" out of a list; picks a "custom program error: 0x1" line; falls back to the last line; with `[]` returns the message; with `[]` and no message returns `null`.
- [ ] Implement `runCall`: with `PgTerminal.println`, print `Calling \`<name>\`...`; `PgProgramInteraction.test(ix)` → signature; `PgTx.confirm`; logs from `PgConnection.current.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })?.meta?.logMessages ?? []`; `ok = !confirm?.err`. A throw becomes `ok: false`, `signature: null`, logs from `e.logs` when an array; keep the old message map ("unable to infer src variant" → "Enum variant not found"). Print "Call succeeded." / "Call failed: <line>" via `PgTerminal.success`/`error`. Keep `PgSettings.testUi.showTxDetailsInTerminal` → `solana confirm <sig> -v`. Record to `PgCallHistory` with `PgProgramInfo.getPkStr()` and `PgConnection.cluster`.
- [ ] Unit tests pass; commit.

### Task 3: BaseCallResult and BaseCallHistory

**Files:** Create `client-v2/src/views/flow/stages/BaseCallResult.tsx`, `BaseCallHistory.tsx`; both suites in `BaseCallResult.test.tsx`.

**Interfaces — Produces:**
```ts
BaseCallResult: { outcome: CallOutcome; cluster: string; txUrl: (sig: string) => string }
BaseCallHistory: { records: CallRecord[]; cluster: string; txUrl: (sig: string) => string; onOpen: (instruction: string) => void }
```
- [ ] Tests: success renders region "Call result", "Succeeded", "Copy signature", link "View on Explorer (devnet)" with the URL; failure renders "Failed", the failing line, and logs only after "Show all logs"; history renders "Call history", rows newest first, clicking a row calls `onOpen("increment")`; empty list renders nothing.
- [ ] Implement with Callout-free cards: `StatusDot` success/error, `CopyButton`, `Collapsible` for logs (`<pre>` mono, `text-xs`).
- [ ] Tests pass; commit.

### Task 4: Instruction delegates the call

**Files:** Modify `client-v2/src/views/sidebar/test/Component/Instruction/Instruction.tsx`, its test.

**Interfaces — Produces:** `Instruction` props `{ idlInstruction; onCall: (ix: GeneratableInstruction) => Promise<unknown>; callBlocked?: boolean; feePayer?: ReactNode }`. Renders flat (no `Interaction` fold): Args and Accounts folds, `feePayer`, then `AsyncButton` "Call <name>" (`disabled = !wallet || invalid || callBlocked`, label "Calling…" while its promise runs), Fill, Reset. Inputs wrapped in `<fieldset disabled={calling}>`, `calling` being its own call in flight.
- [ ] Update the test: no outer fold; button "Call increment" exists; clicking it calls `onCall` with the instruction; `callBlocked` disables it.
- [ ] Implement; remove `handleTest` and terminal imports.
- [ ] Tests pass; commit.

### Task 5: InteractBody

**Files:** Create `client-v2/src/views/flow/stages/InteractBody.tsx`; modify `Interact.tsx` to pass it as `form`; `Test.tsx` becomes a thin wrapper that renders the body; the body renders `Account`/`Event` under `IdlProvider`.

- [ ] Body: `IdlProvider`; `Segmented variant="chips" aria-label="Instruction"` with one `SegmentedItem` per instruction (mono); picked = state, falls back to the first when absent from the IDL; `<Instruction key={JSON.stringify(idlInstruction)} … />`; `BaseCallResult` for the last outcome, shown only while the program and network are the ones it went to; `BaseCallHistory` from `PgCallHistory.list(programId, cluster)`; Accounts and Events sections below. Keep `useBigNumberJson` and `useSyncInstructionStorage` from `Test.tsx`.
- [ ] Fee payer row: `Fee paid by <wallet.isPg ? "Playground wallet" : wallet.name> · <balance> SOL` (balance to 4 decimals, "—" when null).
- [ ] Commit.

### Task 6: Head and callouts

**Files:** Modify `BaseInteract.tsx`, `Interact.tsx`; create `client-v2/src/views/flow/stages/interact-callouts.ts` (in-source tests).

**Interfaces — Produces:**
```ts
export const FEE_SOL = 0.000005
export const builtAfterDeploy: (buildAt: number | null, deployAt: number | null) => boolean
export const solNeeded: (balance: number | null) => boolean
BaseInteract new props: programId: string | null; builtAfterDeploy: boolean; solNeeded: { balance: number; cluster: string; airdrop: (() => Promise<void>) | null } | null
```
- [ ] Tests: `builtAfterDeploy(2, 1)` true, `(1, 2)` false, `(null, 1)` false, `(2, null)` false; `solNeeded(0)` true, `(0.000005)` false, `(null)` false.
- [ ] Head: under the title row, "Program" + `shortenId(programId)` (4…4) + `CopyButton label="Copy program id"` + network. Callouts in `STAGE_FRAME` above the form on `ready` only; Redeploy calls `onGoTo("deploy")`; Get SOL is `AsyncButton` with `reportButtonFailure("get devnet SOL")`.
- [ ] `Interact`: build time from `PgBuildOutput.latest` when `!failed` (subscribe `onDidChange`); deploy time from the newest `history` record whose `cluster === PgConnection.cluster`; balance via `useBalance`, wallet via `useWallet`, faucet via `useAirdrop`. Pass `callBlocked = !!solNeeded` into the body.
- [ ] `BaseInteract.test.tsx` gains: program id and copy shown; both callouts render their copy and buttons.
- [ ] `yarn test-types`, unit tests pass; commit.

### Task 7: Verify and screenshots

- [ ] `yarn run check` in `client-v2`.
- [ ] Dev server on a free slot port, Playwright: desktop 1440×900 and phone 390×844, before (base) and after, Interact with a deployed program.
