# Design

## Context

See proposal.md for why. The pieces this change touches today:

- `features/gist/ui/BaseShareGist.tsx` draws the steps (`ready`, `sign-in`,
  `grant`, `created`, `failed`). `ShareGist.tsx` connects them to
  `exportProject` and to the `signIn` it is handed. `app/ShareGistDialog`
  frames the body in `ModalFrame` and passes `PgSession.signIn`, because
  `gist` may not import `auth`.
- `exportProject` posts `{description, files}` to `/api/gists`. The route
  (`api/gists.mjs`, `parseGist`) hands `createGist`
  (`model/create-gist.mjs`) the files, and `createGist` sends `public: true`.
  The route already answers `{url, id}`, but `exportProject` keeps only
  `url`.
- `routes/gist` serves `/gist/{ref}`, where `parseGistRef` takes a bare hex
  id (optionally `/<revision>`), and opens the gist as a view. GitHub's API
  reads a secret gist by id without auth, so the Playground link needs no
  new route.
- `PgSession.cancelSignIn()` exists. `popup-channel.ts` deliberately does not
  watch `popup.closed`, so a sign-in waits until GitHub answers or someone
  cancels it. The share dialog has no way to cancel today, which is why the
  spec scenario "Sign-in cancelled" was never met.
- `BaseProjectList` offers `share-gist` on every row (key `G`).
  `BaseStageBar` (`widgets/layout-shell`) is the 44 px desktop bar over the
  files column and the stage. It has no slot for actions.
- `Stepper` on a phone drops Write. For a no-program project
  (`stagesOf` gives only Write) it renders an empty tablist.
- `shared/ui/copy-button` reports success only through its own tooltip, and
  `shared/ui` is never edited.

## Goals / Non-Goals

**Goals:**
- Keep the Base/connected split: every new visible state is a prop of
  `BaseShareGist`, and `ShareGist` owns the requests, the telemetry and the
  toasts.
- One source for the Playground link: a pure helper in the `gist` slice
  builds it from the gist id and the page origin, so tests pin it.

**Non-Goals:**
- No new shared UI component, no edit to `shared/ui`.
- No change to sign-in itself (`features/auth`), only a use of
  `cancelSignIn`.

## Decisions

1. **Visibility travels as `public: boolean` in the body. A missing field
   means secret.** The route validates the field in `parseGist`: a value that
   is neither absent nor a boolean answers `400`. Secret as the server's
   default means an old client, or any caller that forgets the field, never
   publishes by accident. *Alternative:* a `visibility: "secret" | "public"`
   string reads closer to the UI, but GitHub's own field is the boolean, and
   a string would need a mapping in two places.

2. **The Playground link is built on the client from the id, as
   `${location.origin}/gist/${id}`** (`lib/playground-link.ts`).
   `exportProject` returns `id` beside `url`. If an answer has no `id`, the
   id is read from the URL with the existing `parseGistUrl`; if neither
   works, that counts as the existing `request-failed` (reported). The origin
   is read in the connected component and passed to the Base as a finished
   string, so stories and tests stay deterministic. *Alternative:* have the
   server return the link. The server does not know which deployment the
   user wants to share (a preview, production), and the client does.

3. **Copy and toast go through the dialog's own buttons, not `CopyButton`.**
   Spec 05 wants a "Link copied" toast and a `gist_link_copied` event, and
   `CopyButton` exposes no success callback (and `shared/ui` stays
   untouched). `BaseShareGist` takes `onCopy(kind)`, which returns a promise.
   `ShareGist` writes to the clipboard, then calls
   `PgView.setToast` (name `gist-link-copied`, text "Link copied") and tracks
   the event. A refused clipboard puts an error line in the dialog instead.
   "Copy Playground link" is a text button beside the field, and "Copy
   GitHub link" a ghost text button.

