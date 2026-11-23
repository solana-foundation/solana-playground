# Design

## Claim, not verification

The source line is read from the link, which anyone can write. HOO-2745 keeps
`from` on solana.com, so "Back to the docs" cannot point elsewhere, but it
does not tie the code to that page. Two ways out:

1. Show the source as the link's claim.
2. Show "From solana.com" only when the code's hash is on a list the docs site
   publishes.

Option 2 needs a published list (nothing in the docs site or this repo
provides one) and a fetch on every open. Option 1 needs nothing outside this
repo, ships before the release, and stays true whatever the link says. Taken:
option 1. Option 2 can be layered on later: a verified link would earn the
plain "From solana.com" title.

## Funding cap

`MAX_LINK_SOL = 1`. The funding card is the only thing `sol` drives; a link
asking for more than the cap is rejected in `decodeDocsLink` with reason
`sol`, the same path as `0` or `lots`, so the broken-link page and its
telemetry need no new case. Clamping was rejected: a clamped card would ask
for less than the script then spends, and fail it midway.

## Confirm before the first Run

`PgClientRun.start()` gains a step before the wallet setup: when a link
opened the project and this link's Run has not been confirmed, the state
becomes `confirm` (with the state to return to) and `start` waits for an
answer. `confirmRun()` marks the link confirmed and goes on; `cancelRun()`
returns to the previous state. A new link, a broken link or another project
answers "no" and clears the mark, so a pending start never runs a project
that is no longer open.

The dialog is `BaseRunConfirm`, built from `shared/ui/modal` and
`shared/ui/code-block`, since a feature may not import the `ModalFrame`
widget (the same reason `BaseFundDialog` gives). `RunButton` mounts it; only
one `RunButton` is mounted at a time (`StageBar` renders one or the other).
