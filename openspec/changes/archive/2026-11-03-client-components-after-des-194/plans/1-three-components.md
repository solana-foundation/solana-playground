# Plan: three client components after DES-194 (HOO-2057)

Tasks 1.1, 2.1 and 3.1 of `client-components-after-des-194`. Mode: inline.

## Success metric (from the ticket)

On the preview: a toast shows the progress bar draining. An invalid project
name shows its message above the field, and a valid one shows the success
edge. A started lesson in the project list shows its progress.

## Design gaps (decided, sent to Design alignment, 2 Nov)

- Lesson progress in the list: prototype shows none, R60 removed it; Slava
  chose to show it (2 Nov). "3/5" muted in the pin/marker slot, a check when
  finished.
- Name message before the field, on its left in the row as the prototype
  draws it (above when stacked), over Spec 09/11 ("under").
- Success edge: on a typed name passing the format check; taken stays on Start.
- Toast bar: 2 px, primary, at the foot, pauses with Sonner, none when
  persistent, none under reduced motion.

## 1.1 Toast progress

1. Test (`ToastHost.test.tsx`): a default toast holds
   `[data-slot=toast-progress]` with `animation-duration: 5000ms`; a
   `duration: 3000` toast's is `3000ms`; a persistent one has none; the bar
   is `aria-hidden`.
2. Run, see it fail.
3. `widgets/overlays/ui/ToastProgress.tsx`: an absolutely placed 2 px
   wrapper at the toast's foot, clipped to its radius, holding a
   `bg-primary` bar animated by `pg-toast-progress` (keyframe `scaleX(1)` to
   `scaleX(0)`, origin left, linear, forwards), paused in
   `[data-expanded=true]` and while the page is hidden (`visibilitychange`),
   hidden under `motion-reduce`. Keyframe in
   `src/index.css` beside the other `pg-*` ones.
4. `ToastHost.show` renders it after the content when the duration is
   finite, keyed per show so a toast shown again by its id starts from full.
5. Tests green; look in the browser.

## 2.1 Name field

1. Tests (`BaseStartFromScratch.test.tsx`): the error renders before the
   input in document order and describes it; `name="my-project"` gives the
   input `data-state="valid"`; empty gives no `data-state`; an invalid start
   gives `aria-invalid` and no `valid`.
2. Fail, then: a `valid` prop (computed by `StartFromScratch` with
   `PgExplorer.isWorkspaceNameValid(name.trim())` when the name is non-empty;
   the field shows it only while no error is shown), `data-state="valid"` +
   `data-[state=valid]:border-success` on the Input; `FieldError` moved
   above the input row.
3. `StartFromScratch` test if one exists; else covered by the base test plus
   the container's one-line computation.

## 3.1 Lesson progress

1. `project-entries.ts` in-source tests: `listProjects` takes
   `progressOf(name)` and sets `progress` only for lessons (`null` else).
2. `BaseProjectList.test.tsx`: a started lesson's row shows "3/5" and is
   described "Page 3 of 5"; a completed one shows a check described
   "Completed"; a project shows neither; the row's accessible name stays the
   lesson name.
3. `ProjectList.tsx` passes `useTutorialProgress()` into `listProjects`;
   `ProjectList.test.tsx` mocks it like `use-catalog-lists.test.ts` does.
4. `BaseProjectList`: the marker slot shows when `pinned || marker ||
   progress`; the progress span carries its own id for `aria-describedby`
   (joined with the marker's).

5. `useTutorialProgress` (found in the browser: the row stayed on "1/4"
   after a page turn): re-read on `PgTutorial.onDidChangePageNumber` and
   `onDidChangeCompleted`, the open lesson's page from memory while the
   explorer holds its workspace, the file otherwise.

## Gate

`yarn run check` (types, unit, lint, format, spec validate). No e2e spec is
added or changed; e2e is CI's job.
