# Design

## Context

The build runner (`features/tutorial-conversation/model/runners/build.ts`) turns a throw from `PgCommand.build` into a result: no answer is `unreachable`, anything else `compiler` with the text as its log. `/api/build-server` (HOO-2422, SF#119) refuses a signed-out build with JSON carrying `reason: "signed-out"` (`SIGNED_OUT_REASON` in `features/auth`), which `PgServerRequestError.reason` carries. A feature may not import another feature, so `tutorial-conversation` cannot read `features/auth`.

## Goals / Non-Goals

**Goals:** a refusal for sign-in is its own build result end to end (runner, persistence, Explain, card, ⌘↵), and the card's primary follows the session.

**Non-Goals:** checking the session before sending (HOO-2422 settled on the route's 401); building by itself after sign-in.

## Decisions

- **`signed_out` is a `BuildFailure`**, beside `unreachable`, not a new act state. The result card already stands in for the act that ran, so the card is the stopped state the no-wallet deploy card is. `parseResult` keeps it on load, as it keeps `unreachable`.
- **Detection lives in the legacy root**: `utils/sign-in-refusal.ts` exports `isSignInRefusalError(e)`, comparing the error's `reason` with `SIGNED_OUT_REASON`. Legacy roots sit outside the layer check and may import a feature, as SF#119's `utils/server.ts` does; the constant stays declared once. Duck-typed on `reason`, it is false until SF#119 lands. Alternative: inject a predicate into the runner from the widget; rejected, since `runBuild` is also called inside the deploy runner and the injection would thread through three modules.
- **The widget reads the session**, the feature does not: `BaseResultCard` takes `signedIn` and `onSignIn`; the connected tutorial widget reads `PgSession` and signs in through `PgSession.signIn` (a popup).
- **No build by itself after sign-in.** The ticket asks for the return to show "Build"; one press builds. The Build stage outside a tutorial builds by itself (SF#119, accepted 6 Nov 13:58); the difference goes to the designers' batch as a gap.
- **Neutral, not red.** Design alignment (6 Nov 13:50, on SF#119): a refusal for sign-in is not a failure. The head takes a muted icon and the card a plain border.

## Risks / Trade-offs

- [SF#119 renames or drops `reason`] → the predicate's unit test pins the shape, and the HOO-2422 session is told the predicate's name.
- [Telemetry counts the refusal as `failed`] → noted in the proposal; an outcome of its own is a follow-up.
