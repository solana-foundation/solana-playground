# Proposal

## Why

Row W4 of the security register (HOO-2883, epic HOO-2872). An `/open` link
names its own source, and the callout above the code reads "From solana.com:
<title>" for whatever code the link's author put in it. The link can also ask
the user to fund the Playground wallet with any amount. One press of Run then
lets that code sign with the wallet. A crafted link can pass its author's code
off as an official docs example.

## What Changes

- The callout states the source as the link's claim, not as a fact: "Opened
  from a link: <title>", then "The link says it comes from <host>. Playground
  can't check that, so read the code before you run it." The ticket offered a
  second option, "From solana.com" only for code whose hash the docs site
  publishes; no such list exists, and building one needs the docs team before
  the release, so the claim wording is taken.
- A link's `sol` is capped at 1 SOL. A larger value breaks the link with the
  existing `sol` reason, as any other bad value does. The Quickstart asks for
  0.02.
- The first Run of a project a link opened asks first, in a dialog that shows
  the file's code, the link's claimed source, and that the code runs with the
  Playground wallet. Run runs it; Cancel runs nothing. The answer holds until
  another link or project opens. A `run` typed in the terminal is the user's
  own command and is not asked about.

Events: none added, renamed or removed. The `docs_link_*` events are kept;
a Run the user confirms still sends `docs_link_run_started` and
`docs_link_run_finished`, and a cancelled question sends nothing.

## Impact

- `client-v2/src/features/docs-link`: `lib/link.ts` (cap), `model/run.ts`
  (confirm step), `ui/BaseRunCallout.tsx` (claim), a new
  `ui/BaseRunConfirm.tsx` built from `shared/ui/modal`, connected as
  `ui/RunConfirm.tsx` and mounted once in `views/flow/Flow.tsx`.
- `client-v2/src/views/sidebar/explorer`: the menu's Run asks through
  `PgClientRun.askFirst()`.
- `client-v2/e2e/docs-open-link.e2e.spec.ts`: Run now confirms first.
- `docs/open-in-playground-link.md`: the cap.

Out of scope: verifying a link's code against a list the docs site publishes
(no such list exists); asking before a `run` or `test` typed in the terminal,
which is the user's own command; the link format itself (`v=1` stays).
