# Design

## Context

Home lives in `widgets/home` (`Home`, `PhoneHome`, their `Base` parts); `homeSlot` picks one by viewport and already hands the phone an `onContinue` back to the work. Projects come from `PgExplorer.allWorkspaceNames`, with no timestamps; a started tutorial is a workspace that `PgTutorial.isWorkspaceTutorial` recognises and `PgTutorial.open` resumes at its page. A build is `PgCommand.build.execute()`; `PgFlow` records `build: "running"` and `buildStartedAt`. The Build stage's "Nothing built yet" surface already says "Building..." while one runs.

## Goals / Non-Goals

**Goals:** the spec's five behaviours with the fewest new moving parts; the build server hit once per example created.

**Non-Goals:** a stored "first run done" flag; recency timestamps; the landing route; indicators and the setup list (HOO-2323).

## Decisions

- **First visit = no project in the browser and no session** (Spec 06). No flag. A user who deletes every project while signed out sees the example again, which Spec 06's rule allows. A signed-in account with nothing in the browser yet sees neither section until sync imports its projects.
- **The example is found by name, `anchor-example`.** A second "Run it" opens it. A stored id was rejected: a rename would then still find it, but a name is what the user sees, and storage (`localStorage` is near its budget) is avoided.
- **The automatic build is part of the "Run it" action**, started (not awaited) after `createWorkspace` resolves. It is not a flag read on load, so a reload cannot start one, by construction. On a first visit no terminal is mounted until the new project replaces Home, so it retries while the terminal is unmounted, for up to 15 s, and builds only while the example is still open and no build runs. A skipped or failed run is logged unreported: the Build stage shows it.
- **Recency is the explorer's list, reversed, with the open project first.** No timestamps exist; new projects are appended to the list, so its tail is the newest. The open one is what the explorer re-opens on a load, so it is the last used.
- **The open project returns to the work** through the same `onContinue`/`leaveHome` the phone's Continue uses, never a switch, which would re-read it under a live editor.
- **Elapsed time is a shared hook** (`shared/lib/hooks/use-elapsed`) fed `buildStartedAt` while a build runs, ticking once a second only then; `BaseBuild` takes `elapsedMs` as a prop and stays pure. The slow line is added under the description, which stays. 60 s is `SLOW_BUILD_MS`, Spec 06's number "to agree".
- **Look (design gap, no source draws it):** the example is an `ActionCard` row above the tiles with a `BrandButton` "Run it"; the recent list is a caption and a list of `ActionCard` rows, each row one target (no separate Open button). Both sit between the heading and the composer, so Tab reaches "Run it" first. Sent to the designers' batch.

## Risks / Trade-offs

- [The example's build fails on a cold or unreachable server] → the Build stage's existing "Build failed" surface with "Retry build"; the action does not fail because the build did.
- [A project named `anchor-example` made by hand counts as the example] → it opens, no build; harmless.
- [Explorer order is not strictly recency] → acceptable for the MVP cut; a timestamp is a follow-up if usability shows it.
