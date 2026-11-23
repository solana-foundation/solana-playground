# Plan: open-link-trust (HOO-2883)

Goal: the three tasks of `tasks.md`, test first. Run from `client-v2/`.

1. **Cap** (`lib/link.ts`): failing in-source test, `sol=2` -> reason `sol`,
   `sol=1` opens. Add `MAX_LINK_SOL = 1`, export it, reject above. Doc line in
   `docs/open-in-playground-link.md`.
2. **Claim** (`ui/BaseRunCallout.tsx`): failing test in
   `BaseRunCallout.test.tsx`, a source with `from` on solana.com renders no
   text starting "From solana.com", title "Opened from a link: <title>", line
   naming the host as the link's claim. Then change the idle note.
3. **Confirm** (`model/run.ts`): failing tests in `model/run.test.ts`:
   - link open, `start()` -> state `confirm`, `connectWallet` and
     `run.execute` not called;
   - `confirmRun()` -> runs; second `start()` runs with no `confirm`;
   - `cancelRun()` -> previous state, nothing runs;
   - workspace switch while `confirm` -> idle, nothing runs;
   - a new link asks again; no link never asks.
   Then add `confirm` to `RunState`, `confirmRun`, `cancelRun`.
4. **Dialog** (`ui/BaseRunConfirm.tsx` + test): renders name, code, claimed
   host; Run and Cancel call back. Mount from `RunButton` on state `confirm`.
   `BaseRunCallout` and `hasRun` treat `confirm` like `funding` (show
   `previous`).
5. **e2e** (`e2e/docs-open-link.e2e.spec.ts`): every Run press on a link's
   project confirms first; new cases for the crafted source and the cap.
6. Gate: `yarn run check`, the changed e2e spec, screenshots before/after.
