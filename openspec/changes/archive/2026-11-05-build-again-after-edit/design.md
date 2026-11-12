## Decisions

**Compare content, not edit events.** The baseline is the text of the files a
build sends (non-empty files under `src/`), taken when the build starts, so an
edit made during the build counts. Paths are left out, so a rename alone is no
change, and an edit undone back to the built text is no change either. A
"dirty" flag set per edit gets both wrong.

The cost of leaving paths out: moving a file within `src/`, or swapping two
files' text, reads as no change. The ticket asks for a rename not to count, and
these are rare enough to accept.

**The declared program id is left out too.** A build's start writes it into the
open file (`Monaco.tsx`) and autosave stores that after the baseline is taken, so
with it left in every first build reads as changed code moments after it
succeeds. The build sends the keypair's id whatever the file says, so the text
there decides nothing. A new keypair after a build therefore reads as no change;
that is not an edit to the program's code.

**Only a success moves the baseline.** A stopped or failed build leaves it, so
a stopped rebuild returns to the surface it left, with the same answer.

**The baseline follows its workspace by name**, as `ownOutput` does for the
report. Sync re-opens a workspace after a merge, which resets the flow; the
check runs again after the reset, so the other device's edit still reads as a
change. Another workspace has no baseline.

**In memory only.** Everything read is `PgExplorer.files`; nothing touches the
filesystem on a save.

**Static, as the flow state is.** `Flow.tsx` re-subscribes on a remount with the
state and the report still there, so a baseline kept in `init` would be lost and
an old build would read as current.

**Another tab's edit gets an event of its own.** `reloadCurrentFromDisk` writes
straight to state and avoids the save event, which would schedule an upload of
what that tab already uploaded, so it fires `ON_DID_RELOAD_FILES`.

**Deploy stays open.** Almaz's sentence makes Build again the main button and
locks nothing. the lock in designers' Spec 01 (the tutorial's spec, kept outside this repo: "Your code changed after the last build. Build again to deploy.", Deploy locked) belongs to the tutorial, not to this
general surface, and tutorial behaviour does not change here. The stepped-down
button is outline, the weight Build again has without a change. The line takes
Spec 01's first sentence; "to deploy" would be false with Deploy open, so it
ends "before you deploy".
