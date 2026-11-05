# Plan: gist-share-secret-link, tasks 1.1–6.1

One PR into `scope/typescript-2`, stacked after SF#75 (the TypeScript
landing). Ticket: HOO-2390 "Gists default to Secret; Share in the header and
on the open row". Executed inline (`superpowers:executing-plans`), TDD per
task.

## Success metric (from the ticket)

A signed-in user shares the open project and has a Playground link
(`<origin>/gist/<id>`) of a secret gist on the clipboard in one dialog:
`gist_export_started {visibility: "secret"}` followed by
`gist_link_copied {copied: "playground"}`. The e2e `gist-sharing` suite pins
the path.

## Design gaps (decided, sent to Design alignment)

- Phone header Share: deferred; the phone shares from the open row's menu.
  Spec 05's menu-extras sheet goes to the designers with DES-206.
- Cancel while signing in: the primary button swaps to "Cancel sign-in"
  (prototype `StatusChips`), keeps the dialog open with "Sign-in cancelled.";
  the frame's Cancel still closes and cancels (HOO-2484).

## Ownership

`PgSession.cancelSignIn` (`features/auth/model/session.ts`) belongs to
HOO-2519 (PR #251). This PR does not edit `features/auth`; it relies on the
pending `signIn` rejecting with `SignInFailed` reason `cancelled`.

## Steps

1. **1.1 Server visibility.** Tests first in `api/gists.test.mjs` (absent →
   `public: false`; boolean passed through; non-boolean → 400, no GitHub call)
   and `create-gist.test.mjs` (`public: false` reaches GitHub). Then
   `parseGist` and `createGist`. Gate: `yarn test-api`.
2. **1.2 Export.** `exportProject({name, files, visibility})` posts
   `public`, returns `id` (falls back to `parseGistUrl(url)`; neither →
   `request-failed`, reported). `lib/playground-link.ts` with an in-source
   test. Gate: `yarn test-unit src/features/gist`.
3. **1.3 Telemetry.** `visibility` on the three export events, `source` on
   `gist_export_started`, new `gist_link_copied {copied}`, each with a doc
   comment. `source` reaches `exportProject` as a parameter.
4. **2.1–2.2 Dialog.** `BaseShareGist`: Visibility radio group (DS
   `radio-group` from `shared/ui` if installed, else `ds-add`), help tip,
   "Share to GitHub" / "Sharing to GitHub…", locked while busy; shared state
   with the Playground link field, the what-it-opens line, Open on GitHub,
   "Copy GitHub link", copy error line. `ShareGist`: visibility state, `onCopy`
   (clipboard → `PgView.setToast` "Link copied" + `gist_link_copied`), origin
   read here. `ModalFrame` title "Share to GitHub". Gate:
   `ShareGist.test.tsx`.
5. **4.1 Cancel sign-in.** `waiting` step in `BaseShareGist` whose button
   is "Cancel sign-in" (`share-gist-cancel-sign-in`); `cancelSignIn` prop;
   `SignInToShare`'s submit reads "Cancel sign-in" while pending and cancels
   without closing. Gate: `ShareGist.test.tsx`, `ShareGistDialog.test.tsx`.
6. **3.1 Open row only.** `BaseProjectList` offers Share and `G` only for
   `entry.name === list.current`. Gate: project-list tests.
7. **3.2 Header Share.** `BaseStageBar` `actions` slot →
   `LayoutShell.stageBarActions` → `Flow` fills it with `ShareButton`
   (`flow-share`) from `app/ShareGistDialog`, `source: "header"`; the row
   passes `"project_menu"`. Gate: `BaseStageBar` test + `ShareButton` test.
8. **5.1 Phone stepper.** `Stepper` draws nothing when no stage is left on
   a phone (`!hasProgram`); `StageBar` keeps "Client project". Gate:
   `Stepper.test.tsx`.
9. **2.3 / 4.2 e2e.** Update `e2e/gist-sharing.e2e.spec.ts` to the new copy
   and the Playground link, add "gist-sharing: Sign-in cancelled" (inline
   cancel) and "Closing the dialog while sign-in waits", the header and
   other-row scenarios, and the no-program phone scenario. Run only these
   specs locally.
10. **6.1 Integration.** `yarn run check`, the touched e2e specs,
    screenshots before/after (desktop + phone: dialog ready, shared, prompt
    while signing in, after cancel; header button; phone no-program bar).
    Then `/sx:review-pr full` and `/sx:review-pr`.
