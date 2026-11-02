# Design

## Context

`openShareGistDialog` (`app/ShareGistDialog`) opens one `ModalFrame` around the
gist feature's `ShareGist`, passing `signedIn` and `signIn` from `PgSession`,
because neither feature may import the other. `ShareGist` shows a "sign-in"
step when signed out and creates the gist as soon as the sign-in resolves.
Sign-in is a popup (`PgSession.signIn`), so the page and the project stay in
memory while it runs. The GitHub mark lives in
`widgets/session-footer/ui/GithubMark.tsx`, which an `app/` module may import
and is the account menu's private part, not exported from the slice.

## Goals / Non-Goals

**Goals:** the prompt as its own frame (title, line, mark, Cancel) from DS
parts; the switch to sharing driven by the session, so a sign-in finished in
another tab or the account menu moves the dialog along too.

**Non-Goals:** a new modal primitive or a sheet on a phone; changing
`ShareGist`'s own steps for an expired session or the gist grant.

## Decisions

- **Switch in `ShareGistDialog`, on `PgSession.get()`.** It already re-renders
  on `PgSession.onDidChange`. Signed out it renders a `ModalFrame` named
  `share-gist-sign-in`, titled "Sign in to share"; signed in, today's
  `share-gist` frame. One dialog on the stack, so focus and Close behave as
  for any dialog, and the opener gets focus back on close. Alternative: a
  second dialog stacked over the share dialog, rejected: two layers for one
  step, and Cancel would leave the share dialog behind.
- **The prompt's sign-in is the frame's submit**, `noCloseOnSubmit`, so the
  frame shows the busy state, keeps Cancel and blocks dismiss while the popup
  runs. A known sign-in failure (`isSignInFailure`: cancelled, blocked popup,
  unread session) is caught and shown as a `Callout` in the body, not thrown:
  the frame reports every thrown error to Sentry, and a closed popup is the
  user's choice. Anything else is rethrown, so the frame shows it and reports
  it.
- **`ShareGist` is handed `signedIn` only once the session exists**, so its
  undecided step resolves to "ready" and nothing is sent until the user
  presses create. Its "sign-in" step remains for a session that ends mid-way
  (`needs-sign-in`), as the spec keeps.
- **`ModalSubmit.icon`**, an optional node drawn before the label (hidden
  while busy, where the spinner takes its place). Smaller than a body-drawn
  button that would bypass the frame's Enter and busy handling.
- **The GitHub mark is exported from `widgets/session-footer`'s entry** and
  imported there by `app/ShareGistDialog`. Alternative: move it to
  `shared/ui`, rejected: `shared/ui` is installed from the design system and
  never edited by hand, and the DS has no GitHub mark; it goes there once
  design adds it to the registry (DES-194).

## Risks / Trade-offs

- [A sign-in finished elsewhere while the prompt is open] → the session change
  re-renders the dialog into sharing; the prompt's own promise then resolves
  into a frame that is gone, which `ModalFrame`'s mounted check already drops.
- [The frame swap remounts the body] → `ShareGist` starts at "ready", which is
  what a fresh share dialog shows anyway.