4. **Visibility lives in `ShareGist` state, and the Base draws the radio
   group from it.** It starts as `secret` on every open and is locked while a
   request runs (the `AsyncButton`'s busy state, mirrored into a `busy`
   flag). A retry after sign-in or a grant reuses the chosen value, because
   `share()` reads it from state. A resumed export (after sign-in or a grant)
   sends `gist_export_started` again with the same `visibility` and
   `source`.

5. **Cancel while waiting is a step of its own: `{ step: "waiting", for:
   "sign-in" | "grant" }`, and the signed-out prompt gets the same button.**
   `ShareGist` shows the step before awaiting `signIn`. Its one button reads
   "Cancel sign-in" (`share-gist-cancel-sign-in`), the prototype's own
   sign-in control's shape (`StatusChips`: the label swaps while signing in,
   no second button; Design alignment, 3 Nov), and calls a `cancelSignIn` prop (wired to
   `PgSession.cancelSignIn` in `app/ShareGistDialog`). The rejected `signIn`
   then lands in the existing catch, which counts `sign-in-failed` and
   returns to the step it came from (`sign-in` or `grant`) with the cancelled
   message. In `SignInToShare` (HOO-2484, on the base already) the frame's
   submit swaps from a disabled "Waiting for GitHub…" to an enabled "Cancel
   sign-in" that cancels and keeps the prompt open with "Sign-in
   cancelled." The frame's Cancel keeps HOO-2484's meaning:
   it closes the dialog and cancels the sign-in. `PgSession.cancelSignIn` is
   owned by HOO-2519 and is not edited here; its contract (the pending
   `signIn` rejects with `SignInFailed` reason `cancelled`) is what both
   buttons rely on.
   *A second popup after Cancel.* `PgSession.signIn` queues a call that needs
   wider scopes behind a pending one and restarts it when that one ends, even
   by a cancel. The share dialog cannot reach that queue: it asks for `gist`
   only from the grant step, which needs a session, and the dialog is modal,
   so no other sign-in can be pending beside it. No handling is added.
   *Alternative:* watch `popup.closed`. Rejected, because `popup-channel`
   chose not to (COOP makes it unreliable), and an explicit Cancel is what
   Spec 05's states table lists ("Signing in … Cancel sign-in").

6. **Where Share is offered.** `BaseProjectList` keeps `share-gist` only for
   `entry.name === list.current`, both in the menu and in the `G` key map.
   The header button goes into a new optional `actions` slot at the right
   end of `BaseStageBar`, threaded through `LayoutShell` as `stageBarActions`.
   `Flow` fills it with a small `ShareButton` (in `app/ShareGistDialog`,
   beside the dialog it opens, since only `app` may join the two features).
   The button shows only when a project is open and Home is not shown.
   `BaseStageBar` is desktop-only, so a phone gets no header button for free.
   The `source` telemetry value comes from which opener called
   `openShareGistDialog(name, readFiles, source)`. `Flow` already imports
   `@/app/ShareGistDialog` for the row menu, so the button follows that
   path. An open lesson gets the button too, matching its row, which keeps
   Share. On a phone the project list sits on the pager's menu page, and the
   open project's row and its menu are reachable there.

7. **The phone stepper for a no-program project is not rendered.**
   `Stepper` draws nothing when the stages it would show are none, which
   happens only on a phone (Write is left out there) for a project whose one
   stage is Write. The "Client project" badge in `StageBar` stays. Kept in
   `Stepper`, beside the filtering that empties the list, so a desktop
   no-program project is unchanged and the case is tested where it arises.

## Risks / Trade-offs

- [A link copied from a Vercel preview points at that preview] → Accepted.
  It is the deployment the user is on, and production users copy production
  links.
- [The server's new default flips any other caller to secret gists] → Only
  this client calls `/api/gists`. The proposal's Impact records it.
- [An old link opened after the gist is deleted] → `routes/gist` already
  shows the missing-gist message (`gist_import_failed`, `not-found`).

## Migration Plan

Client and API ship in one deployment, so no step is needed. Rollback is a
revert. Gists already made stay as they are.
