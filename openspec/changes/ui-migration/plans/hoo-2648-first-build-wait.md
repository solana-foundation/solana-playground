# HOO-2648: First build wait — keep focus, announce it, offer a way out

Bug ticket; the ticket is the proposal
([HOO-2648](https://linear.app/solana-fndn/issue/HOO-2648)). It touches the
umbrella's `client-v2-buttons` scenario "Build cannot be started twice" only to
make its text match what each surface does.

## Goal

While a first build runs, keyboard focus stays in the Build stage, a polite
region says the build started, and the stage offers Stop and "Show full log".

## Steps

1. **Tests first** (`BaseBuild.test.tsx`):
   - the running first build offers Stop and "Show full log", the row last;
     Stop calls `onStop`, the link calls `onShowLog`; no Build button;
   - the first build's description is a polite `role="status"`, the same
     element before and during the run;
   - focus on Build moves to Stop when the run starts, and to the new
     surface's title when it ends;
   - focus outside the stage is never taken.
2. **`BaseBuild.tsx`:**
   - `onStop` prop; `Build.tsx` passes `PgCommandManager.stop()`, the
     console's Stop;
   - `Surface` takes `{ run: { onStop, onShowLog } }` or `{ actions? }`, a
     discriminated union; the running row is drawn by `Surface` itself, so the
     phone layout keys on "no row" only for a surface that has none;
   - `announce` on the description: `"status"` for the first build;
   - Stop that stops nothing opens the console, where the terminal says why;
   - `BaseBuild` keeps focus that was in the stage when a surface swap removes
     the focused element: Stop while running, else the title (`tabIndex=-1`).
3. **e2e** `client-v2-buttons: Build cannot be started twice`: start from
   the keyboard, assert focus on Stop, that Stop and "Show full log" are the
   stage's only buttons, and one build request. New: `A first build stops
   from the stage`: Stop returns to "Nothing built yet" with focus on the
   title, and a late reply is dropped.
4. **Spec text:** the scenario says Build gives way to Stop on a first build
   and stays busy on the other surfaces.

## Gate

`yarn run check` and the changed e2e spec only (CI runs the rest).
