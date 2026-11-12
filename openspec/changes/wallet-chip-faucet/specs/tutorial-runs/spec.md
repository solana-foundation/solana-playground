# Spec Delta

## MODIFIED Requirements

### Requirement: The airdrop act funds the wallet for the deploy

An airdrop act card SHALL be titled by its beat ("Get devnet SOL"), with the
context line "{short address} · {balance} SOL" and one primary button, its
beat's `button` ("Request airdrop"). It needs no sign-in. A press SHALL
request one devnet airdrop of the shortfall against the next deploy's cost
(priced on a 400 KB build while the build's length is unknown), plus fee
headroom, capped at the faucet's amount. It SHALL wait for the
balance to show it, and land with the record "Added {amount} SOL". The
terminal SHALL print "Airdropping {amount} SOL...".

When the lesson reaches the card and the wallet already holds the deploy's
cost, the card SHALL land without a press and without an airdrop, and the
lesson flows on. Only the lesson's first airdrop act, in beat order, SHALL
show that pass, with the record "Your wallet has {balance} SOL". A later
airdrop act SHALL stay out of the feed, its card and its say line both,
until the balance check answers: funded, it SHALL pass with no card, no say
line and no record, and the next card is the deploy's; short, a check
that failed, or one with no answer after 5 seconds SHALL show the card and
its say line as usual. A reload that
reaches the card again, never pressed, interrupted or refused, checks the
balance again.

With no wallet in the browser, the context line SHALL read "A new Playground
wallet, made in this browser", and the same press SHALL make the Playground
wallet, then airdrop, landing with the record "Made a wallet and added {amount}
SOL". The lesson never shows the deploy's "No wallet" card when it reaches the
airdrop card first; that card stays for the deploy as a fallback.

A refused or rate-limited airdrop, or one whose balance never moved, SHALL
post the red result card "Not enough devnet SOL" (`aria-label="Not enough
SOL"`), with the line "Your wallet has {balance} SOL, and this deploy needs
about {cost} SOL." followed by the cause. For a rate limit (a 429 or the
faucet's limit message) it SHALL read "The devnet faucet is at its limit.",
and for any other failure "The airdrop didn't go through." It SHALL NOT say
to try again in a minute. The cost is an estimate, rounded to two decimals
("about 2.81 SOL"); the balance keeps its exact figure. Under the line SHALL
sit the web faucet in three numbered steps (`aria-label="Get devnet SOL from
the web faucet"`): "Open the web faucet and sign in with GitHub. It asks for a public repo: if you have none, fork solana-playground there", "Confirm the airdrop. Your address and 5 SOL are filled
in" and "Come back here and press Try again". Under them sit "Your wallet"
with the whole address and Copy, and the outlined link "Open the web faucet"
(`https://faucet.solana.com/?walletAddress=<address>&amount=5&cluster=devnet`,
new tab). A live airdrop card follows it, with the line "Asks the faucet again"
and the button "Try again".

The run SHALL report `tutorial_action_run` with `action: "airdrop"` and the
outcome `ok`, `no_wallet`, `no_funds`, `failed` or `interrupted`, like any act.

#### Scenario: A fresh wallet presses Request airdrop (manual)

- **WHEN** a learner with 0 SOL presses "Request airdrop" on Hello Anchor's
  airdrop card, and the faucet answers
- **THEN** the terminal prints "Airdropping {amount} SOL...", the card lands
  with "Added {amount} SOL", and the deploy card follows

#### Scenario: A funded wallet passes on its own (manual)

- **WHEN** the lesson reaches Hello Anchor's step 2 airdrop card with
  {balance} SOL in the wallet, at least the deploy's cost
- **THEN** no airdrop is requested, the card lands with "Your wallet has
  {balance} SOL", and the deploy card follows with no press

#### Scenario: A later deploy with a funded wallet shows no airdrop card (manual)

- **WHEN** Hello Anchor's step 4 reaches its airdrop act and the wallet holds
  the upgrade's cost
- **THEN** no airdrop card, say line or record shows, not even while the
  balance is checked, and the next card is "Build & deploy"

#### Scenario: A later deploy with a short wallet shows its airdrop card (manual)

- **WHEN** Hello Anchor's step 4 reaches its airdrop act and the wallet is
  short of the upgrade's cost, or the balance check fails
- **THEN** the say line "Your upgrade pays in devnet SOL too. Top the wallet
  up if it runs short." and the live "Get devnet SOL" card show

#### Scenario: A reload onto a refused airdrop checks again (manual)

- **WHEN** the faucet refused the airdrop, the learner tops the wallet up at
  faucet.solana.com and reloads the page
- **THEN** the balance is checked again, and the card passes with no press

#### Scenario: No wallet yet (manual)

- **WHEN** a fresh browser with no Playground wallet reaches the airdrop card
- **THEN** the context reads "A new Playground wallet, made in this browser",
  and one press of "Request airdrop" makes the wallet and lands with "Made a
  wallet and added {amount} SOL"

#### Scenario: The faucet refuses (manual)

- **WHEN** the faucet answers 429 to a press
- **THEN** the red "Not enough devnet SOL" card posts with the balance, the
  cost, "The devnet faucet is at its limit." and the three web faucet steps,
  and a live card "Asks the faucet again" with "Try again" follows it

### Requirement: The deploy does not fund the wallet

A tutorial deploy SHALL NOT request an airdrop. It SHALL check the wallet's
balance against the deploy's cost: before the build on the estimate only when
the last build's length is known and the build will not rerun, and after the
build on the real binary whenever that check was skipped or the binary
outgrew the estimate. An unknown length is never priced at the 400 KB default
to stop a deploy. When the balance is short, it SHALL stop before writing
the buffer and post the red "Not enough devnet SOL" card, with the three web
faucet steps, the wallet row and "Open the web faucet" as the airdrop's, and
the line "Your wallet has {balance} SOL, and this deploy needs about {cost}
SOL." The deploy never asked the faucet, so the line names no cause. The live deploy card that follows reads "Checks
your balance again, then deploys", with "Try again". The deploy card's stages
SHALL be Building (when stale), Writing buffer, Deploying and Confirming: there
is no "Funding your wallet" stage.

#### Scenario: A short wallet reaches the deploy (manual)

- **WHEN** a learner's wallet holds less than the deploy's cost at the deploy
- **THEN** no airdrop is requested, and the "Not enough devnet SOL" card posts
  with the balance, the cost and the three web faucet steps, followed by
  "Checks your balance again, then deploys"

#### Scenario: An upgrade of unknown length on a wallet that covers it (manual)

- **WHEN** Hello Anchor's step 4 builds and deploys an upgrade, the last
  build's length is unknown, and the wallet holds 2.98 SOL: short of the
  estimate on 400 KB, enough for the real binary
- **THEN** the deploy builds, checks the balance on the real binary, and
  upgrades the program

#### Scenario: A learner tops up from the faucet site and retries (manual)

- **WHEN** the learner funds the wallet at faucet.solana.com and presses "Try
  again"
- **THEN** the deploy checks the balance, finds it enough, and deploys
