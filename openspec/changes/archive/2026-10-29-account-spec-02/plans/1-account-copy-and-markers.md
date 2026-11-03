# Plan: tasks 1.1–1.3, account copy, in-menu sign-out, sync markers

Ticket HOO-2389. Inline (superpowers:executing-plans), test first.

## 1.1 Copy and the online line

1. `features/auth/model/session.ts`: failure strings to Spec 02's
   ("Sign-in isn't available. Your work is saved in this browser." for a
   refused start and a missing URL; "Sign-in did not finish." for a timeout
   and an unreadable session). Update the session tests that match strings.
2. `shared/lib/hooks/use-online.ts`: `useOnline()` over `navigator.onLine`
   and `online`/`offline` (`useSyncExternalStore`), in-source test of the
   subscribe/snapshot pair.
3. `widgets/session-footer/model/account.ts`: `AccountView.online`;
   `AccountLine` kinds `saved-here | signing-in | failed | login | offline`;
   `accountLines` returns `{ primary, line }` (one line); wallet off the row;
   primary is the display name signed in, "Signing in…" pending. In-source
   tests first (red), then the change.
4. `BaseSessionFooter`, `use-account.tsx`: one line;
   tests updated.
5. `BaseAccountMenu`: pending "Waiting for GitHub…" + "Cancel sign-in";
   after a failure the reason + "Try again"; offline and signed out a
   disabled "You're offline". Tests first.

## 1.2 Sign-out in the menu

1. `model/account.ts`: `SignOutState = idle | asking | done(kept)`,
   `leftoversText(n)`.
2. `BaseAccountMenu`: `signOut` prop + `onSignOutConfirm`/`onSignOutCancel`;
   the Sign out item `preventDefault`s and asks; the question replaces the
   items; Cancel focused on mount; confirm item is busy while the promise
   runs and reports a failure through `reportButtonFailure("sign out")`.
3. `use-account.tsx`: state, reset on menu close (counted `cancelled` if
   asking), `items_kept` = workspaces left after `PgSession.signOut`;
   telemetry `session_sign_out_ended` declared in `model/telemetry.ts`.
4. Delete `BaseSignOutDialog` and the `dialog` plumbing in `SessionFooter`
   / `RailFooter`.

## 1.3 Markers

1. `features/persistence/model/sync-mark.ts`: `PgSyncMark.onDidChange`
   fired by `write`, `remove`, `markDirty` with the kind.
2. `features/persistence/model/sync-marker.ts`: `syncMarkerOf(id, name)`
   per design decision 1, `onDidChangeSyncMarkers(cb)` per decision 2;
   in-source tests over stubs of `PgProjectSync`/`PgSyncMark`/`snapshotOf`.
   Exported from `features/persistence/index.ts`.
3. `widgets/app-nav`: `ProjectEntry.marker`; `ProjectList` reads markers
   for every listed project (coalesced) on the events; `BaseProjectList`
   draws the caption (and the warning dot for "Not synced") beside the pin,
   hidden on hover. Tests first in `BaseProjectList.test.tsx`.

## Gate

`yarn run check` from `client-v2/`; screenshots before/after, desktop
1440×900 and phone 390×844, on port 13060.
