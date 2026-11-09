# Main-flow events (tasks 1.1, 5.1–5.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, an instruction call and an applied assistant patch send a success and a failure event, and a check fails when any funnel step loses one.

**Architecture:** The funnel table in the `client-v2-funnels` delta is the checklist; `src/app/slice-structure.test.ts` reads it and every `createTracker` map under `src/`. Build and Interact get trackers in two new slices, called from the legacy code that runs every build and every call; the assistant's two events join its existing tracker.

**Tech Stack:** TypeScript, vitest, the TypeScript compiler API (already used by the slice test), `shared/lib/telemetry` (`createTracker`, `memoryProvider`).

**Spec:** `openspec/changes/funnel-events/specs/client-v2-funnels/spec.md`, `specs/client-v2-build/spec.md`, `specs/client-v2-interact/spec.md`, `specs/client-v2-assistant-usage/spec.md`; `design.md`, "The funnel table is the step-to-name map" and the two HOO-2598 sections.

## Global Constraints

- Event names start with a prefix registered in `shared/lib/telemetry/prefixes.ts`, at most 40 characters; parameters are primitives.
- Every event has a `/** */` doc comment saying when it fires.
- No event carries a file name, path, content, program id, address, signature, instruction name or compiler output.
- Legacy code calls `tracker.track` without a scope.
- A slice never imports another feature; legacy roots import a slice through its `index.ts`.
- Commits: Conventional Commits, `(client-v2)` scope, no AI attribution.

## Review Focus

- A build the user stops sends `build_started` and no outcome; it must not read as `build_failed`.
- A reply that lands after a stop is dropped by the command; it must send nothing either.
- A call whose confirmation throws after a signature came back is `interact_failed {phase: "confirm"}`, after `interact_sent`.
- `PgConnection.cluster` is `null` on a custom endpoint: `cluster: "custom"`, never `null`.
- A telemetry provider that throws must not change the command's result (the collector already catches; tests do not need to re-prove it).

---

### Task 1: The funnel check (1.1)

**Files:**
- Modify: `client-v2/src/app/slice-structure.test.ts`

**Interfaces:**
- Produces: `declaredEvents(): Set<string>` (every key of every `createTracker<...>()` map in non-test `.ts`/`.tsx` under `src/`), `funnelRows(): { step, events: string[], failures: string[], failuresCell: string, source: string }[]` (reads `openspec/specs/client-v2-funnels/spec.md`, else the `funnel-events` delta).

- [ ] Factor the AST walk of `undocumentedEvents` into `eventMaps(file)` returning the resolved type literals, reused by both.
- [ ] Tests: `it.each(funnelRows())` "should declare the events of %s" — names of both columns minus declared, `[]`, skipped for `GA4` and `pending (`; `it.each` "should name how %s fails" — `failures.length > 0 || failuresCell.startsWith("none:")`; and "should find the funnel table" (`rows.length >= 15`).
- [ ] Run `yarn vitest run src/app/slice-structure.test.ts`: fails on `build_*`, `interact_*`, `assistant_patch_*` (not declared yet). Verify a rename and an emptied Failure cell fail, revert.
- [ ] Commit `test(client-v2): check the funnel table against every tracker (HOO-2598)`.

### Task 2: Build events (5.1)

**Files:**
- Create: `client-v2/src/features/program-build/index.ts`, `model/telemetry.ts`
- `frameworkOf` lives in `commands/build/build.ts`, exported for its test
- Modify: `shared/lib/telemetry/prefixes.ts` (`"program-build": "build"`), `commands/build/build.ts`, `commands/build/build.test.ts`

**Interfaces:**
- Produces: `buildTelemetry` with `build_started {framework: BuildFramework}`, `build_succeeded {framework, has_idl: boolean}`, `build_failed {framework, reason: BuildFailedReason}`; `BuildFramework = "anchor" | "native" | "seahorse"`, `BuildFailedReason = "compile" | "server" | "network"`; `frameworkOf(files: TupleFiles): BuildFramework` (Python file → `seahorse`; a file holding `anchor_lang` → `anchor`; else `native`).

- [ ] Tests in `build.test.ts` with `initTelemetry({providers: [memoryProvider()]})`: compile error → started + failed `compile`; success with IDL → succeeded `has_idl: true`; `PgServerError` with `status: undefined` → `network`, with a status → `server`; Seahorse's thrown "Seahorse compile failed" → `compile`; stop → started only; empty file → nothing.
- [ ] Implement: `build_started` after `getBuildFiles` (framework from the build files), inside `buildProgram`'s caller; failure reason by `answered` shape (as `buildFailureOf` reads it), not `instanceof`.
- [ ] `yarn vitest run src/commands/build src/app/slice-structure.test.ts`; commit `feat(client-v2): count every build (HOO-2598)`.

### Task 3: Instruction call events (5.2)

**Files:**
- Create: `client-v2/src/features/program-interact/index.ts`, `model/telemetry.ts`
- Modify: `prefixes.ts` (`"program-interact": "interact"`), `views/flow/stages/run-call.ts`, `run-call.test.ts`

**Interfaces:**
- Produces: `interactTelemetry` with `interact_sent {cluster: InteractCluster}`, `interact_succeeded {cluster}`, `interact_failed {cluster, phase: "send" | "confirm"}`; `InteractCluster = Cluster | "custom"` (`Cluster` from `@/entities/cluster`).

- [ ] Tests: landed → sent, succeeded; confirmed with `err` → sent, failed `confirm`; confirm throws after a signature → sent, failed `confirm`; send throws → failed `send` only; `cluster: null` → `custom`.
- [ ] Implement in `send` (the cluster read in `runCall` before sending, passed in); `interact_sent` right after the signature.
- [ ] Run the tests; commit `feat(client-v2): count every instruction call (HOO-2598)`.

### Task 4: Patch write events (5.3)

**Files:**
- Modify: `widgets/assistant/model/telemetry.ts`, `views/sidebar/assistant/model/tools.ts`, `tools.test.ts`

**Interfaces:**
- Produces: `assistant_patch_written: NoParams`, `assistant_patch_write_failed: {reason: "limit" | "other"}`; `limit` when the error is `ExplorerLimitError` (by `name`, the tests mock the explorer).

- [ ] Tests: allow + write → written once; `applyPatch` rejects with a limit error → failed `limit`; other error → `other`; deny → neither.
- [ ] Implement around `bridge.applyPatch`; import `assistantTelemetry` from `@/widgets/assistant` unless that cycles, else from its `model/telemetry` with a comment why.
- [ ] Run tests; commit `feat(client-v2): count an applied assistant patch (HOO-2598)`.

### Task 5: Close out

- [ ] Tick 1.1 and 5.1–5.3 in `tasks.md`; `yarn run check` green; lint delta +0.
