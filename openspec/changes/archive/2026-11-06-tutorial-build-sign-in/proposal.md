# Proposal

## Why

Once [HOO-2422](https://linear.app/solana-fndn/issue/HOO-2422) puts the build server behind `/api/build-server`, a build through it needs a GitHub sign-in and a signed-out build answers 401 with `reason: "signed-out"`. Signed-out learners are the tutorials' main audience, and the tutorial's Build act has no state for that answer: Hello Anchor's first Build, and every tutorial's, shows a red "Build failed" card with the refusal as a log. [HOO-2661](https://linear.app/solana-fndn/issue/HOO-2661) must land no later than HOO-2422 reaches users.

## What Changes

- A tutorial build the server refuses for sign-in becomes a build result of its own, `signed_out`, beside `compiler` and `unreachable`. It is kept across a reload, has nothing to explain, and is not reported to the team as an error.
- Its result card is a stopped card, not a red failure: head "Sign in to build", line "Builds run on Playground's build server, which needs a GitHub sign-in. Your code stays in this browser.", one primary "Sign in with GitHub". Signing in opens GitHub in a popup, so the page and the step never leave. Once someone is signed in, the same card's primary reads "Build" and runs the build act again. ⌘↵ presses the primary.
- A build-and-deploy whose build was refused for sign-in says "Sign in with GitHub to build." on its failed deploy card.
- Telemetry: no event is added, renamed or removed. The tutorial's existing run-ended event reports such a build with outcome `failed`, as it reports `unreachable`.

## Capabilities

### New Capabilities

### Modified Capabilities

- `tutorial-runs`: a build refused for sign-in has its own result and card.

## Impact

- `client-v2/src/features/tutorial-conversation` (build runner, result type, reload parsing, Explain), `client-v2/src/widgets/tutorial-conversation/ui` (result card, ⌘↵, session read), one predicate in the legacy root `client-v2/src/utils`.
- Before HOO-2422 lands no server answers `signed-out`, so nothing changes for users until then.
- Out of scope: the Build stage, terminal and status bar outside a tutorial (HOO-2422's own PR); asking for sign-in earlier, on the intro card (a question for Almaz); a telemetry outcome of its own for the refusal.
