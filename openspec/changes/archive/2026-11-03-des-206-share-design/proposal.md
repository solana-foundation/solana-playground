# Proposal

## Why

DES-206 redraws Share as gist inside the product: the dialog asks one thing at
a time and puts its one action in the footer, the header's Share becomes an
icon like the bar's others, and a phone gets Share in the Code head. The copy
in the dialog changed with it, so the `gist-sharing` spec no longer matches
what the dialog says. This change brings the spec to the shipped design.

## What Changes

- The dialog is titled "Share <name> as a gist", and "Shared as a secret
  gist" or "Shared as a public gist" once the gist is made.
- Visibility is "Who can open it": Secret and Public as two cards, each with
  its own line, no help tip. The ids `share-gist-visibility-*` stay.
- The footer's one action reads "Create secret gist" or "Create public gist",
  "Creating gist…" while it runs. Sign in with GitHub, Allow gists on GitHub,
  Cancel sign-in, Copy link and Close take the same place in their steps.
  Cancel sign-in is the frame's submit; `share-gist-cancel-sign-in` is gone.
- The dialog lists the files that go to the gist (folded to a count) and says
  what stays in the browser. It reads the project's files to do that; nothing
  is sent until the user presses Create.
- Shared: "<name> opens in Playground from this link", a line on who can open
  it, the Playground link, Copy link in the footer ("Copied" after a copy)
  and a quiet "Open the gist on GitHub" link. "Copy GitHub link" is gone.
- Failures: a project over the limits offers Close only, as a refused gist
  does. A revoked sign-in offers "Sign in with GitHub". A request that failed
  links "Your gists".
- Header: Share is an icon (`flow-share`, accessible name "Share <name>",
  tooltip "Share as a gist"). On a phone the Code head carries a Share icon
  ("Share as a gist"); the header still has no `flow-share`.
- Telemetry: no event is added or renamed. `gist_export_started` fires on
  Create instead of Share to GitHub. `gist_link_copied` is now sent only with
  `copied: "playground"`; the `github` value stays in the type, unused.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gist-sharing`: the dialog's titles, visibility choice, primary action,
  shared step, failure actions, header and phone entry points, and the copy
  event follow the DES-206 design.

## Impact

- `client-v2/src/features/gist/ui/BaseShareGist.tsx`, `ShareGist.tsx`
- `client-v2/src/app/ShareGistDialog/`
- `client-v2/src/widgets/layout-shell/ui/BasePhonePager.tsx`
- `client-v2/e2e/gist-sharing.e2e.spec.ts`
