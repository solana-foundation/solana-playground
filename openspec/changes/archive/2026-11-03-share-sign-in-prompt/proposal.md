# Proposal

## Why

A signed-out user who picks Share as gist lands in the share dialog with a bare
"Sign in with GitHub to share" button, and signing in creates a public gist at
once, without a last look. Spec 05 (Share through GitHub) asks for a sign-in
prompt first: it says why, shows the GitHub mark, and after sign-in returns to
the share dialog with nothing sent yet. DES-194 asks dev to build it from the
design system's parts for Breakpoint (HOO-2484).

## What Changes

- Share signed out opens a "Sign in to share" prompt in the share dialog's
  place: one line on why ("Your project goes to a gist on your GitHub
  account."), "Sign in with GitHub" with the GitHub mark, and Cancel.
- A sign-in from the prompt turns the same dialog into the share dialog, with
  the project unchanged. Nothing reaches GitHub until the user presses
  "Create public gist" (the old flow created the gist on sign-in).
- A cancelled or failed sign-in keeps the prompt open and says why.
- Signed in, Share opens the share dialog directly, as today.
- The account menu's GitHub mark is exported from its slice's entry, so the
  prompt draws the same mark; a modal's submit button can carry an icon.
- Telemetry: no event is added, renamed or removed. A sign-in from the prompt
  is counted by `auth`'s existing `auth_sign_in_started`, `auth_signed_in` and
  `auth_sign_in_failed`; `gist_export_failed` with `sign-in-failed` keeps
  counting sign-ins made from inside the share dialog (a session that ended,
  a grant of gist access).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gist-sharing`: the "Sign in to share" requirement changes from an in-dialog
  sign-in that creates the gist to a prompt that returns to the share dialog.

## Impact

- `client-v2/src/app/ShareGistDialog/` (the prompt and the switch on the
  session), `client-v2/src/widgets/overlays/ui/` (an optional submit icon),
  `client-v2/src/widgets/session-footer/index.ts` (exports `GithubMark`).
  The mark is not moved to `shared/ui`: that folder holds only parts
  installed from the design system, which has no GitHub mark yet; adding it
  there is the registry review DES-194 asks for after the freeze.
- Out of scope: the rest of Spec 05 (Repo sharing, Secret gists, the header
  Share button, which HOO-2390 builds), a phone sheet (the modal is already a
  page on a phone; DES-206 holds that question), and any server change.
