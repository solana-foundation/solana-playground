# Proposal

## Why

The design alignment audit of 28 Oct (items A4, A5) found the account
surfaces off Spec 02 (Account, sign-in, saved work and the profile): the
account row and the sign-in errors show raw or missing copy, the sign-out
confirmation says "Sign out of GitHub?" and promises that projects stay in
the browser (sign-out releases every project the account holds exactly as
this browser does), and nothing on a
project row says whether it is in the account. Stage 1 ships before
Breakpoint, and this is the copy and the one visible sync signal people
meet there. Ticket: HOO-2389.

## What Changes

- The account row's second line follows Spec 02 (28 Oct): "Saved in this
  browser" signed out, "Waiting for GitHub…" under "Signing in…" while a
  sign-in runs, the @login under the display name signed in, "Offline ·
  saving here" signed in without a network. The wallet leaves the row (it
  stays in the menu's wallet group).
- The account menu's sign-in group reads "Waiting for GitHub…" and
  "Cancel sign-in" while a sign-in runs, "Try again" after a failure, and
  "You're offline" (disabled) offline.
- The sign-in failures carry Spec 02's strings instead of raw ones ("Could
  not start sign-in", "Sign-in returned no authorize URL", "Sign-in did not
  complete.").
- Sign-out asks in the menu, in place of the dialog: "Sign out of
  Playground?" with "Projects saved to your account leave this browser.
  Anything not saved stays here.", focus on Cancel; afterwards the menu says
  how many projects stayed in the browser.
- Each project row in the navigation shows "This browser" or "Not synced"
  when, signed in, the project is not in the account or holds work the
  account has not taken. The marker is read from the sync model that already
  exists (the per-account sync mark and the open conflicts); there is no
  second notion of "synced".
- Telemetry: adds `session_sign_out_ended` (`outcome`, `items_kept`) to
  `widgets/session-footer`, Spec 02's `sign_out_ended` under the slice's
  existing prefix. None renamed or removed.

## Capabilities

### New Capabilities

- `client-v2-account`: what the account row, the account menu's sign-in
  group and the sign-out confirmation say in each sign-in state, and where
  each project in the navigation says its work lives.

### Modified Capabilities

(none)

## Impact

- `client-v2/src/widgets/session-footer` (row lines, menu copy, the
  in-menu sign-out replacing `BaseSignOutDialog`), `client-v2/src/shared/lib/hooks`
  (`useOnline`), `client-v2/src/features/auth` (failure strings),
  `client-v2/src/features/persistence` (a read-only marker query over the
  sync mark and the conflicts, exported from the slice), and
  `client-v2/src/widgets/app-nav` (the marker on each row).
- No change to what sync uploads, merges or deletes, to the server, or to
  the database.
- Out of scope, later Spec 02 work: the import offer and "Add browser work
  to your account", "Your session ended" (needs session-expiry detection;
  when it lands it outranks "Offline · saving here" on the row), the
  value-moment prompt, the profile.
