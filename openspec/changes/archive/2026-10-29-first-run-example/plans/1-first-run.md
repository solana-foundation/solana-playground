# First run and return visit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home offers a first visitor "Try an example" with one automatic build, a returning visitor "Pick up where you left off", and the Build stage says when a first build is slow.

**Architecture:** A model module in `widgets/home` owns the example (find or create, then build once) and the recent list (pure function over names). `BaseHome`/`BasePhoneHome` draw the new sections from props; `Home`/`PhoneHome` connect them. `Build` ticks elapsed time from `PgFlow.buildStartedAt`; `BaseBuild` draws it.

**Tech Stack:** React 19, Tailwind 4 design-system parts from `shared/ui`, Vitest + Testing Library.

**Spec:** `openspec/changes/first-run-example/specs/client-v2-first-run/spec.md`, `design.md`.

## Global Constraints

- Copy, verbatim: "Try an example", "This program saves a number in an account and writes it to the logs.", "Run it", "Pick up where you left off", "First builds take longer. This one is running."
- Example project name: `anchor-example`. Slow-build threshold: `SLOW_BUILD_MS = 60_000`. Recent list: at most 3.
- Events: `home_example_run { outcome: "created" | "opened" | "current" }`, `home_recent_opened { kind: "project" | "tutorial" | "current" }`, `HomeQuickstart` gains `"example"`; each with a doc comment.
- Every `AsyncButton` passes `onError={reportButtonFailure(...)}`; no empty `catch`; no nested ternaries.
- Commits: Conventional (`feat(client-v2): ...`), no attribution lines.

## Review Focus

- A build that fails to start after the example is created must not report "Run it" as failed (the project exists): log it, keep going.
- "Run it" pressed when `anchor-example` exists and is already open: return to the work (`onContinue`), not a switch.
- Recent list when the open project is a tutorial: kind `current`, goes back to the work.
- Elapsed time after the build ends: the tick stops and the surface leaves "Building".
- Phone with no project and no Beginner tutorial: quick starts still render, example first.

---

### Task 1: Example and recent model

**Files:**
- Create: `client-v2/src/widgets/home/model/recent.ts` (pure, in-source tests) and `model/example.ts` (the action; it imports `@/utils`, which an in-source block cannot load)
- Modify: `client-v2/src/widgets/home/model/telemetry.ts`

**Interfaces:**
- Produces: `recentProjects(names: readonly string[], current: string | undefined, isLesson: (n: string) => boolean): RecentEntry[]` with `RecentEntry = { name: string; kind: "project" | "tutorial"; current: boolean }`; `runExample(): Promise<"created" | "opened" | "current">` that finds `anchor-example` (current → `"current"`, else switch → `"opened"`) or creates it from Anchor's `getDefaultFiles` and starts one build, not awaited (`"created"`); a skipped or failed build is logged unreported, not rethrown.

- [ ] Step 1: in-source tests for `recentProjects` in `recent.ts`: `["a","b","c","d","e"]` with current `"b"` → `["b","e","d"]`; current undefined → `["e","d","c"]`; lesson names get `kind: "tutorial"`.
- [ ] Step 2: run `yarn test-unit src/widgets/home/model/recent.ts`, expect fail; implement; expect pass.
- [ ] Step 3: `runExample` tested in `ui/Home.test.tsx` (it mocks `@/utils`), Task 2.
- [ ] Step 4: add the events and `"example"` to `telemetry.ts`.

### Task 2: Desktop Home sections

**Files:** Modify `ui/BaseHome.tsx`, `ui/Home.tsx`, `ui/home-slot.tsx`; tests `ui/BaseHome.test.tsx`, `ui/Home.test.tsx`.

**Interfaces:** `BaseHomeProps` gains `start: { kind: "example"; onRun: () => Promise<void> } | { kind: "recent"; entries: RecentEntry[]; onOpen: (e: RecentEntry) => Promise<void> }`. `HomeProps` gains `onContinue: () => void`.

- [ ] Step 1: BaseHome tests: example region `getByRole("region", {name: "Try an example"})` holds the line and "Run it", placed before the composer in DOM order; recent region "Pick up where you left off" lists entries with "Open <name>" buttons and calls `onOpen`.
- [ ] Step 2: Home tests: no workspaces → "Run it" creates `anchor-example` (`PgExplorer.createWorkspace` called with Anchor files) and `PgCommand.build.execute` once, `home_example_run {outcome:"created"}`; existing → `switchWorkspace`, no build, `outcome:"opened"`; recent tutorial → `PgTutorial.open`, `home_recent_opened {kind:"tutorial"}`; current → `onContinue`, `kind:"current"`.
- [ ] Step 3: implement, run both test files, pass.

### Task 3: Phone example quick start

**Files:** Modify `ui/BasePhoneHome.tsx` (`QuickstartTarget` gains `{ id: "example" }`, icon `FlaskConical`, tint green), `ui/PhoneHome.tsx`; test `ui/PhoneHome.test.tsx`.

- [ ] Step 1: test: no project → first quick start "Try an example", three in all; pressing it creates and builds as Task 2.
- [ ] Step 2: implement through `runExample`; pass.

### Task 4: Slow first-build line

**Files:** Modify `views/flow/stages/BaseBuild.tsx` (prop `elapsedMs: number | null`), `views/flow/stages/Build.tsx`; create `shared/lib/hooks/use-elapsed.ts`; tests `BaseBuild.test.tsx`, `use-elapsed.test.ts`.

- [ ] Step 1: tests: building with `elapsedMs: 12_000` → "12 s", not the slow line; `61_000` → "61 s" and "First builds take longer. This one is running."
- [ ] Step 2: implement `useElapsed(startedAt)` in `shared/lib/hooks/use-elapsed.ts` (test file with fake timers); `Build` passes `buildStartedAt` while `flow.build === "running"`.
- [ ] Step 3: `yarn run check` scope: `yarn test-types`, `yarn lint`, `yarn check-format`, the touched test files; commit.
