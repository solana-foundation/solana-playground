# Proposal

## Why

Automatic devnet airdrop is off by default (Slava, 6 Nov 20:26). A tutorial
deploy still tops the wallet up by itself: a "Funding your wallet" stage
inside the deploy card airdrops without the learner asking. That no longer
matches the product default, and the learner never sees where the SOL comes
from. In the 6 Nov Slack thread (18:16–18:25) Sergey Prokhorov asked for an
explicit airdrop step before the deploy, and Slava accepted. Slava approved
this design on 6 Nov at 22:36 (HOO-2677).

## What Changes

- A new act kind, `airdrop`. Its card, "Get devnet SOL", has one primary
  button, "Request airdrop", and shows the wallet's short address and balance.
  The tutorial sits it right before the deploy act.
- A wallet that already holds enough for the deploy passes the airdrop card
  on its own, with no press and no airdrop. The card closes on the line
  "Your wallet has {balance} SOL".
- A refused or rate-limited airdrop posts the existing red "Not enough devnet
  SOL" card, with a live airdrop card under it, "Asks the faucet again", and
  the button "Try again".
- The deploy runner stops airdropping. A short wallet stops the deploy on
  "Not enough devnet SOL", and its Try again checks the balance again before
  deploying; it does not ask the faucet. The "Funding your wallet" stage is
  gone.
- Hello Anchor and Zero Copy get an airdrop act before every deploy act.
  `AUTHORING.md` states the rule: every deploy or build-and-deploy act has an
  airdrop act since the previous one.
- Telemetry: `tutorial_action_run` gains `action: "airdrop"`. The outcomes
  stay the same, with `no_funds` for a refused airdrop. No event is added,
  renamed or removed.
- Funnel: the tutorial's deploy step keeps `tutorial_action_run`. The airdrop
  step reports through the same event. No other funnel event changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tutorial-definition`: an act may be `airdrop`.
- `tutorial-runs`: the airdrop act funds the wallet, and the deploy no longer
  does.

## Impact

- Code: `entities/tutorial` (the act union, check, schema, telemetry),
  `features/tutorial-conversation` (a new airdrop runner, the deploy runner,
  the store's auto-press, view and progress), `widgets/tutorial-conversation`
  (card icon and done line), and tutorials `hello-anchor` and `zero-copy`.
- Out of scope: run and call acts keep their small fee top-up
  (`run-call.ts`); after the airdrop the wallet has headroom for them. The
  editor's deploy and the `wallet.automaticAirdrop` setting are not touched.
  Lumberjack is not in this branch (it lives in PR #390). Its author gets the
  `AUTHORING.md` rule and a comment on #390.
- The `tutorial-flow-v2` change's "Too little balance" and "Airdrop refused"
  paragraphs are rewritten to match.
